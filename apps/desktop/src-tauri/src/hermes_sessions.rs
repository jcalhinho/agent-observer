//! Reads Hermes Agent's session database in read-only mode.
//!
//! Hermes (github.com/NousResearch/hermes-agent) keeps every session in SQLite: `state.db` in its
//! home (`$HERMES_HOME`, else `~/.hermes`), and one per profile in `profiles/<name>/state.db`. The
//! columns read here come from `SCHEMA_SQL` in `hermes_state_common.py` (schema version 33):
//!
//! - `messages`: one row per message. An assistant message lists its tool calls in `tool_calls`
//!   (OpenAI shape, `function.name` and `function.arguments`); a `tool` row is the result, and a
//!   failed tool returns `{"error": …}` (`tool_error` in `tools/registry.py`). Hermes writes them
//!   at the end of each tool round, so they arrive in batches, not one by one.
//! - `session_model_usage`: running token totals per session, model and task. `input_tokens` is
//!   the uncached input; the cache is apart (`normalize_usage` in `agent/usage_pricing.py`). The
//!   app turns each increase into one usage event.
//! - `sessions`: the working folder (`cwd`).
//!
//! Prompt and shell-command text follow the shared opt-in capture policy; assistant text,
//! reasoning and tool results are never stored.

use chrono::{DateTime, Utc};
use rusqlite::{Connection, OpenFlags, params};
use serde_json::Value;
use session_events::{DataOrigin, EventKind, Provider, SessionEvent, Sourced};
use std::{
    collections::HashMap,
    env, fs,
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::Duration,
};
use uuid::Uuid;

const POLL_INTERVAL: Duration = Duration::from_millis(1500);
const BUSY_TIMEOUT: Duration = Duration::from_millis(250);
/// Rows read per poll and database at most; the rest come at the next poll.
const BATCH: i64 = 2_000;
/// Usage rows touched this long before the last poll are read again, for late writes.
const USAGE_OVERLAP_SECS: f64 = 120.0;

/// Token totals of one `session_model_usage` row.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct Totals {
    input: u64,
    output: u64,
    cache_read: u64,
    cache_write: u64,
}

/// What a tool call said, kept until its result arrives.
#[derive(Clone)]
struct Call {
    name: String,
    file_path: Option<String>,
    command: Option<String>,
}

/// Where a session runs: its folder, and Hermes's own `source` (cli, tui, desktop, webui,
/// telegram, oneshot…).
#[derive(Clone, Default)]
struct Place {
    folder: Option<String>,
    source: Option<String>,
}

pub struct HermesMonitor {
    /// Unix seconds: only what was written after the app started is read.
    started_at: f64,
    last_message_id: HashMap<PathBuf, i64>,
    last_usage_poll: HashMap<PathBuf, f64>,
    usage: HashMap<(PathBuf, String), Totals>,
    calls: HashMap<(PathBuf, String), Call>,
    /// (database, session) -> (folder, where the session was opened).
    folders: HashMap<(PathBuf, String), Place>,
}

impl HermesMonitor {
    pub fn new() -> Self {
        Self::starting_at(Utc::now().timestamp_millis() as f64 / 1000.0)
    }

    fn starting_at(started_at: f64) -> Self {
        Self {
            started_at,
            last_message_id: HashMap::new(),
            last_usage_poll: HashMap::new(),
            usage: HashMap::new(),
            calls: HashMap::new(),
            folders: HashMap::new(),
        }
    }

    pub fn poll(&mut self, capture_prompts: bool, capture_commands: bool) -> Vec<SessionEvent> {
        let now = Utc::now().timestamp_millis() as f64 / 1000.0;
        let mut events = Vec::new();
        for path in database_paths() {
            events.extend(self.poll_database(&path, capture_prompts, capture_commands, now));
        }
        events
    }

