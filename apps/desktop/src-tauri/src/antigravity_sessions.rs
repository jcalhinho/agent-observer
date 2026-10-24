//! Reads Antigravity's local files (`~/.gemini/antigravity`), read-only, and projects safe
//! operational metadata into the shared event stream.
//!
//! Two sources, both written by Antigravity itself:
//! - `conversation_summaries.db`: one row per conversation (workspace, state, last activity). It gives
//!   "who works / who waits" for every conversation, but no detail.
//! - `brain/<conversation>/.system_generated/logs/transcript_full.jsonl`: one line per step (tokens,
//!   tool calls, errors), written by recent versions only. The older conversations are encrypted
//!   `.pb` files, which are never read.
//!
//! Nothing is backfilled: only what happens while the app runs. Message text, thoughts, tool outputs
//! and file contents are never persisted.

use chrono::{DateTime, Duration, Utc};
use rusqlite::{Connection, OpenFlags};
use serde_json::Value;
use session_events::{DataOrigin, EventKind, Provider, SessionEvent, Sourced};
use std::{
    collections::{HashMap, VecDeque},
    env, fs,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration as StdDuration, SystemTime},
};

const POLL_INTERVAL: StdDuration = StdDuration::from_millis(1000);
const ACTIVE_WINDOW: Duration = Duration::hours(48);
const MAX_LINE_BYTES: usize = 16 * 1024 * 1024;
const PATH_KEYS: &[&str] = &[
    "TargetFile",
    "AbsolutePath",
    "file_path",
    "FilePath",
    "Path",
    "path",
    "target_file",
    "File",
];
const COMMAND_KEYS: &[&str] = &["CommandLine", "command", "cmd", "script"];

/// `%USERPROFILE%\.gemini\antigravity` on Windows, `$HOME/.gemini/antigravity` elsewhere.
pub fn data_root() -> PathBuf {
    env::var_os("USERPROFILE")
        .or_else(|| env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".gemini")
        .join("antigravity")
}

#[derive(Clone, PartialEq)]
struct Seen {
    modified: String,
    user_input: String,
}

struct Row {
    id: String,
    modified: String,
    user_input: String,
    status: String,
    workspace: Option<String>,
}

#[derive(Default)]
struct Transcript {
    offset: u64,
    pending: Vec<u8>,
    calls: VecDeque<(String, Option<String>, Option<String>)>,
}

pub struct AntigravityMonitor {
    root: PathBuf,
    started_at: SystemTime,
    seen: HashMap<String, Seen>,
    first_poll: bool,
    projects: HashMap<String, String>,
    transcripts: HashMap<PathBuf, Transcript>,
}

impl AntigravityMonitor {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            started_at: SystemTime::now(),
            seen: HashMap::new(),
            first_poll: true,
            projects: HashMap::new(),
            transcripts: HashMap::new(),
        }
    }

    pub fn poll(&mut self, capture_prompts: bool, capture_commands: bool) -> Vec<SessionEvent> {
        let mut events = Vec::new();
        let rows = read_rows(&self.root.join("conversation_summaries.db"));
        let with_transcript = transcript_files(&self.root);
        for row in rows {
            if let Some(project) = row.workspace.clone() {
                self.projects.insert(row.id.clone(), project);
            }
            let current = Seen {
                modified: row.modified.clone(),
                user_input: row.user_input.clone(),
            };
            let previous = self.seen.insert(row.id.clone(), current.clone());
            if self.first_poll || previous.as_ref() == Some(&current) {
                continue;
            }
            // A conversation with a transcript is described step by step there.
            if with_transcript.iter().any(|(id, _)| *id == row.id) {
                continue;
            }
            let project = self.projects.get(&row.id).cloned();
            if previous.as_ref().map(|seen| &seen.user_input) != Some(&row.user_input)
                && let Some(at) = parse_time(&row.user_input)
            {
                let mut event = event(&row.id, &project, EventKind::UserMessage);
                event.occurred_at = at;
                events.push(event);
            }
            if row.status.contains("IDLE")
                && let Some(at) = parse_time(&row.modified)
            {
                let mut event = event(&row.id, &project, EventKind::Checkpoint);
                event.occurred_at = at;
                event.outcome = Some("turn-complete".to_owned());
                events.push(event);
            }
        }
        self.first_poll = false;

        for (id, path) in with_transcript {
            let project = self.projects.get(&id).cloned();
            if !self.transcripts.contains_key(&path) {
                let created_before_start = fs::metadata(&path)
                    .and_then(|metadata| metadata.created())
                    .map(|created| created < self.started_at)
                    .unwrap_or(true);
                let length = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
                self.transcripts.insert(
                    path.clone(),
                    Transcript {
                        offset: if created_before_start { length } else { 0 },
                        ..Transcript::default()
                    },
                );
            }
            if let Some(transcript) = self.transcripts.get_mut(&path) {
                for line in read_appended_lines(&path, transcript) {
                    if let Ok(record) = serde_json::from_str::<Value>(&line) {
                        events.extend(project_step(
                            &id,
                            &project,
                            &record,
                            transcript,
                            capture_prompts,
                            capture_commands,
                        ));
                    }
                }
            }
        }
        events
    }
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
        let mut monitor = AntigravityMonitor::new(root);
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

