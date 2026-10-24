//! Reads the event logs GitHub Copilot's agent writes (`~/.copilot/session-state/<session>/events.jsonl`:
//! Copilot CLI, and the agent sessions of VS Code, which run on it) and projects safe operational
//! metadata into the shared event stream. Only appended lines are read (no backfill); message text,
//! reasoning, tool outputs and the system prompt are never persisted.

use chrono::{DateTime, Duration, Utc};
use serde_json::Value;
use session_events::{DataOrigin, EventKind, Provider, SessionEvent, Sourced};
use std::{
    collections::HashMap,
    env, fs,
    io::{BufRead, BufReader, Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration as StdDuration, SystemTime},
};

const MAX_LINE_BYTES: usize = 16 * 1024 * 1024;
const POLL_INTERVAL: StdDuration = StdDuration::from_millis(900);
const ACTIVE_FILE_WINDOW: Duration = Duration::hours(48);
const PATH_KEYS: &[&str] = &[
    "path",
    "file_path",
    "filePath",
    "file",
    "target_file",
    "filename",
];
const COMMAND_KEYS: &[&str] = &["command", "cmd", "script", "commandLine"];

#[derive(Default)]
struct SessionContext {
    id: String,
    project_path: Option<String>,
    model: Option<String>,
    tools: HashMap<String, (String, Option<String>, Option<String>)>,
}

struct Cursor {
    offset: u64,
    pending: Vec<u8>,
    context: SessionContext,
}

pub struct CopilotMonitor {
    root: PathBuf,
    cursors: HashMap<PathBuf, Cursor>,
    started_at: SystemTime,
}

impl CopilotMonitor {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            cursors: HashMap::new(),
            started_at: SystemTime::now(),
        }
    }

    pub fn poll(&mut self, capture_prompts: bool, capture_commands: bool) -> Vec<SessionEvent> {
        let mut events = Vec::new();
        for (path, length) in recent_logs(&self.root) {
            if !self.cursors.contains_key(&path) {
                let created_before_start = fs::metadata(&path)
                    .and_then(|metadata| metadata.created())
                    .map(|created| created < self.started_at)
                    .unwrap_or(true);
                let mut context = SessionContext {
                    id: session_id_from_path(&path),
                    ..SessionContext::default()
                };
                // A session already running when the app started: its start line says where and with
                // which model, even though nothing before now is imported.
                if created_before_start {
                    read_start_line(&path, &mut context);
                }
                self.cursors.insert(
                    path.clone(),
                    Cursor {
                        offset: if created_before_start { length } else { 0 },
                        pending: Vec::new(),
                        context,
                    },
                );
            }
            if let Some(cursor) = self.cursors.get_mut(&path) {
                events.extend(read_appended_records(
                    &path,
                    cursor,
                    capture_prompts,
                    capture_commands,
                ));
            }
        }
        events
    }
}

/// `COPILOT_HOME`, else `%USERPROFILE%\.copilot` / `$HOME/.copilot`, then `session-state`.
pub fn sessions_root() -> PathBuf {
    env::var_os("COPILOT_HOME")
        .map(PathBuf::from)
        .or_else(|| {
            env::var_os("USERPROFILE")
                .or_else(|| env::var_os("HOME"))
                .map(|home| PathBuf::from(home).join(".copilot"))
        })
        .unwrap_or_else(|| PathBuf::from(".copilot"))
        .join("session-state")
}

pub fn spawn<F>(
    root: PathBuf,
    capture_prompts: Arc<AtomicBool>,
    capture_commands: Arc<AtomicBool>,
    mut on_event: F,
) where
    F: FnMut(SessionEvent) + Send + 'static,
{
    thread::spawn(move || {
        let mut monitor = CopilotMonitor::new(root);
        loop {
            let events = monitor.poll(
                capture_prompts.load(Ordering::Relaxed),
                capture_commands.load(Ordering::Relaxed),
            );
            for event in events {
                on_event(event);
            }
            thread::sleep(POLL_INTERVAL);
        }
    });
}

/// `<root>/<session>/events.jsonl` files written recently.
fn recent_logs(root: &Path) -> Vec<(PathBuf, u64)> {
    let cutoff = Utc::now() - ACTIVE_FILE_WINDOW;
    let Ok(sessions) = fs::read_dir(root) else {
        return Vec::new();
    };
    sessions
        .flatten()
        .filter_map(|entry| {
            let path = entry.path().join("events.jsonl");
            let metadata = fs::metadata(&path).ok()?;
            let modified = metadata.modified().ok()?;
            (metadata.is_file() && DateTime::<Utc>::from(modified) >= cutoff)
                .then_some((path, metadata.len()))
        })
        .collect()
}

