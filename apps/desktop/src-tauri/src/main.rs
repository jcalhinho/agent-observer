#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod activity;
mod antigravity_models;
mod antigravity_sessions;
mod claude_transcripts;
mod codex_rollout;
mod continue_sessions;
mod copilot_chat;
mod copilot_sessions;
mod crush_sessions;
mod diagnostics;
mod gemini_sessions;
mod git_info;
mod goose_sessions;
mod hermes_sessions;
mod kimi_sessions;
mod limits;
mod models;
mod no_window;
mod opencode_sessions;
mod pi_sessions;
mod process_watch;
mod procs;
mod qwen_sessions;
mod reasonix_sessions;
mod redact;
mod tail;
mod tray;
mod zed_threads;

use axum::{
    Router,
    extract::{ConnectInfo, Request, State},
    http::{StatusCode, header},
    response::IntoResponse,
    routing::{get, post},
};
use rusqlite::OptionalExtension;
use rusqlite::{Connection, params};
use serde::Serialize;
use serde_json::{Value, json};
use session_events::{DataOrigin, EventKind, Provider, SessionEvent, Sourced};
use std::{
    collections::HashMap,
    fs,
    io::{BufWriter, Write},
    net::SocketAddr,
    path::PathBuf,
    sync::atomic::{AtomicBool, Ordering},
    sync::{Arc, Mutex},
};
use tauri::{Emitter, Manager};
use uuid::Uuid;

#[derive(Clone)]
struct CollectorState {
    app: tauri::AppHandle,
    token: String,
    database: Arc<Mutex<Connection>>,
    status: Arc<Mutex<String>>,
    capture_prompts: Arc<AtomicBool>,
    capture_commands: Arc<AtomicBool>,
    /// Keep a short, cleaned version of failed tools' error messages (off by default).
    capture_errors: Arc<AtomicBool>,
    /// Latest subscription usage limits each agent reported (kept in memory only).
    limits: limits::SharedLimits,
    /// Events per agent and refused requests since launch, for the diagnostic.
    stats: diagnostics::SharedStats,
    /// Folder of the SQLite store, for the diagnostic.
    data_dir: std::path::PathBuf,
    started_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Serialize)]
struct ClaudeSetup {
    endpoint: String,
    token: String,
    settings_fragment: String,
    /// Optional status line that hands Claude Code's usage limits to the observer.
    statusline_fragment: String,
    capture_prompts: bool,
    capture_commands: bool,
}

#[derive(Serialize)]
struct CodexSetup {
    sessions_dir: String,
    available: bool,
    capture_prompts: bool,
    capture_commands: bool,
}

#[derive(Serialize)]
struct CopilotSetup {
    sessions_dir: String,
    available: bool,
    capture_prompts: bool,
    capture_commands: bool,
}

#[derive(Serialize)]
struct AntigravitySetup {
    data_dir: String,
    available: bool,
    capture_prompts: bool,
    capture_commands: bool,
}

#[derive(Serialize)]
struct ReasonixSetup {
    projects_dir: String,
    available: bool,
    capture_prompts: bool,
    capture_commands: bool,
}

/// Les connecteurs ajoutés en 0.18 : où l'app regarde, et si ça existe ici.
#[derive(Serialize)]
struct SourceSetup {
    paths: Vec<String>,
    available: bool,
}

fn source_paths(kind: &str) -> Vec<std::path::PathBuf> {
    match kind {
        "gemini" => gemini_sessions::roots(),
        "pi" => pi_sessions::pi_roots(),
        "omp" => pi_sessions::omp_roots(),
        "kimi" => vec![kimi_sessions::home().join("sessions")],
        "goose" => goose_sessions::database_paths(),
        "crush" => vec![crush_sessions::projects_file()],
        "zed" => vec![zed_threads::database_path()],
        _ => Vec::new(),
    }
}

#[tauri::command]
fn source_setup(kind: String) -> SourceSetup {
    let paths = source_paths(&kind);
    SourceSetup {
        available: paths.iter().any(|path| path.exists()),
        paths: paths
            .iter()
            .map(|path| path.display().to_string())
            .collect(),
    }
}

#[derive(Serialize)]
struct QwenSetup {
    projects_dir: String,
    available: bool,
    capture_prompts: bool,
    capture_commands: bool,
}

#[derive(Serialize)]
struct ContinueSetup {
    dev_data_dir: String,
    available: bool,
    capture_prompts: bool,
    capture_commands: bool,
}

#[derive(Serialize)]
struct OpenCodeSetup {
    data_dir: String,
    database_paths: Vec<String>,
    available: bool,
    capture_prompts: bool,
    capture_commands: bool,
}

#[derive(Serialize)]
struct CursorSetup {
    endpoint: String,
    settings_fragment: String,
    capture_commands: bool,
}

#[tauri::command]
fn claude_setup(state: tauri::State<'_, CollectorState>) -> ClaudeSetup {
    let endpoint = "http://127.0.0.1:43821/claude-hook".to_owned();
    let hook = || json!([{ "hooks": [{ "type": "http", "url": endpoint, "timeout": 2, "headers": { "Authorization": format!("Bearer {}", state.token) } }] }]);
    let fragment = json!({ "hooks": {
        "UserPromptSubmit": hook(),
        "PreToolUse": hook(),
        "PostToolUse": hook(),
        "PostToolUseFailure": hook(),
        "Stop": hook(),
        "Notification": hook(),
        "SessionEnd": hook()
    }});
    // Claude Code pipes its status line JSON into curl; the observer answers with the line to
    // show. When the observer is closed, curl fails quietly and the line stays empty.
    let statusline = json!({ "statusLine": { "type": "command", "command": format!(
        "curl -s -m 1 -X POST -H \"Content-Type: application/json\" -H \"Authorization: Bearer {}\" --data-binary @- http://127.0.0.1:43821/claude-statusline",
        state.token
    ) } });
    ClaudeSetup {
        endpoint,
        token: state.token.clone(),
        settings_fragment: serde_json::to_string_pretty(&fragment).unwrap_or_default(),
        statusline_fragment: serde_json::to_string_pretty(&statusline).unwrap_or_default(),
        capture_prompts: state.capture_prompts.load(Ordering::Relaxed),
        capture_commands: state.capture_commands.load(Ordering::Relaxed),
    }
}

#[tauri::command]
fn codex_setup(state: tauri::State<'_, CollectorState>) -> CodexSetup {
    let sessions_dir = codex_rollout::sessions_root();
    CodexSetup {
        sessions_dir: sessions_dir.display().to_string(),
        available: sessions_dir.is_dir(),
        capture_prompts: state.capture_prompts.load(Ordering::Relaxed),
        capture_commands: state.capture_commands.load(Ordering::Relaxed),
    }
}

#[tauri::command]
fn configured_models() -> Vec<models::ConfiguredModel> {
    models::configured_models()
}

#[tauri::command]
fn copilot_setup(state: tauri::State<'_, CollectorState>) -> CopilotSetup {
    let sessions_dir = copilot_sessions::sessions_root();
    CopilotSetup {
        sessions_dir: sessions_dir.display().to_string(),
        available: sessions_dir.is_dir(),
        capture_prompts: state.capture_prompts.load(Ordering::Relaxed),
        capture_commands: state.capture_commands.load(Ordering::Relaxed),
    }
}

#[tauri::command]
fn antigravity_setup(state: tauri::State<'_, CollectorState>) -> AntigravitySetup {
    let data_dir = antigravity_sessions::data_root();
    AntigravitySetup {
        data_dir: data_dir.display().to_string(),
        available: data_dir.join("conversation_summaries.db").is_file(),
        capture_prompts: state.capture_prompts.load(Ordering::Relaxed),
        capture_commands: state.capture_commands.load(Ordering::Relaxed),
    }
}

#[tauri::command]
fn qwen_setup(state: tauri::State<'_, CollectorState>) -> QwenSetup {
    let projects_dir = qwen_sessions::projects_root();
    QwenSetup {
        projects_dir: projects_dir.display().to_string(),
        available: projects_dir.is_dir(),
        capture_prompts: state.capture_prompts.load(Ordering::Relaxed),
        capture_commands: state.capture_commands.load(Ordering::Relaxed),
    }
}

#[derive(Serialize)]
struct HermesSetup {
    home: String,
    database_paths: Vec<String>,
    available: bool,
    capture_prompts: bool,
    capture_commands: bool,
}

