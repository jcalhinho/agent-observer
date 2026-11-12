//! Zed : lit en lecture seule les conversations de son agent intégré
//! (`~/Library/Application Support/Zed/threads/threads.db` sur macOS,
//! `~/.local/share/zed/threads/threads.db` sous Linux).
//!
//! Format vérifié dans zed-industries/zed (crates/agent/src/db.rs, thread.rs,
//! crates/language_model_core) : table `threads` (`id`, `updated_at` RFC 3339,
//! `data_type` json|zstd, `data`, `folder_paths` séparés par des retours à la
//! ligne, `created_at`). `data` est la conversation entière, réécrite à chaque
//! sauvegarde : `messages` (`{"User": …}`, `{"Agent": {"content": [{"ToolUse":
//! …}], "tool_results": {…}}}`), `model` (`{provider, model}`) et
//! `cumulative_token_usage` (`input_tokens` sans le cache,
//! `cache_read_input_tokens`, `cache_creation_input_tokens`, `output_tokens`).
//!
//! L'app compare chaque sauvegarde à la précédente : les jetons sont la
//! différence des cumuls (valeur calculée), les outils ceux qui sont apparus.
//! Une conversation ancienne reprise sert de point de départ à sa première
//! sauvegarde vue, sauf si elle a bougé dans les 48 dernières heures : son
//! état est alors relevé au lancement de l'app.

use crate::tail::{self, Poll};
use chrono::{DateTime, Duration as ChronoDuration, Utc};
use rusqlite::{Connection, OpenFlags, params};
use serde_json::Value;
use session_events::{EventKind, Provider, SessionEvent};
use std::{
    collections::{HashMap, HashSet},
    env,
    io::Read,
    path::PathBuf,
};

/// Le dossier de données de Zed (crates/paths/src/paths.rs, data_dir).
pub fn database_path() -> PathBuf {
    let home = tail::home();
    let dir = if cfg!(target_os = "macos") {
        home.join("Library").join("Application Support").join("Zed")
    } else if cfg!(windows) {
        env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join("AppData").join("Local"))
            .join("Zed")
    } else if let Some(flatpak) = env::var_os("FLATPAK_XDG_DATA_HOME") {
        PathBuf::from(flatpak).join("zed")
    } else {
        env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(".local").join("share"))
            .join("zed")
    };
    dir.join("threads").join("threads.db")
}

#[derive(Default, Clone, PartialEq)]
struct State {
    users: usize,
    tool_uses: HashSet<String>,
    results: HashSet<String>,
    usage: [u64; 4],
    model: Option<String>,
}

pub struct ZedMonitor {
    path: PathBuf,
    connection: Option<Connection>,
    watermark: String,
    started_at: String,
    threads: HashMap<String, State>,
}

impl ZedMonitor {
    pub fn new(path: PathBuf) -> Self {
        let now = Utc::now();
        Self {
            path,
            connection: None,
            watermark: now.to_rfc3339(),
            started_at: now.to_rfc3339(),
            threads: HashMap::new(),
        }
    }

    fn open(&mut self) -> bool {
        if self.connection.is_some() {
            return true;
        }
        if !self.path.is_file() {
            return false;
        }
        let Ok(connection) = Connection::open_with_flags(
            &self.path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        ) else {
            return false;
        };
        // État des conversations récentes, pour ne compter que ce qui viendra.
        let recent = (Utc::now() - ChronoDuration::hours(48)).to_rfc3339();
        let rows = rows(
            &connection,
            "updated_at > ?1 AND updated_at <= ?2",
            &recent,
            &self.watermark,
        );
        for (id, data_type, data, _, _) in rows {
            if let Some(thread) = decode(&data_type, &data) {
                self.threads.insert(id, state(&thread));
            }
        }
        self.connection = Some(connection);
        true
    }
}

type Row = (String, String, Vec<u8>, Option<String>, Option<String>);

