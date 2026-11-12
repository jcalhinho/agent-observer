//! Goose (block/goose) : lit en lecture seule sa base de sessions
//! (`~/.local/share/goose/sessions/sessions.db`).
//!
//! Schéma vérifié dans crates/goose/src/session/session_manager.rs :
//! - `sessions` : `id`, `working_dir`, `session_type` (user, scheduled,
//!   sub_agent, terminal, gateway, acp…), `created_at` ;
//! - `messages` : `id` croissant, `session_id`, `role`, `content_json` (liste de
//!   blocs `{"type": "text"|"toolRequest"|"toolResponse", …}`),
//!   `created_timestamp` ;
//! - `usage_ledger` : une ligne par appel au modèle, `model`, `input_tokens`
//!   (cache compris : conversation/token_usage.rs), `output_tokens`,
//!   `cache_read_tokens`, `cache_write_tokens`, `created_timestamp` (secondes).
//!
//! Seules les lignes ajoutées après le lancement de l'app sont lues.

use crate::tail::{self, Poll};
use chrono::Utc;
use rusqlite::{Connection, OpenFlags, params};
use serde_json::Value;
use session_events::{EventKind, Provider, SessionEvent};
use std::{
    collections::{HashMap, HashSet},
    env,
    path::PathBuf,
};

/// Où Goose range sa base : `$GOOSE_PATH_ROOT/data`, sinon `$XDG_DATA_HOME/goose`
/// ou `~/.local/share/goose` (macOS et Linux), `%APPDATA%\Block\goose\data` sous
/// Windows (config/paths.rs, documentation/docs/guides/logs.md).
pub fn database_paths() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(root) = env::var_os("GOOSE_PATH_ROOT")
        .map(PathBuf::from)
        .filter(|root| root.is_absolute())
    {
        dirs.push(root.join("data"));
    }
    if let Some(data) = env::var_os("XDG_DATA_HOME") {
        dirs.push(PathBuf::from(data).join("goose"));
    }
    dirs.push(tail::home().join(".local").join("share").join("goose"));
    if let Some(appdata) = env::var_os("APPDATA") {
        dirs.push(
            PathBuf::from(appdata)
                .join("Block")
                .join("goose")
                .join("data"),
        );
    }
    dirs.into_iter()
        .map(|dir| dir.join("sessions").join("sessions.db"))
        .collect()
}

struct Session {
    working_dir: Option<String>,
    kind: Option<String>,
}

struct Source {
    path: PathBuf,
    connection: Option<Connection>,
    /// Derniers identifiants vus : `None` tant que la base n'a pas été ouverte.
    last_message: Option<i64>,
    last_usage: Option<i64>,
}

pub struct GooseMonitor {
    sources: Vec<Source>,
    sessions: HashMap<String, Session>,
    started: HashSet<String>,
    tools: HashMap<String, (String, Option<String>, Option<String>)>,
    models: HashMap<String, String>,
}

impl GooseMonitor {
    pub fn new(paths: Vec<PathBuf>) -> Self {
        Self {
            sources: paths
                .into_iter()
                .map(|path| Source {
                    path,
                    connection: None,
                    last_message: None,
                    last_usage: None,
                })
                .collect(),
            sessions: HashMap::new(),
            started: HashSet::new(),
            tools: HashMap::new(),
            models: HashMap::new(),
        }
    }

    fn session(&mut self, connection: &Connection, id: &str) -> &Session {
        if !self.sessions.contains_key(id) {
            let found = connection
                .query_row(
                    "SELECT working_dir, session_type FROM sessions WHERE id = ?1",
                    params![id],
                    |row| {
                        Ok(Session {
                            working_dir: row.get(0).ok(),
                            kind: row.get(1).ok(),
                        })
                    },
                )
                .unwrap_or(Session {
                    working_dir: None,
                    kind: None,
                });
            self.sessions.insert(id.to_owned(), found);
        }
        &self.sessions[id]
    }

