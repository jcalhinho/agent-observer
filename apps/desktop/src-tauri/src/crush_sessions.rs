//! Crush (charmbracelet/crush) : lit en lecture seule la base de chaque projet
//! (`<projet>/.crush/crush.db`), dont la liste est tenue dans
//! `~/.local/share/crush/projects.json` (internal/projects/projects.go).
//!
//! Schéma vérifié dans internal/db (models.go et migrations/) :
//! - `messages` : `id`, `session_id`, `role` (user, assistant, tool), `parts`
//!   (liste de `{"type": "text"|"tool_call"|"tool_result"|…, "data": {…}}`),
//!   `model`, `created_at` et `updated_at` en secondes. Un message est mis à
//!   jour sur place pendant qu'il s'écrit.
//! - `sessions` : `prompt_tokens` et `completion_tokens` sont ceux de la
//!   dernière étape seulement, remplacés à chaque étape (internal/agent/
//!   agent.go, updateSessionTokenCounters). `prompt_tokens` compte tout le
//!   contexte, cache compris, sans le détailler : l'app ne peut pas séparer le
//!   cache, et une étape très brève entre deux lectures peut lui échapper.

use crate::tail::{self, Poll};
use chrono::{DateTime, Utc};
use rusqlite::{Connection, OpenFlags, params};
use serde_json::Value;
use session_events::{EventKind, Provider, SessionEvent};
use std::{
    collections::{HashMap, HashSet},
    env, fs,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

/// id, session, rôle, parties, modèle, création, mise à jour.
type MessageRow = (String, String, String, String, Option<String>, i64, i64);

const PROJECTS_REFRESH: Duration = Duration::from_secs(30);

/// `projects.json` : `$CRUSH_GLOBAL_DATA`, `$XDG_DATA_HOME/crush`, sinon
/// `~/.local/share/crush` (`%LOCALAPPDATA%\crush` sous Windows) —
/// internal/config/load.go, GlobalConfigData.
pub fn projects_file() -> PathBuf {
    let dir = if let Some(dir) = env::var_os("CRUSH_GLOBAL_DATA") {
        PathBuf::from(dir)
    } else if let Some(data) = env::var_os("XDG_DATA_HOME") {
        PathBuf::from(data).join("crush")
    } else if cfg!(windows) {
        env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| tail::home().join("AppData").join("Local"))
            .join("crush")
    } else {
        tail::home().join(".local").join("share").join("crush")
    };
    dir.join("projects.json")
}

struct Database {
    project: String,
    connection: Connection,
    /// Secondes : on relit toujours la dernière seconde, les doublons sont écartés.
    watermark: i64,
    users: HashSet<String>,
    started_tools: HashSet<String>,
    finished_tools: HashSet<String>,
    tokens: HashMap<String, (i64, i64)>,
    started: HashSet<String>,
    models: HashMap<String, String>,
    tools: HashMap<String, (String, Option<String>, Option<String>)>,
}

pub struct CrushMonitor {
    projects_file: PathBuf,
    databases: HashMap<PathBuf, Database>,
    refreshed: Option<Instant>,
    started_at: i64,
}

impl CrushMonitor {
    pub fn new(projects_file: PathBuf) -> Self {
        Self {
            projects_file,
            databases: HashMap::new(),
            refreshed: None,
            started_at: Utc::now().timestamp(),
        }
    }

    fn refresh(&mut self) {
        if self
            .refreshed
            .is_some_and(|at| at.elapsed() < PROJECTS_REFRESH)
        {
            return;
        }
        self.refreshed = Some(Instant::now());
        let Ok(text) = fs::read_to_string(&self.projects_file) else {
            return;
        };
        let Ok(list) = serde_json::from_str::<Value>(&text) else {
            return;
        };
        for project in list
            .get("projects")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let (Some(path), Some(data_dir)) = (
                project.get("path").and_then(Value::as_str),
                project.get("data_dir").and_then(Value::as_str),
            ) else {
                continue;
            };
            let db = Path::new(data_dir).join("crush.db");
            if self.databases.contains_key(&db) || !db.is_file() {
                continue;
            }
            if let Ok(connection) = Connection::open_with_flags(
                &db,
                OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
            ) {
                let mut database = Database {
                    project: path.to_owned(),
                    connection,
                    watermark: self.started_at,
                    users: HashSet::new(),
                    started_tools: HashSet::new(),
                    finished_tools: HashSet::new(),
                    tokens: HashMap::new(),
                    started: HashSet::new(),
                    models: HashMap::new(),
                    tools: HashMap::new(),
                };
                // Les jetons déjà là servent de point de départ : rien n'est rattrapé.
                if let Ok(mut statement) = database
                    .connection
                    .prepare("SELECT id, prompt_tokens, completion_tokens FROM sessions")
                {
                    let rows: Vec<(String, i64, i64)> = statement
                        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
                        .map(|rows| rows.flatten().collect())
                        .unwrap_or_default();
                    drop(statement);
                    database.tokens.extend(
                        rows.into_iter()
                            .map(|(id, prompt, completion)| (id, (prompt, completion))),
                    );
                }
                self.databases.insert(db, database);
            }
        }
    }
}

