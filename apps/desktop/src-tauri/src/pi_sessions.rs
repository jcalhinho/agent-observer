//! pi et omp (oh-my-pi, dérivé de pi) : lit les journaux de session qu'ils
//! ajoutent ligne à ligne (`~/.pi/agent/sessions/<projet>/<date>_<id>.jsonl`,
//! `~/.omp/agent/sessions/...`).
//!
//! Format vérifié dans badlogic/pi-mono (packages/coding-agent/src/core/
//! session-manager.ts, packages/ai/src/types.ts) et can1357/oh-my-pi
//! (packages/coding-agent/src/session/session-entries.ts, packages/catalog/
//! src/types.ts) :
//! - `{"type":"session","id","cwd","timestamp"}` ouvre le fichier ;
//! - `{"type":"message","message":{role:user|assistant|toolResult,…}}` ;
//! - un message `assistant` porte `model`, ses appels d'outils (`toolCall`) et
//!   `usage` : `input` sans le cache, `cacheRead`, `cacheWrite`, `output`
//!   (réflexion comprise) ;
//! - `usage` (pi) et `model_usage` (omp) : appels au modèle hors conversation
//!   (réchauffage du cache, titres…), facturés eux aussi.
//!
//! pi n'écrit le fichier qu'à la première réponse du modèle, puis l'allonge.

use crate::tail::{self, Poll, Tail};
use chrono::Utc;
use serde_json::Value;
use session_events::{EventKind, Provider, SessionEvent};
use std::{collections::HashMap, env, path::PathBuf};

#[derive(Default)]
struct Context {
    id: String,
    project_path: Option<String>,
    model: Option<String>,
    tools: HashMap<String, (Option<String>, Option<String>)>,
}

pub struct PiMonitor {
    provider: Provider,
    roots: Vec<PathBuf>,
    tail: Tail,
    contexts: HashMap<PathBuf, Context>,
}

/// `~/.pi/agent/sessions`.
pub fn pi_roots() -> Vec<PathBuf> {
    vec![tail::home().join(".pi").join("agent").join("sessions")]
}

/// `~/.omp/agent/sessions`, et `$XDG_DATA_HOME/omp/sessions` quand omp a été
/// déplacé vers les dossiers XDG (pi-utils/src/dirs.ts).
pub fn omp_roots() -> Vec<PathBuf> {
    let mut roots = vec![tail::home().join(".omp").join("agent").join("sessions")];
    if let Some(data) = env::var_os("XDG_DATA_HOME") {
        roots.push(PathBuf::from(data).join("omp").join("sessions"));
    }
    roots
}

impl PiMonitor {
    pub fn new(provider: Provider, roots: Vec<PathBuf>) -> Self {
        Self::with_tail(provider, roots, Tail::new())
    }

    fn with_tail(provider: Provider, roots: Vec<PathBuf>, tail: Tail) -> Self {
        Self {
            provider,
            roots,
            tail,
            contexts: HashMap::new(),
        }
    }
}

impl Poll for PiMonitor {
    fn poll(&mut self, prompts: bool, commands: bool) -> Vec<SessionEvent> {
        let files: Vec<PathBuf> = self
            .roots
            .iter()
            .flat_map(|root| tail::subdirs(root))
            .flat_map(|dir| tail::recent_files(&dir, |name| name.ends_with(".jsonl")))
            .collect();
        let mut events = Vec::new();
        for path in files {
            let read = self.tail.read(&path);
            if read.fresh {
                // Le nom est `<date>_<id>.jsonl` : l'id suit le dernier `_`.
                let stem = path
                    .file_stem()
                    .and_then(|stem| stem.to_str())
                    .unwrap_or("pi-session");
                let id = stem.rsplit('_').next().unwrap_or(stem).to_owned();
                self.contexts.insert(
                    path.clone(),
                    Context {
                        id,
                        ..Context::default()
                    },
                );
            }
            let context = self.contexts.entry(path).or_default();
            for record in tail::json_lines(&read.lines) {
                events.extend(project_record(
                    self.provider,
                    &record,
                    context,
                    prompts,
                    commands,
                ));
            }
        }
        events
    }
}

