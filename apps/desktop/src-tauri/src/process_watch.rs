//! Agents qui n'écrivent rien de lisible sur le disque : l'app regarde
//! seulement s'ils tournent, et dans quel dossier. Chaque programme vu ouvre
//! une session (début = heure de lancement du processus), qui se ferme quand
//! il s'arrête. Ni jetons ni outils : ces agents ne les exposent pas.
//!
//! Noms d'exécutables vérifiés dans ranxianglei/billion-context
//! (src/launcher.ts, resolveClientCommand) : `amp`, `kiro-cli`, `traecli` ou
//! `trae-cli`, `qoder` ou `qodercli`, `codebuddy`, `mcode`, `jcode`, `dsh`,
//! `iflow`. `cbc` (autre nom de CodeBuddy) et `trae` ne sont pas retenus : le
//! premier est aussi celui d'un solveur courant, le second celui de l'éditeur
//! Trae, qui n'est pas son agent en ligne de commande.
//!
//! Aider passe aussi par ici : on le reconnaît à son processus, puis on lit
//! l'historique qu'il écrit à la racine du dépôt (`.aider.chat.history.md`,
//! aider/io.py et aider/args.py). Ses jetons y sont arrondis (« 2.3k ») : ils
//! sont marqués estimés.

use crate::procs::{self, ProcInfo};
use crate::tail::{self, Poll, Tail};
use chrono::{TimeZone, Utc};
use session_events::{EventKind, Provider, SessionEvent};
use std::{
    collections::HashMap,
    fs,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
};

const HISTORY: &str = ".aider.chat.history.md";
const STARTED: &str = "# aider chat started at";

/// L'agent qu'un exécutable désigne.
fn agent_named(name: &str) -> Option<Provider> {
    let name = name.trim_end_matches(".exe").trim_end_matches(".cmd");
    Some(match name {
        "amp" => Provider::Amp,
        "kiro-cli" => Provider::Kiro,
        "traecli" | "trae-cli" => Provider::Trae,
        "qoder" | "qodercli" => Provider::Qoder,
        "codebuddy" => Provider::CodeBuddy,
        "mcode" => Provider::MiniMaxCode,
        "jcode" => Provider::Jcode,
        "dsh" => Provider::Dsh,
        "iflow" => Provider::Iflow,
        "aider" => Provider::Aider,
        _ => return None,
    })
}

fn base_name(path: &str) -> &str {
    path.rsplit(['/', '\\']).next().unwrap_or(path)
}

/// Un agent lancé directement, ou à travers node, bun, deno ou python (son
/// script est alors le premier argument).
pub fn agent_of(process: &ProcInfo) -> Option<Provider> {
    let mut words = process.cmd.split_whitespace();
    let first = words.next().map(base_name).unwrap_or_default();
    let interpreted = matches!(first, "node" | "bun" | "deno")
        || first.starts_with("python")
        || first.starts_with("Python");
    let script = interpreted.then(|| words.next().map(base_name)).flatten();
    agent_named(&process.name)
        .or_else(|| process.exe.as_deref().map(base_name).and_then(agent_named))
        .or_else(|| (!interpreted).then(|| agent_named(first)).flatten())
        .or_else(|| script.and_then(agent_named))
}

struct Live {
    provider: Provider,
    session: String,
    cwd: Option<String>,
}

#[derive(Default)]
struct AiderContext {
    model: Option<String>,
    in_prompt: bool,
}

pub struct ProcessWatch {
    live: HashMap<(u32, u64), Live>,
    tail: Tail,
    histories: HashMap<(u32, u64), PathBuf>,
    aider: HashMap<(u32, u64), AiderContext>,
    app_started: u64,
}

impl Default for ProcessWatch {
    fn default() -> Self {
        Self::new()
    }
}

impl ProcessWatch {
    pub fn new() -> Self {
        Self {
            live: HashMap::new(),
            tail: Tail::new(),
            histories: HashMap::new(),
            aider: HashMap::new(),
            app_started: Utc::now().timestamp().max(0) as u64,
        }
    }

