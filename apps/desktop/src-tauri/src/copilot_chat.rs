//! Lit la base SQLite du chat Copilot dans VS Code, en lecture seule.
//!
//! Emplacement : `<support VS Code>/User/globalStorage/github.copilot-chat/
//! session-store.db`. Son schema est fait pour nous : la table `sessions`
//! porte le dossier, le depot, la branche et surtout `host_type`, qui dit
//! COMMENT l'agent a ete lance. La table `turns` horodate chaque echange, et
//! `session_files` donne le fichier touche avec l'outil qui l'a touche.
//!
//! Le texte des messages suit la politique de capture commune : la question
//! de l'utilisateur n'est gardee que s'il l'a demande, et la reponse de
//! l'assistant ne l'est jamais.
//!
//! Lecture seule et sans verrou : VS Code ecrit pendant qu'on lit, donc la
//! connexion est ouverte en `READ_ONLY` avec un delai d'attente court, et un
//! echec de lecture est simplement reessaye au tour suivant.

use chrono::{DateTime, Utc};
use rusqlite::{Connection, OpenFlags, params};
use session_events::{DataOrigin, EventKind, Provider, SessionEvent, Sourced};
use std::{
    collections::HashSet,
    env,
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::Duration,
};

const POLL_INTERVAL: Duration = Duration::from_millis(1500);
const BUSY_TIMEOUT: Duration = Duration::from_millis(250);
/// Au premier passage on ne remonte pas tout l'historique : seuls les tours
/// recents interessent un observateur du present.
const FIRST_PASS_LIMIT: usize = 50;

/// Les variantes de VS Code qui partagent ce format.
const FLAVOURS: [&str; 3] = ["Code", "Code - Insiders", "VSCodium"];

/// Chemins possibles de la base, selon le systeme et la variante installee.
pub fn database_paths() -> Vec<PathBuf> {
    let Some(home) = home() else {
        return Vec::new();
    };
    let bases: Vec<PathBuf> = if cfg!(target_os = "macos") {
        vec![home.join("Library").join("Application Support")]
    } else if cfg!(target_os = "windows") {
        env::var_os("APPDATA")
            .map(|appdata| vec![PathBuf::from(appdata)])
            .unwrap_or_default()
    } else {
        vec![
            env::var_os("XDG_CONFIG_HOME")
                .map(PathBuf::from)
                .unwrap_or_else(|| home.join(".config")),
        ]
    };
    bases
        .iter()
        .flat_map(|base| {
            FLAVOURS.iter().map(move |flavour| {
                base.join(flavour)
                    .join("User")
                    .join("globalStorage")
                    .join("github.copilot-chat")
                    .join("session-store.db")
            })
        })
        .filter(|path| path.exists())
        .collect()
}

