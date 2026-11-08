//! Limites d'usage d'un abonnement (fenetre de 5 heures, fenetre de la semaine), telles que l'agent
//! les rapporte lui-meme. Rien n'est devine : on ne garde que ce qui est ecrit par l'agent.
//!
//! - Codex ecrit `payload.rate_limits` dans chaque ligne `token_count` de ses fichiers de session
//!   (`primary` / `secondary`, avec `used_percent`, `window_minutes` et `resets_at` en secondes Unix ;
//!   les versions plus anciennes ecrivaient `resets_in_seconds`, relatif a la ligne).
//! - Claude Code ne les ecrit nulle part sur le disque : il les passe au script de la barre d'etat
//!   (`rate_limits.five_hour` / `seven_day`, `used_percentage`, `resets_at`), seulement pour les
//!   abonnes Pro et Max. Une barre d'etat facultative les transmet donc au collecteur local.
//!
//! On ne conserve que les pourcentages, la duree des fenetres, l'heure de remise a zero et le type
//! d'offre. Le reste de ce que l'agent transmet (dossier, modele, couts...) n'est pas garde.

use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LimitWindow {
    /// Part de la fenetre deja consommee, de 0 a 100 (peut depasser 100 une fois la limite atteinte).
    pub used_percent: f64,
    /// Duree de la fenetre glissante, en minutes, quand l'agent la donne.
    pub window_minutes: Option<i64>,
    /// Heure de remise a zero, en secondes Unix.
    pub resets_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LimitSnapshot {
    /// La cle d'evenement du fournisseur (`codex`, `claude_code`).
    pub provider: String,
    /// Quand l'agent a rapporte ces valeurs.
    pub observed_at: DateTime<Utc>,
    /// La fenetre courte (5 heures).
    pub primary: Option<LimitWindow>,
    /// La fenetre longue (la semaine).
    pub secondary: Option<LimitWindow>,
    /// Le type d'offre, quand l'agent le dit (`plus`, `pro`...).
    pub plan: Option<String>,
}

pub type SharedLimits = Arc<Mutex<HashMap<String, LimitSnapshot>>>;

/// Garde le releve le plus recent de chaque fournisseur ; vrai quand ses chiffres ont change.
pub fn record(shared: &SharedLimits, snapshot: LimitSnapshot) -> bool {
    let Ok(mut map) = shared.lock() else {
        return false;
    };
    match map.get_mut(&snapshot.provider) {
        Some(current) if current.observed_at > snapshot.observed_at => false,
        // Memes chiffres, releve plus recent : on note l'heure sans signaler de changement.
        Some(current)
            if current.primary == snapshot.primary
                && current.secondary == snapshot.secondary
                && current.plan == snapshot.plan =>
        {
            current.observed_at = snapshot.observed_at;
            false
        }
        _ => {
            map.insert(snapshot.provider.clone(), snapshot);
            true
        }
    }
}

pub fn all(shared: &SharedLimits) -> Vec<LimitSnapshot> {
    let mut list: Vec<LimitSnapshot> = shared
        .lock()
        .map(|map| map.values().cloned().collect())
        .unwrap_or_default();
    list.sort_by(|a, b| a.provider.cmp(&b.provider));
    list
}

fn number(value: Option<&Value>) -> Option<f64> {
    value
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite())
}

fn integer(value: Option<&Value>) -> Option<i64> {
    let value = value?;
    value.as_i64().or_else(|| {
        value
            .as_f64()
            .filter(|value| value.is_finite())
            .map(|value| value.round() as i64)
    })
}

/// Une fenetre de Codex. `resets_at` est absolu ; l'ancien `resets_in_seconds` est relatif a la
/// ligne lue, d'ou `observed_at`.
fn codex_window(value: Option<&Value>, observed_at: DateTime<Utc>) -> Option<LimitWindow> {
    let value = value.filter(|value| value.is_object())?;
    let used_percent = number(value.get("used_percent"))?;
    let resets_at = integer(value.get("resets_at")).or_else(|| {
        integer(value.get("resets_in_seconds")).map(|seconds| observed_at.timestamp() + seconds)
    });
    Some(LimitWindow {
        used_percent,
        window_minutes: integer(value.get("window_minutes")),
        resets_at,
    })
}

