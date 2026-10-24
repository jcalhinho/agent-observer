//! The model selected in Antigravity.
//!
//! Antigravity only writes an internal code for it (`last_selected_agent_model:
//! MODEL_PLACEHOLDER_M319` in `antigravity_state.pbtxt`). The names that go with those codes
//! ("Gemini 3.8 Flash (Medium)") come from the app's own local language server, which the user
//! authorized this app to ask: a read-only request to `127.0.0.1`, authenticated with the token the
//! app was started with (read from the process list, kept in memory for the request, never logged,
//! stored or sent anywhere). Only the model names and codes are kept from the answer; the rest of it
//! (account, plan, credits) is dropped unread.

use serde_json::Value;
use std::{
    collections::HashMap,
    io::{Read, Write},
    net::{SocketAddr, TcpStream},
    path::Path,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

const REFRESH_WHEN_KNOWN: Duration = Duration::from_secs(300);
const RETRY_WHEN_UNKNOWN: Duration = Duration::from_secs(45);
const TIMEOUT: Duration = Duration::from_millis(1500);
const PATH: &str = "/exa.language_server_pb.LanguageServerService/GetUserStatus";

struct Catalog {
    labels: HashMap<String, String>,
    checked: Option<Instant>,
}

fn catalog() -> &'static Mutex<Catalog> {
    static CATALOG: OnceLock<Mutex<Catalog>> = OnceLock::new();
    CATALOG.get_or_init(|| {
        Mutex::new(Catalog {
            labels: HashMap::new(),
            checked: None,
        })
    })
}

/// The name of the model selected in Antigravity, when both the selection and its name are known.
pub fn selected_model(data_root: &Path) -> Option<String> {
    let key =
        selected_key(&std::fs::read_to_string(data_root.join("antigravity_state.pbtxt")).ok()?)?;
    let mut catalog = catalog().lock().ok()?;
    let wait = if catalog.labels.is_empty() {
        RETRY_WHEN_UNKNOWN
    } else {
        REFRESH_WHEN_KNOWN
    };
    // The key may be missing from a catalog fetched before the user picked a new model.
    let stale = catalog.checked.is_none_or(|at| at.elapsed() >= wait);
    if stale
        || !catalog.labels.contains_key(&key)
            && catalog
                .checked
                .is_none_or(|at| at.elapsed() >= RETRY_WHEN_UNKNOWN)
    {
        catalog.checked = Some(Instant::now());
        if let Some(labels) = fetch_labels() {
            catalog.labels = labels;
        }
    }
    catalog.labels.get(&key).cloned()
}

fn selected_key(pbtxt: &str) -> Option<String> {
    pbtxt.lines().find_map(|line| {
        let value = line.trim().strip_prefix("last_selected_agent_model:")?;
        let value = value.trim().trim_matches('"');
        (!value.is_empty()).then(|| value.to_owned())
    })
}

/// `--csrf_token <t>` or `--csrf_token=<t>` on the command line of Antigravity's language server.
fn server_token(cmd: &str) -> Option<String> {
    let mut words = cmd.split_whitespace();
    while let Some(word) = words.next() {
        if let Some(value) = word.strip_prefix("--csrf_token=") {
            return Some(value.to_owned());
        }
        if word == "--csrf_token" {
            return words.next().map(str::to_owned);
        }
    }
    None
}

fn fetch_labels() -> Option<HashMap<String, String>> {
    let processes = crate::focus::snapshot();
    let server = processes.iter().find(|process| {
        let cmd = process.cmd.to_lowercase();
        cmd.contains("language_server") && cmd.contains("antigravity")
    })?;
    let token = server_token(&server.cmd)?;
    crate::focus::listening_ports(server.pid)
        .into_iter()
        .find_map(|port| ask(port, &token).and_then(|body| parse_labels(&body)))
}

