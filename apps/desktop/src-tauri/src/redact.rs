//! Error messages are only kept when the user asks for it, and never as they came: one line,
//! cut short, with anything that looks like a secret or a personal folder taken out.

use std::sync::atomic::{AtomicBool, Ordering};

const MAX_CHARS: usize = 300;

/// Mirrors the setting, so every connector (not only Claude's hooks) follows it.
static KEEP_MESSAGES: AtomicBool = AtomicBool::new(false);

pub fn keep_messages(enabled: bool) {
    KEEP_MESSAGES.store(enabled, Ordering::Relaxed);
}

/// What a connector records for a failed action: the cleaned message if the user asked for it.
pub fn failure_outcome(message: Option<&str>) -> String {
    outcome(KEEP_MESSAGES.load(Ordering::Relaxed), message)
}

fn outcome(keep: bool, message: Option<&str>) -> String {
    if keep && let Some(message) = message {
        let cleaned = redact_error(message);
        if !cleaned.is_empty() {
            return format!("error: {cleaned}");
        }
    }
    "failed".to_owned()
}

const SECRET_PREFIXES: &[&str] = &[
    "sk-",
    "sk_",
    "pk_",
    "ghp_",
    "gho_",
    "ghu_",
    "ghs_",
    "github_pat_",
    "xoxb-",
    "xoxp-",
    "AKIA",
    "ASIA",
    "AIza",
    "eyJ",
];
const SECRET_WORDS: &[&str] = &[
    "password",
    "passwd",
    "secret",
    "token",
    "apikey",
    "api_key",
    "api-key",
    "authorization",
    "bearer",
    "credential",
    "private_key",
];

fn looks_like_secret(word: &str) -> bool {
    let trimmed = word.trim_matches(|c: char| !c.is_ascii_alphanumeric() && c != '_' && c != '-');
    if trimmed.len() < 8 {
        return false;
    }
    if SECRET_PREFIXES
        .iter()
        .any(|prefix| trimmed.starts_with(prefix))
    {
        return true;
    }
    // A long run of letters and digits with no separators is more often a key than a word.
    trimmed.len() >= 24
        && trimmed
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
        && trimmed.chars().any(|c| c.is_ascii_digit())
        && trimmed.chars().any(|c| c.is_ascii_alphabetic())
}

/// Replaces the user's folder by `~`, on both systems.
fn hide_home(text: &str) -> String {
    let mut out = text.to_owned();
    for variable in ["HOME", "USERPROFILE"] {
        if let Some(home) = std::env::var_os(variable) {
            let home = home.to_string_lossy().into_owned();
            if home.len() > 3 {
                out = out
                    .replace(&home, "~")
                    .replace(&home.replace('\\', "/"), "~");
            }
        }
    }
    out
}

/// A short, single-line, secret-free version of an error message.
pub fn redact_error(message: &str) -> String {
    let single = hide_home(message)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let mut redact_next = false;
    let words: Vec<String> = single
        .split(' ')
        .map(|word| {
            let lower = word.to_lowercase();
            // `password=hunter2`, `token: abc`, `Authorization: Bearer abc`
            let secret_key = SECRET_WORDS.iter().any(|name| lower.contains(name));
            if let Some((name, value)) = word.split_once(['=', ':']) {
                if !value.is_empty()
                    && SECRET_WORDS
                        .iter()
                        .any(|secret| name.to_lowercase().contains(secret))
                {
                    return format!("{name}=[redacted]");
                }
            }
            let hide = redact_next || looks_like_secret(word);
            redact_next = secret_key;
            if hide {
                "[redacted]".to_owned()
            } else {
                word.to_owned()
            }
        })
        .collect();
    let joined = words.join(" ");
    if joined.chars().count() <= MAX_CHARS {
        return joined;
    }
    let cut: String = joined.chars().take(MAX_CHARS).collect();
    format!("{cut}…")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_a_useful_error_on_one_line() {
        assert_eq!(
            redact_error("Error: Cannot find module './render'\n  at load (a.js:1)"),
            "Error: Cannot find module './render' at load (a.js:1)"
        );
    }

    #[test]
    fn removes_keys_tokens_and_passwords() {
        let text = redact_error(
            "401 for sk-ant-api03-abcdefghijklmnop and ghp_abcdefghijklmnopqrstuvwxyz0123456789, password=hunter2 Authorization: Bearer abc123xyz",
        );
        assert!(!text.contains("sk-ant"));
        assert!(!text.contains("ghp_"));
        assert!(!text.contains("hunter2"));
        assert!(!text.contains("abc123xyz"));
        assert!(text.contains("[redacted]"));
        assert!(text.starts_with("401 for"));
    }

    #[test]
    fn hides_the_home_folder_and_cuts_long_messages() {
        if let Some(home) = std::env::var_os("HOME") {
            let home = home.to_string_lossy().into_owned();
            if home.len() > 3 {
                assert_eq!(
                    redact_error(&format!("ENOENT {home}/project/a.ts")),
                    "ENOENT ~/project/a.ts"
                );
            }
        }
        let long = "word ".repeat(200);
        let cut = redact_error(&long);
        assert!(cut.chars().count() <= MAX_CHARS + 1);
        assert!(cut.ends_with('…'));
    }

    #[test]
    fn connectors_record_a_message_only_when_asked() {
        assert_eq!(outcome(false, Some("boom")), "failed");
        assert_eq!(outcome(true, Some("boom  now")), "error: boom now");
        assert_eq!(outcome(true, None), "failed");
    }
}