#[tauri::command]
fn hermes_setup(state: tauri::State<'_, CollectorState>) -> HermesSetup {
    let paths = hermes_sessions::database_paths();
    HermesSetup {
        home: hermes_sessions::data_root().display().to_string(),
        available: !paths.is_empty(),
        database_paths: paths
            .iter()
            .map(|path| path.display().to_string())
            .collect(),
        capture_prompts: state.capture_prompts.load(Ordering::Relaxed),
        capture_commands: state.capture_commands.load(Ordering::Relaxed),
    }
}

#[tauri::command]
fn continue_setup(state: tauri::State<'_, CollectorState>) -> ContinueSetup {
    let dev_data_dir = continue_sessions::dev_data_dir(&continue_sessions::data_root());
    ContinueSetup {
        dev_data_dir: dev_data_dir.display().to_string(),
        available: dev_data_dir.is_dir(),
        capture_prompts: state.capture_prompts.load(Ordering::Relaxed),
        capture_commands: state.capture_commands.load(Ordering::Relaxed),
    }
}

#[tauri::command]
fn reasonix_setup(state: tauri::State<'_, CollectorState>) -> ReasonixSetup {
    let projects_dir = reasonix_sessions::projects_root();
    ReasonixSetup {
        projects_dir: projects_dir.display().to_string(),
        available: projects_dir.is_dir(),
        capture_prompts: state.capture_prompts.load(Ordering::Relaxed),
        capture_commands: state.capture_commands.load(Ordering::Relaxed),
    }
}

#[tauri::command]
fn opencode_setup(state: tauri::State<'_, CollectorState>) -> OpenCodeSetup {
    let paths = opencode_sessions::database_paths();
    OpenCodeSetup {
        data_dir: opencode_sessions::data_root().display().to_string(),
        database_paths: paths
            .iter()
            .map(|path| path.display().to_string())
            .collect(),
        available: !paths.is_empty(),
        capture_prompts: state.capture_prompts.load(Ordering::Relaxed),
        capture_commands: state.capture_commands.load(Ordering::Relaxed),
    }
}

#[tauri::command]
fn cursor_setup(
    state: tauri::State<'_, CollectorState>,
    app: tauri::AppHandle,
) -> Result<CursorSetup, String> {
    let endpoint = "http://127.0.0.1:43821/cursor-hook";
    let token_path = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?
        .join("collector-token");
    let command = if cfg!(target_os = "windows") {
        let path = token_path.display().to_string().replace('\'', "''");
        format!(
            r#"powershell.exe -NoProfile -NonInteractive -Command "[Console]::InputEncoding=[System.Text.UTF8Encoding]::new(); $p=[Console]::In.ReadToEnd(); $t=(Get-Content -Raw -LiteralPath '{}').Trim(); try {{ Invoke-RestMethod -Uri '{}' -Method Post -ContentType 'application/json' -Headers @{{Authorization=('Bearer '+$t)}} -Body $p | Out-Null }} catch {{ }}"#,
            path, endpoint
        )
    } else {
        let path = serde_json::to_string(&token_path.display().to_string())
            .map_err(|error| error.to_string())?;
        let python = format!(
            "import sys,json,urllib.request; p=sys.stdin.read(); t=open({path},encoding='utf-8').read().strip(); r=urllib.request.Request('{endpoint}',data=p.encode(),headers={{'Content-Type':'application/json','Authorization':'Bearer '+t}},method='POST'); urllib.request.urlopen(r,timeout=2).read()",
            path = path,
            endpoint = endpoint
        );
        format!(
            // Like the PowerShell `catch {}`: never fail the Cursor hook when the
            // observer is closed or python3 is missing.
            "python3 -c {} >/dev/null 2>&1 || true",
            serde_json::to_string(&python).map_err(|error| error.to_string())?
        )
    };
    let hook = json!([{ "command": command, "timeout": 3 }]);
    let fragment = json!({ "version": 1, "hooks": {
        "sessionStart": hook,
        "sessionEnd": hook,
        "postToolUse": hook,
        "postToolUseFailure": hook,
        "afterShellExecution": hook,
        "afterFileEdit": hook,
        "stop": hook
    }});
    Ok(CursorSetup {
        endpoint: endpoint.to_owned(),
        settings_fragment: serde_json::to_string_pretty(&fragment).unwrap_or_default(),
        capture_commands: state.capture_commands.load(Ordering::Relaxed),
    })
}

/// Whether short, cleaned error messages are kept (so "why did it fail?" can be answered).
#[tauri::command]
fn capture_errors(state: tauri::State<'_, CollectorState>) -> bool {
    state.capture_errors.load(Ordering::Relaxed)
}

#[tauri::command]
fn update_capture_errors(
    state: tauri::State<'_, CollectorState>,
    enabled: bool,
) -> Result<(), String> {
    let database = state.database.lock().map_err(|error| error.to_string())?;
    database
        .execute(
            "INSERT INTO preferences(key, value) VALUES ('capture_errors', ?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            [enabled as i64],
        )
        .map_err(|error| error.to_string())?;
    state.capture_errors.store(enabled, Ordering::Relaxed);
    redact::keep_messages(enabled);
    Ok(())
}