fn read_rows(path: &Path) -> Vec<Row> {
    let Ok(connection) = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    ) else {
        return Vec::new();
    };
    let _ = connection.busy_timeout(StdDuration::from_millis(250));
    let Ok(mut statement) = connection.prepare(
        "SELECT conversation_id, CAST(last_modified_time AS TEXT), CAST(last_user_input_time AS TEXT), status, workspace_uris FROM conversation_summaries",
    ) else {
        return Vec::new();
    };
    let Ok(rows) = statement.query_map([], |row| {
        let workspaces: Option<String> = row.get(4)?;
        Ok(Row {
            id: row.get(0)?,
            modified: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
            user_input: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
            status: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
            workspace: workspaces.as_deref().and_then(first_workspace),
        })
    }) else {
        return Vec::new();
    };
    rows.flatten().collect()
}

/// `["file:///Users/me/work%20x"]` → `/Users/me/work x`; `file:///c%3A/Users/me` → `c:/Users/me`.
fn first_workspace(uris: &str) -> Option<String> {
    let list: Vec<String> = serde_json::from_str(uris).ok()?;
    let uri = list.first()?.strip_prefix("file://")?;
    let decoded = percent_decode(uri);
    let bytes = decoded.as_bytes();
    let drive = bytes.len() > 2 && bytes[0] == b'/' && bytes[2] == b':';
    Some(if drive {
        decoded[1..].to_owned()
    } else {
        decoded
    })
}

fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%'
            && index + 2 < bytes.len()
            && let Ok(value) = u8::from_str_radix(&text[index + 1..index + 3], 16)
        {
            out.push(value);
            index += 3;
        } else {
            out.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn parse_time(text: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(&text.replacen(' ', "T", 1))
        .ok()
        .map(|time| time.with_timezone(&Utc))
}

/// The transcript to read for each recently active conversation (the "full" one when both exist).
fn transcript_files(root: &Path) -> Vec<(String, PathBuf)> {
    let cutoff = SystemTime::now() - StdDuration::from_secs(ACTIVE_WINDOW.num_seconds() as u64);
    let Ok(entries) = fs::read_dir(root.join("brain")) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter_map(|entry| {
            let logs = entry.path().join(".system_generated").join("logs");
            let file = ["transcript_full.jsonl", "transcript.jsonl"]
                .iter()
                .map(|name| logs.join(name))
                .find(|path| path.is_file())?;
            let recent = fs::metadata(&file)
                .and_then(|metadata| metadata.modified())
                .map(|modified| modified >= cutoff)
                .unwrap_or(false);
            recent.then(|| (entry.file_name().to_string_lossy().into_owned(), file))
        })
        .collect()
}

fn read_appended_lines(path: &Path, transcript: &mut Transcript) -> Vec<String> {
    let Ok(mut file) = fs::File::open(path) else {
        return Vec::new();
    };
    let length = file.metadata().map(|metadata| metadata.len()).unwrap_or(0);
    if length < transcript.offset {
        transcript.offset = 0;
        transcript.pending.clear();
    }
    if length == transcript.offset || file.seek(SeekFrom::Start(transcript.offset)).is_err() {
        return Vec::new();
    }
    let mut chunk = Vec::new();
    if file
        .take(MAX_LINE_BYTES as u64)
        .read_to_end(&mut chunk)
        .is_err()
    {
        return Vec::new();
    }
    transcript.offset += chunk.len() as u64;
    transcript.pending.extend_from_slice(&chunk);
    let mut lines = Vec::new();
    while let Some(end) = transcript.pending.iter().position(|byte| *byte == b'\n') {
        let line: Vec<u8> = transcript.pending.drain(..=end).collect();
        let text = String::from_utf8_lossy(&line).trim().to_owned();
        if !text.is_empty() {
            lines.push(text);
        }
    }
    lines
}

fn project_step(
    id: &str,
    project: &Option<String>,
    record: &Value,
    transcript: &mut Transcript,
    capture_prompts: bool,
    capture_commands: bool,
) -> Vec<SessionEvent> {
    let at = record
        .get("created_at")
        .and_then(Value::as_str)
        .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
        .map(|time| time.with_timezone(&Utc))
        .unwrap_or_else(Utc::now);
    let stamped = |kind| {
        let mut event = event(id, project, kind);
        event.occurred_at = at;
        event
    };
    let kind = record.get("type").and_then(Value::as_str).unwrap_or("");
    let failed = record.get("status").and_then(Value::as_str) == Some("ERROR");
    let mut events = Vec::new();
    match kind {
        "USER_INPUT" => {
            let mut message = stamped(EventKind::UserMessage);
            if capture_prompts {
                message.content = record.get("content").and_then(Value::as_str).map(|text| {
                    text.replace("<USER_REQUEST>", "")
                        .replace("</USER_REQUEST>", "")
                        .trim()
                        .to_owned()
                });
            }
            events.push(message);
        }
        "PLANNER_RESPONSE" => {
            let count = |key: &str| record.get(key).and_then(Value::as_u64);
            if count("input_tokens").is_some() || count("output_tokens").is_some() {
                let mut usage = stamped(EventKind::ModelUsage);
                let cached = count("cache_read_tokens");
                // The prompt count includes the cached part (Gemini semantics); price them apart.
                usage.input_tokens = count("input_tokens").map(|input| match cached {
                    Some(cached) if cached > 0 => Sourced {
                        value: input.saturating_sub(cached),
                        origin: DataOrigin::Derived,
                    },
                    _ => provider_value(input),
                });
                usage.cache_read_tokens = cached.map(provider_value);
                usage.output_tokens = count("output_tokens").map(provider_value);
                events.push(usage);
            }
            let calls = record.get("tool_calls").and_then(Value::as_array);
            for call in calls.into_iter().flatten() {
                let name = call
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or("tool")
                    .to_owned();
                let args = call.get("args");
                let file = text_field(args, PATH_KEYS);
                let command = capture_commands
                    .then(|| text_field(args, COMMAND_KEYS))
                    .flatten();
                let mut started = stamped(EventKind::ToolStarted);
                started.tool_name = Some(name.clone());
                started.file_path = file.clone();
                started.command = command.clone();
                events.push(started);
                transcript.calls.push_back((name, file, command));
            }
            if calls.is_none_or(|calls| calls.is_empty()) && !failed {
                let mut done = stamped(EventKind::Checkpoint);
                done.outcome = Some("turn-complete".to_owned());
                events.push(done);
            }
        }
        "GENERIC" => {
            let (name, file, command) = transcript
                .calls
                .pop_front()
                .unwrap_or_else(|| ("step".to_owned(), None, None));
            let mut finished = stamped(if failed {
                EventKind::ToolFailed
            } else {
                EventKind::ToolFinished
            });
            finished.tool_name = Some(name);
            finished.file_path = file;
            finished.command = command;
            if failed {
                finished.outcome = Some(crate::redact::failure_outcome(
                    record.get("error").and_then(Value::as_str),
                ));
            }
            events.push(finished);
        }
        _ => {}
    }
    events
}

fn event(id: &str, project: &Option<String>, kind: EventKind) -> SessionEvent {
    let mut event = SessionEvent::new(id, Provider::Antigravity, kind);
    event.project_path = project.clone();
    event
}

/// The first of `keys` present on `args`, as plain text (values are sometimes JSON-quoted).
fn text_field(args: Option<&Value>, keys: &[&str]) -> Option<String> {
    let object = args?.as_object()?;
    keys.iter()
        .find_map(|key| object.get(*key).and_then(Value::as_str))
        .map(|value| value.trim().trim_matches('"').to_owned())
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

    fn step(record: Value, transcript: &mut Transcript, commands: bool) -> Vec<SessionEvent> {
        project_step(
            "c1",
            &Some("/work/demo".into()),
            &record,
            transcript,
            false,
            commands,
        )
    }

    #[test]
    fn a_planner_step_gives_usage_and_one_event_per_tool_call() {
        let mut transcript = Transcript::default();
        let events = step(
            json!({
                "type": "PLANNER_RESPONSE", "status": "DONE", "created_at": "2026-10-24T00:21:04Z",
                "input_tokens": 1000, "cache_read_tokens": 400, "output_tokens": 50,
                "thinking": "private", "tool_calls": [
                    { "name": "run_command", "args": { "CommandLine": "\"rm -rf x\"" } },
                    { "name": "write_to_file", "args": { "TargetFile": "\"/work/demo/a.rs\"" } }
                ]
            }),
            &mut transcript,
            false,
        );
        let kinds: Vec<_> = events.iter().map(|event| event.kind).collect();
        assert_eq!(
            kinds,
            [
                EventKind::ModelUsage,
                EventKind::ToolStarted,
                EventKind::ToolStarted
            ]
        );
        assert_eq!(events[0].input_tokens.as_ref().map(|v| v.value), Some(600));
        assert_eq!(
            events[0].cache_read_tokens.as_ref().map(|v| v.value),
            Some(400)
        );
        assert_eq!(events[1].command, None);
        assert_eq!(events[2].file_path.as_deref(), Some("/work/demo/a.rs"));
        assert_eq!(events[2].project_path.as_deref(), Some("/work/demo"));
        assert_eq!(transcript.calls.len(), 2);
    }

    #[test]
    fn results_close_the_calls_in_order_and_errors_fail_them() {
        let mut transcript = Transcript::default();
        transcript
            .calls
            .push_back(("read_file".into(), Some("/work/demo/a.rs".into()), None));
        let events = step(
            json!({ "type": "GENERIC", "status": "ERROR", "error": "file does not exist",
                    "created_at": "2026-10-24T00:21:12Z" }),
            &mut transcript,
            false,
        );
        assert_eq!(events[0].kind, EventKind::ToolFailed);
        assert_eq!(events[0].tool_name.as_deref(), Some("read_file"));
        assert_eq!(events[0].outcome.as_deref(), Some("failed"));
        let ok = step(
            json!({ "type": "GENERIC", "status": "DONE" }),
            &mut transcript,
            false,
        );
        assert_eq!(ok[0].kind, EventKind::ToolFinished);
        assert_eq!(ok[0].tool_name.as_deref(), Some("step"));
    }

    #[test]
    fn an_answer_without_tool_calls_ends_the_turn() {
        let mut transcript = Transcript::default();
        let events = step(
            json!({ "type": "PLANNER_RESPONSE", "status": "DONE", "created_at": "2026-10-24T00:22:00Z",
                    "input_tokens": 10, "output_tokens": 5 }),
            &mut transcript,
            false,
        );
        assert_eq!(
            events.last().map(|event| event.kind),
            Some(EventKind::Checkpoint)
        );
    }

    #[test]
    fn workspaces_decode_on_both_systems() {
        assert_eq!(
            first_workspace(r#"["file:///Users/me/bric%20a%20brac/app"]"#).as_deref(),
            Some("/Users/me/bric a brac/app")
        );
        assert_eq!(
            first_workspace(r#"["file:///c%3A/Users/me/app"]"#).as_deref(),
            Some("c:/Users/me/app")
        );
        assert_eq!(first_workspace("[]"), None);
    }

    #[test]
    fn summary_times_parse() {
        assert!(parse_time("2026-10-24 00:21:45.721814+00:00").is_some());
        assert!(parse_time("").is_none());
    }
}