fn session_id_from_path(path: &Path) -> String {
    path.parent()
        .and_then(Path::file_name)
        .and_then(|name| name.to_str())
        .unwrap_or("copilot-session")
        .to_owned()
}

fn read_start_line(path: &Path, context: &mut SessionContext) {
    let Ok(file) = fs::File::open(path) else {
        return;
    };
    for line in BufReader::new(file).lines().take(3).map_while(Result::ok) {
        if let Ok(record) = serde_json::from_str::<Value>(&line)
            && record.get("type").and_then(Value::as_str) == Some("session.start")
        {
            apply_start(&record, context);
            return;
        }
    }
}

fn apply_start(record: &Value, context: &mut SessionContext) {
    let data = record.get("data");
    if let Some(id) = data
        .and_then(|data| data.get("sessionId"))
        .and_then(Value::as_str)
    {
        context.id = id.to_owned();
    }
    context.project_path = data
        .and_then(|data| data.get("context"))
        .and_then(|context| context.get("cwd"))
        .and_then(Value::as_str)
        .map(str::to_owned)
        .or(context.project_path.take());
    set_model(
        context,
        data.and_then(|data| data.get("selectedModel"))
            .and_then(Value::as_str),
    );
}

/// The model a run is really using beats the "auto" selection.
fn set_model(context: &mut SessionContext, model: Option<&str>) {
    if let Some(model) = model.filter(|model| !model.is_empty() && *model != "auto") {
        context.model = Some(model.to_owned());
    }
}

fn read_appended_records(
    path: &Path,
    cursor: &mut Cursor,
    capture_prompts: bool,
    capture_commands: bool,
) -> Vec<SessionEvent> {
    let Ok(mut file) = fs::File::open(path) else {
        return Vec::new();
    };
    let Ok(metadata) = file.metadata() else {
        return Vec::new();
    };
    if metadata.len() < cursor.offset {
        cursor.offset = 0;
        cursor.pending.clear();
    }
    if metadata.len() == cursor.offset || file.seek(SeekFrom::Start(cursor.offset)).is_err() {
        return Vec::new();
    }
    let mut appended = Vec::new();
    if file
        .take(8 * 1024 * 1024)
        .read_to_end(&mut appended)
        .is_err()
    {
        return Vec::new();
    }
    cursor.offset += appended.len() as u64;
    cursor.pending.extend(appended);
    let mut events = Vec::new();
    while let Some(newline) = cursor.pending.iter().position(|byte| *byte == b'\n') {
        if newline <= MAX_LINE_BYTES
            && let Ok(record) = serde_json::from_slice::<Value>(&cursor.pending[..newline])
        {
            events.extend(project_record(
                &record,
                &mut cursor.context,
                capture_prompts,
                capture_commands,
            ));
        }
        cursor.pending.drain(..=newline);
    }
    if cursor.pending.len() > MAX_LINE_BYTES {
        cursor.pending.clear();
    }
    events
}