fn rows(connection: &Connection, filter: &str, low: &str, high: &str) -> Vec<Row> {
    connection
        .prepare(&format!(
            "SELECT id, data_type, data, folder_paths, created_at FROM threads WHERE {filter} ORDER BY updated_at LIMIT 200"
        ))
        .and_then(|mut statement| {
            statement
                .query_map(params![low, high], |row| {
                    Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3).ok().flatten(), row.get(4).ok().flatten()))
                })?
                .collect()
        })
        .unwrap_or_default()
}

fn decode(data_type: &str, data: &[u8]) -> Option<Value> {
    match data_type {
        "json" => serde_json::from_slice(data).ok(),
        "zstd" => {
            let mut source = data;
            let mut decoder = ruzstd::decoding::StreamingDecoder::new(&mut source).ok()?;
            let mut json = Vec::new();
            decoder.read_to_end(&mut json).ok()?;
            serde_json::from_slice(&json).ok()
        }
        _ => None,
    }
}

fn state(thread: &Value) -> State {
    let mut state = State::default();
    for message in thread
        .get("messages")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        if message.get("User").is_some() {
            state.users += 1;
        }
        let Some(agent) = message.get("Agent") else {
            continue;
        };
        for part in agent
            .get("content")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            if let Some(id) = part
                .get("ToolUse")
                .and_then(|tool| tool.get("id"))
                .and_then(Value::as_str)
            {
                state.tool_uses.insert(id.to_owned());
            }
        }
        if let Some(results) = agent.get("tool_results").and_then(Value::as_object) {
            state.results.extend(results.keys().cloned());
        }
    }
    let usage = thread.get("cumulative_token_usage");
    let number = |key: &str| {
        usage
            .and_then(|usage| usage.get(key))
            .and_then(Value::as_u64)
            .unwrap_or(0)
    };
    state.usage = [
        number("input_tokens"),
        number("output_tokens"),
        number("cache_read_input_tokens"),
        number("cache_creation_input_tokens"),
    ];
    state.model = thread
        .get("model")
        .and_then(|model| model.get("model"))
        .and_then(Value::as_str)
        .map(str::to_owned);
    state
}

/// Ce qui a changé entre deux sauvegardes d'une conversation.
fn changes(
    id: &str,
    project: Option<&str>,
    thread: &Value,
    before: &State,
    after: &State,
    at: DateTime<Utc>,
    commands: bool,
) -> Vec<SessionEvent> {
    let event = |kind| {
        let mut event = SessionEvent::new(id, Provider::Zed, kind);
        event.occurred_at = at;
        event.project_path = project.map(str::to_owned);
        event.model = after.model.clone().map(tail::provider);
        event
    };
    let mut events = Vec::new();
    for _ in before.users..after.users {
        events.push(event(EventKind::UserMessage));
    }
    let mut tools: HashMap<String, (String, Option<String>, Option<String>)> = HashMap::new();
    let mut failures: HashMap<String, bool> = HashMap::new();
    for message in thread
        .get("messages")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let Some(agent) = message.get("Agent") else {
            continue;
        };
        for tool in agent
            .get("content")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|part| part.get("ToolUse"))
        {
            let Some(tool_id) = tool.get("id").and_then(Value::as_str) else {
                continue;
            };
            let input = tool.get("input");
            // LanguageModelToolUseInput : `{"type": "json", "value": {…}}`, ou l'objet lui-même.
            let args = match input
                .and_then(|input| input.get("type"))
                .and_then(Value::as_str)
            {
                Some("json") => input.and_then(|input| input.get("value")),
                _ => input,
            };
            let name = tool
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("tool")
                .to_owned();
            tools.insert(
                tool_id.to_owned(),
                (
                    name,
                    tail::tool_path(args),
                    tail::tool_command(args, commands),
                ),
            );
        }
        if let Some(results) = agent.get("tool_results").and_then(Value::as_object) {
            for (tool_id, result) in results {
                failures.insert(
                    tool_id.clone(),
                    result.get("is_error").and_then(Value::as_bool) == Some(true),
                );
            }
        }
    }
    for tool_id in after.tool_uses.difference(&before.tool_uses) {
        let (name, file_path, command) =
            tools
                .get(tool_id)
                .cloned()
                .unwrap_or(("tool".to_owned(), None, None));
        let mut started = event(EventKind::ToolStarted);
        started.tool_name = Some(name);
        started.file_path = file_path;
        started.command = command;
        events.push(started);
    }
    for tool_id in after.results.difference(&before.results) {
        let (name, file_path, command) =
            tools
                .get(tool_id)
                .cloned()
                .unwrap_or(("tool".to_owned(), None, None));
        let failed = failures.get(tool_id).copied().unwrap_or(false);
        let mut finished = event(if failed {
            EventKind::ToolFailed
        } else {
            EventKind::ToolFinished
        });
        finished.tool_name = Some(name);
        finished.file_path = file_path;
        finished.command = command;
        if failed {
            finished.outcome = Some(crate::redact::failure_outcome(None));
        }
        events.push(finished);
    }
    let delta: Vec<u64> = after
        .usage
        .iter()
        .zip(before.usage)
        .map(|(now, then)| now.saturating_sub(then))
        .collect();
    if delta.iter().any(|value| *value > 0) {
        let mut usage = event(EventKind::ModelUsage);
        usage.input_tokens = Some(tail::derived(delta[0]));
        usage.output_tokens = Some(tail::derived(delta[1]));
        usage.cache_read_tokens = (delta[2] > 0).then(|| tail::derived(delta[2]));
        usage.cache_write_tokens = (delta[3] > 0).then(|| tail::derived(delta[3]));
        events.push(usage);
    }
    events
}