impl Poll for CrushMonitor {
    fn poll(&mut self, prompts: bool, commands: bool) -> Vec<SessionEvent> {
        self.refresh();
        let started_at = self.started_at;
        self.databases
            .values_mut()
            .flat_map(|database| read(database, started_at, prompts, commands))
            .collect()
    }
}

fn read(
    database: &mut Database,
    started_at: i64,
    prompts: bool,
    commands: bool,
) -> Vec<SessionEvent> {
    let since = database.watermark - 1;
    let mut events = Vec::new();
    let event = |database: &Database, session: &str, kind, at: DateTime<Utc>| {
        let mut event = SessionEvent::new(session, Provider::Crush, kind);
        event.occurred_at = at;
        event.project_path = Some(database.project.clone());
        event.model = database.models.get(session).cloned().map(tail::provider);
        event
    };
    let messages: Vec<MessageRow> = database
        .connection
        .prepare(
            "SELECT id, session_id, role, parts, model, created_at, updated_at FROM messages \
             WHERE updated_at >= ?1 ORDER BY created_at, updated_at LIMIT 500",
        )
        .and_then(|mut statement| {
            statement
                .query_map(params![since], |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                    ))
                })?
                .collect()
        })
        .unwrap_or_default();
    for (id, session, role, parts, model, created, updated) in messages {
        database.watermark = database.watermark.max(updated);
        if let Some(model) = model.filter(|model| !model.is_empty()) {
            database.models.insert(session.clone(), model);
        }
        let at = tail::parse_time(Some(&Value::from(created))).unwrap_or_else(Utc::now);
        if created >= started_at && database.started.insert(session.clone()) {
            events.push(event(database, &session, EventKind::SessionStarted, at));
        }
        let parts: Vec<Value> = serde_json::from_str(&parts).unwrap_or_default();
        let of = |kind: &'static str| parts_of(&parts, kind);
        match role.as_str() {
            "user" if created >= started_at && database.users.insert(id.clone()) => {
                let mut user = event(database, &session, EventKind::UserMessage, at);
                if prompts {
                    let text: Vec<&str> = of("text")
                        .filter_map(|data| data.get("text").and_then(Value::as_str))
                        .collect();
                    user.content = (!text.is_empty()).then(|| text.join("\n"));
                }
                events.push(user);
            }
            "assistant" => {
                for call in of("tool_call") {
                    let Some(call_id) = call.get("id").and_then(Value::as_str) else {
                        continue;
                    };
                    // L'appel est complet quand ses arguments ont fini d'arriver.
                    if call.get("finished").and_then(Value::as_bool) != Some(true)
                        || !database.started_tools.insert(call_id.to_owned())
                    {
                        continue;
                    }
                    let name = call
                        .get("name")
                        .and_then(Value::as_str)
                        .unwrap_or("tool")
                        .to_owned();
                    let args = call
                        .get("input")
                        .and_then(Value::as_str)
                        .and_then(|input| serde_json::from_str::<Value>(input).ok());
                    let file_path = tail::tool_path(args.as_ref());
                    let command = tail::tool_command(args.as_ref(), commands);
                    database.tools.insert(
                        call_id.to_owned(),
                        (name.clone(), file_path.clone(), command.clone()),
                    );
                    let mut started = event(database, &session, EventKind::ToolStarted, Utc::now());
                    started.tool_name = Some(name);
                    started.file_path = file_path;
                    started.command = command;
                    events.push(started);
                }
            }
            "tool" => {
                for result in of("tool_result") {
                    let Some(call_id) = result.get("tool_call_id").and_then(Value::as_str) else {
                        continue;
                    };
                    if !database.finished_tools.insert(call_id.to_owned()) {
                        continue;
                    }
                    let Some((name, file_path, command)) = database.tools.remove(call_id) else {
                        // Appel commencé avant le lancement de l'app : rien à clore.
                        continue;
                    };
                    let failed = result.get("is_error").and_then(Value::as_bool) == Some(true);
                    let mut finished = event(
                        database,
                        &session,
                        if failed {
                            EventKind::ToolFailed
                        } else {
                            EventKind::ToolFinished
                        },
                        tail::parse_time(Some(&Value::from(updated))).unwrap_or_else(Utc::now),
                    );
                    finished.tool_name = Some(name);
                    finished.file_path = file_path;
                    finished.command = command;
                    if failed {
                        finished.outcome = Some(crate::redact::failure_outcome(None));
                    }
                    events.push(finished);
                }
            }
            _ => {}
        }
    }

    let sessions: Vec<(String, i64, i64, i64, i64)> = database
        .connection
        .prepare(
            "SELECT id, prompt_tokens, completion_tokens, created_at, updated_at FROM sessions WHERE updated_at >= ?1",
        )
        .and_then(|mut statement| {
            statement
                .query_map(params![since], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)))?
                .collect()
        })
        .unwrap_or_default();
    for (session, prompt, completion, created, updated) in sessions {
        database.watermark = database.watermark.max(updated);
        let previous = database
            .tokens
            .insert(session.clone(), (prompt, completion));
        let baseline = previous.or((created < started_at).then_some((prompt, completion)));
        if baseline == Some((prompt, completion)) || (prompt == 0 && completion == 0) {
            continue;
        }
        let mut usage = event(
            database,
            &session,
            EventKind::ModelUsage,
            tail::parse_time(Some(&Value::from(updated))).unwrap_or_else(Utc::now),
        );
        usage.input_tokens = (prompt > 0).then(|| tail::provider(prompt as u64));
        usage.output_tokens = (completion > 0).then(|| tail::provider(completion as u64));
        events.push(usage);
    }
    events
}

