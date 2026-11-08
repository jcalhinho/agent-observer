//! Reads what the Continue extension appends to its local "dev data" logs
//! (`~/.continue/dev_data/0.2.0/*.jsonl`, written by `DataLogger.logLocalData` in
//! continuedev/continue `core/data/log.ts`, schemas in `packages/config-yaml/src/schemas/data`).
//!
//! - `chatInteraction.jsonl`: one line per chat answer, with the chat session id and the model
//!   title. Its `prompt` and `completion` fields are never read into an event.
//! - `tokensGenerated.jsonl`: one line per model call, with the model id and token counts that
//!   Continue computes with its own tokenizer (`BaseLLM._logEnd`), hence `Estimated`. It has no
//!   session id: a line is joined to the chat answer that follows it within a few seconds from the
//!   same provider; the others (autocomplete, edits, titles) are left out.
//! - `toolUsage.jsonl`: one line per tool call, with its name and whether it was accepted and
//!   succeeded. Its arguments and output are never read. It has no session id either: it belongs
//!   to the chat session of the latest answer seen.
//!
//! Only lines appended after the app started are read; history is never backfilled.

use chrono::{DateTime, Duration, Utc};
use serde_json::Value;
use session_events::{DataOrigin, EventKind, Provider, SessionEvent, Sourced};
use std::{
    collections::HashMap,
    env, fs,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    thread,
    time::Duration as StdDuration,
};

const MAX_LINE_BYTES: usize = 4 * 1024 * 1024;
const POLL_INTERVAL: StdDuration = StdDuration::from_millis(900);
/// The schema version Continue writes its local logs with (`LOCAL_DEV_DATA_VERSION`).
const DEV_DATA_VERSION: &str = "0.2.0";
/// How long before a chat answer its token line can have been written.
const PAIRING_WINDOW: Duration = Duration::seconds(30);
/// Session files are read for their project folder only; larger ones are skipped.
const MAX_SESSION_FILE_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq)]
enum LogFile {
    Chat,
    Tokens,
    Tools,
}

impl LogFile {
    /// Token lines first: at the same timestamp, the token line of an answer is written before it.
    const ALL: [LogFile; 3] = [LogFile::Tokens, LogFile::Chat, LogFile::Tools];

    fn file_name(self) -> &'static str {
        match self {
            LogFile::Chat => "chatInteraction.jsonl",
            LogFile::Tokens => "tokensGenerated.jsonl",
            LogFile::Tools => "toolUsage.jsonl",
        }
    }
}

struct Cursor {
    offset: u64,
    pending: Vec<u8>,
}

#[derive(Debug, Clone)]
struct TokenLine {
    at: DateTime<Utc>,
    provider: String,
    model: Option<String>,
    prompt: Option<u64>,
    generated: Option<u64>,
}

pub struct ContinueMonitor {
    root: PathBuf,
    cursors: HashMap<PathBuf, Cursor>,
    tokens: Vec<TokenLine>,
    /// Chat session of the latest answer, for tool lines.
    current_session: Option<String>,
    projects: HashMap<String, Option<String>>,
}

impl ContinueMonitor {
    pub fn new(root: PathBuf) -> Self {
        // A log that already exists is read from its current end: history is never backfilled.
        // A log created later is read from its start.
        let directory = dev_data_dir(&root);
        let cursors = LogFile::ALL
            .iter()
            .filter_map(|log| {
                let path = directory.join(log.file_name());
                let length = fs::metadata(&path).ok()?.len();
                Some((
                    path,
                    Cursor {
                        offset: length,
                        pending: Vec::new(),
                    },
                ))
            })
            .collect();
        Self {
            root,
            cursors,
            tokens: Vec::new(),
            current_session: None,
            projects: HashMap::new(),
        }
    }