fn project_record(
    record: &Value,
    context: &mut SessionContext,
    capture_prompts: bool,
    capture_commands: bool,
) -> Vec<SessionEvent> {
    let kind = record.get("type").and_then(Value::as_str).unwrap_or("");
    let data = record.get("data");
    let occurred_at = record
        .get("timestamp")
        .and_then(Value::as_str)
        .and_then(|timestamp| DateTime::parse_from_rfc3339(timestamp).ok())
        .map(|timestamp| timestamp.with_timezone(&Utc))
        .unwrap_or_else(Utc::now);
    let at = |mut event: SessionEvent| {
        event.occurred_at = occurred_at;
        event
    };
    match kind {
        "session.start" => {
            apply_start(record, context);
            vec![at(event(context, EventKind::SessionStarted))]
        }
        "session.auto_mode_resolved" => {
            set_model(
                context,
                data.and_then(|data| data.get("chosenModel"))
                    .and_then(Value::as_str),
            );
            Vec::new()
        }
        "user.message" => {
            let mut message = at(event(context, EventKind::UserMessage));
            if capture_prompts {
                message.content = data
                    .and_then(|data| data.get("content"))
                    .and_then(Value::as_str)
                    .map(str::to_owned);
            }
            vec![message]
        }
        "assistant.message" => {
            set_model(
                context,
                data.and_then(|data| data.get("model"))
                    .and_then(Value::as_str),
            );
            let requests = data
                .and_then(|data| data.get("toolRequests"))
                .and_then(Value::as_array);
            let mut events = Vec::new();
            for request in requests.into_iter().flatten() {
                let name = request
                    .get("name")
                    .or_else(|| request.get("toolName"))
                    .and_then(Value::as_str)
                    .unwrap_or("tool")
                    .to_owned();
                let args = request.get("arguments");
                let file = text_field(args, PATH_KEYS);
                let command = capture_commands
                    .then(|| text_field(args, COMMAND_KEYS))
                    .flatten();
                let call_id = request
                    .get("toolCallId")
                    .or_else(|| request.get("id"))
                    .and_then(Value::as_str);
                if let Some(call_id) = call_id {
                    context.tools.insert(
                        call_id.to_owned(),
                        (name.clone(), file.clone(), command.clone()),
                    );
                }
                let mut started = at(event(context, EventKind::ToolStarted));
                started.tool_name = Some(name);
                started.file_path = file;
                started.command = command;
                events.push(started);
            }
            // An answer with no tool to run ends the turn: the agent waits for the user.
            if requests.is_none_or(|requests| requests.is_empty()) {
                let mut done = at(event(context, EventKind::Checkpoint));
                done.outcome = Some("turn-complete".to_owned());
                events.push(done);
            }
            events
        }
        "tool.execution_complete" => {
            let call_id = data
                .and_then(|data| data.get("toolCallId"))
                .and_then(Value::as_str)
                .unwrap_or("");
            let (name, file, command) = context
                .tools
                .remove(call_id)
                .unwrap_or_else(|| ("tool".to_owned(), None, None));
            let failed = data
                .and_then(|data| data.get("success"))
                .and_then(Value::as_bool)
                == Some(false);
            let mut finished = at(event(
                context,
                if failed {
                    EventKind::ToolFailed
                } else {
                    EventKind::ToolFinished
                },
            ));
            finished.tool_name = Some(name);
            finished.file_path = file;
            finished.command = command;
            if failed {
                let error = data.and_then(|data| data.get("error")).and_then(|error| {
                    error
                        .as_str()
                        .or_else(|| error.get("message").and_then(Value::as_str))
                });
                finished.outcome = Some(crate::redact::failure_outcome(error));
            }
            vec![finished]
        }
        "session.usage_record" => {
            let Some(usage) = data.and_then(|data| data.get("usage")) else {
                return Vec::new();
            };
            set_model(context, usage.get("model").and_then(Value::as_str));
            let count = |key: &str| usage.get(key).and_then(Value::as_u64);
            if count("inputTokens").is_none() && count("outputTokens").is_none() {
                return Vec::new();
            }
            let mut record = at(event(context, EventKind::ModelUsage));
            let cache_read = count("cacheReadTokens");
            let cache_write = count("cacheWriteTokens");
            // The prompt count includes the cached part; price them apart.
            record.input_tokens = count("inputTokens").map(|input| {
                let cached = cache_read.unwrap_or(0) + cache_write.unwrap_or(0);
                if cached == 0 {
                    provider_value(input)
                } else {
                    Sourced {
                        value: input.saturating_sub(cached),
                        origin: DataOrigin::Derived,
                    }
                }
            });
            record.cache_read_tokens = cache_read.map(provider_value);
            record.cache_write_tokens = cache_write.map(provider_value);
            record.output_tokens = count("outputTokens").map(provider_value);
            record.duration_ms = count("duration").map(provider_value);
            vec![record]
        }
        _ => Vec::new(),
    }
}

fn event(context: &SessionContext, kind: EventKind) -> SessionEvent {
    let mut event = SessionEvent::new(&context.id, Provider::GitHubCopilot, kind);
    event.project_path = context.project_path.clone();
    event.model = context.model.as_deref().map(|model| Sourced {
        value: model.to_owned(),
        origin: DataOrigin::Provider,
    });
    event
}