fn parts_of<'a>(parts: &'a [Value], kind: &'static str) -> impl Iterator<Item = &'a Value> + 'a {
    parts
        .iter()
        .filter(move |part| part.get("type").and_then(Value::as_str) == Some(kind))
        .filter_map(|part| part.get("data"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_crush_project_gives_new_messages_tools_and_step_tokens() {
        let dir = std::env::temp_dir().join(format!("crush-{}", uuid::Uuid::new_v4()));
        let data = dir.join("app").join(".crush");
        fs::create_dir_all(&data).unwrap();
        let list = dir.join("projects.json");
        fs::write(
            &list,
            serde_json::json!({"projects": [{"path": "/Users/me/app", "data_dir": data, "last_accessed": "2026-11-12T10:00:00Z"}]}).to_string(),
        )
        .unwrap();
        let writer = Connection::open(data.join("crush.db")).unwrap();
        writer
            .execute_batch(
                "CREATE TABLE sessions (id TEXT PRIMARY KEY, parent_session_id TEXT, title TEXT NOT NULL, message_count INTEGER NOT NULL DEFAULT 0, prompt_tokens INTEGER NOT NULL DEFAULT 0, completion_tokens INTEGER NOT NULL DEFAULT 0, cost REAL NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
                 CREATE TABLE messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL, parts TEXT NOT NULL default '[]', model TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, finished_at INTEGER);",
            )
            .unwrap();
        let mut monitor = CrushMonitor::new(list);
        assert!(monitor.poll(true, true).is_empty());

        let now = Utc::now().timestamp();
        let call = serde_json::json!([{"type": "tool_call", "data": {"id": "c1", "name": "edit", "input": "{\"file_path\":\"/Users/me/app/main.go\"}", "finished": true}}]).to_string();
        let result = serde_json::json!([{"type": "tool_result", "data": {"tool_call_id": "c1", "name": "edit", "content": "ok", "is_error": false}}]).to_string();
        writer
            .execute(
                "INSERT INTO sessions VALUES ('s1', NULL, 't', 3, 12000, 300, 0, ?1, ?1)",
                params![now],
            )
            .unwrap();
        writer.execute("INSERT INTO messages VALUES ('m1', 's1', 'user', '[{\"type\":\"text\",\"data\":{\"text\":\"rename it\"}}]', NULL, ?1, ?1, NULL)", params![now]).unwrap();
        writer
            .execute(
                "INSERT INTO messages VALUES ('m2', 's1', 'assistant', ?1, 'gpt-5', ?2, ?2, NULL)",
                params![call, now],
            )
            .unwrap();
        writer
            .execute(
                "INSERT INTO messages VALUES ('m3', 's1', 'tool', ?1, NULL, ?2, ?2, NULL)",
                params![result, now],
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
        assert!(
            events
                .iter()
                .all(|event| event.project_path.as_deref() == Some("/Users/me/app"))
        );
        assert_eq!(
            events[2].file_path.as_deref(),
            Some("/Users/me/app/main.go")
        );
        assert_eq!(
            events[4].input_tokens.as_ref().map(|v| v.value),
            Some(12000)
        );
        assert_eq!(
            events[4].model.as_ref().map(|m| m.value.as_str()),
            Some("gpt-5")
        );
        // Relire la même seconde ne double rien.
        assert!(monitor.poll(true, true).is_empty());
        fs::remove_dir_all(dir).ok();
    }
}