fn project_record(
    provider: Provider,
    record: &Value,
    context: &mut Context,
    prompts: bool,
    commands: bool,
) -> Vec<SessionEvent> {
    let at = tail::parse_time(record.get("timestamp")).unwrap_or_else(Utc::now);
    let event = |context: &Context, kind| {
        let mut event = SessionEvent::new(&context.id, provider, kind);
        event.occurred_at = at;
        event.project_path = context.project_path.clone();
        event.model = context
            .model
            .as_deref()
            .map(|model| tail::provider(model.to_owned()));
        event
    };
    match record.get("type").and_then(Value::as_str) {
        Some("session") => {
            if let Some(id) = record.get("id").and_then(Value::as_str) {
                context.id = id.to_owned();
            }
            context.project_path = record.get("cwd").and_then(Value::as_str).map(str::to_owned);
            vec![event(context, EventKind::SessionStarted)]
        }
        Some("model_change") => {
            // pi : `modelId` ; omp : `model` au format « fournisseur/modèle ».
            let model = record.get("modelId").and_then(Value::as_str).or_else(|| {
                record
                    .get("model")
                    .and_then(Value::as_str)
                    .map(|model| model.split_once('/').map_or(model, |(_, id)| id))
            });
            if let Some(model) = model {
                context.model = Some(model.to_owned());
            }
            Vec::new()
        }
        Some("usage" | "model_usage") => {
            let model = record.get("model").and_then(Value::as_str);
            usage(
                event(context, EventKind::ModelUsage),
                record.get("usage"),
                model,
                None,
            )
            .into_iter()
            .collect()
        }
        Some("message") => {
            let Some(message) = record.get("message") else {
                return Vec::new();
            };
            match message.get("role").and_then(Value::as_str) {
                Some("user") => {
                    let mut user = event(context, EventKind::UserMessage);
                    if prompts {
                        user.content = tail::content_text(message.get("content"));
                    }
                    vec![user]
                }
                Some("assistant") => {
                    if let Some(model) = message.get("model").and_then(Value::as_str) {
                        context.model = Some(model.to_owned());
                    }
                    let mut events = Vec::new();
                    for call in message
                        .get("content")
                        .and_then(Value::as_array)
                        .into_iter()
                        .flatten()
                        .filter(|part| part.get("type").and_then(Value::as_str) == Some("toolCall"))
                    {
                        let args = call.get("arguments");
                        let file_path = tail::tool_path(args);
                        let command = tail::tool_command(args, commands);
                        if let Some(id) = call.get("id").and_then(Value::as_str) {
                            context
                                .tools
                                .insert(id.to_owned(), (file_path.clone(), command.clone()));
                        }
                        let mut started = event(context, EventKind::ToolStarted);
                        started.tool_name = Some(
                            call.get("name")
                                .and_then(Value::as_str)
                                .unwrap_or("tool")
                                .to_owned(),
                        );
                        started.file_path = file_path;
                        started.command = command;
                        events.push(started);
                    }
                    let duration = message.get("durationMs").and_then(Value::as_u64);
                    events.extend(usage(
                        event(context, EventKind::ModelUsage),
                        message.get("usage"),
                        None,
                        duration,
                    ));
                    events
                }
                Some("toolResult") => {
                    let failed = message.get("isError").and_then(Value::as_bool) == Some(true);
                    let (file_path, command) = message
                        .get("toolCallId")
                        .and_then(Value::as_str)
                        .and_then(|id| context.tools.remove(id))
                        .unwrap_or_default();
                    let mut finished = event(
                        context,
                        if failed {
                            EventKind::ToolFailed
                        } else {
                            EventKind::ToolFinished
                        },
                    );
                    finished.tool_name = message
                        .get("toolName")
                        .and_then(Value::as_str)
                        .map(str::to_owned);
                    finished.file_path = file_path;
                    finished.command = command;
                    if failed {
                        finished.outcome = Some(crate::redact::failure_outcome(None));
                    }
                    vec![finished]
                }
                _ => Vec::new(),
            }
        }
        _ => Vec::new(),
    }
}