    pub fn poll(&mut self) -> Vec<SessionEvent> {
        let directory = dev_data_dir(&self.root);
        let mut records = Vec::new();
        for log in LogFile::ALL {
            let path = directory.join(log.file_name());
            if !path.is_file() {
                continue;
            }
            self.cursors.entry(path.clone()).or_insert(Cursor {
                offset: 0,
                pending: Vec::new(),
            });
            if let Some(cursor) = self.cursors.get_mut(&path) {
                for record in read_appended_lines(&path, cursor) {
                    if let Some(at) = timestamp(&record) {
                        records.push((at, log, record));
                    }
                }
            }
        }
        // Each file is in order; across files the timestamps give the order.
        records.sort_by_key(|(at, _, _)| *at);
        let mut events = Vec::new();
        for (at, log, record) in records {
            events.extend(self.project(at, log, &record));
        }
        if let Some(latest) = events.last().map(|event| event.occurred_at) {
            self.tokens
                .retain(|line| line.at >= latest - PAIRING_WINDOW);
        }
        let horizon = Utc::now() - PAIRING_WINDOW * 4;
        self.tokens.retain(|line| line.at >= horizon);
        events
    }

    fn project(&mut self, at: DateTime<Utc>, log: LogFile, record: &Value) -> Option<SessionEvent> {
        let text = |key: &str| {
            record
                .get(key)
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
                .map(str::to_owned)
        };
        match log {
            LogFile::Tokens => {
                self.tokens.push(TokenLine {
                    at,
                    provider: text("provider").unwrap_or_default(),
                    model: text("model"),
                    prompt: count(record, "promptTokens"),
                    generated: count(record, "generatedTokens"),
                });
                None
            }
            LogFile::Chat => {
                let session = text("sessionId")?;
                let provider = text("modelProvider").unwrap_or_default();
                let paired = self
                    .tokens
                    .iter()
                    .rposition(|line| {
                        line.provider == provider && line.at <= at && line.at >= at - PAIRING_WINDOW
                    })
                    .map(|index| self.tokens.remove(index));
                self.current_session = Some(session.clone());
                let mut event = self.event(&session, EventKind::ModelUsage, at);
                let estimated = |value: Option<u64>| {
                    value.map(|value| Sourced {
                        value,
                        origin: DataOrigin::Estimated,
                    })
                };
                event.model = paired
                    .as_ref()
                    .and_then(|line| line.model.clone())
                    .or_else(|| text("modelName"))
                    .map(|value| Sourced {
                        value,
                        origin: DataOrigin::Provider,
                    });
                if let Some(line) = paired {
                    event.input_tokens = estimated(line.prompt);
                    event.output_tokens = estimated(line.generated);
                }
                Some(event)
            }
            LogFile::Tools => {
                let session = self.current_session.clone()?;
                let accepted = record.get("accepted").and_then(Value::as_bool);
                let succeeded = record.get("succeeded").and_then(Value::as_bool);
                let kind = if accepted == Some(true) && succeeded == Some(false) {
                    EventKind::ToolFailed
                } else {
                    EventKind::ToolFinished
                };
                let mut event = self.event(&session, kind, at);
                event.tool_name = text("functionName");
                event.outcome = match (accepted, succeeded) {
                    (Some(false), _) => Some("rejected".to_owned()),
                    (Some(true), Some(false)) => Some("failed".to_owned()),
                    _ => None,
                };
                Some(event)
            }
        }
    }

    fn event(&mut self, session: &str, kind: EventKind, at: DateTime<Utc>) -> SessionEvent {
        let mut event = SessionEvent::new(session, Provider::Continue, kind);
        event.occurred_at = at;
        event.project_path = self.project_of(session);
        event
    }

    /// The workspace folder Continue saved with the chat session (`sessions/<id>.json`).
    fn project_of(&mut self, session: &str) -> Option<String> {
        if let Some(known) = self.projects.get(session) {
            return known.clone();
        }
        let project = session_workspace(&self.root, session);
        // A session file is written after the first answer: ask again until it has a folder.
        if project.is_some() {
            self.projects.insert(session.to_owned(), project.clone());
        }
        project
    }
}

/// `$CONTINUE_GLOBAL_DIR` when it is an absolute path, else `~/.continue` (as Continue does).
pub fn data_root() -> PathBuf {
    if let Some(custom) = env::var_os("CONTINUE_GLOBAL_DIR").map(PathBuf::from)
        && custom.is_absolute()
    {
        return custom;
    }
    env::var_os("USERPROFILE")
        .or_else(|| env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".continue")
}