/// A plain HTTP/1.1 POST to the loopback port: no TLS and no new dependency (the server has an
/// HTTP port next to its HTTPS one; a port that does not answer in time is skipped).
fn ask(port: u16, token: &str) -> Option<String> {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream = TcpStream::connect_timeout(&address, TIMEOUT).ok()?;
    stream.set_read_timeout(Some(TIMEOUT)).ok()?;
    stream.set_write_timeout(Some(TIMEOUT)).ok()?;
    let request = format!(
        "POST {PATH} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Type: application/json\r\nConnect-Protocol-Version: 1\r\nx-codeium-csrf-token: {token}\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{{}}"
    );
    stream.write_all(request.as_bytes()).ok()?;
    let mut raw = Vec::new();
    // `Connection: close`: the answer ends with the connection; a timeout leaves what arrived.
    let _ = stream.take(4 * 1024 * 1024).read_to_end(&mut raw);
    http_body(&raw)
}

/// The body of a 200 response, de-chunked if needed.
fn http_body(raw: &[u8]) -> Option<String> {
    let text = String::from_utf8_lossy(raw);
    let (head, body) = text.split_once("\r\n\r\n")?;
    if !head.lines().next()?.contains(" 200") {
        return None;
    }
    if !head.to_lowercase().contains("transfer-encoding: chunked") {
        return Some(body.to_owned());
    }
    let mut out = String::new();
    let mut rest = body;
    while let Some((size, after)) = rest.split_once("\r\n") {
        let length = usize::from_str_radix(size.trim(), 16).ok()?;
        if length == 0 {
            break;
        }
        out.push_str(after.get(..length)?);
        rest = after.get(length..)?.strip_prefix("\r\n")?;
    }
    Some(out)
}

/// `userStatus.cascadeModelConfigData.clientModelConfigs[*]` → code → label.
fn parse_labels(body: &str) -> Option<HashMap<String, String>> {
    let value: Value = serde_json::from_str(body).ok()?;
    let configs = value
        .get("userStatus")?
        .get("cascadeModelConfigData")?
        .get("clientModelConfigs")?
        .as_array()?;
    let labels: HashMap<String, String> = configs
        .iter()
        .filter_map(|config| {
            let label = config.get("label")?.as_str()?.trim();
            let model = config.get("modelOrAlias")?.get("model")?.as_str()?;
            (!label.is_empty() && !model.is_empty()).then(|| (model.to_owned(), label.to_owned()))
        })
        .collect();
    (!labels.is_empty()).then_some(labels)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_selected_code() {
        assert_eq!(
            selected_key(
                "agent_onboarding_completed: X\nlast_selected_agent_model: MODEL_PLACEHOLDER_M319\n"
            )
            .as_deref(),
            Some("MODEL_PLACEHOLDER_M319")
        );
        assert_eq!(selected_key("other: 1"), None);
    }

    #[test]
    fn finds_the_token_on_the_command_line() {
        assert_eq!(
            server_token("language_server --standalone --csrf_token abc-123 --x y").as_deref(),
            Some("abc-123")
        );
        assert_eq!(
            server_token("language_server --csrf_token=zzz").as_deref(),
            Some("zzz")
        );
        assert_eq!(server_token("language_server --standalone"), None);
    }

    #[test]
    fn keeps_only_names_and_codes() {
        let body = r#"{ "userStatus": { "email": "me@x", "cascadeModelConfigData": { "clientModelConfigs": [
            { "label": "Gemini 3.8 Flash (Medium)", "modelOrAlias": { "model": "MODEL_PLACEHOLDER_M319" }, "quotaInfo": {} },
            { "label": "Claude Sonnet 4.6 (Thinking)", "modelOrAlias": { "model": "MODEL_PLACEHOLDER_M35" } },
            { "modelOrAlias": { "model": "MODEL_X" } } ] } } }"#;
        let labels = parse_labels(body).unwrap();
        assert_eq!(labels.len(), 2);
        assert_eq!(
            labels["MODEL_PLACEHOLDER_M319"],
            "Gemini 3.8 Flash (Medium)"
        );
        assert!(parse_labels("{}").is_none());
    }

    #[test]
    fn reads_plain_and_chunked_bodies_and_refuses_errors() {
        assert_eq!(
            http_body(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}").as_deref(),
            Some("{}")
        );
        assert_eq!(
            http_body(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n3\r\n{\"a\r\n3\r\n\":1\r\n1\r\n}\r\n0\r\n\r\n").as_deref(),
            Some("{\"a\":1}")
        );
        assert_eq!(http_body(b"HTTP/1.1 401 Unauthorized\r\n\r\nno"), None);
    }
}