    fn observe(&mut self, processes: &[ProcInfo], prompts: bool) -> Vec<SessionEvent> {
        let matched: HashMap<u32, Provider> = processes
            .iter()
            .filter_map(|process| agent_of(process).map(|provider| (process.pid, provider)))
            .collect();
        let mut seen = HashMap::new();
        for process in processes {
            let Some(provider) = matched.get(&process.pid).copied() else {
                continue;
            };
            // Un lanceur et son processus enfant ne font qu'une session.
            if process.parent.and_then(|parent| matched.get(&parent)) == Some(&provider) {
                continue;
            }
            seen.insert((process.pid, process.start_time), (provider, process));
        }
        let mut events = Vec::new();
        for (key, (provider, process)) in &seen {
            if self.live.contains_key(key) {
                continue;
            }
            let started = Utc
                .timestamp_opt(process.start_time as i64, 0)
                .single()
                .unwrap_or_else(Utc::now);
            let live = Live {
                provider: *provider,
                session: format!("{}-{}-{}", provider.key(), process.pid, process.start_time),
                cwd: process.cwd.clone(),
            };
            let mut event = event(&live, EventKind::SessionStarted, None);
            event.occurred_at = started;
            events.push(event);
            if *provider == Provider::Aider
                && let Some(history) = process
                    .cwd
                    .as_deref()
                    .and_then(|cwd| find_history(Path::new(cwd)))
            {
                let offset = if process.start_time >= self.app_started {
                    session_start(&history)
                } else {
                    file_len(&history)
                };
                self.tail.start_at(&history, offset);
                self.histories.insert(*key, history);
                self.aider.insert(*key, AiderContext::default());
            }
            self.live.insert(*key, live);
        }
        for (key, history) in &self.histories {
            if !seen.contains_key(key) {
                continue;
            }
            let read = self.tail.read(history);
            let (Some(live), Some(context)) = (self.live.get(key), self.aider.get_mut(key)) else {
                continue;
            };
            for line in &read.lines {
                events.extend(aider_line(
                    &String::from_utf8_lossy(line),
                    live,
                    context,
                    prompts,
                ));
            }
        }
        let gone: Vec<(u32, u64)> = self
            .live
            .keys()
            .filter(|key| !seen.contains_key(key))
            .copied()
            .collect();
        for key in gone {
            if let Some(live) = self.live.remove(&key) {
                let model = self.aider.remove(&key).and_then(|context| context.model);
                events.push(event(&live, EventKind::SessionEnded, model.as_deref()));
            }
            self.histories.remove(&key);
        }
        events
    }
}

impl Poll for ProcessWatch {
    fn poll(&mut self, prompts: bool, _commands: bool) -> Vec<SessionEvent> {
        self.observe(&procs::snapshot(), prompts)
    }
}

fn event(live: &Live, kind: EventKind, model: Option<&str>) -> SessionEvent {
    let mut event = SessionEvent::new(&live.session, live.provider, kind);
    event.project_path = live.cwd.clone();
    event.model = model.map(|model| tail::provider(model.to_owned()));
    event
}

/// L'historique d'Aider : dans le dossier de travail ou un parent, jusqu'à la
/// racine du dépôt git (là où Aider le met par défaut).
fn find_history(cwd: &Path) -> Option<PathBuf> {
    for dir in cwd.ancestors() {
        let history = dir.join(HISTORY);
        if history.is_file() {
            return Some(history);
        }
        if dir.join(".git").exists() {
            break;
        }
    }
    None
}

fn file_len(path: &Path) -> u64 {
    fs::metadata(path).map(|meta| meta.len()).unwrap_or(0)
}

/// Le début de la session la plus récente : la dernière ligne « # aider chat started at ».
fn session_start(path: &Path) -> u64 {
    let length = file_len(path);
    let from = length.saturating_sub(256 * 1024);
    let Ok(mut file) = fs::File::open(path) else {
        return length;
    };
    let mut tail = Vec::new();
    if file.seek(SeekFrom::Start(from)).is_err() || file.read_to_end(&mut tail).is_err() {
        return length;
    }
    let text = String::from_utf8_lossy(&tail);
    text.rfind(STARTED)
        .map_or(length, |index| from + index as u64)
}