fn usage(
    mut event: SessionEvent,
    usage: Option<&Value>,
    model: Option<&str>,
    duration: Option<u64>,
) -> Option<SessionEvent> {
    let usage = usage?;
    let number = |key: &str| usage.get(key).and_then(Value::as_u64);
    event.input_tokens = number("input").map(tail::provider);
    event.output_tokens = number("output").map(tail::provider);
    event.cache_read_tokens = number("cacheRead").filter(|n| *n > 0).map(tail::provider);
    event.cache_write_tokens = number("cacheWrite").filter(|n| *n > 0).map(tail::provider);
    event.duration_ms = duration.map(tail::provider);
    if let Some(model) = model {
        event.model = Some(tail::provider(model.to_owned()));
    }
    let any = [
        &event.input_tokens,
        &event.output_tokens,
        &event.cache_read_tokens,
        &event.cache_write_tokens,
    ]
    .iter()
    .any(|value| value.as_ref().is_some_and(|value| value.value > 0));
    any.then_some(event)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        time::{Duration, SystemTime},
    };

    #[test]
    fn a_pi_session_gives_tools_and_tokens_with_the_cache_apart() {
        let root = std::env::temp_dir().join(format!("pi-{}", uuid::Uuid::new_v4()));
        let dir = root.join("--Users-me-app--");
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("2026-11-12T10-00-00-000Z_abc-123.jsonl");
        let lines = [
            serde_json::json!({"type": "session", "version": 3, "id": "abc-123", "timestamp": "2026-11-12T10:00:00.000Z", "cwd": "/Users/me/app"}),
            serde_json::json!({"type": "model_change", "id": "1", "parentId": null, "timestamp": "2026-11-12T10:00:00.000Z", "provider": "anthropic", "modelId": "claude-sonnet-4-5"}),
            serde_json::json!({"type": "message", "id": "2", "parentId": "1", "timestamp": "2026-11-12T10:00:01.000Z", "message": {"role": "user", "content": "hello", "timestamp": 1}}),
            serde_json::json!({"type": "message", "id": "3", "parentId": "2", "timestamp": "2026-11-12T10:00:02.000Z", "message": {"role": "assistant", "model": "claude-sonnet-4-5", "durationMs": 900,
                "content": [{"type": "text", "text": "ok"}, {"type": "toolCall", "id": "c1", "name": "bash", "arguments": {"command": "ls"}}],
                "usage": {"input": 10, "output": 5, "cacheRead": 2000, "cacheWrite": 30, "totalTokens": 2045, "cost": {}}, "stopReason": "toolUse"}}),
            serde_json::json!({"type": "message", "id": "4", "parentId": "3", "timestamp": "2026-11-12T10:00:03.000Z", "message": {"role": "toolResult", "toolCallId": "c1", "toolName": "bash", "content": [], "isError": true}}),
        ];
        fs::write(
            &file,
            lines
                .iter()
                .map(|line| format!("{line}\n"))
                .collect::<String>(),
        )
        .unwrap();
        let mut monitor = PiMonitor::with_tail(
            Provider::Pi,
            vec![root.clone()],
            Tail::since(SystemTime::now() - Duration::from_secs(60)),
        );
        let events = monitor.poll(false, true);
        let kinds: Vec<_> = events.iter().map(|event| event.kind).collect();
        assert_eq!(
            kinds,
            vec![
                EventKind::SessionStarted,
                EventKind::UserMessage,
                EventKind::ToolStarted,
                EventKind::ModelUsage,
                EventKind::ToolFailed
            ]
        );
        assert!(
            events
                .iter()
                .all(|event| event.session_id == "abc-123" && event.provider == Provider::Pi)
        );
        assert_eq!(events[1].content, None);
        assert_eq!(events[2].command.as_deref(), Some("ls"));
        let usage = &events[3];
        assert_eq!(usage.input_tokens.as_ref().map(|v| v.value), Some(10));
        assert_eq!(
            usage.cache_read_tokens.as_ref().map(|v| v.value),
            Some(2000)
        );
        assert_eq!(usage.cache_write_tokens.as_ref().map(|v| v.value), Some(30));
        assert_eq!(usage.duration_ms.as_ref().map(|v| v.value), Some(900));
        assert_eq!(events[4].command.as_deref(), Some("ls"));
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn omp_names_its_model_with_the_provider_and_logs_side_calls() {
        let mut context = Context::default();
        project_record(
            Provider::Omp,
            &serde_json::json!({"type": "model_change", "timestamp": "2026-11-12T10:00:00Z", "model": "anthropic/claude-opus-4-5"}),
            &mut context,
            false,
            false,
        );
        assert_eq!(context.model.as_deref(), Some("claude-opus-4-5"));
        let side = serde_json::json!({"type": "model_usage", "timestamp": "2026-11-12T10:00:00Z", "purpose": "title", "api": "x", "provider": "openai", "model": "gpt-5-mini", "usage": {"input": 40, "output": 8, "cacheRead": 0, "cacheWrite": 0, "totalTokens": 48}, "stopReason": "stop"});
        let events = project_record(Provider::Omp, &side, &mut context, false, false);
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].model.as_ref().map(|m| m.value.as_str()),
            Some("gpt-5-mini")
        );
        assert_eq!(events[0].cache_read_tokens, None);
    }
}