    fn poll_database(
        &mut self,
        path: &Path,
        capture_prompts: bool,
        capture_commands: bool,
        now: f64,
    ) -> Vec<SessionEvent> {
        let Ok(connection) = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        ) else {
            return Vec::new();
        };
        let _ = connection.busy_timeout(BUSY_TIMEOUT);
        let mut events = Vec::new();
        if has_table(&connection, "messages") && has_table(&connection, "sessions") {
            self.read_messages(
                &connection,
                path,
                capture_prompts,
                capture_commands,
                &mut events,
            );
        }
        if has_table(&connection, "session_model_usage") {
            self.read_usage(&connection, path, now, &mut events);
        }
        // A folder can be set after the first message (the session row is updated): look again
        // next time.
        self.folders
            .retain(|(db, _), place| db != path || place.folder.is_some());
        events
    }

    fn folder(&mut self, connection: &Connection, path: &Path, session: &str) -> Place {
        self.folders
            .entry((path.to_owned(), session.to_owned()))
            .or_insert_with(|| {
                let row = connection
                    .query_row(
                        "SELECT cwd, source FROM sessions WHERE id = ?1",
                        params![session],
                        |row| {
                            Ok((
                                row.get::<_, Option<String>>(0)?,
                                row.get::<_, Option<String>>(1)?,
                            ))
                        },
                    )
                    .ok();
                let (cwd, source) = row.unwrap_or((None, None));
                Place {
                    folder: cwd.filter(|cwd| !cwd.trim().is_empty()),
                    source: source.filter(|s| !s.is_empty() && s.len() <= 64),
                }
            })
            .clone()
    }

    fn read_messages(
        &mut self,
        connection: &Connection,
        path: &Path,
        capture_prompts: bool,
        capture_commands: bool,
        events: &mut Vec<SessionEvent>,
    ) {
        let last = self.last_message_id.get(path).copied();
        let sql = "SELECT id, session_id, role, content, tool_call_id, tool_calls, tool_name, timestamp \
                   FROM messages WHERE (?1 IS NULL AND timestamp >= ?2) OR id > ?1 ORDER BY id LIMIT ?3";
        let Ok(mut statement) = connection.prepare(sql) else {
            return;
        };
        type Row = (
            i64,
            String,
            String,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            f64,
        );
        let rows: Vec<Row> =
            match statement.query_map(params![last, self.started_at, BATCH], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3).ok().flatten(),
                    row.get(4).ok().flatten(),
                    row.get(5).ok().flatten(),
                    row.get(6).ok().flatten(),
                    row.get(7)?,
                ))
            }) {
                Ok(rows) => rows.flatten().collect(),
                Err(_) => return,
            };
        let mut highest = last;
        for (id, session, role, content, tool_call_id, tool_calls, tool_name, timestamp) in rows {
            highest = Some(highest.map_or(id, |h| h.max(id)));
            let place = self.folder(connection, path, &session);
            let at = seconds_to_time(timestamp);
            let event = |kind: EventKind, key: &str| {
                let mut event = SessionEvent::new(&session, Provider::Hermes, kind);
                event.project_path = place.folder.clone();
                event.launch_mode = place.source.clone();
                event.occurred_at = at;
                event.event_id = Uuid::new_v5(
                    &Uuid::NAMESPACE_URL,
                    format!("hermes:{}:{session}:{id}:{key}", path.display()).as_bytes(),
                );
                event
            };
            match role.as_str() {
                "user" => {
                    let mut message = event(EventKind::UserMessage, "user");
                    if capture_prompts {
                        message.content = content.filter(|text| !text.trim().is_empty());
                    }
                    events.push(message);
                }
                "assistant" => {
                    let calls = tool_calls
                        .as_deref()
                        .and_then(|text| serde_json::from_str::<Value>(text).ok())
                        .and_then(|value| value.as_array().cloned())
                        .unwrap_or_default();
                    if calls.is_empty() {
                        // A message without tool calls ends the turn.
                        let mut done = event(EventKind::Checkpoint, "turn");
                        done.outcome = Some("turn-completed".to_owned());
                        events.push(done);
                        continue;
                    }
                    for (index, call) in calls.iter().enumerate() {
                        let call_id = call
                            .get("id")
                            .and_then(Value::as_str)
                            .map(str::to_owned)
                            .unwrap_or_else(|| format!("{id}-{index}"));
                        let function = call.get("function").unwrap_or(call);
                        let name = function
                            .get("name")
                            .and_then(Value::as_str)
                            .unwrap_or("tool")
                            .to_owned();
                        // `arguments` is a JSON string in the OpenAI shape, sometimes an object.
                        let arguments = match function.get("arguments") {
                            Some(Value::String(text)) => {
                                serde_json::from_str(text).unwrap_or(Value::Null)
                            }
                            Some(value) => value.clone(),
                            None => Value::Null,
                        };
                        let info = Call {
                            name: name.clone(),
                            file_path: find_text(&arguments, &["path", "file_path", "target_file"]),
                            command: capture_commands
                                .then(|| find_text(&arguments, &["command", "cmd"]))
                                .flatten(),
                        };
                        let mut started =
                            event(EventKind::ToolStarted, &format!("tool:{call_id}:started"));
                        started.tool_name = Some(name);
                        started.file_path = info.file_path.clone();
                        started.command = info.command.clone();
                        started.outcome = Some("running".to_owned());
                        events.push(started);
                        self.calls.insert((path.to_owned(), call_id), info);
                    }
                }
                "tool" => {
                    let call_id = tool_call_id.unwrap_or_else(|| id.to_string());
                    let known = self.calls.remove(&(path.to_owned(), call_id.clone()));
                    let name = tool_name
                        .clone()
                        .or_else(|| known.as_ref().map(|call| call.name.clone()))
                        .unwrap_or_else(|| "tool".to_owned());
                    let info = known.unwrap_or(Call {
                        name: name.clone(),
                        file_path: None,
                        command: None,
                    });
                    let error = content.as_deref().and_then(tool_error);
                    let (kind, outcome) = match &error {
                        Some(message) => (
                            EventKind::ToolFailed,
                            crate::redact::failure_outcome(Some(message)),
                        ),
                        None => (EventKind::ToolFinished, "completed".to_owned()),
                    };
                    let mut finished = event(kind, &format!("tool:{call_id}:finished"));
                    finished.tool_name = Some(name);
                    finished.file_path = info.file_path;
                    finished.command = info.command;
                    finished.outcome = Some(outcome);
                    events.push(finished);
                }
                _ => {}
            }
        }
        // Until a message arrives, the next poll still filters on the start time.
        if let Some(highest) = highest {
            self.last_message_id.insert(path.to_owned(), highest);
        }
        // Calls whose result never came (an interrupted round) are not kept for ever.
        if self.calls.len() > 10_000 {
            self.calls.clear();
        }
    }

    fn read_usage(
        &mut self,
        connection: &Connection,
        path: &Path,
        now: f64,
        events: &mut Vec<SessionEvent>,
    ) {
        let since = self
            .last_usage_poll
            .get(path)
            .map(|last| last - USAGE_OVERLAP_SECS)
            .unwrap_or(self.started_at - USAGE_OVERLAP_SECS);
        let sql = "SELECT session_id, model, billing_provider, billing_base_url, billing_mode, task, \
                   input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, first_seen, last_seen \
                   FROM session_model_usage WHERE COALESCE(last_seen, 0) >= ?1";
        let Ok(mut statement) = connection.prepare(sql) else {
            return;
        };
        type Row = (
            String,
            String,
            String,
            String,
            String,
            String,
            i64,
            i64,
            i64,
            i64,
            Option<f64>,
            Option<f64>,
        );
        let rows: Vec<Row> = match statement.query_map(params![since], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
                row.get(6)?,
                row.get(7)?,
                row.get(8)?,
                row.get(9)?,
                row.get(10)?,
                row.get(11)?,
            ))
        }) {
            Ok(rows) => rows.flatten().collect(),
            Err(_) => return,
        };
        for (
            session,
            model,
            provider,
            base_url,
            mode,
            task,
            input,
            output,
            cache_read,
            cache_write,
            first_seen,
            last_seen,
        ) in rows
        {
            let current = Totals {
                input: input.max(0) as u64,
                output: output.max(0) as u64,
                cache_read: cache_read.max(0) as u64,
                cache_write: cache_write.max(0) as u64,
            };
            let key = (
                path.to_owned(),
                format!(
                    "{session}\u{1f}{model}\u{1f}{provider}\u{1f}{base_url}\u{1f}{mode}\u{1f}{task}"
                ),
            );
            // What was spent before the app started is not counted: a row first met with a
            // `first_seen` before that is a starting point, not a spend.
            let previous = match self.usage.get(&key) {
                Some(previous) => *previous,
                None if first_seen.unwrap_or(0.0) >= self.started_at => Totals::default(),
                None => {
                    self.usage.insert(key, current);
                    continue;
                }
            };
            self.usage.insert(key.clone(), current);
            // Totals only grow; a smaller one means the row was rebuilt (a repair): start again from it.
            if current.input < previous.input
                || current.output < previous.output
                || current.cache_read < previous.cache_read
                || current.cache_write < previous.cache_write
                || current == previous
            {
                continue;
            }
            let place = self.folder(connection, path, &session);
            let mut usage = SessionEvent::new(&session, Provider::Hermes, EventKind::ModelUsage);
            usage.project_path = place.folder;
            usage.launch_mode = place.source;
            usage.occurred_at = seconds_to_time(last_seen.unwrap_or(now));
            usage.event_id = Uuid::new_v5(
                &Uuid::NAMESPACE_URL,
                format!(
                    "hermes:{}:usage:{}:{}:{}:{}:{}",
                    path.display(),
                    key.1,
                    current.input,
                    current.output,
                    current.cache_read,
                    current.cache_write
                )
                .as_bytes(),
            );
            if !model.trim().is_empty() {
                usage.model = Some(provider_value(model));
            }
            usage.input_tokens = Some(provider_value(current.input - previous.input));
            usage.output_tokens = Some(provider_value(current.output - previous.output));
            usage.cache_read_tokens =
                Some(provider_value(current.cache_read - previous.cache_read));
            usage.cache_write_tokens =
                Some(provider_value(current.cache_write - previous.cache_write));
            events.push(usage);
        }
        self.last_usage_poll.insert(path.to_owned(), now);
    }
}