/// « 2.3k » → 2300, « 120 » → 120 (aider/utils.py, format_tokens).
fn tokens(text: &str) -> Option<u64> {
    let text = text.trim();
    if let Some(thousands) = text.strip_suffix('k') {
        return thousands
            .parse::<f64>()
            .ok()
            .map(|value| (value * 1000.0).round() as u64);
    }
    text.parse().ok()
}

fn aider_line(
    line: &str,
    live: &Live,
    context: &mut AiderContext,
    prompts: bool,
) -> Vec<SessionEvent> {
    let line = line.trim_end();
    let mut events = Vec::new();
    let event = |context: &AiderContext, kind| event(live, kind, context.model.as_deref());
    if let Some(prompt) = line.strip_prefix("#### ") {
        if !context.in_prompt {
            let mut user = event(context, EventKind::UserMessage);
            if prompts {
                user.content = Some(prompt.to_owned());
            }
            events.push(user);
        }
        context.in_prompt = true;
        return events;
    }
    context.in_prompt = false;
    let Some(note) = line.strip_prefix("> ") else {
        return events;
    };
    if let Some(rest) = note
        .strip_prefix("Main model: ")
        .or_else(|| note.strip_prefix("Model: "))
    {
        context.model = rest.split(" with ").next().map(str::to_owned);
    } else if let Some(path) = note.strip_prefix("Applied edit to ") {
        let mut changed = event(context, EventKind::FileChanged);
        changed.file_path = Some(path.to_owned());
        events.push(changed);
    } else if let Some(report) = note.strip_prefix("Tokens: ") {
        // « 12k sent, 1.2k cache write, 3k cache hit, 420 received. » (coders/base_coder.py)
        let report = report
            .split(". Cost")
            .next()
            .unwrap_or(report)
            .trim_end_matches('.');
        let mut sent = None;
        let mut received = None;
        let mut hit = 0;
        let mut write = 0;
        for part in report.split(", ") {
            let (number, label) = part.split_once(' ').unwrap_or((part, ""));
            match label.trim_end_matches('.') {
                "sent" => sent = tokens(number),
                "received" => received = tokens(number),
                "cache hit" => hit = tokens(number).unwrap_or(0),
                "cache write" => write = tokens(number).unwrap_or(0),
                _ => {}
            }
        }
        if sent.is_some() || received.is_some() {
            let mut usage = event(context, EventKind::ModelUsage);
            usage.input_tokens = sent.map(|sent| tail::estimated(sent.saturating_sub(hit + write)));
            usage.output_tokens = received.map(tail::estimated);
            usage.cache_read_tokens = (hit > 0).then(|| tail::estimated(hit));
            usage.cache_write_tokens = (write > 0).then(|| tail::estimated(write));
            events.push(usage);
        }
    }
    events
}

#[cfg(test)]
mod tests {
    use super::*;
    use session_events::DataOrigin;

    fn process(
        pid: u32,
        parent: Option<u32>,
        name: &str,
        cmd: &str,
        cwd: &str,
        start_time: u64,
    ) -> ProcInfo {
        ProcInfo {
            pid,
            parent,
            name: name.to_owned(),
            cmd: cmd.to_owned(),
            exe: None,
            cwd: Some(cwd.to_owned()),
            start_time,
        }
    }