fn home() -> Option<PathBuf> {
    env::var_os("HOME")
        .or_else(|| env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
}

/// Ce qu'on sait d'une session, lu une fois puis garde.
#[derive(Clone, Default)]
struct SessionInfo {
    cwd: Option<String>,
    host_type: Option<String>,
    agent_name: Option<String>,
}

#[derive(Default)]
struct CopilotChatMonitor {
    /// Tours deja emis, par base : (session, index du tour).
    seen_turns: HashSet<(PathBuf, String, i64)>,
    /// Fichiers deja emis : (session, chemin).
    seen_files: HashSet<(PathBuf, String, String)>,
    /// Vrai une fois le premier passage fait : il sert a se caler, pas a
    /// rejouer l'historique.
    primed: HashSet<PathBuf>,
}

impl CopilotChatMonitor {
    fn poll(&mut self, capture_prompts: bool) -> Vec<SessionEvent> {
        let mut events = Vec::new();
        for path in database_paths() {
            let Ok(connection) = Connection::open_with_flags(
                &path,
                OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
            ) else {
                continue;
            };
            let _ = connection.busy_timeout(BUSY_TIMEOUT);
            if !has_table(&connection, "sessions") || !has_table(&connection, "turns") {
                continue;
            }
            let first_pass = self.primed.insert(path.clone());
            events.extend(self.read_turns(&connection, &path, capture_prompts, first_pass));
            if has_table(&connection, "session_files") {
                events.extend(self.read_files(&connection, &path, first_pass));
            }
        }
        events.sort_by_key(|event| event.occurred_at);
        events
    }

    fn session_info(&self, connection: &Connection, session_id: &str) -> SessionInfo {
        connection
            .query_row(
                "SELECT cwd, host_type, agent_name FROM sessions WHERE id = ?1",
                params![session_id],
                |row| {
                    Ok(SessionInfo {
                        cwd: row.get::<_, Option<String>>(0)?,
                        host_type: row.get::<_, Option<String>>(1)?,
                        agent_name: row.get::<_, Option<String>>(2)?,
                    })
                },
            )
            .unwrap_or_default()
    }

    fn read_turns(
        &mut self,
        connection: &Connection,
        path: &Path,
        capture_prompts: bool,
        first_pass: bool,
    ) -> Vec<SessionEvent> {
        let Ok(mut statement) = connection.prepare(
            "SELECT session_id, turn_index, user_message, assistant_response, timestamp \
             FROM turns ORDER BY timestamp DESC, turn_index DESC LIMIT ?1",
        ) else {
            return Vec::new();
        };
        let limit = if first_pass { FIRST_PASS_LIMIT } else { 200 } as i64;
        let Ok(rows) = statement.query_map(params![limit], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
            ))
        }) else {
            return Vec::new();
        };

        let mut events = Vec::new();
        for row in rows.flatten() {
            let (session_id, turn_index, user_message, assistant_response, timestamp) = row;
            if !self
                .seen_turns
                .insert((path.to_path_buf(), session_id.clone(), turn_index))
            {
                continue;
            }
            if first_pass {
                // Le premier passage ne fait que memoriser ce qui existait deja.
                continue;
            }
            let at = parse_time(timestamp.as_deref());
            let info = self.session_info(connection, &session_id);

            if user_message.is_some() {
                let mut event = self.base_event(&session_id, EventKind::UserMessage, &info, at);
                if capture_prompts {
                    event.content = user_message;
                }
                events.push(event);
            }
            if assistant_response.is_some() {
                // La reponse elle-meme n'est jamais conservee : seul le fait
                // qu'un tour s'est termine compte pour l'observateur.
                let mut event = self.base_event(&session_id, EventKind::Checkpoint, &info, at);
                event.outcome = Some("turn-finished".to_owned());
                events.push(event);
            }
        }
        events
    }

    fn read_files(
        &mut self,
        connection: &Connection,
        path: &Path,
        first_pass: bool,
    ) -> Vec<SessionEvent> {
        let Ok(mut statement) = connection.prepare(
            "SELECT session_id, file_path, tool_name, first_seen_at \
             FROM session_files ORDER BY first_seen_at DESC LIMIT 200",
        ) else {
            return Vec::new();
        };
        let Ok(rows) = statement.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        }) else {
            return Vec::new();
        };

        let mut events = Vec::new();
        for row in rows.flatten() {
            let (session_id, file_path, tool_name, first_seen_at) = row;
            if !self
                .seen_files
                .insert((path.to_path_buf(), session_id.clone(), file_path.clone()))
            {
                continue;
            }
            if first_pass {
                continue;
            }
            let info = self.session_info(connection, &session_id);
            let mut event = self.base_event(
                &session_id,
                EventKind::ToolFinished,
                &info,
                parse_time(first_seen_at.as_deref()),
            );
            event.tool_name = tool_name;
            event.file_path = Some(file_path);
            events.push(event);
        }
        events
    }

    fn base_event(
        &self,
        session_id: &str,
        kind: EventKind,
        info: &SessionInfo,
        at: DateTime<Utc>,
    ) -> SessionEvent {
        let mut event = SessionEvent::new(session_id, Provider::GitHubCopilot, kind);
        event.occurred_at = at;
        event.project_path = info.cwd.clone();
        // `host_type` est la valeur de Copilot, gardee telle quelle.
        event.launch_mode = info.host_type.clone().or_else(|| Some("vscode".to_owned()));
        if let Some(agent) = &info.agent_name {
            event.model = Some(Sourced {
                value: agent.clone(),
                origin: DataOrigin::Provider,
            });
        }
        event
    }
}