fn seconds_to_time(seconds: f64) -> DateTime<Utc> {
    DateTime::from_timestamp_millis((seconds * 1000.0) as i64).unwrap_or_else(Utc::now)
}

fn provider_value<T>(value: T) -> Sourced<T> {
    Sourced {
        value,
        origin: DataOrigin::Provider,
    }
}

/// The message of a failed tool's result: Hermes tools return `{"error": "…"}` on failure.
fn tool_error(content: &str) -> Option<String> {
    let value: Value = serde_json::from_str(content.trim()).ok()?;
    match value.get("error")? {
        Value::Null | Value::Bool(false) => None,
        Value::String(text) if text.trim().is_empty() => None,
        Value::String(text) => Some(text.clone()),
        other => Some(other.to_string()),
    }
}

fn find_text(value: &Value, keys: &[&str]) -> Option<String> {
    let object = value.as_object()?;
    keys.iter()
        .find_map(|key| object.get(*key).and_then(Value::as_str))
        .filter(|text| !text.trim().is_empty())
        .map(str::to_owned)
}

fn has_table(connection: &Connection, table: &str) -> bool {
    connection
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1",
            params![table],
            |_| Ok(()),
        )
        .is_ok()
}

/// Hermes's home: `$HERMES_HOME`, else `~/.hermes` (`%LOCALAPPDATA%\hermes` on Windows), as in
/// `_platform_default_hermes_home` (`hermes_constants.py`).
pub fn data_root() -> PathBuf {
    if let Some(path) = env::var_os("HERMES_HOME").filter(|path| !path.is_empty()) {
        return PathBuf::from(path);
    }
    let suffix = env::var("HERMES_DATA_DIR_SUFFIX").unwrap_or_default();
    if cfg!(windows) {
        let base = env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .or_else(|| {
                env::var_os("USERPROFILE")
                    .map(|home| PathBuf::from(home).join("AppData").join("Local"))
            })
            .unwrap_or_else(|| PathBuf::from("."));
        return base.join(format!("hermes{suffix}"));
    }
    env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
        .join(format!(".hermes{suffix}"))
}