#[tauri::command]
fn update_capture_policy(
    state: tauri::State<'_, CollectorState>,
    capture_prompts: bool,
    capture_commands: bool,
) -> Result<(), String> {
    let database = state.database.lock().map_err(|error| error.to_string())?;
    database.execute("INSERT INTO preferences(key, value) VALUES ('capture_prompts', ?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [capture_prompts as i64]).map_err(|error| error.to_string())?;
    database.execute("INSERT INTO preferences(key, value) VALUES ('capture_commands', ?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [capture_commands as i64]).map_err(|error| error.to_string())?;
    state
        .capture_prompts
        .store(capture_prompts, Ordering::Relaxed);
    state
        .capture_commands
        .store(capture_commands, Ordering::Relaxed);
    Ok(())
}

const SCHEMA: &str = "PRAGMA journal_mode=WAL; PRAGMA secure_delete=ON; CREATE TABLE IF NOT EXISTS session_events (event_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, occurred_at TEXT NOT NULL, provider TEXT NOT NULL, kind TEXT NOT NULL, project_path TEXT, payload TEXT NOT NULL); CREATE INDEX IF NOT EXISTS idx_session_events_time ON session_events(occurred_at); CREATE INDEX IF NOT EXISTS idx_session_events_session ON session_events(provider, session_id, occurred_at); CREATE TABLE IF NOT EXISTS preferences (key TEXT PRIMARY KEY, value INTEGER NOT NULL);";

/// Days events are kept; 0 keeps everything.
const DEFAULT_RETENTION_DAYS: i64 = 30;
const PURGE_INTERVAL: std::time::Duration = std::time::Duration::from_secs(60 * 60);

fn retention_days(connection: &Connection) -> i64 {
    connection
        .query_row(
            "SELECT value FROM preferences WHERE key='retention_days'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .ok()
        .flatten()
        .unwrap_or(DEFAULT_RETENTION_DAYS)
}

/// Deletes events older than `days` (none when `days` is 0) and returns how many were removed.
fn purge_expired_events(connection: &Connection, days: i64) -> rusqlite::Result<usize> {
    if days <= 0 {
        return Ok(0);
    }
    // Same RFC 3339 shape as the stored `occurred_at`, so text comparison orders correctly.
    let cutoff = (chrono::Utc::now() - chrono::Duration::days(days)).to_rfc3339();
    connection.execute(
        "DELETE FROM session_events WHERE occurred_at < ?1",
        [cutoff],
    )
}

#[tauri::command]
fn retention_policy(state: tauri::State<'_, CollectorState>) -> Result<i64, String> {
    let database = state.database.lock().map_err(|error| error.to_string())?;
    Ok(retention_days(&database))
}

/// Saves the retention period and applies it at once; returns the number of events removed.
#[tauri::command]
fn update_retention_policy(
    state: tauri::State<'_, CollectorState>,
    days: i64,
) -> Result<usize, String> {
    if !(0..=3650).contains(&days) {
        return Err("Durée de conservation invalide.".into());
    }
    let database = state.database.lock().map_err(|error| error.to_string())?;
    database
        .execute("INSERT INTO preferences(key, value) VALUES ('retention_days', ?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [days])
        .map_err(|error| error.to_string())?;
    purge_expired_events(&database, days).map_err(|error| error.to_string())
}

#[tauri::command]
fn clear_session_history(state: tauri::State<'_, CollectorState>) -> Result<(), String> {
    let database = state.database.lock().map_err(|error| error.to_string())?;
    database
        .execute("DELETE FROM session_events", [])
        .map_err(|error| error.to_string())?;
    database
        .execute_batch("PRAGMA wal_checkpoint(TRUNCATE); VACUUM;")
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn load_session_events(
    state: tauri::State<'_, CollectorState>,
    limit: Option<usize>,
    before_occurred_at: Option<String>,
    before_event_id: Option<String>,
) -> Result<Vec<SessionEvent>, String> {
    let limit = limit.unwrap_or(500).clamp(1, 500) as i64;
    let database = state.database.lock().map_err(|error| error.to_string())?;
    let mut statement = database
        .prepare("SELECT payload FROM session_events WHERE (?1 IS NULL OR (occurred_at, event_id) < (?1, ?2)) ORDER BY occurred_at DESC, event_id DESC LIMIT ?3")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![before_occurred_at, before_event_id, limit], |row| {
            row.get::<_, String>(0)
        })
        .map_err(|error| error.to_string())?;
    let payloads = rows
        .collect::<Result<Vec<String>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(decode_stored_events(&payloads))
}

/// Upper bound on the events one history query returns, so a huge database cannot freeze the window.
const HISTORY_EVENT_CAP: i64 = 200_000;

/// One agent session seen during a quarter of an hour. Every time zone is a whole number of
/// quarters away from UTC, so the interface can put each one in the right local day.
#[derive(Debug, PartialEq, Serialize)]
struct SessionPresence {
    provider: String,
    session_id: String,
    occurred_at: String,
}

#[derive(Debug, Serialize)]
struct HistoryRows {
    /// Events that carry tokens, and failed tool calls: what the daily totals add up.
    events: Vec<SessionEvent>,
    /// Which sessions were active, by quarter of an hour, to count the sessions of each day.
    presence: Vec<SessionPresence>,
    /// True when the event cap was reached before the start of the period.
    truncated: bool,
}

/// The rows the history needs since `since`, instead of every event: tool starts, file reads
/// and messages are left out, and sessions come back as one row per quarter of an hour.
fn history_rows(connection: &Connection, since: &str) -> rusqlite::Result<HistoryRows> {
    let mut statement = connection.prepare(
        "SELECT payload FROM session_events WHERE occurred_at >= ?1 AND (kind = 'ToolFailed' \
         OR json_extract(payload, '$.input_tokens') IS NOT NULL \
         OR json_extract(payload, '$.output_tokens') IS NOT NULL \
         OR json_extract(payload, '$.cache_read_tokens') IS NOT NULL \
         OR json_extract(payload, '$.cache_write_tokens') IS NOT NULL) \
         ORDER BY occurred_at DESC, event_id DESC LIMIT ?2",
    )?;
    let payloads = statement
        .query_map(params![since, HISTORY_EVENT_CAP + 1], |row| {
            row.get::<_, String>(0)
        })?
        .collect::<Result<Vec<String>, _>>()?;
    let truncated = payloads.len() as i64 > HISTORY_EVENT_CAP;
    let events = decode_stored_events(&payloads[..payloads.len().min(HISTORY_EVENT_CAP as usize)]);
    let mut statement = connection.prepare(
        "SELECT provider, session_id, MIN(occurred_at) FROM session_events WHERE occurred_at >= ?1 \
         GROUP BY provider, session_id, substr(occurred_at, 1, 14), CAST(substr(occurred_at, 15, 2) AS INTEGER) / 15",
    )?;
    let presence = statement
        .query_map(params![since], |row| {
            Ok(SessionPresence {
                provider: row.get(0)?,
                session_id: row.get(1)?,
                occurred_at: row.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(HistoryRows {
        events,
        presence,
        truncated,
    })
}

/// What the history needs over the last `days` days (at most 400).
#[tauri::command]
fn load_history(state: tauri::State<'_, CollectorState>, days: i64) -> Result<HistoryRows, String> {
    // Same RFC 3339 shape as the stored `occurred_at`, so text comparison orders correctly.
    let since = (chrono::Utc::now() - chrono::Duration::days(days.clamp(1, 400))).to_rfc3339();
    let database = state.database.lock().map_err(|error| error.to_string())?;
    history_rows(&database, &since).map_err(|error| error.to_string())
}

/// One stored session of an agent, summed up by the database.
#[derive(Debug, PartialEq, Serialize)]
struct PastSession {
    session_id: String,
    /// The most recent project folder the session reported.
    project_path: Option<String>,
    started_at: String,
    last_at: String,
    events: i64,
    /// Calls observed: per tool, the larger of starts and ends, as in the live summary.
    tool_calls: i64,
    failures: i64,
}

#[derive(Debug, Serialize)]
struct AgentSessions {
    sessions: Vec<PastSession>,
    /// The events of these sessions that carry tokens, to add up tokens and cost.
    usage: Vec<SessionEvent>,
}

/// The `limit` most recent sessions of one agent, from the local database.
fn agent_sessions_rows(
    connection: &Connection,
    provider: &str,
    limit: i64,
) -> rusqlite::Result<AgentSessions> {
    let mut statement = connection.prepare(
        "SELECT session_id, \
           (SELECT project_path FROM session_events AS inner_row WHERE inner_row.provider = ?1 \
              AND inner_row.session_id = outer_row.session_id AND inner_row.project_path IS NOT NULL \
              ORDER BY inner_row.occurred_at DESC LIMIT 1), \
           MIN(occurred_at), MAX(occurred_at), COUNT(*), SUM(kind = 'ToolFailed') \
         FROM session_events AS outer_row WHERE provider = ?1 \
         GROUP BY session_id ORDER BY MAX(occurred_at) DESC LIMIT ?2",
    )?;
    let mut sessions = statement
        .query_map(params![provider, limit], |row| {
            Ok(PastSession {
                session_id: row.get(0)?,
                project_path: row.get(1)?,
                started_at: row.get(2)?,
                last_at: row.get(3)?,
                events: row.get(4)?,
                tool_calls: 0,
                failures: row.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut calls = connection.prepare(
        "SELECT COALESCE(SUM(calls), 0) FROM (SELECT MAX(SUM(kind = 'ToolStarted'), SUM(kind <> 'ToolStarted')) AS calls \
         FROM session_events WHERE provider = ?1 AND session_id = ?2 \
           AND kind IN ('ToolStarted', 'ToolFinished', 'ToolFailed') \
         GROUP BY json_extract(payload, '$.tool_name'))",
    )?;
    let mut usage_statement = connection.prepare(
        "SELECT payload FROM session_events WHERE provider = ?1 AND session_id = ?2 AND ( \
           json_extract(payload, '$.input_tokens') IS NOT NULL \
           OR json_extract(payload, '$.output_tokens') IS NOT NULL \
           OR json_extract(payload, '$.cache_read_tokens') IS NOT NULL \
           OR json_extract(payload, '$.cache_write_tokens') IS NOT NULL) \
         ORDER BY occurred_at, event_id",
    )?;
    let mut payloads = Vec::new();
    for session in &mut sessions {
        session.tool_calls =
            calls.query_row(params![provider, session.session_id], |row| row.get(0))?;
        for payload in usage_statement.query_map(params![provider, session.session_id], |row| {
            row.get::<_, String>(0)
        })? {
            payloads.push(payload?);
        }
    }
    Ok(AgentSessions {
        sessions,
        usage: decode_stored_events(&payloads),
    })
}

/// The most recent sessions of one agent (at most 50), for its detail panel.
#[tauri::command]
fn agent_sessions(
    state: tauri::State<'_, CollectorState>,
    provider: String,
    limit: Option<i64>,
) -> Result<AgentSessions, String> {
    let database = state.database.lock().map_err(|error| error.to_string())?;
    agent_sessions_rows(&database, &provider, limit.unwrap_or(20).clamp(1, 50))
        .map_err(|error| error.to_string())
}

/// Decodes stored payloads, skipping any row this version cannot read: one such row
/// must not hide every other event, which would leave the race empty over a full database.
fn decode_stored_events(payloads: &[String]) -> Vec<SessionEvent> {
    payloads
        .iter()
        .filter_map(
            |payload| match serde_json::from_str::<SessionEvent>(payload) {
                Ok(event) => Some(event),
                Err(error) => {
                    eprintln!("session_events: unreadable row skipped: {error}");
                    None
                }
            },
        )
        .collect()
}

#[tauri::command]
fn export_session_history(
    state: tauri::State<'_, CollectorState>,
    path: String,
) -> Result<usize, String> {
    let output_path = PathBuf::from(path);
    if !output_path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("json"))
    {
        return Err("Choisis un fichier avec l’extension .json.".into());
    }
    let database = state.database.lock().map_err(|error| error.to_string())?;
    let mut statement = database
        .prepare("SELECT payload FROM session_events ORDER BY occurred_at ASC, event_id ASC")
        .map_err(|error| error.to_string())?;
    let mut rows = statement.query([]).map_err(|error| error.to_string())?;
    let file = fs::File::create(&output_path).map_err(|error| error.to_string())?;
    let mut writer = BufWriter::new(file);
    writer.write_all(b"[").map_err(|error| error.to_string())?;
    let mut count = 0usize;
    while let Some(row) = rows.next().map_err(|error| error.to_string())? {
        let payload: String = row.get(0).map_err(|error| error.to_string())?;
        if count > 0 {
            writer.write_all(b",").map_err(|error| error.to_string())?;
        }
        writer
            .write_all(payload.as_bytes())
            .map_err(|error| error.to_string())?;
        count += 1;
    }
    writer.write_all(b"]").map_err(|error| error.to_string())?;
    writer.flush().map_err(|error| error.to_string())?;
    Ok(count)
}

/// L'etat git du dossier d'un agent : branche, avance/retard, fichiers modifies. Lecture seule.
#[tauri::command]
async fn repository_snapshot(path: String) -> Result<git_info::RepositorySnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || git_info::snapshot(&path))
        .await
        .map_err(|error| error.to_string())?
}

/// Ouvre le dossier d'un agent dans le gestionnaire de fichiers (jamais un fichier).
#[tauri::command]
fn reveal_in_file_manager(path: String) -> Result<(), String> {
    git_info::reveal(&path)
}

#[tauri::command]
fn collector_status(state: tauri::State<'_, CollectorState>) -> String {
    state
        .status
        .lock()
        .map(|status| status.clone())
        .unwrap_or_else(|_| "error: état indisponible".into())
}

fn persist_event(state: &CollectorState, event: SessionEvent) -> bool {
    let Ok(payload) = serde_json::to_string(&event) else {
        return false;
    };
    let Ok(database) = state.database.lock() else {
        return false;
    };
    if database.execute("INSERT INTO session_events(event_id, session_id, occurred_at, provider, kind, project_path, payload) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) ON CONFLICT(event_id) DO UPDATE SET occurred_at=excluded.occurred_at, provider=excluded.provider, kind=excluded.kind, project_path=excluded.project_path, payload=excluded.payload", params![event.event_id.to_string(), event.session_id, event.occurred_at.to_rfc3339(), event.provider.key(), format!("{:?}", event.kind), event.project_path, payload]).unwrap_or(0) == 0 {
        return false;
    }
    drop(database);
    state
        .stats
        .record(event.provider.key(), event.occurred_at, chrono::Utc::now());
    let _ = state.app.emit("session-event", event);
    true
}

async fn receive_claude_hook(
    State(state): State<CollectorState>,
    ConnectInfo(_peer): ConnectInfo<SocketAddr>,
    request: Request,
) -> impl IntoResponse {
    let authorized = bearer_matches(request.headers(), &state.token);
    if !authorized {
        state.stats.reject();
        return StatusCode::UNAUTHORIZED;
    }

    let Ok(body) = axum::body::to_bytes(request.into_body(), 64 * 1024).await else {
        return StatusCode::PAYLOAD_TOO_LARGE;
    };
    let Ok(input) = serde_json::from_slice::<Value>(&body) else {
        state.stats.reject();
        return StatusCode::BAD_REQUEST;
    };
    let Some(event) = normalize_claude_event(
        &input,
        state.capture_prompts.load(Ordering::Relaxed),
        state.capture_commands.load(Ordering::Relaxed),
        state.capture_errors.load(Ordering::Relaxed),
    ) else {
        return StatusCode::NO_CONTENT;
    };
    if !persist_event(&state, event) {
        return StatusCode::INTERNAL_SERVER_ERROR;
    }
    StatusCode::NO_CONTENT
}

/// Claude Code's status line input: keeps only the usage limits, answers the text to display.
async fn receive_claude_statusline(
    State(state): State<CollectorState>,
    request: Request,
) -> axum::response::Response {
    let authorized = bearer_matches(request.headers(), &state.token);
    if !authorized {
        state.stats.reject();
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let Ok(body) = axum::body::to_bytes(request.into_body(), 64 * 1024).await else {
        return StatusCode::PAYLOAD_TOO_LARGE.into_response();
    };
    let Ok(input) = serde_json::from_slice::<Value>(&body) else {
        state.stats.reject();
        return StatusCode::BAD_REQUEST.into_response();
    };
    if let Some(snapshot) = limits::parse_claude_statusline(&input, chrono::Utc::now())
        && limits::record(&state.limits, snapshot)
    {
        let _ = state.app.emit("limits-updated", ());
    }
    (
        [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
        limits::statusline_text(&input),
    )
        .into_response()
}

/// Whether a request carries this installation's token. The comparison does not stop at the first
/// differing byte, so its duration says nothing about the token.
fn bearer_matches(headers: &axum::http::HeaderMap, token: &str) -> bool {
    let Some(value) = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
    else {
        return false;
    };
    let expected = format!("Bearer {token}");
    value.len() == expected.len()
        && value
            .bytes()
            .zip(expected.bytes())
            .fold(0u8, |difference, (a, b)| difference | (a ^ b))
            == 0
}

/// Reads `minutes=N` from a query string (1 to 1440, 60 by default).
fn activity_window(query: Option<&str>) -> i64 {
    query
        .unwrap_or("")
        .split('&')
        .find_map(|pair| pair.strip_prefix("minutes="))
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(60)
        .clamp(1, 1440)
}

/// `GET /v1/activity`: read-only summary of the recent sessions, for local tools (the MCP server
/// in `tools/mcp`). Same token as the hooks; a request coming from a web page is refused.
async fn read_activity(
    State(state): State<CollectorState>,
    request: Request,
) -> axum::response::Response {
    let headers = request.headers();
    let authorized = bearer_matches(headers, &state.token);
    if !authorized {
        state.stats.reject();
        return StatusCode::UNAUTHORIZED.into_response();
    }
    // Browsers always send `Origin` on cross-site requests: no web page may read this.
    if headers.contains_key(header::ORIGIN) {
        state.stats.reject();
        return StatusCode::FORBIDDEN.into_response();
    }
    let minutes = activity_window(request.uri().query());
    let now = chrono::Utc::now();
    let since = (now - chrono::Duration::minutes(minutes)).to_rfc3339();
    let payloads = {
        let Ok(database) = state.database.lock() else {
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        };
        let Ok(mut statement) = database.prepare(
            "SELECT payload FROM session_events WHERE occurred_at >= ?1 ORDER BY occurred_at DESC LIMIT 20000",
        ) else {
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        };
        let rows = statement
            .query_map(params![since], |row| row.get::<_, String>(0))
            .map(|rows| rows.filter_map(Result::ok).collect::<Vec<String>>());
        match rows {
            Ok(rows) => rows,
            Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
        }
    };
    let sessions = activity::summarize(&decode_stored_events(&payloads));
    axum::Json(json!({
        "generated_at": now,
        "window_minutes": minutes,
        "sessions": sessions,
        "limits": limits::all(&state.limits),
    }))
    .into_response()
}

#[derive(Serialize)]
struct DatabaseDiagnostic {
    path: String,
    size_bytes: u64,
    events: i64,
    oldest: Option<String>,
    newest: Option<String>,
    retention_days: i64,
}

#[derive(Serialize)]
struct Diagnostic {
    version: String,
    os: &'static str,
    arch: &'static str,
    collector: String,
    started_at: chrono::DateTime<chrono::Utc>,
    home: String,
    database: DatabaseDiagnostic,
    providers: Vec<diagnostics::ProviderStats>,
    rejected_requests: u64,
}

/// Everything needed to understand why an agent does not show up, with the home folder hidden.
#[tauri::command]
fn diagnostic(state: tauri::State<'_, CollectorState>) -> Diagnostic {
    let home = state
        .app
        .path()
        .home_dir()
        .map(|path| path.display().to_string())
        .unwrap_or_default();
    let file = state.data_dir.join("observer.sqlite3");
    // The write-ahead log holds recent writes until they are merged into the file.
    let size_bytes = ["", "-wal"]
        .iter()
        .filter_map(|suffix| {
            fs::metadata(format!("{}{suffix}", file.display()))
                .ok()
                .map(|metadata| metadata.len())
        })
        .sum();
    let (events, oldest, newest, retention) = state
        .database
        .lock()
        .ok()
        .map(|database| {
            let (events, oldest, newest) = database
                .query_row(
                    "SELECT COUNT(*), MIN(occurred_at), MAX(occurred_at) FROM session_events",
                    [],
                    |row| {
                        Ok((
                            row.get::<_, i64>(0)?,
                            row.get::<_, Option<String>>(1)?,
                            row.get::<_, Option<String>>(2)?,
                        ))
                    },
                )
                .unwrap_or((0, None, None));
            (events, oldest, newest, retention_days(&database))
        })
        .unwrap_or((0, None, None, 0));
    Diagnostic {
        version: state.app.package_info().version.to_string(),
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
        collector: state
            .status
            .lock()
            .map(|status| status.clone())
            .unwrap_or_default(),
        started_at: state.started_at,
        database: DatabaseDiagnostic {
            path: diagnostics::anonymize(&file.display().to_string(), &home),
            size_bytes,
            events,
            oldest,
            newest,
            retention_days: retention,
        },
        providers: state.stats.providers(),
        rejected_requests: state.stats.rejected(),
        home,
    }
}

/// Whether this build can update itself (see `updates_configured`).
struct UpdatesEnabled(bool);

/// True when the build carries an updater public key and at least one address to check.
fn updates_configured(plugins: &HashMap<String, serde_json::Value>) -> bool {
    let Some(updater) = plugins.get("updater") else {
        return false;
    };
    let pubkey = updater
        .get("pubkey")
        .and_then(serde_json::Value::as_str)
        .is_some_and(|key| !key.trim().is_empty());
    let endpoints = updater
        .get("endpoints")
        .and_then(serde_json::Value::as_array)
        .is_some_and(|list| {
            list.iter()
                .any(|item| item.as_str().is_some_and(|url| !url.trim().is_empty()))
        });
    pubkey && endpoints
}

#[tauri::command]
fn updates_available(updates: tauri::State<'_, UpdatesEnabled>) -> bool {
    updates.0
}

/// The interface reports how many agents need you; the tray icon only shows it.
#[tauri::command]
fn set_tray_status(
    app: tauri::AppHandle,
    need_you: u32,
    status: String,
    open: String,
    quit: String,
) {
    tray::update(
        &app,
        tray::TrayStatus {
            need_you,
            status: &status,
            open: &open,
            quit: &quit,
        },
    );
}

#[tauri::command]
fn subscription_limits(state: tauri::State<'_, CollectorState>) -> Vec<limits::LimitSnapshot> {
    limits::all(&state.limits)
}

async fn receive_cursor_hook(
    State(state): State<CollectorState>,
    request: Request,
) -> impl IntoResponse {
    let authorized = bearer_matches(request.headers(), &state.token);
    if !authorized {
        state.stats.reject();
        return StatusCode::UNAUTHORIZED;
    }
    let Ok(body) = axum::body::to_bytes(request.into_body(), 64 * 1024).await else {
        return StatusCode::PAYLOAD_TOO_LARGE;
    };
    let Ok(input) = serde_json::from_slice::<Value>(&body) else {
        state.stats.reject();
        return StatusCode::BAD_REQUEST;
    };
    let Some(event) =
        normalize_cursor_event(&input, state.capture_commands.load(Ordering::Relaxed))
    else {
        return StatusCode::NO_CONTENT;
    };
    if !persist_event(&state, event) {
        return StatusCode::INTERNAL_SERVER_ERROR;
    }
    StatusCode::NO_CONTENT
}

fn normalize_cursor_event(input: &Value, capture_commands: bool) -> Option<SessionEvent> {
    let event_name = input.get("hook_event_name")?.as_str()?;
    let session_id = input
        .get("conversation_id")
        .or_else(|| input.get("session_id"))?
        .as_str()?
        .to_owned();
    let kind = match event_name {
        "sessionStart" => EventKind::SessionStarted,
        "sessionEnd" => EventKind::SessionEnded,
        "postToolUse" | "afterShellExecution" => EventKind::ToolFinished,
        "postToolUseFailure" => EventKind::ToolFailed,
        "afterFileEdit" => EventKind::FileChanged,
        "stop" => EventKind::Checkpoint,
        _ => return None,
    };
    let mut event = SessionEvent::new(session_id, Provider::Cursor, kind);
    event.project_path = input
        .get("cwd")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .or_else(|| {
            input
                .get("workspace_roots")
                .and_then(Value::as_array)
                .and_then(|roots| roots.first())
                .and_then(Value::as_str)
                .map(str::to_owned)
        });
    event.model = input
        .get("model_id")
        .or_else(|| input.get("model"))
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(|value| Sourced {
            value: value.to_owned(),
            origin: DataOrigin::Provider,
        });
    event.tool_name = input
        .get("tool_name")
        .and_then(Value::as_str)
        .map(str::to_owned);
    event.file_path = input
        .get("file_path")
        .and_then(Value::as_str)
        .map(str::to_owned);
    let tool_input = input.get("tool_input");
    event.file_path = event.file_path.or_else(|| {
        tool_input
            .and_then(|value| value.get("file_path").or_else(|| value.get("path")))
            .and_then(Value::as_str)
            .map(str::to_owned)
    });
    if capture_commands
        && matches!(
            event_name,
            "afterShellExecution" | "postToolUse" | "postToolUseFailure"
        )
    {
        event.command = input
            .get("command")
            .or_else(|| tool_input.and_then(|value| value.get("command")))
            .and_then(Value::as_str)
            .map(str::to_owned);
    }
    event.duration_ms = input
        .get("duration")
        .or_else(|| input.get("duration_ms"))
        .and_then(Value::as_u64)
        .map(|value| Sourced {
            value,
            origin: DataOrigin::Provider,
        });
    event.outcome = input
        .get("status")
        .or_else(|| input.get("failure_type"))
        .and_then(Value::as_str)
        .map(str::to_owned);
    // Never retain Cursor tool outputs, transcript paths, user identity, or thinking text.
    Some(event)
}

fn normalize_claude_event(
    input: &Value,
    capture_prompts: bool,
    capture_commands: bool,
    capture_errors: bool,
) -> Option<SessionEvent> {
    let event_name = input.get("hook_event_name")?.as_str()?;
    let session_id = input.get("session_id")?.as_str()?.to_owned();
    let kind = match event_name {
        "UserPromptSubmit" => EventKind::UserMessage,
        "PreToolUse" => EventKind::ToolStarted,
        "PostToolUse" => EventKind::ToolFinished,
        "PostToolUseFailure" => EventKind::ToolFailed,
        "Stop" => EventKind::Checkpoint,
        // Claude asks for a permission or waits for the user: not the end of a turn.
        "Notification" => EventKind::Checkpoint,
        "SessionEnd" => EventKind::SessionEnded,
        _ => return None,
    };
    let mut event = SessionEvent::new(session_id, Provider::ClaudeCode, kind);
    event.project_path = input.get("cwd").and_then(Value::as_str).map(str::to_owned);
    event.tool_name = input
        .get("tool_name")
        .and_then(Value::as_str)
        .map(str::to_owned);
    let tool_input = input.get("tool_input");
    event.file_path = tool_input
        .and_then(|value| value.get("file_path").or_else(|| value.get("path")))
        .and_then(Value::as_str)
        .map(str::to_owned);
    if capture_prompts && event_name == "UserPromptSubmit" {
        event.content = input
            .get("prompt")
            .and_then(Value::as_str)
            .map(str::to_owned);
    }
    if capture_commands && matches!(event.tool_name.as_deref(), Some("Bash" | "PowerShell")) {
        event.command = tool_input
            .and_then(|value| value.get("command"))
            .and_then(Value::as_str)
            .map(str::to_owned);
    }
    event.outcome = input.get("error").and_then(Value::as_str).map(|message| {
        // The message itself is kept only when the user asked for it, and always cleaned.
        if capture_errors {
            format!("error: {}", redact::redact_error(message))
        } else {
            "failed".to_owned()
        }
    });
    if event_name == "Notification" {
        // Claude's own system message ("Claude needs your permission to use Bash"), never user text.
        let message: String = input
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("")
            .chars()
            .take(160)
            .collect();
        event.outcome = Some(format!("attention:{message}"));
    }
    if event_name == "PostToolUse" && event.tool_name.as_deref() == Some("Agent") {
        let response = input.get("tool_response");
        if let Some(usage) = response.and_then(|value| value.get("usage")) {
            event.input_tokens = usage
                .get("input_tokens")
                .and_then(Value::as_u64)
                .map(|value| Sourced {
                    value,
                    origin: DataOrigin::Provider,
                });
            event.output_tokens = usage
                .get("output_tokens")
                .and_then(Value::as_u64)
                .map(|value| Sourced {
                    value,
                    origin: DataOrigin::Provider,
                });
        }
        event.model = response
            .and_then(|value| value.get("resolvedModel"))
            .and_then(Value::as_str)
            .map(|value| Sourced {
                value: value.to_owned(),
                origin: DataOrigin::Provider,
            });
        event.duration_ms = response
            .and_then(|value| value.get("totalDurationMs"))
            .and_then(Value::as_u64)
            .map(|value| Sourced {
                value,
                origin: DataOrigin::Provider,
            });
    }
    // Prompt and shell-command retention is separately opt-in; tool outputs and
    // transcript paths are always excluded.
    Some(event)
}

fn main() {
    tauri::Builder::default()
        // Must be registered first. A second launch would lose the collector port and
        // silently observe nothing: bring the running window forward instead.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            tray::show_main_window(app);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // Updates are switched on only by a release built with a signing key, which writes the
            // public key and the address of `latest.json` into `plugins.updater`.
            let updates = updates_configured(&app.config().plugins.0)
                && match app
                    .handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())
                {
                    Ok(()) => true,
                    Err(error) => {
                        eprintln!("updates unavailable: {error}");
                        false
                    }
                };
            app.manage(UpdatesEnabled(updates));
            let config_dir = app.path().app_config_dir()?;
            fs::create_dir_all(&config_dir)?;
            let token_path = config_dir.join("collector-token");
            let token = fs::read_to_string(&token_path).unwrap_or_else(|_| {
                let token = Uuid::new_v4().to_string();
                let _ = fs::write(&token_path, &token);
                token
            });
            let data_dir = app.path().app_local_data_dir()?;
            fs::create_dir_all(&data_dir)?;
            let connection = Connection::open(data_dir.join("observer.sqlite3"))?;
            connection.execute_batch(SCHEMA)?;
            // Old events go first, before anything reads the database.
            let _ = purge_expired_events(&connection, retention_days(&connection));
            let preference = |key: &str| -> bool {
                connection
                    .query_row("SELECT value FROM preferences WHERE key=?1", [key], |row| {
                        row.get::<_, i64>(0)
                    })
                    .optional()
                    .ok()
                    .flatten()
                    .unwrap_or(0)
                    != 0
            };
            let capture_prompts = preference("capture_prompts");
            let capture_commands = preference("capture_commands");
            let capture_errors = preference("capture_errors");
            redact::keep_messages(capture_errors);
            let state = CollectorState {
                app: app.handle().clone(),
                token,
                database: Arc::new(Mutex::new(connection)),
                status: Arc::new(Mutex::new("starting".into())),
                capture_prompts: Arc::new(AtomicBool::new(capture_prompts)),
                capture_commands: Arc::new(AtomicBool::new(capture_commands)),
                capture_errors: Arc::new(AtomicBool::new(capture_errors)),
                limits: Arc::default(),
                stats: Arc::default(),
                data_dir: data_dir.clone(),
                started_at: chrono::Utc::now(),
            };
            let port = 43821;
            let address = SocketAddr::from(([127, 0, 0, 1], port));
            let router = Router::new()
                .route("/claude-hook", post(receive_claude_hook))
                .route("/cursor-hook", post(receive_cursor_hook))
                .route("/claude-statusline", post(receive_claude_statusline))
                .route("/v1/activity", get(read_activity))
                .with_state(state.clone());
            let handle = app.handle().clone();
            let status = state.status.clone();
            tauri::async_runtime::spawn(async move {
                match tokio::net::TcpListener::bind(address).await {
                    Ok(listener) => {
                        if let Ok(mut value) = status.lock() {
                            *value = "listening".into();
                        }
                        let _ = axum::serve(
                            listener,
                            router.into_make_service_with_connect_info::<SocketAddr>(),
                        )
                        .await;
                    }
                    Err(error) => {
                        if let Ok(mut value) = status.lock() {
                            *value = format!("error: {error}");
                        }
                        let _ = handle.emit("collector-error", error.to_string());
                    }
                }
            });
            let claude_state = state.clone();
            claude_transcripts::spawn(claude_transcripts::projects_root(), move |event| {
                persist_event(&claude_state, event);
            });
            let codex_state = state.clone();
            let codex_limits = state.clone();
            codex_rollout::spawn(
                codex_rollout::sessions_root(),
                state.capture_prompts.clone(),
                state.capture_commands.clone(),
                move |event| {
                    persist_event(&codex_state, event);
                },
                move |snapshot| {
                    if limits::record(&codex_limits.limits, snapshot) {
                        let _ = codex_limits.app.emit("limits-updated", ());
                    }
                },
            );
            // Gemini CLI is not observed any more (Antigravity replaces it): nothing of it is read.
            let copilot_state = state.clone();
            copilot_sessions::spawn(
                copilot_sessions::sessions_root(),
                state.capture_prompts.clone(),
                state.capture_commands.clone(),
                move |event| {
                    persist_event(&copilot_state, event);
                },
            );
            let antigravity_state = state.clone();
            antigravity_sessions::spawn(
                antigravity_sessions::data_root(),
                state.capture_prompts.clone(),
                state.capture_commands.clone(),
                move |event| {
                    persist_event(&antigravity_state, event);
                },
            );
            let qwen_state = state.clone();
            qwen_sessions::spawn(
                qwen_sessions::projects_root(),
                state.capture_prompts.clone(),
                state.capture_commands.clone(),
                move |event| {
                    persist_event(&qwen_state, event);
                },
            );
            {
                use std::time::Duration;
                let every = Duration::from_millis(900);
                let start = |monitor: Box<dyn tail::Poll>, every: Duration| {
                    let reader_state = state.clone();
                    tail::spawn(
                        monitor,
                        every,
                        state.capture_prompts.clone(),
                        state.capture_commands.clone(),
                        move |event| {
                            persist_event(&reader_state, event);
                        },
                    );
                };
                start(
                    Box::new(gemini_sessions::GeminiMonitor::new(gemini_sessions::roots())),
                    every,
                );
                start(
                    Box::new(pi_sessions::PiMonitor::new(
                        session_events::Provider::Pi,
                        pi_sessions::pi_roots(),
                    )),
                    every,
                );
                start(
                    Box::new(pi_sessions::PiMonitor::new(
                        session_events::Provider::Omp,
                        pi_sessions::omp_roots(),
                    )),
                    every,
                );
                start(
                    Box::new(kimi_sessions::KimiMonitor::new(kimi_sessions::home())),
                    every,
                );
                start(
                    Box::new(goose_sessions::GooseMonitor::new(
                        goose_sessions::database_paths(),
                    )),
                    Duration::from_secs(2),
                );
                start(
                    Box::new(crush_sessions::CrushMonitor::new(
                        crush_sessions::projects_file(),
                    )),
                    Duration::from_secs(2),
                );
                start(
                    Box::new(zed_threads::ZedMonitor::new(zed_threads::database_path())),
                    Duration::from_secs(2),
                );
                start(
                    Box::<process_watch::ProcessWatch>::default(),
                    Duration::from_secs(4),
                );
            }
            let reasonix_state = state.clone();
            reasonix_sessions::spawn(
                reasonix_sessions::projects_root(),
                state.capture_prompts.clone(),
                state.capture_commands.clone(),
                move |event| {
                    persist_event(&reasonix_state, event);
                },
            );
            let continue_state = state.clone();
            continue_sessions::spawn(continue_sessions::data_root(), move |event| {
                persist_event(&continue_state, event);
            });
            let hermes_state = state.clone();
            hermes_sessions::spawn(
                state.capture_prompts.clone(),
                state.capture_commands.clone(),
                move |event| {
                    persist_event(&hermes_state, event);
                },
            );
            let opencode_state = state.clone();
            let copilot_chat_state = state.clone();
            copilot_chat::spawn(state.capture_prompts.clone(), move |event| {
                persist_event(&copilot_chat_state, event);
            });
            opencode_sessions::spawn(
                state.capture_prompts.clone(),
                state.capture_commands.clone(),
                move |event| {
                    persist_event(&opencode_state, event);
                },
            );
            let purge_database = state.database.clone();
            std::thread::spawn(move || {
                loop {
                    std::thread::sleep(PURGE_INTERVAL);
                    if let Ok(database) = purge_database.lock() {
                        let _ = purge_expired_events(&database, retention_days(&database));
                    }
                }
            });
            app.manage(state);
            // The tray icon is a convenience: if the system cannot show one (on Linux the
            // appindicator library is loaded at run time), the app goes on without it.
            let handle = app.handle().clone();
            match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| tray::install(&handle)))
            {
                Ok(Ok(())) => {}
                Ok(Err(error)) => eprintln!("tray icon unavailable: {error}"),
                Err(_) => eprintln!("tray icon unavailable on this system"),
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            claude_setup,
            codex_setup,
            antigravity_setup,
            copilot_setup,
            configured_models,
            opencode_setup,
            qwen_setup,
            source_setup,
            continue_setup,
            hermes_setup,
            reasonix_setup,
            cursor_setup,
            load_session_events,
            load_history,
            agent_sessions,
            export_session_history,
            collector_status,
            repository_snapshot,
            reveal_in_file_manager,
            subscription_limits,
            set_tray_status,
            diagnostic,
            updates_available,
            update_capture_policy,
            retention_policy,
            update_retention_policy,
            clear_session_history,
            capture_errors,
            update_capture_errors
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Agent Observer");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_exact_token_is_accepted() {
        let mut headers = axum::http::HeaderMap::new();
        assert!(!bearer_matches(&headers, "abc"));
        headers.insert(header::AUTHORIZATION, "Bearer abc".parse().unwrap());
        assert!(bearer_matches(&headers, "abc"));
        assert!(!bearer_matches(&headers, "abd"));
        assert!(!bearer_matches(&headers, "ab"));
        headers.insert(header::AUTHORIZATION, "Bearer abcd".parse().unwrap());
        assert!(!bearer_matches(&headers, "abc"));
        headers.insert(header::AUTHORIZATION, "abc".parse().unwrap());
        assert!(!bearer_matches(&headers, "abc"));
    }

    #[test]
    fn updates_need_a_public_key_and_an_address() {
        let config = |value: serde_json::Value| -> HashMap<String, serde_json::Value> {
            serde_json::from_value(value).unwrap()
        };
        assert!(!updates_configured(&config(json!({}))));
        assert!(!updates_configured(&config(
            json!({ "updater": { "pubkey": "", "endpoints": ["https://x/latest.json"] } })
        )));
        assert!(!updates_configured(&config(
            json!({ "updater": { "pubkey": "abc", "endpoints": [] } })
        )));
        assert!(!updates_configured(&config(
            json!({ "updater": { "pubkey": "abc" } })
        )));
        assert!(updates_configured(&config(
            json!({ "updater": { "pubkey": "abc", "endpoints": ["https://x/latest.json"] } })
        )));
    }

    #[test]
    fn activity_window_is_bounded() {
        assert_eq!(activity_window(None), 60);
        assert_eq!(activity_window(Some("minutes=15")), 15);
        assert_eq!(activity_window(Some("x=1&minutes=99999")), 1440);
        assert_eq!(activity_window(Some("minutes=-3")), 1);
        assert_eq!(activity_window(Some("minutes=abc")), 60);
    }

    #[test]
    fn an_unreadable_stored_row_does_not_hide_the_others() {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch(SCHEMA).unwrap();
        let mut event = normalize_cursor_event(
            &json!({ "hook_event_name": "postToolUse", "conversation_id": "c", "generation_id": "g", "tool_name": "Shell", "tool_input": {} }),
            false,
        )
        .unwrap();
        event.provider = Provider::Codex;
        let readable = serde_json::to_string(&event).unwrap();
        let payloads = vec![
            "{\"provider\":\"unknown-agent\",\"kind\":\"from_the_future\"}".to_owned(),
            readable,
            "not json".to_owned(),
        ];
        let decoded = decode_stored_events(&payloads);
        assert_eq!(decoded.len(), 1);
        assert_eq!(decoded[0].provider, Provider::Codex);
    }

    #[test]
    fn history_keeps_usage_and_failures_and_counts_sessions_by_quarter_hour() {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch(SCHEMA).unwrap();
        let sourced = |value| {
            Some(Sourced {
                value,
                origin: DataOrigin::Provider,
            })
        };
        let at = |text: &str| {
            chrono::DateTime::parse_from_rfc3339(text)
                .unwrap()
                .with_timezone(&chrono::Utc)
        };
        let mut usage = SessionEvent::new("s1", Provider::Codex, EventKind::ModelUsage);
        usage.occurred_at = at("2026-11-08T10:05:00Z");
        usage.input_tokens = sourced(10);
        // Tokens reported on another kind of event count too.
        let mut message = SessionEvent::new("s1", Provider::Codex, EventKind::AssistantMessage);
        message.occurred_at = at("2026-11-08T10:06:00Z");
        message.cache_read_tokens = sourced(4);
        let mut failure = SessionEvent::new("s1", Provider::Codex, EventKind::ToolFailed);
        failure.occurred_at = at("2026-11-08T10:20:00Z");
        let mut read = SessionEvent::new("s2", Provider::ClaudeCode, EventKind::FileRead);
        read.occurred_at = at("2026-11-08T10:59:59.5Z");
        let mut started = SessionEvent::new("s2", Provider::ClaudeCode, EventKind::ToolStarted);
        started.occurred_at = at("2026-11-08T10:46:00Z");
        let mut old = SessionEvent::new("s3", Provider::Codex, EventKind::ModelUsage);
        old.occurred_at = at("2026-10-01T10:00:00Z");
        old.output_tokens = sourced(5);
        for event in [&usage, &message, &failure, &read, &started, &old] {
            connection
                .execute(
                    "INSERT INTO session_events VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6)",
                    params![
                        event.event_id.to_string(),
                        event.session_id,
                        event.occurred_at.to_rfc3339(),
                        event.provider.key(),
                        format!("{:?}", event.kind),
                        serde_json::to_string(event).unwrap()
                    ],
                )
                .unwrap();
        }
        let rows = history_rows(&connection, &at("2026-11-01T00:00:00Z").to_rfc3339()).unwrap();
        assert!(!rows.truncated);
        let kinds: Vec<EventKind> = rows.events.iter().map(|event| event.kind).collect();
        assert_eq!(
            kinds,
            vec![
                EventKind::ToolFailed,
                EventKind::AssistantMessage,
                EventKind::ModelUsage
            ]
        );
        let mut presence: Vec<(String, String, String)> = rows
            .presence
            .into_iter()
            .map(|row| (row.provider, row.session_id, row.occurred_at))
            .collect();
        presence.sort();
        assert_eq!(
            presence,
            vec![
                (
                    "claude_code".into(),
                    "s2".into(),
                    "2026-11-08T10:46:00+00:00".into()
                ),
                (
                    "codex".into(),
                    "s1".into(),
                    "2026-11-08T10:05:00+00:00".into()
                ),
                (
                    "codex".into(),
                    "s1".into(),
                    "2026-11-08T10:20:00+00:00".into()
                ),
            ],
            "one row per session and quarter of an hour, the old session left out"
        );
    }

    #[test]
    fn past_sessions_are_summed_up_newest_first() {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch(SCHEMA).unwrap();
        let at = |text: &str| {
            chrono::DateTime::parse_from_rfc3339(text)
                .unwrap()
                .with_timezone(&chrono::Utc)
        };
        let event = |session: &str,
                     kind: EventKind,
                     when: &str,
                     tool: Option<&str>,
                     project: Option<&str>| {
            let mut event = SessionEvent::new(session, Provider::Codex, kind);
            event.occurred_at = at(when);
            event.tool_name = tool.map(str::to_owned);
            event.project_path = project.map(str::to_owned);
            event
        };
        let mut usage = event(
            "old",
            EventKind::ModelUsage,
            "2026-11-01T10:10:00Z",
            None,
            None,
        );
        usage.output_tokens = Some(Sourced {
            value: 7,
            origin: DataOrigin::Provider,
        });
        let mut other = SessionEvent::new("x", Provider::ClaudeCode, EventKind::ToolStarted);
        other.occurred_at = at("2026-11-09T00:00:00Z");
        let events = [
            event(
                "old",
                EventKind::SessionStarted,
                "2026-11-01T10:00:00Z",
                None,
                Some("/work/a"),
            ),
            // Shell: a start and an end per call (2 calls); Read: ends only (1 call).
            event(
                "old",
                EventKind::ToolStarted,
                "2026-11-01T10:01:00Z",
                Some("shell"),
                Some("/work/a"),
            ),
            event(
                "old",
                EventKind::ToolFinished,
                "2026-11-01T10:02:00Z",
                Some("shell"),
                None,
            ),
            event(
                "old",
                EventKind::ToolStarted,
                "2026-11-01T10:03:00Z",
                Some("shell"),
                Some("/work/b"),
            ),
            event(
                "old",
                EventKind::ToolFailed,
                "2026-11-01T10:04:00Z",
                Some("shell"),
                None,
            ),
            event(
                "old",
                EventKind::ToolFinished,
                "2026-11-01T10:05:00Z",
                Some("read"),
                None,
            ),
            usage,
            event(
                "new",
                EventKind::SessionStarted,
                "2026-11-08T09:00:00Z",
                None,
                None,
            ),
            other,
        ];
        for event in &events {
            connection
                .execute(
                    "INSERT INTO session_events VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![
                        event.event_id.to_string(),
                        event.session_id,
                        event.occurred_at.to_rfc3339(),
                        event.provider.key(),
                        format!("{:?}", event.kind),
                        event.project_path,
                        serde_json::to_string(event).unwrap()
                    ],
                )
                .unwrap();
        }
        let rows = agent_sessions_rows(&connection, "codex", 20).unwrap();
        assert_eq!(
            rows.sessions,
            vec![
                PastSession {
                    session_id: "new".into(),
                    project_path: None,
                    started_at: "2026-11-08T09:00:00+00:00".into(),
                    last_at: "2026-11-08T09:00:00+00:00".into(),
                    events: 1,
                    tool_calls: 0,
                    failures: 0,
                },
                PastSession {
                    session_id: "old".into(),
                    project_path: Some("/work/b".into()),
                    started_at: "2026-11-01T10:00:00+00:00".into(),
                    last_at: "2026-11-01T10:10:00+00:00".into(),
                    events: 7,
                    tool_calls: 3,
                    failures: 1,
                },
            ]
        );
        assert_eq!(rows.usage.len(), 1);
        assert_eq!(rows.usage[0].session_id, "old");
        assert_eq!(
            agent_sessions_rows(&connection, "codex", 1)
                .unwrap()
                .sessions
                .len(),
            1
        );
    }

    #[test]
    fn purges_only_events_older_than_the_retention_period() {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch(SCHEMA).unwrap();
        assert_eq!(retention_days(&connection), DEFAULT_RETENTION_DAYS);
        for (id, age_days) in [("old", 40), ("recent", 2)] {
            let at = (chrono::Utc::now() - chrono::Duration::days(age_days)).to_rfc3339();
            connection.execute("INSERT INTO session_events VALUES (?1, 's', ?2, 'codex', 'Checkpoint', NULL, '{}')", params![id, at]).unwrap();
        }
        assert_eq!(purge_expired_events(&connection, 0).unwrap(), 0);
        assert_eq!(purge_expired_events(&connection, 30).unwrap(), 1);
        let left: String = connection
            .query_row("SELECT event_id FROM session_events", [], |row| row.get(0))
            .unwrap();
        assert_eq!(left, "recent");
    }

    #[test]
    fn cursor_tool_and_file_events_exclude_outputs_and_gate_commands() {
        let input = json!({
            "hook_event_name": "postToolUse",
            "conversation_id": "cursor-conversation",
            "generation_id": "generation-2",
            "model_id": "cursor-model",
            "cwd": "C:/work/repo",
            "tool_name": "Shell",
            "tool_input": { "command": "Get-ChildItem" },
            "tool_output": "must not be retained",
            "duration": 1250
        });
        let omitted = normalize_cursor_event(&input, false).unwrap();
        assert_eq!(omitted.provider, Provider::Cursor);
        assert_eq!(omitted.kind, EventKind::ToolFinished);
        assert_eq!(omitted.command, None);
        assert_eq!(
            omitted.model.as_ref().map(|value| value.value.as_str()),
            Some("cursor-model")
        );
        assert_eq!(
            omitted.duration_ms.as_ref().map(|value| value.value),
            Some(1250)
        );
        let captured = normalize_cursor_event(&input, true).unwrap();
        assert_eq!(captured.command.as_deref(), Some("Get-ChildItem"));
        assert_eq!(captured.content, None);

        let edit = json!({
            "hook_event_name": "afterFileEdit",
            "conversation_id": "cursor-conversation",
            "file_path": "C:/work/repo/src/main.rs",
            "edits": [{"old_string": "secret", "new_string": "replacement"}]
        });
        let event = normalize_cursor_event(&edit, false).unwrap();
        assert_eq!(event.kind, EventKind::FileChanged);
        assert_eq!(event.file_path.as_deref(), Some("C:/work/repo/src/main.rs"));
        assert_eq!(event.content, None);
    }

    #[test]
    fn cursor_session_events_require_session_identity_and_drop_unrecognized_hooks() {
        assert!(
            normalize_cursor_event(&json!({"hook_event_name":"sessionStart"}), false).is_none()
        );
        assert!(
            normalize_cursor_event(
                &json!({"hook_event_name":"workspaceOpen","workspace_roots":[]}),
                false
            )
            .is_none()
        );
        let ended = normalize_cursor_event(&json!({"hook_event_name":"sessionEnd","session_id":"s-1","duration_ms":2000,"reason":"completed"}), false).unwrap();
        assert_eq!(ended.kind, EventKind::SessionEnded);
        assert_eq!(
            ended.duration_ms.as_ref().map(|value| value.value),
            Some(2000)
        );
    }

    #[test]
    fn claude_notification_hook_marks_attention_without_user_text() {
        let input = json!({ "hook_event_name": "Notification", "session_id": "s", "message": "Claude needs your permission to use Bash", "cwd": "/w" });
        let event = normalize_claude_event(&input, false, false, false).unwrap();
        assert_eq!(event.kind, EventKind::Checkpoint);
        assert_eq!(
            event.outcome.as_deref(),
            Some("attention:Claude needs your permission to use Bash")
        );
        assert_eq!(event.content, None);
    }

    #[test]
    fn claude_prompt_and_shell_command_capture_are_opt_in() {
        let prompt = json!({
            "hook_event_name": "UserPromptSubmit",
            "session_id": "claude-session",
            "cwd": "C:/work/demo",
            "prompt": "private prompt"
        });
        let omitted = normalize_claude_event(&prompt, false, false, false).unwrap();
        let captured = normalize_claude_event(&prompt, true, false, false).unwrap();
        assert_eq!(omitted.kind, EventKind::UserMessage);
        assert_eq!(omitted.content, None);
        assert_eq!(captured.content.as_deref(), Some("private prompt"));

        let command = json!({
            "hook_event_name": "PreToolUse",
            "session_id": "claude-session",
            "tool_name": "PowerShell",
            "tool_input": { "command": "Get-ChildItem" }
        });
        let omitted = normalize_claude_event(&command, false, false, false).unwrap();
        let captured = normalize_claude_event(&command, false, true, false).unwrap();
        assert_eq!(omitted.kind, EventKind::ToolStarted);
        assert_eq!(omitted.command, None);
        assert_eq!(captured.command.as_deref(), Some("Get-ChildItem"));
    }
}