/// `payload` d'une ligne `token_count` de Codex.
pub fn parse_codex(payload: &Value, observed_at: DateTime<Utc>) -> Option<LimitSnapshot> {
    let limits = payload
        .get("rate_limits")
        .filter(|value| value.is_object())?;
    let primary = codex_window(limits.get("primary"), observed_at);
    let secondary = codex_window(limits.get("secondary"), observed_at);
    if primary.is_none() && secondary.is_none() {
        return None;
    }
    Some(LimitSnapshot {
        provider: "codex".to_owned(),
        observed_at,
        primary,
        secondary,
        plan: limits
            .get("plan_type")
            .and_then(Value::as_str)
            .filter(|plan| !plan.is_empty())
            .map(str::to_owned),
    })
}

fn claude_window(value: Option<&Value>, minutes: i64) -> Option<LimitWindow> {
    let value = value.filter(|value| value.is_object())?;
    Some(LimitWindow {
        used_percent: number(value.get("used_percentage"))?,
        window_minutes: Some(minutes),
        resets_at: integer(value.get("resets_at")),
    })
}

/// L'entree JSON que Claude Code donne a sa barre d'etat.
pub fn parse_claude_statusline(input: &Value, observed_at: DateTime<Utc>) -> Option<LimitSnapshot> {
    let limits = input.get("rate_limits").filter(|value| value.is_object())?;
    let primary = claude_window(limits.get("five_hour"), 5 * 60);
    let secondary = claude_window(limits.get("seven_day"), 7 * 24 * 60);
    if primary.is_none() && secondary.is_none() {
        return None;
    }
    Some(LimitSnapshot {
        provider: "claude_code".to_owned(),
        observed_at,
        primary,
        secondary,
        plan: None,
    })
}

