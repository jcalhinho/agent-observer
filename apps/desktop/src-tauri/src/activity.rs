//! Resume en lecture seule de l'activite recente, pour les outils qui veulent savoir quels agents
//! travaillent et ou (le serveur MCP fourni dans `tools/mcp`, un script...).
//!
//! Seules des metadonnees sortent : agent, session, dossier, heures, compteurs, noms d'outils et
//! fichiers modifies. Jamais le texte d'un prompt, une commande ou un message d'erreur, meme quand
//! l'utilisateur a choisi de les garder dans l'app.

use chrono::{DateTime, Utc};
use serde::Serialize;
use session_events::{EventKind, SessionEvent};
use std::collections::{BTreeSet, HashMap};

const MAX_FILES: usize = 20;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SessionActivity {
    /// Cle du fournisseur (`claude_code`, `codex`...).
    pub agent: String,
    pub session_id: String,
    pub project_path: Option<String>,
    pub started_at: DateTime<Utc>,
    pub last_event_at: DateTime<Utc>,
    pub events: usize,
    pub tool_calls: usize,
    pub failures: usize,
    /// Le dernier outil utilise et son fichier, quand il y en a un.
    pub last_tool: Option<String>,
    pub last_file: Option<String>,
    /// Fichiers modifies dans la fenetre (au plus 20), tries.
    pub files_edited: Vec<String>,
    pub model: Option<String>,
    /// Vrai quand le dernier evenement est une fin de tour : l'agent attend l'utilisateur.
    pub waiting_for_user: bool,
}

fn is_edit_tool(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    [
        "edit", "write", "patch", "replace", "create", "apply", "insert",
    ]
    .iter()
    .any(|word| name.contains(word))
}

/// Regroupe les evenements par session, la plus recemment active d'abord.
pub fn summarize(events: &[SessionEvent]) -> Vec<SessionActivity> {
    let mut ordered: Vec<&SessionEvent> = events.iter().collect();
    ordered.sort_by_key(|event| event.occurred_at);
    let mut sessions: HashMap<(String, String), (SessionActivity, BTreeSet<String>)> =
        HashMap::new();
    for event in ordered {
        let agent = event.provider.key().to_owned();
        let key = (agent.clone(), event.session_id.clone());
        let (entry, files) = sessions.entry(key).or_insert_with(|| {
            (
                SessionActivity {
                    agent,
                    session_id: event.session_id.clone(),
                    project_path: None,
                    started_at: event.occurred_at,
                    last_event_at: event.occurred_at,
                    events: 0,
                    tool_calls: 0,
                    failures: 0,
                    last_tool: None,
                    last_file: None,
                    files_edited: Vec::new(),
                    model: None,
                    waiting_for_user: false,
                },
                BTreeSet::new(),
            )
        });
        entry.events += 1;
        entry.last_event_at = event.occurred_at;
        if event.project_path.is_some() {
            entry.project_path = event.project_path.clone();
        }
        if let Some(model) = &event.model {
            entry.model = Some(model.value.clone());
        }
        match event.kind {
            EventKind::ToolFinished | EventKind::ToolFailed => {
                entry.tool_calls += 1;
                if event.kind == EventKind::ToolFailed {
                    entry.failures += 1;
                }
            }
            _ => {}
        }
        if matches!(
            event.kind,
            EventKind::ToolStarted | EventKind::ToolFinished | EventKind::ToolFailed
        ) {
            entry.last_tool = event.tool_name.clone();
            entry.last_file = event.file_path.clone();
        }
        // Seule une modification terminee compte : une tentative peut encore echouer.
        let edited = event.kind == EventKind::FileChanged
            || (event.kind == EventKind::ToolFinished
                && event.tool_name.as_deref().is_some_and(is_edit_tool));
        if edited && let Some(path) = &event.file_path {
            files.insert(path.clone());
        }
        // Une fin de tour met l'agent en attente ; toute autre activite l'en sort. Codex marque aussi
        // le debut d'un tour d'un `Checkpoint` (`turn-started:`), qui n'est pas une attente.
        entry.waiting_for_user = event.kind == EventKind::Checkpoint
            && !event
                .outcome
                .as_deref()
                .is_some_and(|outcome| outcome.starts_with("turn-started:"));
    }
    let mut list: Vec<SessionActivity> = sessions
        .into_values()
        .map(|(mut entry, files)| {
            entry.files_edited = files.into_iter().take(MAX_FILES).collect();
            entry
        })
        .collect();
    list.sort_by_key(|entry| std::cmp::Reverse(entry.last_event_at));
    list
}

