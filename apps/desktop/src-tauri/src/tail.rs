//! Outils communs aux lecteurs de journaux ajoutés en 0.18 : lecture des
//! lignes JSON ajoutées à un fichier, et valeurs marquées selon leur origine.
//! Comme les autres lecteurs, l'historique d'avant le lancement de l'app n'est
//! jamais relu : un fichier qui existait déjà est lu à partir de sa fin.

use chrono::{DateTime, TimeZone, Utc};
use serde_json::Value;
use session_events::{DataOrigin, SessionEvent, Sourced};
use std::{
    collections::HashMap,
    env, fs,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration, SystemTime},
};

const MAX_LINE_BYTES: usize = 16 * 1024 * 1024;
const MAX_READ_BYTES: u64 = 8 * 1024 * 1024;
/// Les fichiers qui n'ont pas bougé depuis ce délai ne sont plus regardés.
pub const ACTIVE_WINDOW: Duration = Duration::from_secs(48 * 3600);

/// Ce qu'une lecture a trouvé : les lignes nouvelles, et si le fichier est vu
/// pour la première fois (ou a été réécrit), auquel cas le lecteur repart d'un
/// contexte vierge.
pub struct Appended {
    pub fresh: bool,
    pub lines: Vec<Vec<u8>>,
}

struct Cursor {
    offset: u64,
    pending: Vec<u8>,
}

pub struct Tail {
    cursors: HashMap<PathBuf, Cursor>,
    started_at: SystemTime,
}

impl Default for Tail {
    fn default() -> Self {
        Self::new()
    }
}

impl Tail {
    pub fn new() -> Self {
        Self::since(SystemTime::now())
    }

    /// Pour les tests : fait comme si l'app avait démarré à `started_at`.
    pub fn since(started_at: SystemTime) -> Self {
        Self {
            cursors: HashMap::new(),
            started_at,
        }
    }

    /// Lit ce qui a été ajouté à `path` depuis l'appel précédent.
    pub fn read(&mut self, path: &Path) -> Appended {
        let mut fresh = false;
        let Ok(mut file) = fs::File::open(path) else {
            return Appended {
                fresh,
                lines: Vec::new(),
            };
        };
        let length = file.metadata().map(|meta| meta.len()).unwrap_or(0);
        if !self.cursors.contains_key(path) {
            let created_before_start = fs::metadata(path)
                .and_then(|meta| meta.created().or_else(|_| meta.modified()))
                .map(|created| created < self.started_at)
                .unwrap_or(true);
            let offset = if created_before_start { length } else { 0 };
            self.cursors.insert(
                path.to_path_buf(),
                Cursor {
                    offset,
                    pending: Vec::new(),
                },
            );
            fresh = true;
        }
        let cursor = self.cursors.get_mut(path).expect("cursor inserted above");
        if length < cursor.offset {
            cursor.offset = 0;
            cursor.pending.clear();
            fresh = true;
        }
        let mut lines = Vec::new();
        if length == cursor.offset || file.seek(SeekFrom::Start(cursor.offset)).is_err() {
            return Appended { fresh, lines };
        }
        let mut appended = Vec::new();
        if file
            .take(MAX_READ_BYTES)
            .read_to_end(&mut appended)
            .is_err()
        {
            return Appended { fresh, lines };
        }
        cursor.offset += appended.len() as u64;
        cursor.pending.extend(appended);
        while let Some(newline) = cursor.pending.iter().position(|byte| *byte == b'\n') {
            if newline <= MAX_LINE_BYTES {
                lines.push(cursor.pending[..newline].to_vec());
            }
            cursor.pending.drain(..=newline);
        }
        if cursor.pending.len() > MAX_LINE_BYTES {
            cursor.pending.clear();
        }
        Appended { fresh, lines }
    }

    /// Place le curseur d'un fichier à `offset` (Aider : début de la session en cours).
    pub fn start_at(&mut self, path: &Path, offset: u64) {
        self.cursors.insert(
            path.to_path_buf(),
            Cursor {
                offset,
                pending: Vec::new(),
            },
        );
    }
}

/// Un lecteur d'agent : chaque appel rend les événements nouveaux.
pub trait Poll: Send + 'static {
    fn poll(&mut self, prompts: bool, commands: bool) -> Vec<SessionEvent>;
}

impl Poll for Box<dyn Poll> {
    fn poll(&mut self, prompts: bool, commands: bool) -> Vec<SessionEvent> {
        (**self).poll(prompts, commands)
    }
}

/// Fait tourner un lecteur dans son propre fil, toutes les `every`.
pub fn spawn<P, F>(
    mut monitor: P,
    every: Duration,
    capture_prompts: Arc<AtomicBool>,
    capture_commands: Arc<AtomicBool>,
    mut on_event: F,
) where
    P: Poll,
    F: FnMut(SessionEvent) + Send + 'static,
{
    thread::spawn(move || {
        loop {
            for event in monitor.poll(
                capture_prompts.load(Ordering::Relaxed),
                capture_commands.load(Ordering::Relaxed),
            ) {
                on_event(event);
            }
            thread::sleep(every);
        }
    });
}

/// Les lignes JSON valides parmi celles lues.
pub fn json_lines(lines: &[Vec<u8>]) -> impl Iterator<Item = Value> + '_ {
    lines
        .iter()
        .filter_map(|line| serde_json::from_slice::<Value>(line).ok())
}