/// Le texte que la barre d'etat de Claude Code affiche : modele, contexte et limites, a partir de
/// ce que Claude Code vient de transmettre. Seulement les champs presents.
pub fn statusline_text(input: &Value) -> String {
    let mut parts = Vec::new();
    if let Some(model) = input
        .get("model")
        .and_then(|model| model.get("display_name"))
        .and_then(Value::as_str)
    {
        parts.push(model.to_owned());
    }
    if let Some(percent) = number(
        input
            .get("context_window")
            .and_then(|context| context.get("used_percentage")),
    ) {
        parts.push(format!("ctx {}%", percent.round() as i64));
    }
    if let Some(limits) = input.get("rate_limits") {
        for (key, label) in [("five_hour", "5h"), ("seven_day", "7d")] {
            if let Some(percent) = number(
                limits
                    .get(key)
                    .and_then(|window| window.get("used_percentage")),
            ) {
                parts.push(format!("{label} {}%", percent.round() as i64));
            }
        }
    }
    parts.join(" · ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn at(seconds: i64) -> DateTime<Utc> {
        DateTime::from_timestamp(seconds, 0).unwrap()
    }

    #[test]
    fn reads_current_codex_limits() {
        // Forme du code source de Codex (RateLimitSnapshot / RateLimitWindow).
        let payload = json!({ "type": "token_count", "info": null, "rate_limits": {
            "primary": { "used_percent": 23.5, "window_minutes": 300, "resets_at": 1765975828 },
            "secondary": { "used_percent": 41.0, "window_minutes": 10080, "resets_at": 1766562628 },
            "credits": { "has_credits": false, "unlimited": false, "balance": null },
            "plan_type": "plus"
        }});
        let snapshot = parse_codex(&payload, at(1765970000)).unwrap();
        assert_eq!(snapshot.provider, "codex");
        assert_eq!(snapshot.plan.as_deref(), Some("plus"));
        let primary = snapshot.primary.unwrap();
        assert_eq!(primary.used_percent, 23.5);
        assert_eq!(primary.window_minutes, Some(300));
        assert_eq!(primary.resets_at, Some(1765975828));
        assert_eq!(snapshot.secondary.unwrap().window_minutes, Some(10080));
    }

    #[test]
    fn reads_older_codex_relative_resets() {
        let payload = json!({ "rate_limits": {
            "primary": { "used_percent": 0.0, "window_minutes": 299, "resets_in_seconds": 17940 }
        }});
        let snapshot = parse_codex(&payload, at(1_000_000)).unwrap();
        assert_eq!(snapshot.primary.unwrap().resets_at, Some(1_017_940));
        assert!(snapshot.secondary.is_none());
        assert!(snapshot.plan.is_none());
    }

    #[test]
    fn ignores_codex_lines_without_limits() {
        assert!(parse_codex(&json!({ "info": {} }), at(0)).is_none());
        assert!(parse_codex(&json!({ "rate_limits": null }), at(0)).is_none());
        assert!(
            parse_codex(
                &json!({ "rate_limits": { "primary": null, "secondary": null } }),
                at(0)
            )
            .is_none()
        );
        assert!(
            parse_codex(
                &json!({ "rate_limits": { "primary": { "window_minutes": 300 } } }),
                at(0)
            )
            .is_none()
        );
    }

    #[test]
    fn reads_claude_statusline_limits() {
        // Exemple de la documentation de la barre d'etat de Claude Code.
        let input = json!({
            "model": { "display_name": "Opus" },
            "context_window": { "used_percentage": 8 },
            "rate_limits": {
                "five_hour": { "used_percentage": 23.5, "resets_at": 1738425600 },
                "seven_day": { "used_percentage": 41.2, "resets_at": 1738857600 }
            }
        });
        let snapshot = parse_claude_statusline(&input, at(1738400000)).unwrap();
        assert_eq!(snapshot.provider, "claude_code");
        assert_eq!(snapshot.primary.as_ref().unwrap().window_minutes, Some(300));
        assert_eq!(
            snapshot.primary.as_ref().unwrap().resets_at,
            Some(1738425600)
        );
        assert_eq!(snapshot.secondary.as_ref().unwrap().used_percent, 41.2);
        assert_eq!(statusline_text(&input), "Opus · ctx 8% · 5h 24% · 7d 41%");
    }

    #[test]
    fn claude_without_limits_is_not_a_snapshot() {
        // API, Bedrock, Vertex : pas de `rate_limits`.
        let input = json!({ "model": { "display_name": "Sonnet" } });
        assert!(parse_claude_statusline(&input, at(0)).is_none());
        assert_eq!(statusline_text(&input), "Sonnet");
        assert_eq!(statusline_text(&json!({})), "");
    }

    #[test]
    fn keeps_the_newest_snapshot() {
        let shared: SharedLimits = Arc::default();
        let window = |used| {
            Some(LimitWindow {
                used_percent: used,
                window_minutes: Some(300),
                resets_at: None,
            })
        };
        let snapshot = |seconds, used| LimitSnapshot {
            provider: "codex".into(),
            observed_at: at(seconds),
            primary: window(used),
            secondary: None,
            plan: None,
        };
        assert!(record(&shared, snapshot(10, 5.0)));
        assert!(
            !record(&shared, snapshot(5, 50.0)),
            "an older reading never replaces a newer one"
        );
        assert!(
            !record(&shared, snapshot(10, 5.0)),
            "the same reading changes nothing"
        );
        assert!(
            !record(&shared, snapshot(15, 5.0)),
            "same figures later: no change to signal"
        );
        assert_eq!(
            all(&shared)[0].observed_at,
            at(15),
            "but the reading time moves on"
        );
        assert!(record(&shared, snapshot(20, 7.0)));
        assert_eq!(all(&shared)[0].primary.as_ref().unwrap().used_percent, 7.0);
    }
}