    fn event(
        &mut self,
        connection: &Connection,
        id: &str,
        kind: EventKind,
        at: chrono::DateTime<Utc>,
    ) -> SessionEvent {
        let model = self.models.get(id).cloned();
        let session = self.session(connection, id);
        let mut event = SessionEvent::new(id, Provider::Goose, kind);
        event.occurred_at = at;
        event.project_path = session.working_dir.clone();
        event.launch_mode = session.kind.clone();
        event.model = model.map(tail::provider);
        event
    }

    fn poll_source(&mut self, index: usize, prompts: bool, commands: bool) -> Vec<SessionEvent> {
        let mut source = std::mem::replace(
            &mut self.sources[index],
            Source {
                path: PathBuf::new(),
                connection: None,
                last_message: None,
                last_usage: None,
            },
        );
        let events = self.read(&mut source, prompts, commands);
        self.sources[index] = source;
        events
    }

    fn read(&mut self, source: &mut Source, prompts: bool, commands: bool) -> Vec<SessionEvent> {
        if source.connection.is_none() {
            if !source.path.is_file() {
                return Vec::new();
            }
            let Ok(connection) = Connection::open_with_flags(
                &source.path,
                OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
            ) else {
                return Vec::new();
            };
            let max = |table: &str| {
                connection
                    .query_row(
                        &format!("SELECT COALESCE(MAX(id), 0) FROM {table}"),
                        [],
                        |row| row.get::<_, i64>(0),
                    )
                    .ok()
            };
            source.last_message = source.last_message.or_else(|| max("messages"));
            source.last_usage = source.last_usage.or_else(|| max("usage_ledger"));
            source.connection = Some(connection);
        }
        let Some(connection) = source.connection.take() else {
            return Vec::new();
        };
        let mut events = Vec::new();

        // Les messages d'abord : ils annoncent la session et ses outils.
        let messages: Vec<(i64, String, String, String, i64)> = connection
            .prepare(
                "SELECT id, session_id, role, content_json, created_timestamp FROM messages WHERE id > ?1 ORDER BY id LIMIT 500",
            )
            .and_then(|mut statement| {
                statement
                    .query_map(params![source.last_message.unwrap_or(0)], |row| {
                        Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?))
                    })?
                    .collect()
            })
            .unwrap_or_default();
        for (id, session_id, role, content, created) in messages {
            source.last_message = Some(id);
            let at = tail::parse_time(Some(&Value::from(created))).unwrap_or_else(Utc::now);
            if self.started.insert(session_id.clone()) {
                events.push(self.event(&connection, &session_id, EventKind::SessionStarted, at));
            }
            let blocks: Vec<Value> = serde_json::from_str(&content).unwrap_or_default();
            let mut texts = Vec::new();
            for block in &blocks {
                match block.get("type").and_then(Value::as_str) {
                    Some("text") => {
                        texts.extend(block.get("text").and_then(Value::as_str).map(str::to_owned))
                    }
                    Some("toolRequest") => {
                        let call = block.get("toolCall").and_then(|call| call.get("value"));
                        let name = call
                            .and_then(|call| call.get("name"))
                            .and_then(Value::as_str)
                            .unwrap_or("tool")
                            .to_owned();
                        let args = call.and_then(|call| call.get("arguments"));
                        let file_path = tail::tool_path(args);
                        // L'éditeur de texte de Goose a lui aussi un champ `command` (view, write…) :
                        // seule une commande d'outil shell en est vraiment une.
                        let command = name
                            .ends_with("shell")
                            .then(|| tail::tool_command(args, commands))
                            .flatten();
                        if let Some(tool_id) = block.get("id").and_then(Value::as_str) {
                            self.tools.insert(
                                tool_id.to_owned(),
                                (name.clone(), file_path.clone(), command.clone()),
                            );
                        }
                        let mut started =
                            self.event(&connection, &session_id, EventKind::ToolStarted, at);
                        started.tool_name = Some(name);
                        started.file_path = file_path;
                        started.command = command;
                        events.push(started);
                    }
                    Some("toolResponse") => {
                        let result = block.get("toolResult");
                        let failed = result
                            .and_then(|result| result.get("status"))
                            .and_then(Value::as_str)
                            == Some("error")
                            || result
                                .and_then(|result| result.get("value"))
                                .and_then(|value| value.get("isError"))
                                .and_then(Value::as_bool)
                                == Some(true);
                        let (name, file_path, command) = block
                            .get("id")
                            .and_then(Value::as_str)
                            .and_then(|tool_id| self.tools.remove(tool_id))
                            .unwrap_or_else(|| ("tool".to_owned(), None, None));
                        let mut finished = self.event(
                            &connection,
                            &session_id,
                            if failed {
                                EventKind::ToolFailed
                            } else {
                                EventKind::ToolFinished
                            },
                            at,
                        );
                        finished.tool_name = Some(name);
                        finished.file_path = file_path;
                        finished.command = command;
                        if failed {
                            finished.outcome = Some(crate::redact::failure_outcome(None));
                        }
                        events.push(finished);
                    }
                    _ => {}
                }
            }
            let has_tool_response = blocks
                .iter()
                .any(|block| block.get("type").and_then(Value::as_str) == Some("toolResponse"));
            if role == "user" && !has_tool_response {
                let mut user = self.event(&connection, &session_id, EventKind::UserMessage, at);
                if prompts && !texts.is_empty() {
                    user.content = Some(texts.join("\n"));
                }
                events.push(user);
            }
        }

        type Row = (
            i64,
            String,
            Option<String>,
            Option<i64>,
            Option<i64>,
            Option<i64>,
            Option<i64>,
            i64,
        );
        let usages: Vec<Row> = connection
            .prepare(
                "SELECT id, session_id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, created_timestamp \
                 FROM usage_ledger WHERE id > ?1 ORDER BY id LIMIT 500",
            )
            .and_then(|mut statement| {
                statement
                    .query_map(params![source.last_usage.unwrap_or(0)], |row| {
                        Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?, row.get(6)?, row.get(7)?))
                    })?
                    .collect()
            })
            .unwrap_or_default();
        for (id, session_id, model, input, output, cache_read, cache_write, created) in usages {
            source.last_usage = Some(id);
            if let Some(model) = &model {
                self.models.insert(session_id.clone(), model.clone());
            }
            let at = tail::parse_time(Some(&Value::from(created))).unwrap_or_else(Utc::now);
            let mut usage = self.event(&connection, &session_id, EventKind::ModelUsage, at);
            let read = cache_read.unwrap_or(0).max(0) as u64;
            let write = cache_write.unwrap_or(0).max(0) as u64;
            usage.input_tokens = input.map(|input| {
                let input = input.max(0) as u64;
                if read == 0 && write == 0 {
                    tail::provider(input)
                } else {
                    tail::derived(input.saturating_sub(read + write))
                }
            });
            usage.output_tokens = output.map(|output| tail::provider(output.max(0) as u64));
            usage.cache_read_tokens = (read > 0).then(|| tail::provider(read));
            usage.cache_write_tokens = (write > 0).then(|| tail::provider(write));
            if usage.input_tokens.is_some() || usage.output_tokens.is_some() {
                events.push(usage);
            }
        }
        source.connection = Some(connection);
        events
    }
}