impl Poll for ZedMonitor {
    fn poll(&mut self, _prompts: bool, commands: bool) -> Vec<SessionEvent> {
        if !self.open() {
            return Vec::new();
        }
        let Some(connection) = self.connection.as_ref() else {
            return Vec::new();
        };
        let updated: Vec<(Row, String)> = connection
            .prepare(
                "SELECT id, data_type, data, folder_paths, created_at, updated_at FROM threads \
                 WHERE updated_at > ?1 ORDER BY updated_at LIMIT 200",
            )
            .and_then(|mut statement| {
                statement
                    .query_map(params![self.watermark], |row| {
                        Ok((
                            (
                                row.get(0)?,
                                row.get(1)?,
                                row.get(2)?,
                                row.get(3).ok().flatten(),
                                row.get(4).ok().flatten(),
                            ),
                            row.get::<_, String>(5)?,
                        ))
                    })?
                    .collect()
            })
            .unwrap_or_default();
        let mut events = Vec::new();
        for ((id, data_type, data, folders, created), updated_at) in updated {
            self.watermark = self.watermark.clone().max(updated_at.clone());
            let Some(thread) = decode(&data_type, &data) else {
                continue;
            };
            let after = state(&thread);
            let at = DateTime::parse_from_rfc3339(&updated_at)
                .map(|at| at.with_timezone(&Utc))
                .unwrap_or_else(|_| Utc::now());
            let project = folders
                .as_deref()
                .and_then(|folders| folders.lines().next())
                .filter(|first| !first.is_empty());
            let before = match self.threads.get(&id) {
                Some(before) => before.clone(),
                None if created
                    .as_deref()
                    .is_some_and(|created| created >= self.started_at.as_str()) =>
                {
                    let mut started =
                        SessionEvent::new(&id, Provider::Zed, EventKind::SessionStarted);
                    started.occurred_at = at;
                    started.project_path = project.map(str::to_owned);
                    events.push(started);
                    State::default()
                }
                None => {
                    self.threads.insert(id, after);
                    continue;
                }
            };
            if before != after {
                events.extend(changes(
                    &id, project, &thread, &before, &after, at, commands,
                ));
            }
            self.threads.insert(id, after);
        }
        events
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn zstd(value: &Value) -> Vec<u8> {
        ruzstd::encoding::compress_to_vec(
            value.to_string().as_bytes(),
            ruzstd::encoding::CompressionLevel::Fastest,
        )
    }

    #[test]
    fn a_new_zed_thread_gives_tools_and_token_differences() {
        let dir = std::env::temp_dir().join(format!("zed-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("threads.db");
        let writer = Connection::open(&path).unwrap();
        writer
            .execute_batch(
                "CREATE TABLE threads (id TEXT PRIMARY KEY, summary TEXT NOT NULL, updated_at TEXT NOT NULL, data_type TEXT NOT NULL, data BLOB NOT NULL, parent_id TEXT, folder_paths TEXT, folder_paths_order TEXT, created_at TEXT);",
            )
            .unwrap();
        let mut monitor = ZedMonitor::new(path.clone());
        assert!(monitor.poll(false, true).is_empty());

        let first = serde_json::json!({"title": "t", "version": "0.3.0", "updated_at": "x",
            "messages": [{"User": {"id": "u", "content": [{"Text": "hi"}]}},
                         {"Agent": {"content": [{"ToolUse": {"id": "t1", "name": "edit_file", "raw_input": "{}", "input": {"type": "json", "value": {"path": "src/main.rs"}}, "is_input_complete": true}}], "tool_results": {}}}],
            "model": {"provider": "anthropic", "model": "claude-sonnet-4-5"},
            "cumulative_token_usage": {"input_tokens": 100, "output_tokens": 10, "cache_read_input_tokens": 500}});
        let later = Utc::now() + ChronoDuration::seconds(1);
        writer
            .execute(
                "INSERT INTO threads (id, summary, updated_at, data_type, data, folder_paths, created_at) VALUES ('th', 't', ?1, 'zstd', ?2, '/Users/me/app\n/Users/me/lib', ?1)",
                params![later.to_rfc3339(), zstd(&first)],
            )
            .unwrap();
        let events = monitor.poll(false, true);
        let kinds: Vec<_> = events.iter().map(|event| event.kind).collect();
        assert_eq!(
            kinds,
            vec![
                EventKind::SessionStarted,
                EventKind::UserMessage,
                EventKind::ToolStarted,
                EventKind::ModelUsage
            ]
        );
        assert!(
            events
                .iter()
                .all(|event| event.project_path.as_deref() == Some("/Users/me/app"))
        );
        assert_eq!(events[2].file_path.as_deref(), Some("src/main.rs"));
        assert_eq!(events[3].input_tokens.as_ref().map(|v| v.value), Some(100));

        let mut second = first.clone();
        second["messages"][1]["Agent"]["tool_results"] = serde_json::json!({"t1": {"tool_use_id": "t1", "tool_name": "edit_file", "is_error": true, "content": [], "output": null}});
        second["cumulative_token_usage"] = serde_json::json!({"input_tokens": 130, "output_tokens": 25, "cache_read_input_tokens": 900});
        writer
            .execute(
                "UPDATE threads SET updated_at = ?1, data = ?2 WHERE id = 'th'",
                params![
                    (later + ChronoDuration::seconds(1)).to_rfc3339(),
                    zstd(&second)
                ],
            )
            .unwrap();
        let events = monitor.poll(false, true);
        let kinds: Vec<_> = events.iter().map(|event| event.kind).collect();
        assert_eq!(kinds, vec![EventKind::ToolFailed, EventKind::ModelUsage]);
        assert_eq!(events[1].input_tokens.as_ref().map(|v| v.value), Some(30));
        assert_eq!(
            events[1].cache_read_tokens.as_ref().map(|v| v.value),
            Some(400)
        );
        assert_eq!(
            events[1].model.as_ref().map(|m| m.value.as_str()),
            Some("claude-sonnet-4-5")
        );
        std::fs::remove_dir_all(dir).ok();
    }
}
