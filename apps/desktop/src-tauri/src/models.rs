//! The model each agent is set to use, read (never written) from the agent's own settings. It is
//! only what the user chose: the model a session really ran with comes from its events, and wins.

use serde::Serialize;
use serde_json::Value;
use std::{env, fs, path::PathBuf};

#[derive(Serialize, Debug, PartialEq)]
pub struct ConfiguredModel {
    /// `Provider::key()` of the agent.
    pub provider: &'static str,
    pub model: String,
    /// Where it was read, for the tooltip.
    pub source: &'static str,
}

fn home() -> Option<PathBuf> {
    env::var_os("USERPROFILE")
        .or_else(|| env::var_os("HOME"))
        .map(PathBuf::from)
}

fn json(path: PathBuf) -> Option<Value> {
    serde_json::from_str(&fs::read_to_string(path).ok()?).ok()
}

fn clean(value: &str) -> Option<String> {
    let value = value.trim();
    (!value.is_empty() && value.len() <= 120).then(|| value.to_owned())
}

/// `model = "gpt-5"` before the first `[table]` of a Codex `config.toml`.
fn codex_model(toml: &str) -> Option<String> {
    for line in toml.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            return None;
        }
        if let Some(rest) = line.strip_prefix("model")
            && let Some(value) = rest.trim_start().strip_prefix('=')
        {
            return clean(value.trim().trim_matches(['"', '\'']));
        }
    }
    None
}

/// The model last picked in OpenCode (`state/opencode/model.json`: `recent[0]`), else its config.
/// Returns `(provider, model)`; the provider is missing when only a bare name is configured.
fn opencode_choice(
    state: Option<&Value>,
    config: Option<&Value>,
) -> Option<(Option<String>, String)> {
    let recent = state
        .and_then(|state| state.get("recent"))
        .and_then(Value::as_array)
        .and_then(|recent| recent.first());
    if let Some(entry) = recent
        && let Some(model) = entry.get("modelID").and_then(Value::as_str).and_then(clean)
    {
        let provider = entry
            .get("providerID")
            .and_then(Value::as_str)
            .and_then(clean);
        return Some((provider, model));
    }
    let configured = config?.get("model")?.as_str()?;
    match configured.split_once('/') {
        Some((provider, model)) => Some((clean(provider), clean(model)?)),
        None => Some((None, clean(configured)?)),
    }
}

fn opencode_model(state: Option<&Value>, config: Option<&Value>) -> Option<String> {
    opencode_choice(state, config).map(|(_, model)| model)
}

/// `$VAR/opencode/<file>` when the XDG variable is set, else `~/<default>/opencode/<file>`; OpenCode
/// uses the same locations on every system, Windows included. The first one that exists is read.
fn opencode_file(variable: &str, default: &[&str], names: &[&str]) -> Option<Value> {
    let mut folders: Vec<PathBuf> = Vec::new();
    if let Some(base) = env::var_os(variable).filter(|base| !base.is_empty()) {
        folders.push(PathBuf::from(base));
    }
    if let Some(home) = home() {
        folders.push(default.iter().fold(home, |path, part| path.join(part)));
    }
    folders
        .iter()
        .flat_map(|folder| {
            names
                .iter()
                .map(move |name| folder.join("opencode").join(name))
        })
        .find_map(json)
}

/// `provider/model` for `opencode run --model`: what the user picked last in OpenCode, which is not
/// always what its config file says (an agent run without it can fail on a model the key does not
/// serve).
pub fn opencode_model_ref() -> Option<String> {
    let state = opencode_file("XDG_STATE_HOME", &[".local", "state"], &["model.json"]);
    let config = opencode_file(
        "XDG_CONFIG_HOME",
        &[".config"],
        &["opencode.json", "opencode.jsonc"],
    );
    opencode_choice(state.as_ref(), config.as_ref())
        .and_then(|(provider, model)| provider.map(|provider| format!("{provider}/{model}")))
}