/// Where the logs this connector reads are written.
pub fn dev_data_dir(root: &Path) -> PathBuf {
    root.join("dev_data").join(DEV_DATA_VERSION)
}

pub fn spawn<F>(root: PathBuf, mut on_event: F)
where
    F: FnMut(SessionEvent) + Send + 'static,
{
    thread::spawn(move || {
        let mut monitor = ContinueMonitor::new(root);
        loop {
            for event in monitor.poll() {
                on_event(event);
            }
            thread::sleep(POLL_INTERVAL);
        }
    });
}

fn timestamp(record: &Value) -> Option<DateTime<Utc>> {
    record
        .get("timestamp")
        .and_then(Value::as_str)
        .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
        .map(|value| value.with_timezone(&Utc))
}

fn count(record: &Value, key: &str) -> Option<u64> {
    let value = record.get(key)?;
    value.as_u64().or_else(|| {
        value
            .as_f64()
            .filter(|number| *number >= 0.0)
            .map(|number| number.round() as u64)
    })
}

fn session_workspace(root: &Path, session: &str) -> Option<String> {
    // Session ids are UUIDs; anything that could leave the folder is refused.
    if session.is_empty() || session.contains(['/', '\\']) || session.contains("..") {
        return None;
    }
    let path = root.join("sessions").join(format!("{session}.json"));
    if fs::metadata(&path).ok()?.len() > MAX_SESSION_FILE_BYTES {
        return None;
    }
    let value: Value = serde_json::from_slice(&fs::read(&path).ok()?).ok()?;
    let workspace = value.get("workspaceDirectory")?.as_str()?;
    workspace_path(workspace)
}

/// Continue saves the workspace as a URI (`file:///Users/ana/api`, `file:///c%3A/work/api`).
fn workspace_path(workspace: &str) -> Option<String> {
    let workspace = workspace.trim();
    if workspace.is_empty() {
        return None;
    }
    let Some(rest) = workspace.strip_prefix("file://") else {
        // Remote workspaces (`vscode-remote://…`) are not folders of this computer.
        return (!workspace.contains("://")).then(|| workspace.to_owned());
    };
    let decoded = percent_decode(rest)?;
    // `/c:/work/api` is a Windows drive path.
    let bytes = decoded.as_bytes();
    if bytes.len() >= 3 && bytes[0] == b'/' && bytes[1].is_ascii_alphabetic() && bytes[2] == b':' {
        return Some(decoded[1..].to_owned());
    }
    Some(decoded)
}

fn percent_decode(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hex = text.get(index + 1..index + 3)?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            index += 3;
        } else {
            out.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(out).ok()
}

