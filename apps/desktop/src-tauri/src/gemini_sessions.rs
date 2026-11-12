//! Gemini CLI : lit les journaux de conversation qu'il ajoute ligne à ligne
//! (`~/.gemini/tmp/<projet>/chats/session-*.jsonl`).
//!
//! Format vérifié dans google-gemini/gemini-cli (packages/core/src/services/
//! chatRecordingService.ts et chatRecordingTypes.ts) : une première ligne de
//! métadonnées (`sessionId`, `projectHash`, `startTime`, `kind`), puis un
//! message par ligne (`id`, `timestamp`, `type` user|gemini|info|error|warning).
//! Un message `gemini` est réécrit en entier, avec le même `id`, chaque fois que
//! ses appels d'outils ou ses jetons changent : on retient ce qui a déjà été
//! signalé pour ne rien compter deux fois. Les lignes `$set`, `$patch` et
//! `$rewindTo` ne portent pas d'activité nouvelle.
//!
//! Le dossier du projet n'est pas dans le journal : il est dans le fichier
//! `.project_root` que Gemini CLI écrit à côté (config/projectRegistry.ts).

use crate::tail::{self, Poll, Tail};
use chrono::Utc;
use serde_json::Value;
use session_events::{EventKind, Provider, SessionEvent};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
};

#[derive(Default)]
struct Context {
    id: String,
    project_path: Option<String>,
    model: Option<String>,
    users: HashSet<String>,
    tokens: HashSet<String>,
    started_tools: HashSet<String>,
    finished_tools: HashSet<String>,
}

pub struct GeminiMonitor {
    roots: Vec<PathBuf>,
    tail: Tail,
    contexts: HashMap<PathBuf, Context>,
}

/// `~/.gemini/tmp`, et `~/.cache/.gemini/tmp` où Gemini CLI écrit quand il
/// tourne dans le bac à sable macOS (config/storage.ts, getGlobalRuntimeDir).
pub fn roots() -> Vec<PathBuf> {
    let home = tail::home();
    vec![
        home.join(".gemini").join("tmp"),
        home.join(".cache").join(".gemini").join("tmp"),
    ]
}

impl GeminiMonitor {
    pub fn new(roots: Vec<PathBuf>) -> Self {
        Self::with_tail(roots, Tail::new())
    }

    fn with_tail(roots: Vec<PathBuf>, tail: Tail) -> Self {
        Self {
            roots,
            tail,
            contexts: HashMap::new(),
        }
    }

    fn chats(&self) -> Vec<PathBuf> {
        self.roots
            .iter()
            .flat_map(|root| tail::subdirs(root))
            .flat_map(|project| {
                tail::recent_files(&project.join("chats"), |name| {
                    name.starts_with("session-") && name.ends_with(".jsonl")
                })
            })
            .collect()
    }
}

impl Poll for GeminiMonitor {
    fn poll(&mut self, prompts: bool, commands: bool) -> Vec<SessionEvent> {
        let mut events = Vec::new();
        for path in self.chats() {
            let read = self.tail.read(&path);
            if read.fresh {
                let project = path
                    .parent()
                    .and_then(Path::parent)
                    .and_then(|dir| fs::read_to_string(dir.join(".project_root")).ok())
                    .map(|root| root.trim().to_owned())
                    .filter(|root| !root.is_empty());
                self.contexts.insert(
                    path.clone(),
                    Context {
                        id: path
                            .file_stem()
                            .and_then(|stem| stem.to_str())
                            .unwrap_or("gemini-session")
                            .to_owned(),
                        project_path: project,
                        ..Context::default()
                    },
                );
            }
            let context = self.contexts.entry(path).or_default();
            for record in tail::json_lines(&read.lines) {
                events.extend(project_record(&record, context, prompts, commands));
            }
        }
        events
    }
}