fn qwen_model(settings: &Value) -> Option<String> {
    let model = settings.get("model")?;
    clean(model.as_str().or_else(|| model.get("name")?.as_str())?)
}

fn claude_model(settings: &Value) -> Option<String> {
    let direct = settings.get("model").and_then(Value::as_str);
    let from_env = settings
        .get("env")
        .and_then(|env| env.get("ANTHROPIC_MODEL"))
        .and_then(Value::as_str);
    clean(direct.or(from_env)?)
}

pub fn configured_models() -> Vec<ConfiguredModel> {
    let Some(home) = home() else {
        return Vec::new();
    };
    let mut found = Vec::new();
    let mut add = |provider, model: Option<String>, source| {
        if let Some(model) = model {
            found.push(ConfiguredModel {
                provider,
                model,
                source,
            });
        }
    };
    add(
        "claude_code",
        json(home.join(".claude").join("settings.json"))
            .and_then(|settings| claude_model(&settings)),
        "~/.claude/settings.json",
    );
    add(
        "codex",
        fs::read_to_string(home.join(".codex").join("config.toml"))
            .ok()
            .and_then(|toml| codex_model(&toml)),
        "~/.codex/config.toml",
    );
    add(
        "qwen_code",
        json(home.join(".qwen").join("settings.json")).and_then(|settings| qwen_model(&settings)),
        "~/.qwen/settings.json",
    );
    let state = json(
        home.join(".local")
            .join("state")
            .join("opencode")
            .join("model.json"),
    );
    let config = json(home.join(".config").join("opencode").join("opencode.json"));
    add(
        "opencode",
        opencode_model(state.as_ref(), config.as_ref()),
        "OpenCode",
    );
    add(
        "antigravity",
        crate::antigravity_models::selected_model(&crate::antigravity_sessions::data_root()),
        "Antigravity",
    );
    found
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn codex_reads_the_top_level_model_only() {
        assert_eq!(
            codex_model("model = \"gpt-5.6\"\n[mcp]\nmodel = \"x\"").as_deref(),
            Some("gpt-5.6")
        );
        assert_eq!(codex_model("[mcp]\nmodel = \"x\""), None);
        assert_eq!(codex_model("model_reasoning_effort = \"low\""), None);
    }

    #[test]
    fn opencode_prefers_the_model_picked_last_over_the_config() {
        let state = json!({ "recent": [{ "providerID": "sgp", "modelID": "claude-qwen" }] });
        let config = json!({ "model": "sgp/glm-5.3-flash" });
        assert_eq!(
            opencode_model(Some(&state), Some(&config)).as_deref(),
            Some("claude-qwen")
        );
        assert_eq!(
            opencode_model(None, Some(&config)).as_deref(),
            Some("glm-5.3-flash")
        );
        assert_eq!(opencode_model(None, None), None);
        assert_eq!(
            opencode_choice(Some(&state), None),
            Some((Some("sgp".to_owned()), "claude-qwen".to_owned()))
        );
        assert_eq!(
            opencode_choice(None, Some(&config)),
            Some((Some("sgp".to_owned()), "glm-5.3-flash".to_owned()))
        );
        assert_eq!(
            opencode_choice(None, Some(&json!({ "model": "big-pickle" }))),
            Some((None, "big-pickle".to_owned()))
        );
    }

    #[test]
    fn qwen_and_claude_settings() {
        assert_eq!(
            qwen_model(&json!({ "model": { "name": "claude-qwen" } })).as_deref(),
            Some("claude-qwen")
        );
        assert_eq!(
            qwen_model(&json!({ "model": "qwen3-coder" })).as_deref(),
            Some("qwen3-coder")
        );
        assert_eq!(
            claude_model(&json!({ "model": "opus" })).as_deref(),
            Some("opus")
        );
        assert_eq!(
            claude_model(&json!({ "env": { "ANTHROPIC_MODEL": "sonnet" } })).as_deref(),
            Some("sonnet")
        );
    }
}