/// `state.db` of the home and of each profile in `profiles/`.
pub fn database_paths() -> Vec<PathBuf> {
    database_paths_in(&data_root())
}

fn database_paths_in(root: &Path) -> Vec<PathBuf> {
    let mut paths: Vec<PathBuf> = Vec::new();
    let main = root.join("state.db");
    if main.is_file() {
        paths.push(main);
    }
    if let Ok(entries) = fs::read_dir(root.join("profiles")) {
        let mut profiles: Vec<PathBuf> = entries
            .flatten()
            .map(|entry| entry.path().join("state.db"))
            .filter(|path| path.is_file())
            .collect();
        profiles.sort();
        paths.extend(profiles);
    }
    paths
}

pub fn spawn<F>(
    capture_prompts: Arc<AtomicBool>,
    capture_commands: Arc<AtomicBool>,
    mut on_event: F,
) where
    F: FnMut(SessionEvent) + Send + 'static,
{
    thread::spawn(move || {
        let mut monitor = HermesMonitor::new();
        loop {
            for event in monitor.poll(
                capture_prompts.load(Ordering::Relaxed),
                capture_commands.load(Ordering::Relaxed),
            ) {
                on_event(event);
            }
            thread::sleep(POLL_INTERVAL);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The tables and columns this connector reads, as `SCHEMA_SQL` defines them (the others are
    /// left out).
    const SCHEMA: &str = "
        CREATE TABLE sessions (id TEXT PRIMARY KEY, source TEXT NOT NULL, model TEXT, started_at REAL NOT NULL, cwd TEXT);
        CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, role TEXT NOT NULL,
            content TEXT, tool_call_id TEXT, tool_calls TEXT, tool_name TEXT, timestamp REAL NOT NULL, finish_reason TEXT);
        CREATE TABLE session_model_usage (session_id TEXT NOT NULL, model TEXT NOT NULL, billing_provider TEXT NOT NULL DEFAULT '',
            billing_base_url TEXT NOT NULL DEFAULT '', billing_mode TEXT NOT NULL DEFAULT '', task TEXT NOT NULL DEFAULT '',
            api_call_count INTEGER NOT NULL DEFAULT 0, input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
            cache_read_tokens INTEGER NOT NULL DEFAULT 0, cache_write_tokens INTEGER NOT NULL DEFAULT 0, reasoning_tokens INTEGER NOT NULL DEFAULT 0,
            first_seen REAL, last_seen REAL,
            PRIMARY KEY (session_id, model, billing_provider, billing_base_url, billing_mode, task));";

    const START: f64 = 1_794_200_000.0;

    fn database(name: &str) -> (PathBuf, Connection) {
        let dir = std::env::temp_dir().join(format!("hermes-test-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("state.db");
        let connection = Connection::open(&path).unwrap();
        connection.execute_batch(SCHEMA).unwrap();
        connection
            .execute(
                "INSERT INTO sessions (id, source, model, started_at, cwd) VALUES ('s1', 'cli', 'claude-sonnet-5-5', ?1, '/Users/demo/api')",
                params![START - 600.0],
            )
            .unwrap();
        (path, connection)
    }

    fn message(
        db: &Connection,
        role: &str,
        content: Option<&str>,
        call_id: Option<&str>,
        calls: Option<&str>,
        tool: Option<&str>,
        at: f64,
    ) {
        db.execute(
            "INSERT INTO messages (session_id, role, content, tool_call_id, tool_calls, tool_name, timestamp) VALUES ('s1', ?1, ?2, ?3, ?4, ?5, ?6)",
            params![role, content, call_id, calls, tool, at],
        )
        .unwrap();
    }

    fn usage(
        db: &Connection,
        task: &str,
        input: i64,
        output: i64,
        cache_read: i64,
        first: f64,
        last: f64,
    ) {
        db.execute(
            "INSERT INTO session_model_usage (session_id, model, billing_provider, task, input_tokens, output_tokens, cache_read_tokens, first_seen, last_seen)
             VALUES ('s1', 'claude-sonnet-5-5', 'anthropic', ?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT (session_id, model, billing_provider, billing_base_url, billing_mode, task) DO UPDATE SET
               input_tokens = excluded.input_tokens, output_tokens = excluded.output_tokens,
               cache_read_tokens = excluded.cache_read_tokens, last_seen = excluded.last_seen",
            params![task, input, output, cache_read, first, last],
        )
        .unwrap();
    }

    fn poll(
        monitor: &mut HermesMonitor,
        path: &Path,
        prompts: bool,
        commands: bool,
        now: f64,
    ) -> Vec<SessionEvent> {
        monitor.poll_database(path, prompts, commands, now)
    }

    fn kinds(events: &[SessionEvent]) -> Vec<EventKind> {
        events.iter().map(|e| e.kind).collect()
    }

    #[test]
    fn a_tool_round_is_read_with_its_folder_and_only_after_the_start() {
        let (path, db) = database("round");
        message(
            &db,
            "user",
            Some("old request"),
            None,
            None,
            None,
            START - 60.0,
        );
        let mut monitor = HermesMonitor::starting_at(START);
        assert!(
            poll(&mut monitor, &path, true, true, START + 1.0).is_empty(),
            "older messages are skipped"
        );

        message(
            &db,
            "user",
            Some("fix the login test"),
            None,
            None,
            None,
            START + 5.0,
        );
        message(
            &db,
            "assistant",
            None,
            None,
            Some(
                r#"[{"id":"call_1","type":"function","function":{"name":"terminal","arguments":"{\"command\":\"npm test -- login\"}"}},
                    {"id":"call_2","type":"function","function":{"name":"patch","arguments":"{\"path\":\"src/auth.ts\",\"old_string\":\"a\"}"}}]"#,
            ),
            None,
            START + 6.0,
        );
        message(
            &db,
            "tool",
            Some(r#"{"output":"1 failing","exit_code":1}"#),
            Some("call_1"),
            None,
            Some("terminal"),
            START + 8.0,
        );
        message(
            &db,
            "tool",
            Some(r#"{"error":"old_string not found in src/auth.ts"}"#),
            Some("call_2"),
            None,
            Some("patch"),
            START + 9.0,
        );
        message(
            &db,
            "assistant",
            Some("Done."),
            None,
            None,
            None,
            START + 12.0,
        );

        let events = poll(&mut monitor, &path, true, true, START + 13.0);
        assert_eq!(
            kinds(&events),
            [
                EventKind::UserMessage,
                EventKind::ToolStarted,
                EventKind::ToolStarted,
                EventKind::ToolFinished,
                EventKind::ToolFailed,
                EventKind::Checkpoint
            ]
        );
        assert!(
            events
                .iter()
                .all(|e| e.provider == Provider::Hermes && e.session_id == "s1")
        );
        assert!(
            events
                .iter()
                .all(|e| e.project_path.as_deref() == Some("/Users/demo/api")
                    && e.launch_mode.as_deref() == Some("cli"))
        );
        assert_eq!(events[0].content.as_deref(), Some("fix the login test"));
        assert_eq!(events[1].tool_name.as_deref(), Some("terminal"));
        assert_eq!(events[1].command.as_deref(), Some("npm test -- login"));
        assert_eq!(events[2].file_path.as_deref(), Some("src/auth.ts"));
        assert_eq!(
            events[3].command.as_deref(),
            Some("npm test -- login"),
            "the result keeps what the call said"
        );
        assert_eq!(events[4].tool_name.as_deref(), Some("patch"));
        assert_eq!(events[4].file_path.as_deref(), Some("src/auth.ts"));
        assert_eq!(events[5].outcome.as_deref(), Some("turn-completed"));
        assert_eq!(events[1].occurred_at, seconds_to_time(START + 6.0));
        // Nothing is read twice.
        assert!(poll(&mut monitor, &path, true, true, START + 20.0).is_empty());
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn prompts_and_commands_follow_the_capture_settings() {
        let (path, db) = database("privacy");
        let mut monitor = HermesMonitor::starting_at(START);
        message(
            &db,
            "user",
            Some("secret plan"),
            None,
            None,
            None,
            START + 1.0,
        );
        message(
            &db,
            "assistant",
            None,
            None,
            Some(
                r#"[{"id":"c","function":{"name":"terminal","arguments":{"command":"export TOKEN=x"}}}]"#,
            ),
            None,
            START + 2.0,
        );
        let events = poll(&mut monitor, &path, false, false, START + 3.0);
        assert_eq!(events[0].content, None);
        assert_eq!(events[1].command, None);
        assert_eq!(
            events[1].tool_name.as_deref(),
            Some("terminal"),
            "an object `arguments` is read too"
        );
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn usage_counts_only_what_was_spent_after_the_start() {
        let (path, db) = database("usage");
        // A session already running when the app starts: its totals so far are a starting point.
        usage(&db, "", 1_000, 200, 5_000, START - 300.0, START - 10.0);
        let mut monitor = HermesMonitor::starting_at(START);
        assert!(poll(&mut monitor, &path, false, false, START + 1.0).is_empty());

        usage(&db, "", 1_400, 260, 9_000, START - 300.0, START + 30.0);
        let events = poll(&mut monitor, &path, false, false, START + 31.0);
        assert_eq!(kinds(&events), [EventKind::ModelUsage]);
        let spent = &events[0];
        assert_eq!(spent.input_tokens.as_ref().map(|t| t.value), Some(400));
        assert_eq!(spent.output_tokens.as_ref().map(|t| t.value), Some(60));
        assert_eq!(
            spent.cache_read_tokens.as_ref().map(|t| t.value),
            Some(4_000)
        );
        assert_eq!(spent.cache_write_tokens.as_ref().map(|t| t.value), Some(0));
        assert_eq!(
            spent.model.as_ref().map(|m| m.value.as_str()),
            Some("claude-sonnet-5-5")
        );
        assert_eq!(spent.project_path.as_deref(), Some("/Users/demo/api"));
        assert_eq!(spent.occurred_at, seconds_to_time(START + 30.0));
        // The same totals read again (the overlap) are not counted twice.
        assert!(poll(&mut monitor, &path, false, false, START + 40.0).is_empty());

        // A task that starts after the app (title, compression) counts from zero.
        usage(&db, "title", 50, 10, 0, START + 50.0, START + 50.0);
        let events = poll(&mut monitor, &path, false, false, START + 51.0);
        assert_eq!(events[0].input_tokens.as_ref().map(|t| t.value), Some(50));

        // A rebuilt row (smaller totals) is a new starting point, not a negative spend.
        usage(&db, "", 100, 10, 0, START - 300.0, START + 60.0);
        assert!(poll(&mut monitor, &path, false, false, START + 61.0).is_empty());
        usage(&db, "", 150, 20, 0, START - 300.0, START + 70.0);
        assert_eq!(
            poll(&mut monitor, &path, false, false, START + 71.0)[0]
                .input_tokens
                .as_ref()
                .map(|t| t.value),
            Some(50)
        );
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn failed_results_are_recognised() {
        assert_eq!(
            tool_error(r#"{"error": "not found"}"#).as_deref(),
            Some("not found")
        );
        assert_eq!(
            tool_error(r#"{"error": {"code": 2}}"#).as_deref(),
            Some(r#"{"code":2}"#)
        );
        assert_eq!(tool_error(r#"{"error": null, "output": "ok"}"#), None);
        assert_eq!(tool_error(r#"{"error": ""}"#), None);
        assert_eq!(tool_error("plain text output"), None);
        assert_eq!(tool_error(r#"["error"]"#), None);
    }

    #[test]
    fn databases_of_the_home_and_its_profiles() {
        let root = std::env::temp_dir().join(format!("hermes-home-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("profiles/work")).unwrap();
        fs::create_dir_all(root.join("profiles/empty")).unwrap();
        assert!(database_paths_in(&root).is_empty());
        fs::write(root.join("state.db"), "").unwrap();
        fs::write(root.join("profiles/work/state.db"), "").unwrap();
        assert_eq!(
            database_paths_in(&root),
            [root.join("state.db"), root.join("profiles/work/state.db")]
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_database_without_the_tables_is_skipped() {
        let dir = std::env::temp_dir().join(format!("hermes-empty-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("state.db");
        Connection::open(&path)
            .unwrap()
            .execute_batch("CREATE TABLE other (x)")
            .unwrap();
        assert!(
            HermesMonitor::starting_at(START)
                .poll_database(&path, true, true, START)
                .is_empty()
        );
        let _ = fs::remove_dir_all(&dir);
    }
}
