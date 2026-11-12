//! Kimi Code (MoonshotAI/kimi-code, successeur du Kimi CLI en Python) : lit le
//! journal que chaque session ajoute ligne à ligne
//! (`~/.kimi-code/sessions/<espace>/<session>/wire.jsonl`, et celui de chaque
//! sous-agent dans `agents/<id>/wire.jsonl`).
//!
//! Format vérifié dans packages/agent-core-v2 (docs/wire-manifest.d.ts,
//! protocole 1.5, et src/agent/contextMemory/loopEventFold.ts) : chaque ligne
//! est `{"type", …, "time"}` (millisecondes) ;
//! - `metadata` ouvre le journal ;
//! - `llm.request` donne le modèle (`kind` loop) ;
//! - `turn.prompt` est un message, `origin` user pour ceux de l'utilisateur ;
//! - `context.append_loop_event` porte `event` : `tool.call`, `tool.result`, et
//!   `step.end` avec l'usage d'un appel au modèle (`inputOther` sans le cache,
//!   `inputCacheRead`, `inputCacheCreation`, `output`) ;
//! - `turn.ended` clôt un tour (`reason`, `durationMs`).
//!
//! Le dossier du projet vient de `~/.kimi-code/projects.json`
//! (`projects[<espace>].root`, app/workspace/workspacePersistence.ts).

use crate::tail::{self, Poll, Tail};
use chrono::Utc;
use serde_json::Value;
use session_events::{EventKind, Provider, SessionEvent};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    time::SystemTime,
};

#[derive(Default)]
struct Context {
    id: String,
    project_path: Option<String>,
    model: Option<String>,
    tools: HashMap<String, (String, Option<String>, Option<String>)>,
}

pub struct KimiMonitor {
    home: PathBuf,
    tail: Tail,
    contexts: HashMap<PathBuf, Context>,
    started: HashSet<String>,
    projects: HashMap<String, String>,
    projects_read: Option<SystemTime>,
}

/// `~/.kimi-code` (app/bootstrap/bootstrap.ts, resolveKimiHome).
pub fn home() -> PathBuf {
    tail::home().join(".kimi-code")
}

impl KimiMonitor {
    pub fn new(home: PathBuf) -> Self {
        Self::with_tail(home, Tail::new())
    }

    fn with_tail(home: PathBuf, tail: Tail) -> Self {
        Self {
            home,
            tail,
            contexts: HashMap::new(),
            started: HashSet::new(),
            projects: HashMap::new(),
            projects_read: None,
        }
    }

    fn refresh_projects(&mut self) {
        let path = self.home.join("projects.json");
        let modified = fs::metadata(&path).and_then(|meta| meta.modified()).ok();
        if modified.is_none() || modified == self.projects_read {
            return;
        }
        self.projects_read = modified;
        let Ok(text) = fs::read_to_string(&path) else {
            return;
        };
        let Ok(value) = serde_json::from_str::<Value>(&text) else {
            return;
        };
        if let Some(projects) = value.get("projects").and_then(Value::as_object) {
            self.projects = projects
                .iter()
                .filter_map(|(id, entry)| {
                    entry
                        .get("root")
                        .and_then(Value::as_str)
                        .map(|root| (id.clone(), root.to_owned()))
                })
                .collect();
        }
    }

    /// Chaque journal, avec l'espace et la session auxquels il appartient.
    fn journals(&self) -> Vec<(PathBuf, String, String)> {
        let mut found = Vec::new();
        for workspace in tail::subdirs(&self.home.join("sessions")) {
            let workspace_id = name_of(&workspace);
            for session in tail::subdirs(&workspace) {
                let session_id = name_of(&session);
                let mut files = vec![session.join("wire.jsonl")];
                files.extend(
                    tail::subdirs(&session.join("agents"))
                        .into_iter()
                        .map(|agent| agent.join("wire.jsonl")),
                );
                for file in files {
                    if file.is_file() && tail::recent(&file) {
                        found.push((file, workspace_id.clone(), session_id.clone()));
                    }
                }
            }
        }
        found
    }
}

fn name_of(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_owned()
}