fn project_record(
    record: &Value,
    context: &mut Context,
    prompts: bool,
    commands: bool,
) -> Vec<SessionEvent> {
    if record.get("$set").is_some()
        || record.get("$patch").is_some()
        || record.get("$rewindTo").is_some()
    {
        return Vec::new();
    }
    let at = tail::parse_time(record.get("timestamp")).unwrap_or_else(Utc::now);
    let Some(kind) = record.get("type").and_then(Value::as_str) else {
        // Ligne de métadonnées : début de session.
        if let Some(id) = record.get("sessionId").and_then(Value::as_str) {
            context.id = id.to_owned();
            let mut started = event(context, EventKind::SessionStarted);
            started.occurred_at = tail::parse_time(record.get("startTime")).unwrap_or(at);
            return vec![started];
        }
        return Vec::new();
    };
    let id = record
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    let stamp = |mut event: SessionEvent| {
        event.occurred_at = at;
        event
    };
    match kind {
        "user" => {
            if id.is_empty() || !context.users.insert(id) {
                return Vec::new();
            }
            let mut message = stamp(event(context, EventKind::UserMessage));
            if prompts {
                message.content = tail::content_text(record.get("content"));
            }
            vec![message]
        }
        "gemini" => {
            if let Some(model) = record.get("model").and_then(Value::as_str) {
                context.model = Some(model.to_owned());
            }
            let mut events = Vec::new();
            for call in record
                .get("toolCalls")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                let Some(call_id) = call.get("id").and_then(Value::as_str) else {
                    continue;
                };
                let name = call
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or("tool")
                    .to_owned();
                let args = call.get("args");
                let file_path = tail::tool_path(args);
                let command = tail::tool_command(args, commands);
                let call_at = tail::parse_time(call.get("timestamp")).unwrap_or(at);
                if context.started_tools.insert(call_id.to_owned()) {
                    let mut started = event(context, EventKind::ToolStarted);
                    started.occurred_at = call_at;
                    started.tool_name = Some(name.clone());
                    started.file_path = file_path.clone();
                    started.command = command.clone();
                    events.push(started);
                }
                // CoreToolCallStatus (scheduler/types.ts) : les trois états finaux.
                let status = call.get("status").and_then(Value::as_str);
                let finished_kind = match status {
                    Some("success") => EventKind::ToolFinished,
                    Some("error" | "cancelled") => EventKind::ToolFailed,
                    _ => continue,
                };
                if context.finished_tools.insert(call_id.to_owned()) {
                    let mut finished = event(context, finished_kind);
                    finished.occurred_at = call_at;
                    finished.tool_name = Some(name);
                    finished.file_path = file_path;
                    finished.command = command;
                    if finished_kind == EventKind::ToolFailed {
                        finished.outcome = Some(if status == Some("cancelled") {
                            "cancelled".to_owned()
                        } else {
                            crate::redact::failure_outcome(
                                call.get("resultDisplay").and_then(Value::as_str),
                            )
                        });
                    }
                    events.push(finished);
                }
            }
            if let Some(tokens) = record.get("tokens").filter(|tokens| tokens.is_object())
                && !id.is_empty()
                && context.tokens.insert(id)
            {
                events.extend(usage(context, tokens, at));
            }
            events
        }
        _ => Vec::new(),
    }
}

/// `TokensSummary` : `input` est `promptTokenCount` (cache compris), `output`
/// est `candidatesTokenCount` (sans la réflexion, comptée à part dans
/// `thoughts`), `tool` est `toolUsePromptTokenCount`, facturé en entrée.
fn usage(context: &Context, tokens: &Value, at: chrono::DateTime<Utc>) -> Option<SessionEvent> {
    let number = |key: &str| tokens.get(key).and_then(Value::as_u64);
    let input = number("input");
    let output = number("output");
    if input.is_none() && output.is_none() {
        return None;
    }
    let cached = number("cached").unwrap_or(0);
    let thoughts = number("thoughts").unwrap_or(0);
    let tool = number("tool").unwrap_or(0);
    let mut usage = event(context, EventKind::ModelUsage);
    usage.occurred_at = at;
    usage.input_tokens = input.map(|input| {
        if cached == 0 && tool == 0 {
            tail::provider(input)
        } else {
            tail::derived((input + tool).saturating_sub(cached))
        }
    });
    usage.cache_read_tokens = (cached > 0).then(|| tail::provider(cached));
    usage.output_tokens = output.map(|output| {
        if thoughts == 0 {
            tail::provider(output)
        } else {
            tail::derived(output + thoughts)
        }
    });
    Some(usage)
}

fn event(context: &Context, kind: EventKind) -> SessionEvent {
    let mut event = SessionEvent::new(&context.id, Provider::GeminiCli, kind);
    event.project_path = context.project_path.clone();
    event.model = context
        .model
        .as_deref()
        .map(|model| tail::provider(model.to_owned()));
    event
}

#[cfg(test)]
mod tests {
    use super::*;
    use session_events::DataOrigin;
    use std::time::{Duration, SystemTime};

    fn write(path: &Path, lines: &[Value]) {
        let text: String = lines.iter().map(|line| format!("{line}\n")).collect();
        fs::write(path, text).unwrap();
    }

