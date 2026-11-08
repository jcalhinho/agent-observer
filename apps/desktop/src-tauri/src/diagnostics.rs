//! Ce qu'il faut pour comprendre pourquoi un agent n'apparait pas : combien d'evenements chaque
//! connecteur a apporte depuis le lancement, quand, et combien de requetes le collecteur a refusees.
//! Tout est en memoire et repart de zero a chaque lancement.

use chrono::{DateTime, Utc};
use serde::Serialize;
use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
};

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ProviderStats {
    pub provider: String,
    /// Evenements enregistres depuis le lancement de l'app.
    pub events: u64,
    /// L'heure du plus recent evenement (celle que l'agent a rapportee).
    pub last_event_at: Option<DateTime<Utc>>,
    /// Quand l'app a recu le dernier evenement de cet agent.
    pub last_received_at: Option<DateTime<Utc>>,
}

#[derive(Default)]
pub struct IngestStats {
    providers: Mutex<HashMap<String, ProviderStats>>,
    rejected: AtomicU64,
}

pub type SharedStats = Arc<IngestStats>;

impl IngestStats {
    /// Compte un evenement enregistre.
    pub fn record(&self, provider: &str, occurred_at: DateTime<Utc>, received_at: DateTime<Utc>) {
        let Ok(mut map) = self.providers.lock() else {
            return;
        };
        let entry = map
            .entry(provider.to_owned())
            .or_insert_with(|| ProviderStats {
                provider: provider.to_owned(),
                events: 0,
                last_event_at: None,
                last_received_at: None,
            });
        entry.events += 1;
        if entry.last_event_at.is_none_or(|last| occurred_at > last) {
            entry.last_event_at = Some(occurred_at);
        }
        entry.last_received_at = Some(received_at);
    }

    /// Compte une requete refusee par le collecteur (cle absente ou fausse, contenu illisible).
    pub fn reject(&self) {
        self.rejected.fetch_add(1, Ordering::Relaxed);
    }

    pub fn rejected(&self) -> u64 {
        self.rejected.load(Ordering::Relaxed)
    }

    /// Les compteurs, tries par fournisseur.
    pub fn providers(&self) -> Vec<ProviderStats> {
        let mut list: Vec<ProviderStats> = self
            .providers
            .lock()
            .map(|map| map.values().cloned().collect())
            .unwrap_or_default();
        list.sort_by(|a, b| a.provider.cmp(&b.provider));
        list
    }
}

/// Remplace le dossier personnel par `~`, pour un diagnostic qu'on peut coller dans un ticket.
pub fn anonymize(path: &str, home: &str) -> String {
    let home = home.trim_end_matches(['/', '\\']);
    if home.is_empty() {
        return path.to_owned();
    }
    match path.strip_prefix(home) {
        Some(rest) if rest.is_empty() || rest.starts_with(['/', '\\']) => format!("~{rest}"),
        _ => path.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(seconds: i64) -> DateTime<Utc> {
        DateTime::from_timestamp(1_800_000_000 + seconds, 0).unwrap()
    }

    #[test]
    fn counts_events_and_keeps_the_latest_times() {
        let stats = IngestStats::default();
        stats.record("codex", at(10), at(100));
        stats.record("codex", at(5), at(101));
        stats.record("claude_code", at(20), at(102));
        stats.reject();
        stats.reject();
        let list = stats.providers();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].provider, "claude_code");
        let codex = &list[1];
        assert_eq!(codex.events, 2);
        assert_eq!(
            codex.last_event_at,
            Some(at(10)),
            "an older event does not move it back"
        );
        assert_eq!(codex.last_received_at, Some(at(101)));
        assert_eq!(stats.rejected(), 2);
    }

    #[test]
    fn hides_the_home_folder_only() {
        assert_eq!(
            anonymize("/Users/ana/.codex/sessions", "/Users/ana"),
            "~/.codex/sessions"
        );
        assert_eq!(anonymize("/Users/ana", "/Users/ana/"), "~");
        assert_eq!(anonymize("/Users/anais/x", "/Users/ana"), "/Users/anais/x");
        assert_eq!(
            anonymize(r"C:\Users\ana\.codex", r"C:\Users\ana"),
            r"~\.codex"
        );
        assert_eq!(anonymize("/opt/data", ""), "/opt/data");
    }
}