fn read_appended_lines(path: &Path, cursor: &mut Cursor) -> Vec<Value> {
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
    let mut records = Vec::new();
    while let Some(newline) = cursor.pending.iter().position(|byte| *byte == b'\n') {
        if newline <= MAX_LINE_BYTES
            && let Ok(record) = serde_json::from_slice::<Value>(&cursor.pending[..newline])
        {
            records.push(record);
        }
        cursor.pending.drain(..=newline);
    }
    if cursor.pending.len() > MAX_LINE_BYTES {
        cursor.pending.clear();
    }
    records
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn temp_root(name: &str) -> PathBuf {
        let root = env::temp_dir().join(format!(
            "agent-observer-continue-{name}-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(root.join("dev_data").join(DEV_DATA_VERSION)).unwrap();
        fs::create_dir_all(root.join("sessions")).unwrap();
        root
    }

    fn append(root: &Path, log: LogFile, lines: &[&str]) {
        let mut file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(dev_data_dir(root).join(log.file_name()))
            .unwrap();
        for line in lines {
            writeln!(file, "{line}").unwrap();
        }
    }

    #[test]
    fn joins_tokens_to_the_chat_answer_and_never_keeps_text() {
        let root = temp_root("chat");
        fs::write(
            root.join("sessions").join("s-1.json"),
            r#"{"sessionId":"s-1","title":"t","workspaceDirectory":"file:///Users/ana/My%20App","history":[]}"#,
        )
        .unwrap();
        let mut monitor = ContinueMonitor::new(root.clone());
        // Fixture lines follow the 0.2.0 schemas: base fields plus the event's own.
        append(
            &root,
            LogFile::Tokens,
            &[
                r#"{"eventName":"tokensGenerated","schema":"0.2.0","timestamp":"2026-11-08T10:00:00.000Z","userId":"","userAgent":"Visual Studio Code/1.99.0 (Continue/1.2.0)","selectedProfileId":"local","model":"claude-sonnet-5-5","provider":"anthropic","promptTokens":1200,"generatedTokens":80}"#,
                r#"{"eventName":"tokensGenerated","schema":"0.2.0","timestamp":"2026-11-08T10:00:20.000Z","userId":"","userAgent":"x","selectedProfileId":"local","model":"codestral-latest","provider":"mistral","promptTokens":300,"generatedTokens":12}"#,
                r#"{"eventName":"tokensGenerated","schema":"0.2.0","timestamp":"2026-11-08T10:00:30.000Z","userId":"","userAgent":"x","selectedProfileId":"local","model":"claude-sonnet-5-5","provider":"anthropic","promptTokens":1500,"generatedTokens":40}"#,
            ],
        );
        append(
            &root,
            LogFile::Chat,
            &[
                r#"{"eventName":"chatInteraction","schema":"0.2.0","timestamp":"2026-11-08T10:00:01.000Z","userId":"","userAgent":"x","selectedProfileId":"local","prompt":"SECRET PROMPT","completion":"SECRET ANSWER","modelName":"Claude Sonnet","modelTitle":"Claude Sonnet","modelProvider":"anthropic","sessionId":"s-1","tools":["read_file"]}"#,
            ],
        );
        append(
            &root,
            LogFile::Tools,
            &[
                r#"{"eventName":"toolUsage","schema":"0.2.0","timestamp":"2026-11-08T10:00:05.000Z","userId":"","userAgent":"x","selectedProfileId":"local","toolCallId":"c1","functionName":"read_file","functionParams":{},"toolCallArgs":"{\"filepath\":\"SECRET\"}","accepted":true,"succeeded":true,"output":[{"content":"SECRET"}]}"#,
                r#"{"eventName":"toolUsage","schema":"0.2.0","timestamp":"2026-11-08T10:00:06.000Z","userId":"","userAgent":"x","selectedProfileId":"local","toolCallId":"c2","functionName":"run_terminal_command","accepted":true,"succeeded":false}"#,
                r#"{"eventName":"toolUsage","schema":"0.2.0","timestamp":"2026-11-08T10:00:07.000Z","userId":"","userAgent":"x","selectedProfileId":"local","toolCallId":"c3","functionName":"edit_existing_file","accepted":false,"succeeded":false}"#,
            ],
        );
        let events = monitor.poll();
        assert_eq!(events.len(), 4, "{events:#?}");
        let answer = &events[0];
        assert_eq!(answer.provider, Provider::Continue);
        assert_eq!(answer.kind, EventKind::ModelUsage);
        assert_eq!(answer.session_id, "s-1");
        assert_eq!(answer.project_path.as_deref(), Some("/Users/ana/My App"));
        assert_eq!(
            answer.model.as_ref().map(|model| model.value.as_str()),
            Some("claude-sonnet-5-5")
        );
        assert_eq!(
            answer
                .input_tokens
                .as_ref()
                .map(|value| (value.value, value.origin)),
            Some((1200, DataOrigin::Estimated))
        );
        assert_eq!(
            answer.output_tokens.as_ref().map(|value| value.value),
            Some(80)
        );
        let tools: Vec<(EventKind, Option<&str>, Option<&str>)> = events[1..]
            .iter()
            .map(|event| {
                (
                    event.kind,
                    event.tool_name.as_deref(),
                    event.outcome.as_deref(),
                )
            })
            .collect();
        assert_eq!(
            tools,
            vec![
                (EventKind::ToolFinished, Some("read_file"), None),
                (
                    EventKind::ToolFailed,
                    Some("run_terminal_command"),
                    Some("failed")
                ),
                (
                    EventKind::ToolFinished,
                    Some("edit_existing_file"),
                    Some("rejected")
                ),
            ]
        );
        let stored = serde_json::to_string(&events).unwrap();
        assert!(
            !stored.contains("SECRET"),
            "no prompt, answer, argument or output is kept"
        );
        assert!(events.iter().all(|event| event.session_id == "s-1"));
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn a_token_line_with_the_same_timestamp_as_its_answer_is_joined() {
        let root = temp_root("same");
        let mut monitor = ContinueMonitor::new(root.clone());
        append(
            &root,
            LogFile::Chat,
            &[
                r#"{"timestamp":"2026-11-08T10:00:00.000Z","modelName":"Claude","modelProvider":"anthropic","sessionId":"s"}"#,
            ],
        );
        append(
            &root,
            LogFile::Tokens,
            &[
                r#"{"timestamp":"2026-11-08T10:00:00.000Z","model":"claude-sonnet-5-5","provider":"anthropic","promptTokens":10,"generatedTokens":2}"#,
            ],
        );
        let events = monitor.poll();
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].model.as_ref().map(|model| model.value.as_str()),
            Some("claude-sonnet-5-5")
        );
        assert_eq!(
            events[0].input_tokens.as_ref().map(|value| value.value),
            Some(10)
        );
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn an_answer_without_a_token_line_keeps_its_model_title_and_no_tokens() {
        let root = temp_root("alone");
        let mut monitor = ContinueMonitor::new(root.clone());
        append(
            &root,
            LogFile::Tokens,
            &[
                // Another provider, and one too old: neither belongs to the answer.
                r#"{"timestamp":"2026-11-08T10:00:00.000Z","model":"m","provider":"ollama","promptTokens":9,"generatedTokens":9}"#,
                r#"{"timestamp":"2026-11-08T09:00:00.000Z","model":"m","provider":"openai","promptTokens":9,"generatedTokens":9}"#,
            ],
        );
        append(
            &root,
            LogFile::Chat,
            &[
                r#"{"timestamp":"2026-11-08T10:00:01.000Z","modelName":"GPT","modelProvider":"openai","sessionId":"s-2","prompt":"p","completion":"c"}"#,
            ],
        );
        let events = monitor.poll();
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].model.as_ref().map(|model| model.value.as_str()),
            Some("GPT")
        );
        assert!(events[0].input_tokens.is_none() && events[0].output_tokens.is_none());
        assert_eq!(events[0].project_path, None, "no session file yet");
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn lines_written_before_launch_are_not_read_and_tools_need_a_chat_first() {
        let root = temp_root("start");
        append(
            &root,
            LogFile::Chat,
            &[
                r#"{"timestamp":"2026-11-08T08:00:00.000Z","modelName":"GPT","modelProvider":"openai","sessionId":"old"}"#,
            ],
        );
        let mut monitor = ContinueMonitor::new(root.clone());
        assert!(monitor.poll().is_empty());
        append(
            &root,
            LogFile::Tools,
            &[
                r#"{"timestamp":"2026-11-08T10:00:00.000Z","functionName":"read_file","accepted":true,"succeeded":true}"#,
            ],
        );
        assert!(
            monitor.poll().is_empty(),
            "a tool line has no session before an answer is seen"
        );
        append(
            &root,
            LogFile::Chat,
            &[
                r#"{"timestamp":"2026-11-08T10:00:01.000Z","modelName":"GPT","modelProvider":"openai","sessionId":"new"}"#,
            ],
        );
        let events = monitor.poll();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].session_id, "new");
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn workspace_uris_become_local_paths() {
        assert_eq!(
            workspace_path("file:///Users/ana/api").as_deref(),
            Some("/Users/ana/api")
        );
        assert_eq!(
            workspace_path("file:///c%3A/work/my%20api").as_deref(),
            Some("c:/work/my api")
        );
        assert_eq!(
            workspace_path("vscode-remote://ssh-remote+box/home/ana"),
            None
        );
        assert_eq!(
            workspace_path("/plain/path").as_deref(),
            Some("/plain/path")
        );
        assert_eq!(workspace_path(""), None);
        assert_eq!(session_workspace(Path::new("/tmp"), "../etc/passwd"), None);
    }
}