/// Le dossier personnel (`USERPROFILE` sous Windows, `HOME` ailleurs).
pub fn home() -> PathBuf {
    env::var_os("USERPROFILE")
        .or_else(|| env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

/// Un fichier modifié récemment, avec sa taille.
pub fn recent(path: &Path) -> bool {
    fs::metadata(path)
        .and_then(|meta| meta.modified())
        .map(|modified| {
            SystemTime::now()
                .duration_since(modified)
                .map(|age| age <= ACTIVE_WINDOW)
                .unwrap_or(true)
        })
        .unwrap_or(false)
}

/// Les sous-dossiers d'un dossier (vide s'il n'existe pas).
pub fn subdirs(dir: &Path) -> Vec<PathBuf> {
    fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .map(|entry| entry.path())
                .filter(|path| path.is_dir())
                .collect()
        })
        .unwrap_or_default()
}

/// Les fichiers récents d'un dossier dont le nom vérifie `keep`.
pub fn recent_files(dir: &Path, keep: impl Fn(&str) -> bool) -> Vec<PathBuf> {
    fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .map(|entry| entry.path())
                .filter(|path| {
                    path.file_name()
                        .and_then(|name| name.to_str())
                        .is_some_and(&keep)
                        && path.is_file()
                        && recent(path)
                })
                .collect()
        })
        .unwrap_or_default()
}

pub fn provider<T>(value: T) -> Sourced<T> {
    Sourced {
        value,
        origin: DataOrigin::Provider,
    }
}

pub fn derived<T>(value: T) -> Sourced<T> {
    Sourced {
        value,
        origin: DataOrigin::Derived,
    }
}

pub fn estimated<T>(value: T) -> Sourced<T> {
    Sourced {
        value,
        origin: DataOrigin::Estimated,
    }
}

/// Le premier champ texte trouvé parmi `keys` dans un objet JSON.
pub fn text_field(value: Option<&Value>, keys: &[&str]) -> Option<String> {
    let object = value?.as_object()?;
    keys.iter()
        .find_map(|key| object.get(*key).and_then(Value::as_str))
        .filter(|text| !text.is_empty())
        .map(str::to_owned)
}

/// Le chemin de fichier d'un appel d'outil, sous les noms qu'utilisent les agents.
pub fn tool_path(args: Option<&Value>) -> Option<String> {
    text_field(
        args,
        &["file_path", "absolute_path", "path", "filePath", "dir_path"],
    )
}

/// La commande d'un appel d'outil, seulement si l'utilisateur a choisi de les garder.
pub fn tool_command(args: Option<&Value>, capture: bool) -> Option<String> {
    capture
        .then(|| text_field(args, &["command", "cmd"]))
        .flatten()
}

pub fn parse_time(value: Option<&Value>) -> Option<DateTime<Utc>> {
    let value = value?;
    if let Some(text) = value.as_str() {
        return DateTime::parse_from_rfc3339(text)
            .ok()
            .map(|time| time.with_timezone(&Utc));
    }
    value.as_i64().and_then(|number| {
        // Secondes ou millisecondes, selon l'agent.
        if number > 100_000_000_000 {
            Utc.timestamp_millis_opt(number).single()
        } else {
            Utc.timestamp_opt(number, 0).single()
        }
    })
}

/// Le texte d'un contenu de message : une chaîne, ou une liste de parties `{text}`.
pub fn content_text(content: Option<&Value>) -> Option<String> {
    match content? {
        Value::String(text) => Some(text.clone()),
        Value::Array(parts) => parts
            .iter()
            .filter(|part| part.get("thought").is_none())
            .filter_map(|part| part.get("text").and_then(Value::as_str))
            .map(str::to_owned)
            .reduce(|mut all, part| {
                all.push('\n');
                all.push_str(&part);
                all
            }),
        Value::Object(part) => part.get("text").and_then(Value::as_str).map(str::to_owned),
        _ => None,
    }
    .filter(|text| !text.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_new_file_is_read_from_its_start_and_an_old_one_from_its_end() {
        let dir = std::env::temp_dir().join(format!("tail-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let old = dir.join("old.jsonl");
        fs::write(&old, "{\"a\":1}\n").unwrap();
        let mut tail = Tail::new();
        let first = tail.read(&old);
        assert!(first.fresh);
        assert!(first.lines.is_empty());
        fs::write(&old, "{\"a\":1}\n{\"a\":2}\n").unwrap();
        let next = tail.read(&old);
        assert!(!next.fresh);
        assert_eq!(
            json_lines(&next.lines).collect::<Vec<_>>(),
            vec![serde_json::json!({"a": 2})]
        );

        let mut tail = Tail::since(SystemTime::now() - Duration::from_secs(60));
        let new = dir.join("new.jsonl");
        fs::write(&new, "{\"b\":1}\n{\"b\":").unwrap();
        let read = tail.read(&new);
        assert_eq!(read.lines.len(), 1);
        fs::write(&new, "{\"b\":1}\n{\"b\":2}\n").unwrap();
        assert_eq!(json_lines(&tail.read(&new).lines).count(), 1);
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn times_in_seconds_milliseconds_or_text_are_read() {
        let at = Utc.timestamp_opt(1_762_000_000, 0).unwrap();
        assert_eq!(
            parse_time(Some(&serde_json::json!(1_762_000_000))),
            Some(at)
        );
        assert_eq!(
            parse_time(Some(&serde_json::json!(1_762_000_000_000_i64))),
            Some(at)
        );
        assert_eq!(
            parse_time(Some(&serde_json::json!(at.to_rfc3339()))),
            Some(at)
        );
    }
}