    #[test]
    fn agents_are_known_by_their_program_even_behind_node_or_python() {
        assert_eq!(
            agent_of(&process(
                1,
                None,
                "kiro-cli",
                "/Users/me/.local/bin/kiro-cli chat",
                "/",
                0
            )),
            Some(Provider::Kiro)
        );
        assert_eq!(
            agent_of(&process(
                1,
                None,
                "node",
                "node /usr/local/lib/node_modules/@qoder-ai/qodercli/bin/qodercli",
                "/",
                0
            )),
            Some(Provider::Qoder)
        );
        assert_eq!(
            agent_of(&process(
                1,
                None,
                "python3.12",
                "/opt/homebrew/bin/python3.12 /Users/me/.local/bin/aider --model x",
                "/",
                0
            )),
            Some(Provider::Aider)
        );
        assert_eq!(
            agent_of(&process(
                1,
                None,
                "Trae",
                "/Applications/Trae.app/Contents/MacOS/Trae",
                "/",
                0
            )),
            None
        );
        assert_eq!(
            agent_of(&process(1, None, "node", "node server.js amp", "/", 0)),
            None
        );
        assert_eq!(agent_of(&process(1, None, "vim", "vim amp", "/", 0)), None);
    }

    #[test]
    fn a_running_agent_opens_a_session_that_closes_when_it_stops() {
        let mut watch = ProcessWatch::new();
        let launcher = process(10, Some(1), "amp", "amp", "/Users/me/app", 1_762_940_000);
        let child = process(
            11,
            Some(10),
            "amp",
            "amp --worker",
            "/Users/me/app",
            1_762_940_001,
        );
        let events = watch.observe(&[launcher.clone(), child.clone()], false);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].kind, EventKind::SessionStarted);
        assert_eq!(events[0].provider, Provider::Amp);
        assert_eq!(events[0].project_path.as_deref(), Some("/Users/me/app"));
        assert_eq!(events[0].occurred_at.timestamp(), 1_762_940_000);
        assert!(watch.observe(&[launcher, child], false).is_empty());
        let events = watch.observe(&[], false);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].kind, EventKind::SessionEnded);
    }

    #[test]
    fn aider_history_gives_prompts_model_edits_and_estimated_tokens() {
        let repo = std::env::temp_dir().join(format!("aider-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(repo.join(".git")).unwrap();
        fs::create_dir_all(repo.join("src")).unwrap();
        let history = repo.join(HISTORY);
        fs::write(
            &history,
            "\n# aider chat started at 2026-11-01 09:00:00\n\n#### old prompt\n",
        )
        .unwrap();
        let mut watch = ProcessWatch::new();
        let start = watch.app_started + 1;
        let aider = process(
            20,
            None,
            "aider",
            "aider",
            repo.join("src").to_str().unwrap(),
            start,
        );
        let mut text = fs::read_to_string(&history).unwrap();
        text.push_str("\n# aider chat started at 2026-11-12 10:00:00\n\n> Aider v0.86.0  \n> Main model: anthropic/claude-sonnet-4-5 with diff edit format, prompt cache  \n");
        fs::write(&history, &text).unwrap();
        let started = watch.observe(std::slice::from_ref(&aider), true);
        assert_eq!(started[0].kind, EventKind::SessionStarted);
        text.push_str("\n#### rename foo  \n#### and bar  \n\nDone.\n\n> Applied edit to src/foo.py  \n> Tokens: 12k sent, 3k cache hit, 420 received. Cost: $0.01 message, $0.02 session.  \n");
        fs::write(&history, &text).unwrap();
        let events = watch.observe(&[aider], true);
        let kinds: Vec<_> = events.iter().map(|event| event.kind).collect();
        assert_eq!(
            kinds,
            vec![
                EventKind::UserMessage,
                EventKind::FileChanged,
                EventKind::ModelUsage
            ]
        );
        assert_eq!(events[0].content.as_deref(), Some("rename foo"));
        assert_eq!(events[1].file_path.as_deref(), Some("src/foo.py"));
        let usage = &events[2];
        assert_eq!(
            usage.input_tokens.as_ref().map(|v| (v.value, v.origin)),
            Some((9000, DataOrigin::Estimated))
        );
        assert_eq!(
            usage.cache_read_tokens.as_ref().map(|v| v.value),
            Some(3000)
        );
        assert_eq!(usage.output_tokens.as_ref().map(|v| v.value), Some(420));
        assert_eq!(
            usage.model.as_ref().map(|m| m.value.as_str()),
            Some("anthropic/claude-sonnet-4-5")
        );
        fs::remove_dir_all(repo).ok();
    }
}