#[cfg(test)]
mod tests {
    use super::*;
    use session_events::{DataOrigin, Provider, Sourced};
    use uuid::Uuid;

    fn event(provider: Provider, session: &str, seconds: i64, kind: EventKind) -> SessionEvent {
        SessionEvent {
            schema_version: 1,
            event_id: Uuid::new_v4(),
            session_id: session.into(),
            occurred_at: DateTime::from_timestamp(1_800_000_000 + seconds, 0).unwrap(),
            provider,
            agent: None,
            kind,
            launch_mode: None,
            project_path: Some("/work/api".into()),
            project_hash: None,
            model: None,
            tool_name: None,
            command: Some("secret command".into()),
            file_path: None,
            input_tokens: None,
            output_tokens: None,
            cache_read_tokens: None,
            cache_write_tokens: None,
            context_window: None,
            duration_ms: None,
            outcome: None,
            content: Some("private prompt".into()),
        }
    }

    #[test]
    fn groups_sessions_and_counts_without_private_text() {
        let mut edit = event(Provider::ClaudeCode, "a", 10, EventKind::ToolFinished);
        edit.tool_name = Some("Edit".into());
        edit.file_path = Some("/work/api/src/main.rs".into());
        let mut failed = event(Provider::ClaudeCode, "a", 20, EventKind::ToolFailed);
        failed.tool_name = Some("Write".into());
        failed.file_path = Some("/work/api/src/never.rs".into());
        let mut usage = event(Provider::ClaudeCode, "a", 25, EventKind::ModelUsage);
        usage.model = Some(Sourced {
            value: "claude-x".into(),
            origin: DataOrigin::Provider,
        });
        let events = vec![
            event(Provider::ClaudeCode, "a", 0, EventKind::UserMessage),
            edit,
            failed,
            usage,
            event(Provider::ClaudeCode, "a", 30, EventKind::Checkpoint),
            event(Provider::Codex, "b", 40, EventKind::UserMessage),
        ];
        let list = summarize(&events);
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].agent, "codex", "most recent first");
        let claude = &list[1];
        assert_eq!(claude.events, 5);
        assert_eq!(claude.tool_calls, 2);
        assert_eq!(claude.failures, 1);
        assert_eq!(
            claude.files_edited,
            vec!["/work/api/src/main.rs".to_owned()],
            "a failed write edits nothing"
        );
        assert_eq!(claude.last_tool.as_deref(), Some("Write"));
        assert_eq!(claude.model.as_deref(), Some("claude-x"));
        assert!(claude.waiting_for_user);
        assert!(!list[0].waiting_for_user);
        let json = serde_json::to_string(&list).unwrap();
        assert!(!json.contains("private prompt") && !json.contains("secret command"));
    }

    #[test]
    fn a_started_turn_and_a_started_edit_are_not_what_they_seem() {
        let mut turn = event(Provider::Codex, "c", 0, EventKind::Checkpoint);
        turn.outcome = Some("turn-started:7".into());
        let mut attempt = event(Provider::Codex, "c", 5, EventKind::ToolStarted);
        attempt.tool_name = Some("apply_patch".into());
        attempt.file_path = Some("/work/api/a.rs".into());
        let list = summarize(&[turn, attempt]);
        assert!(
            !list[0].waiting_for_user,
            "a turn that starts is not a wait"
        );
        assert!(
            list[0].files_edited.is_empty(),
            "an edit that only started edited nothing"
        );
        assert_eq!(list[0].last_tool.as_deref(), Some("apply_patch"));
        let mut done = event(Provider::Codex, "c", 9, EventKind::Checkpoint);
        done.outcome = Some("turn-complete:7".into());
        assert!(summarize(&[done])[0].waiting_for_user);
    }
}