impl Poll for GooseMonitor {
    fn poll(&mut self, prompts: bool, commands: bool) -> Vec<SessionEvent> {
        (0..self.sources.len())
            .flat_map(|index| self.poll_source(index, prompts, commands))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use session_events::DataOrigin;

    fn schema(connection: &Connection) {
        connection
            .execute_batch(
                "CREATE TABLE sessions (id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', session_type TEXT NOT NULL DEFAULT 'user', working_dir TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
                 CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, message_id TEXT, session_id TEXT NOT NULL, role TEXT NOT NULL, content_json TEXT NOT NULL, created_timestamp INTEGER NOT NULL, timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP, tokens INTEGER, metadata_json TEXT);
                 CREATE TABLE usage_ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, created_timestamp INTEGER NOT NULL, model TEXT, input_tokens INTEGER, output_tokens INTEGER, total_tokens INTEGER, cache_read_tokens INTEGER, cache_write_tokens INTEGER, cost REAL, cost_source TEXT, is_compaction INTEGER DEFAULT 0);
                 INSERT INTO sessions (id, session_type, working_dir) VALUES ('old', 'user', '/old');
                 INSERT INTO messages (session_id, role, content_json, created_timestamp) VALUES ('old', 'user', '[{\"type\":\"text\",\"text\":\"before\"}]', 1762000000);",
            )
            .unwrap();
    }

    #[test]
    fn only_rows_added_after_start_are_read_with_tools_and_uncached_input() {
        let dir = std::env::temp_dir().join(format!("goose-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("sessions.db");
        let writer = Connection::open(&path).unwrap();
        schema(&writer);
        let mut monitor = GooseMonitor::new(vec![path.clone()]);
        assert!(monitor.poll(true, true).is_empty());

        writer
            .execute_batch(
                "INSERT INTO sessions (id, session_type, working_dir) VALUES ('s1', 'terminal', '/Users/me/app');
                 INSERT INTO messages (session_id, role, content_json, created_timestamp) VALUES ('s1', 'user', '[{\"type\":\"text\",\"text\":\"list files\"}]', 1762940000);
                 INSERT INTO messages (session_id, role, content_json, created_timestamp) VALUES ('s1', 'assistant', '[{\"type\":\"toolRequest\",\"id\":\"t1\",\"toolCall\":{\"status\":\"success\",\"value\":{\"name\":\"developer__shell\",\"arguments\":{\"command\":\"ls\"}}}}]', 1762940001);
                 INSERT INTO messages (session_id, role, content_json, created_timestamp) VALUES ('s1', 'user', '[{\"type\":\"toolResponse\",\"id\":\"t1\",\"toolResult\":{\"status\":\"success\",\"value\":{\"content\":[],\"isError\":false}}}]', 1762940002);
                 INSERT INTO usage_ledger (session_id, created_timestamp, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens) VALUES ('s1', 1762940003, 'claude-sonnet-4-5', 1000, 40, 700, 100);",
            )
            .unwrap();
        let events = monitor.poll(true, true);
        let kinds: Vec<_> = events.iter().map(|event| event.kind).collect();
        assert_eq!(
            kinds,
            vec![
                EventKind::SessionStarted,
                EventKind::UserMessage,
                EventKind::ToolStarted,
                EventKind::ToolFinished,
                EventKind::ModelUsage
            ]
        );
        assert!(events.iter().all(|event| event.session_id == "s1"
            && event.project_path.as_deref() == Some("/Users/me/app")
            && event.launch_mode.as_deref() == Some("terminal")));
        assert_eq!(events[1].content.as_deref(), Some("list files"));
        assert_eq!(events[3].command.as_deref(), Some("ls"));
        let usage = &events[4];
        assert_eq!(
            usage.input_tokens.as_ref().map(|v| (v.value, v.origin)),
            Some((200, DataOrigin::Derived))
        );
        assert_eq!(usage.cache_read_tokens.as_ref().map(|v| v.value), Some(700));
        assert_eq!(
            usage.model.as_ref().map(|m| m.value.as_str()),
            Some("claude-sonnet-4-5")
        );
        assert!(monitor.poll(true, true).is_empty());
        std::fs::remove_dir_all(dir).ok();
    }
}