/// L'horodatage de Copilot est en ISO 8601 ; sans lui, l'instant de lecture.
fn parse_time(value: Option<&str>) -> DateTime<Utc> {
    value
        .and_then(|text| DateTime::parse_from_rfc3339(text).ok())
        .map(|at| at.with_timezone(&Utc))
        .unwrap_or_else(Utc::now)
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

pub fn spawn<F>(capture_prompts: Arc<AtomicBool>, mut on_event: F)
where
    F: FnMut(SessionEvent) + Send + 'static,
{
    thread::spawn(move || {
        let mut monitor = CopilotChatMonitor::default();
        loop {
            for event in monitor.poll(capture_prompts.load(Ordering::Relaxed)) {
                on_event(event);
            }
            thread::sleep(POLL_INTERVAL);
        }
    });
}

#[cfg(test)]
impl CopilotChatMonitor {
    /// Comme `poll`, mais sur une base precise : `database_paths()` depend du
    /// systeme, et un test ne doit pas lire le VS Code de la machine.
    fn poll_path(&mut self, path: &Path, capture_prompts: bool) -> Vec<SessionEvent> {
        let Ok(connection) = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        ) else {
            return Vec::new();
        };
        let _ = connection.busy_timeout(BUSY_TIMEOUT);
        if !has_table(&connection, "sessions") || !has_table(&connection, "turns") {
            return Vec::new();
        }
        let first_pass = self.primed.insert(path.to_path_buf());
        let mut events = self.read_turns(&connection, path, capture_prompts, first_pass);
        if has_table(&connection, "session_files") {
            events.extend(self.read_files(&connection, path, first_pass));
        }
        events.sort_by_key(|event| event.occurred_at);
        events
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use uuid::Uuid;

    /// Une base au schema de Copilot, remplie a la main. Les autres lecteurs
    /// du projet creent ainsi leurs fichiers de test : pas de dependance de
    /// developpement, juste le dossier temporaire du systeme.
    fn database() -> PathBuf {
        let path =
            env::temp_dir().join(format!("agent-observer-copilot-chat-{}.db", Uuid::new_v4()));
        let connection = Connection::open(&path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE sessions (id TEXT PRIMARY KEY, cwd TEXT, repository TEXT, \
                 host_type TEXT, branch TEXT, summary TEXT, agent_name TEXT, \
                 agent_description TEXT, created_at TEXT, updated_at TEXT);
                 CREATE TABLE turns (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, \
                 turn_index INTEGER, user_message TEXT, assistant_response TEXT, timestamp TEXT);
                 CREATE TABLE session_files (id INTEGER PRIMARY KEY AUTOINCREMENT, \
                 session_id TEXT, file_path TEXT, tool_name TEXT, turn_index INTEGER, \
                 first_seen_at TEXT);",
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO sessions(id, cwd, host_type, agent_name) VALUES ('s1', '/w/api', 'vscode', 'gpt-5')",
                [],
            )
            .unwrap();
        path
    }

    fn add_turn(path: &Path, index: i64, at: &str) {
        let connection = Connection::open(path).unwrap();
        connection
            .execute(
                "INSERT INTO turns(session_id, turn_index, user_message, assistant_response, timestamp) \
                 VALUES ('s1', ?1, 'ma question', 'sa reponse', ?2)",
                params![index, at],
            )
            .unwrap();
    }

    #[test]
    fn the_first_pass_records_without_replaying_history() {
        let path = database();
        add_turn(&path, 1, "2026-11-06T10:00:00.000Z");
        let mut monitor = CopilotChatMonitor::default();
        // Rien n'est emis : on se cale sur l'existant.
        assert!(monitor.poll_path(&path, false).is_empty());
        // Et ce tour-la ne ressortira pas au tour suivant.
        assert!(monitor.poll_path(&path, false).is_empty());
    }

    #[test]
    fn a_new_turn_yields_a_question_and_a_turn_end() {
        let path = database();
        add_turn(&path, 1, "2026-11-06T10:00:00.000Z");
        let mut monitor = CopilotChatMonitor::default();
        monitor.poll_path(&path, false);

        add_turn(&path, 2, "2026-11-06T10:05:00.000Z");
        let events = monitor.poll_path(&path, false);
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].kind, EventKind::UserMessage);
        assert_eq!(events[1].kind, EventKind::Checkpoint);
        assert_eq!(events[1].outcome.as_deref(), Some("turn-finished"));
    }

    #[test]
    fn the_launch_mode_and_the_folder_come_from_the_session() {
        let path = database();
        add_turn(&path, 1, "2026-11-06T10:00:00.000Z");
        let mut monitor = CopilotChatMonitor::default();
        monitor.poll_path(&path, false);
        add_turn(&path, 2, "2026-11-06T10:05:00.000Z");
        let events = monitor.poll_path(&path, false);
        assert_eq!(events[0].launch_mode.as_deref(), Some("vscode"));
        assert_eq!(events[0].project_path.as_deref(), Some("/w/api"));
        assert_eq!(
            events[0].model.as_ref().map(|model| model.value.as_str()),
            Some("gpt-5")
        );
    }

    #[test]
    fn the_question_is_kept_only_when_asked_and_the_answer_never() {
        let path = database();
        add_turn(&path, 1, "2026-11-06T10:00:00.000Z");
        let mut monitor = CopilotChatMonitor::default();
        monitor.poll_path(&path, false);
        add_turn(&path, 2, "2026-11-06T10:05:00.000Z");

        let without = monitor.poll_path(&path, false);
        assert_eq!(without[0].content, None);

        let mut other = CopilotChatMonitor::default();
        other.poll_path(&path, true);
        add_turn(&path, 3, "2026-11-06T10:06:00.000Z");
        let with = other.poll_path(&path, true);
        assert_eq!(with[0].content.as_deref(), Some("ma question"));
        // La reponse de l'assistant n'est jamais conservee.
        assert!(
            with.iter()
                .all(|event| event.content.as_deref() != Some("sa reponse"))
        );
    }

    #[test]
    fn timestamps_are_read_not_invented() {
        let at = parse_time(Some("2026-11-06T10:00:00.000Z"));
        assert_eq!(at.to_rfc3339(), "2026-11-06T10:00:00+00:00");
        // Sans horodatage lisible, on prend l'instant de lecture plutot que
        // d'inventer une date.
        let fallback = parse_time(Some("pas une date"));
        assert!((Utc::now() - fallback).num_seconds().abs() < 5);
    }

    #[test]
    fn a_file_touched_becomes_a_tool_event() {
        let path = database();
        let mut monitor = CopilotChatMonitor::default();
        monitor.poll_path(&path, false);
        Connection::open(&path)
            .unwrap()
            .execute(
                "INSERT INTO session_files(session_id, file_path, tool_name, first_seen_at) \
                 VALUES ('s1', '/w/api/src/main.rs', 'edit_file', '2026-11-06T10:07:00.000Z')",
                [],
            )
            .unwrap();
        let events = monitor.poll_path(&path, false);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].kind, EventKind::ToolFinished);
        assert_eq!(events[0].tool_name.as_deref(), Some("edit_file"));
        assert_eq!(events[0].file_path.as_deref(), Some("/w/api/src/main.rs"));
    }

    #[test]
    fn a_missing_database_is_not_an_error() {
        let mut monitor = CopilotChatMonitor::default();
        assert!(
            monitor
                .poll_path(&PathBuf::from("/nulle/part.db"), false)
                .is_empty()
        );
    }
}