/// The first of `keys` on `args`; arguments may also arrive as a JSON string.
fn text_field(args: Option<&Value>, keys: &[&str]) -> Option<String> {
    let parsed;
    let object = match args? {
        Value::Object(object) => object,
        Value::String(text) => {
            parsed = serde_json::from_str::<Value>(text).ok()?;
            parsed.as_object()?
        }
        _ => return None,
    };
    keys.iter()
        .find_map(|key| object.get(*key).and_then(Value::as_str))
        .map(str::to_owned)
        .filter(|value| !value.is_empty())
}

fn provider_value(value: u64) -> Sourced<u64> {
    Sourced {
        value,
        origin: DataOrigin::Provider,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn run(records: &[Value], commands: bool) -> (Vec<SessionEvent>, SessionContext) {
        let mut context = SessionContext {
            id: "dir-id".into(),
            ..SessionContext::default()
        };
        let events = records
            .iter()
            .flat_map(|record| project_record(record, &mut context, false, commands))
            .collect();
        (events, context)
    }

    #[test]
    fn a_text_only_exchange_starts_works_and_ends_the_turn() {
        let (events, context) = run(
            &[
                json!({ "type": "session.start", "timestamp": "2026-10-24T11:52:44.559Z",
                        "data": { "sessionId": "abc", "selectedModel": "auto", "context": { "cwd": "/work/demo" } } }),
                json!({ "type": "session.auto_mode_resolved", "data": { "chosenModel": "mai-code-1.1-flash" } }),
                json!({ "type": "user.message", "timestamp": "2026-10-24T11:53:25.136Z", "data": { "content": "hi" } }),
                json!({ "type": "session.usage_record", "timestamp": "2026-10-24T11:53:41.505Z",
                        "data": { "usage": { "model": "mai-code-1.1-flash", "inputTokens": 17849, "outputTokens": 119,
                                              "cacheReadTokens": 5760, "duration": 900 } } }),
                json!({ "type": "assistant.message", "timestamp": "2026-10-24T11:53:41.514Z",
                        "data": { "model": "mai-code-1.1-flash", "content": "secret", "toolRequests": [] } }),
            ],
            false,
        );
        let kinds: Vec<_> = events.iter().map(|event| event.kind).collect();
        assert_eq!(
            kinds,
            [
                EventKind::SessionStarted,
                EventKind::UserMessage,
                EventKind::ModelUsage,
                EventKind::Checkpoint
            ]
        );
        assert_eq!(context.id, "abc");
        assert_eq!(events[1].project_path.as_deref(), Some("/work/demo"));
        assert_eq!(
            events[1].model.as_ref().map(|m| m.value.as_str()),
            Some("mai-code-1.1-flash")
        );
        assert_eq!(events[1].content, None);
        assert_eq!(
            events[2].input_tokens.as_ref().map(|v| v.value),
            Some(12089)
        );
        assert_eq!(
            events[2].cache_read_tokens.as_ref().map(|v| v.value),
            Some(5760)
        );
    }

    #[test]
    fn tool_requests_start_and_their_completion_finishes_or_fails() {
        let (events, _) = run(
            &[
                json!({ "type": "assistant.message", "data": { "toolRequests": [
                    { "toolCallId": "t1", "name": "bash", "arguments": { "command": "rm -rf x" } },
                    { "toolCallId": "t2", "name": "edit", "arguments": "{\"path\":\"/work/demo/a.rs\"}" } ] } }),
                json!({ "type": "tool.execution_complete", "data": { "toolCallId": "t1", "success": true } }),
                json!({ "type": "tool.execution_complete", "data": { "toolCallId": "t2", "success": false,
                        "error": { "message": "boom" } } }),
            ],
            false,
        );
        let kinds: Vec<_> = events.iter().map(|event| event.kind).collect();
        assert_eq!(
            kinds,
            [
                EventKind::ToolStarted,
                EventKind::ToolStarted,
                EventKind::ToolFinished,
                EventKind::ToolFailed
            ]
        );
        assert_eq!(events[0].command, None);
        assert_eq!(events[1].file_path.as_deref(), Some("/work/demo/a.rs"));
        assert_eq!(events[3].tool_name.as_deref(), Some("edit"));
        assert_eq!(events[3].file_path.as_deref(), Some("/work/demo/a.rs"));
        assert_eq!(events[3].outcome.as_deref(), Some("failed"));
    }

    #[test]
    fn unknown_records_are_ignored() {
        let (events, _) = run(
            &[
                json!({ "type": "hook.start", "data": {} }),
                json!({ "nope": 1 }),
            ],
            false,
        );
        assert!(events.is_empty());
    }
}