    #[test]
    fn a_new_chat_gives_its_project_prompts_tools_and_tokens_once() {
        let root = std::env::temp_dir().join(format!("gemini-{}", uuid::Uuid::new_v4()));
        let project = root.join("agent-observer");
        fs::create_dir_all(project.join("chats")).unwrap();
        fs::write(project.join(".project_root"), "/Users/me/agent-observer\n").unwrap();
        let chat = project
            .join("chats")
            .join("session-2026-11-12T10-00-abcd1234.jsonl");
        let meta = serde_json::json!({"sessionId": "s-1", "projectHash": "h", "startTime": "2026-11-12T10:00:00.000Z", "lastUpdated": "2026-11-12T10:00:00.000Z", "kind": "main"});
        let user = serde_json::json!({"id": "u1", "timestamp": "2026-11-12T10:00:01.000Z", "type": "user", "content": [{"text": "fix the bug"}]});
        let running = serde_json::json!({"id": "g1", "timestamp": "2026-11-12T10:00:02.000Z", "type": "gemini", "content": "", "model": "gemini-3-pro",
            "toolCalls": [{"id": "t1", "name": "replace", "args": {"file_path": "/Users/me/agent-observer/a.rs"}, "status": "executing", "timestamp": "2026-11-12T10:00:02.000Z"}]});
        write(&chat, &[meta.clone(), user.clone(), running.clone()]);

        let mut monitor = GeminiMonitor::with_tail(
            vec![root.clone()],
            Tail::since(SystemTime::now() - Duration::from_secs(60)),
        );
        let events = monitor.poll(true, false);
        let kinds: Vec<_> = events.iter().map(|event| event.kind).collect();
        assert_eq!(
            kinds,
            vec![
                EventKind::SessionStarted,
                EventKind::UserMessage,
                EventKind::ToolStarted
            ]
        );
        assert!(events.iter().all(|event| event.session_id == "s-1"
            && event.project_path.as_deref() == Some("/Users/me/agent-observer")));
        assert_eq!(events[1].content.as_deref(), Some("fix the bug"));
        assert_eq!(
            events[2].file_path.as_deref(),
            Some("/Users/me/agent-observer/a.rs")
        );

        // Le même message réécrit : outil terminé et jetons, signalés une seule fois.
        let done = serde_json::json!({"id": "g1", "timestamp": "2026-11-12T10:00:02.000Z", "type": "gemini", "content": "", "model": "gemini-3-pro",
            "toolCalls": [{"id": "t1", "name": "replace", "args": {"file_path": "/Users/me/agent-observer/a.rs"}, "status": "success", "timestamp": "2026-11-12T10:00:03.000Z"}],
            "tokens": {"input": 1000, "output": 50, "cached": 600, "thoughts": 20, "tool": 0, "total": 1070}});
        write(
            &chat,
            &[
                meta.clone(),
                user.clone(),
                running,
                done.clone(),
                serde_json::json!({"$set": {"lastUpdated": "x"}}),
            ],
        );
        let events = monitor.poll(true, false);
        let kinds: Vec<_> = events.iter().map(|event| event.kind).collect();
        assert_eq!(kinds, vec![EventKind::ToolFinished, EventKind::ModelUsage]);
        let usage = &events[1];
        assert_eq!(
            usage.input_tokens.as_ref().map(|v| (v.value, v.origin)),
            Some((400, DataOrigin::Derived))
        );
        assert_eq!(usage.cache_read_tokens.as_ref().map(|v| v.value), Some(600));
        assert_eq!(
            usage.output_tokens.as_ref().map(|v| (v.value, v.origin)),
            Some((70, DataOrigin::Derived))
        );
        assert_eq!(
            usage.model.as_ref().map(|m| m.value.as_str()),
            Some("gemini-3-pro")
        );

        let mut again = fs::read_to_string(&chat).unwrap();
        again.push_str(&format!("{done}\n"));
        fs::write(&chat, again).unwrap();
        assert!(monitor.poll(true, false).is_empty());
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn prompts_stay_out_unless_asked() {
        let mut context = Context::default();
        let user = serde_json::json!({"id": "u1", "timestamp": "2026-11-12T10:00:01.000Z", "type": "user", "content": "secret"});
        let events = project_record(&user, &mut context, false, false);
        assert_eq!(events[0].content, None);
        let call = serde_json::json!({"id": "g", "type": "gemini", "timestamp": "2026-11-12T10:00:01.000Z", "toolCalls": [{"id": "t", "name": "run_shell_command", "args": {"command": "rm -rf build"}, "status": "error", "resultDisplay": "exit 1"}]});
        let events = project_record(&call, &mut context, false, false);
        assert!(events.iter().all(|event| event.command.is_none()));
        assert_eq!(events[1].kind, EventKind::ToolFailed);
    }
}