impl Poll for KimiMonitor {
    fn poll(&mut self, prompts: bool, commands: bool) -> Vec<SessionEvent> {
        self.refresh_projects();
        let mut events = Vec::new();
        for (path, workspace, session) in self.journals() {
            let read = self.tail.read(&path);
            if read.fresh {
                self.contexts.insert(
                    path.clone(),
                    Context {
                        id: session,
                        project_path: self.projects.get(&workspace).cloned(),
                        ..Context::default()
                    },
                );
            }
            let context = self.contexts.entry(path).or_default();
            if context.project_path.is_none() {
                context.project_path = self.projects.get(&workspace).cloned();
            }
            for record in tail::json_lines(&read.lines) {
                events.extend(project_record(
                    &record,
                    context,
                    &mut self.started,
                    prompts,
                    commands,
                ));
            }
        }
        events
    }
}

fn project_record(
    record: &Value,
    context: &mut Context,
    started: &mut HashSet<String>,
    prompts: bool,
    commands: bool,
) -> Vec<SessionEvent> {
    let at = tail::parse_time(record.get("time").or_else(|| record.get("created_at")))
        .unwrap_or_else(Utc::now);
    let event = |context: &Context, kind| {
        let mut event = SessionEvent::new(&context.id, Provider::KimiCode, kind);
        event.occurred_at = at;
        event.project_path = context.project_path.clone();
        event.model = context
            .model
            .as_deref()
            .map(|model| tail::provider(model.to_owned()));
        event
    };
    match record.get("type").and_then(Value::as_str) {
        // Un sous-agent a son propre journal : la session ne commence qu'une fois.
        Some("metadata") if started.insert(context.id.clone()) => {
            vec![event(context, EventKind::SessionStarted)]
        }
        Some("llm.request") => {
            if record.get("kind").and_then(Value::as_str) == Some("loop")
                && let Some(model) = record.get("model").and_then(Value::as_str)
            {
                context.model = Some(model.to_owned());
            }
            Vec::new()
        }
        Some("turn.prompt") if record.get("origin").and_then(Value::as_str) == Some("user") => {
            let mut user = event(context, EventKind::UserMessage);
            if prompts {
                user.content = tail::content_text(record.get("input"));
            }
            vec![user]
        }
        Some("turn.ended") => {
            let mut checkpoint = event(context, EventKind::Checkpoint);
            checkpoint.outcome = record
                .get("reason")
                .and_then(Value::as_str)
                .map(|reason| format!("turn-{reason}"));
            checkpoint.duration_ms = record
                .get("durationMs")
                .and_then(Value::as_u64)
                .map(tail::provider);
            vec![checkpoint]
        }
        Some("context.append_loop_event") => {
            let Some(loop_event) = record.get("event") else {
                return Vec::new();
            };
            match loop_event.get("type").and_then(Value::as_str) {
                Some("tool.call") => {
                    let name = loop_event
                        .get("name")
                        .and_then(Value::as_str)
                        .unwrap_or("tool")
                        .to_owned();
                    let args = loop_event.get("args");
                    let file_path = tail::tool_path(args);
                    let command = tail::tool_command(args, commands);
                    if let Some(id) = loop_event.get("toolCallId").and_then(Value::as_str) {
                        context.tools.insert(
                            id.to_owned(),
                            (name.clone(), file_path.clone(), command.clone()),
                        );
                    }
                    let mut started = event(context, EventKind::ToolStarted);
                    started.tool_name = Some(name);
                    started.file_path = file_path;
                    started.command = command;
                    vec![started]
                }
                Some("tool.result") => {
                    let result = loop_event.get("result");
                    let failed = result
                        .and_then(|result| result.get("isError"))
                        .and_then(Value::as_bool)
                        == Some(true);
                    let (name, file_path, command) = loop_event
                        .get("toolCallId")
                        .and_then(Value::as_str)
                        .and_then(|id| context.tools.remove(id))
                        .unwrap_or_else(|| ("tool".to_owned(), None, None));
                    let mut finished = event(
                        context,
                        if failed {
                            EventKind::ToolFailed
                        } else {
                            EventKind::ToolFinished
                        },
                    );
                    finished.tool_name = Some(name);
                    finished.file_path = file_path;
                    finished.command = command;
                    finished.duration_ms = result
                        .and_then(|result| result.get("durationMs"))
                        .and_then(Value::as_u64)
                        .map(tail::provider);
                    if failed {
                        finished.outcome = Some(crate::redact::failure_outcome(None));
                    }
                    vec![finished]
                }
                Some("step.end") => {
                    let Some(usage) = loop_event.get("usage") else {
                        return Vec::new();
                    };
                    let number = |key: &str| usage.get(key).and_then(Value::as_u64);
                    let mut used = event(context, EventKind::ModelUsage);
                    used.input_tokens = number("inputOther").map(tail::provider);
                    used.output_tokens = number("output").map(tail::provider);
                    used.cache_read_tokens = number("inputCacheRead")
                        .filter(|n| *n > 0)
                        .map(tail::provider);
                    used.cache_write_tokens = number("inputCacheCreation")
                        .filter(|n| *n > 0)
                        .map(tail::provider);
                    used.duration_ms = loop_event
                        .get("llmStreamDurationMs")
                        .and_then(Value::as_u64)
                        .map(tail::provider);
                    vec![used]
                }
                _ => Vec::new(),
            }
        }
        _ => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn a_kimi_session_gives_its_folder_tools_tokens_and_turns() {
        let home = std::env::temp_dir().join(format!("kimi-{}", uuid::Uuid::new_v4()));
        let session = home.join("sessions").join("ws1").join("sess-1");
        fs::create_dir_all(session.join("agents").join("sub")).unwrap();
        fs::write(home.join("projects.json"), r#"{"schema_version":2,"projects":{"ws1":{"root":"/Users/me/app","name":"app","created_at":"x","last_opened_at":"x"}},"deleted_project_ids":[]}"#).unwrap();
        let lines = [
            serde_json::json!({"type": "metadata", "protocol_version": "1.5", "created_at": 1_762_940_000_000_i64}),
            serde_json::json!({"type": "llm.request", "agentId": "main", "kind": "loop", "provider": "kimi", "model": "kimi-k3", "toolSelect": false, "systemPromptHash": "a", "toolsHash": "b", "messageCount": 1, "time": 1_762_940_000_100_i64}),
            serde_json::json!({"type": "turn.prompt", "agentId": "main", "input": [{"type": "text", "text": "salut"}], "origin": "user", "time": 1_762_940_000_050_i64}),
            serde_json::json!({"type": "context.append_loop_event", "agentId": "main", "event": {"type": "tool.call", "stepUuid": "s", "toolCallId": "t1", "name": "Write", "args": {"path": "/Users/me/app/a.txt", "content": "x"}}, "time": 1_762_940_001_000_i64}),
            serde_json::json!({"type": "context.append_loop_event", "agentId": "main", "event": {"type": "tool.result", "toolCallId": "t1", "result": {"output": "ok", "durationMs": 12}}, "time": 1_762_940_001_100_i64}),
            serde_json::json!({"type": "context.append_loop_event", "agentId": "main", "event": {"type": "step.end", "uuid": "s", "usage": {"inputOther": 100, "output": 20, "inputCacheRead": 900, "inputCacheCreation": 0}}, "time": 1_762_940_001_200_i64}),
            serde_json::json!({"type": "turn.ended", "agentId": "main", "turnId": 1, "reason": "completed", "durationMs": 1500, "time": 1_762_940_001_300_i64}),
        ];
        fs::write(
            session.join("wire.jsonl"),
            lines
                .iter()
                .map(|line| format!("{line}\n"))
                .collect::<String>(),
        )
        .unwrap();
        fs::write(
            session.join("agents").join("sub").join("wire.jsonl"),
            format!("{}\n", lines[0]),
        )
        .unwrap();

        let mut monitor = KimiMonitor::with_tail(
            home.clone(),
            Tail::since(SystemTime::now() - Duration::from_secs(60)),
        );
        let events = monitor.poll(true, false);
        let kinds: Vec<_> = events.iter().map(|event| event.kind).collect();
        assert_eq!(
            kinds,
            vec![
                EventKind::SessionStarted,
                EventKind::UserMessage,
                EventKind::ToolStarted,
                EventKind::ToolFinished,
                EventKind::ModelUsage,
                EventKind::Checkpoint
            ]
        );
        assert!(events.iter().all(|event| event.session_id == "sess-1"
            && event.project_path.as_deref() == Some("/Users/me/app")));
        assert_eq!(events[1].content.as_deref(), Some("salut"));
        assert_eq!(events[3].file_path.as_deref(), Some("/Users/me/app/a.txt"));
        assert_eq!(
            events[4].model.as_ref().map(|m| m.value.as_str()),
            Some("kimi-k3")
        );
        assert_eq!(
            events[4].cache_read_tokens.as_ref().map(|v| v.value),
            Some(900)
        );
        assert_eq!(events[5].outcome.as_deref(), Some("turn-completed"));
        fs::remove_dir_all(home).ok();
    }
}
