//! The daily story: the text of a report is written by an agent the user already has installed,
//! run once in non-interactive mode with every tool switched off, in an empty folder. Nothing is
//! installed, no key is stored, and the agent's own login (and plan) is what pays for it.
//!
//! Finding the program, building its command line and running it with a time limit is the same
//! on macOS and Windows; only locating the binary differs a little.

use crate::no_window::Quiet;
use serde::Serialize;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

/// Folder name every run happens in. Events whose project is in a folder with this name come from
/// a story being written, not from the user's work, and are not recorded.
pub const SANDBOX: &str = "agent-observer-report";

pub const TIMEOUT: Duration = Duration::from_secs(300);

pub fn sandbox_dir() -> PathBuf {
    std::env::temp_dir().join(SANDBOX)
}

pub fn is_sandbox_path(path: &str) -> bool {
    path.replace('\\', "/")
        .to_lowercase()
        .split('/')
        .any(|part| part == SANDBOX)
}

/// Agents that can write a story, with the name of their program.
const AGENTS: &[(&str, &str, &str)] = &[
    ("claude_code", "Claude Code", "claude"),
    ("codex", "Codex", "codex"),
    ("gemini_cli", "Gemini CLI", "gemini"),
    ("qwen_code", "Qwen Code", "qwen"),
    ("opencode", "OpenCode", "opencode"),
];

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct StoryAgent {
    pub provider: String,
    pub name: String,
    pub program: String,
    /// Where it was found: its command line, an editor extension or the agent's desktop app.
    pub origin: String,
    pub version: Option<String>,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct StoryError {
    /// `not_installed`, `busy`, `timeout`, `cancelled`, `failed` or `empty`.
    pub code: String,
    pub detail: String,
}

impl StoryError {
    fn new(code: &str, detail: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            detail: detail.into(),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct StoryText {
    pub text: String,
    pub agent: String,
    pub seconds: f64,
}

// ---------------------------------------------------------------------------------------------
// Finding the program
// ---------------------------------------------------------------------------------------------

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(Into::into)
}

/// What a terminal would find: the user's shell is asked, because an application launched from
/// the Dock or the Start menu has a shorter PATH than their terminal.
fn on_path(binary: &str) -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    let output = Command::new("where").arg(binary).quiet().output().ok()?;
    #[cfg(not(target_os = "windows"))]
    let output = {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
        Command::new(shell)
            .args(["-ilc", &format!("command -v {binary}")])
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .output()
            .ok()?
    };
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        // `command -v` can print an alias definition; a path starts with a separator or a drive.
        .find(|line| Path::new(line).is_file())
        .map(PathBuf::from)
}

/// Folders in `parent` whose name starts with `prefix`, newest name last.
fn children_starting_with(parent: &Path, prefix: &str) -> Vec<PathBuf> {
    let mut found: Vec<PathBuf> = std::fs::read_dir(parent)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .to_lowercase()
                .starts_with(prefix)
        })
        .map(|entry| entry.path())
        .collect();
    found.sort();
    found
}

fn first_file(candidates: impl IntoIterator<Item = PathBuf>) -> Option<PathBuf> {
    candidates.into_iter().find(|path| path.is_file())
}

fn exe_names(name: &str) -> Vec<String> {
    vec![name.to_owned(), format!("{name}.exe")]
}

/// The binary an editor extension ships (Claude Code and Codex both bundle a standalone one).
fn in_editor_extension(provider: &str, program: &str) -> Option<PathBuf> {
    let (prefixes, subfolders): (&[&str], &[&str]) = match provider {
        "claude_code" => (&["anthropic.claude-code-"], &["resources/native-binary"]),
        "codex" => (&["openai.chatgpt-", "openai.codex-"], &["bin"]),
        _ => return None,
    };
    let home = home_dir()?;
    for editor in [".vscode", ".cursor", ".windsurf"] {
        let extensions = home.join(editor).join("extensions");
        for prefix in prefixes {
            for folder in children_starting_with(&extensions, prefix)
                .into_iter()
                .rev()
            {
                for sub in subfolders {
                    let base = folder.join(sub);
                    // Codex keeps one folder per platform inside `bin`.
                    let mut places = vec![base.clone()];
                    places.extend(
                        std::fs::read_dir(&base)
                            .into_iter()
                            .flatten()
                            .flatten()
                            .map(|entry| entry.path()),
                    );
                    for place in places {
                        if let Some(found) =
                            first_file(exe_names(program).into_iter().map(|name| place.join(name)))
                        {
                            return Some(found);
                        }
                    }
                }
            }
        }
    }
    None
}

/// The engine Claude Desktop runs for its Code sessions.
fn in_desktop_app(provider: &str) -> Option<PathBuf> {
    if provider != "claude_code" {
        return None;
    }
    #[cfg(target_os = "macos")]
    let root = home_dir()?.join("Library/Application Support/Claude/claude-code");
    #[cfg(target_os = "windows")]
    let root = PathBuf::from(std::env::var_os("APPDATA")?)
        .join("Claude")
        .join("claude-code");
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let root = home_dir()?.join(".config/Claude/claude-code");
    for version in children_starting_with(&root, "").into_iter().rev() {
        for build in std::fs::read_dir(&version).into_iter().flatten().flatten() {
            let folder = build.path();
            let candidates = [
                folder.join("claude.app/Contents/MacOS/claude"),
                folder.join("claude.exe"),
                folder.join("claude"),
            ];
            if let Some(found) = first_file(candidates) {
                return Some(found);
            }
        }
        // Windows keeps the binary right under the version folder.
        if let Some(found) = first_file([version.join("claude.exe")]) {
            return Some(found);
        }
    }
    None
}

fn find_program(provider: &str, program: &str) -> Option<(PathBuf, &'static str)> {
    if let Some(path) = on_path(program) {
        return Some((path, "command"));
    }
    if let Some(path) = in_editor_extension(provider, program) {
        return Some((path, "editor"));
    }
    in_desktop_app(provider).map(|path| (path, "desktop"))
}

/// `--version` with a short limit, to show which version will be used.
fn version_of(path: &Path) -> Option<String> {
    let mut child = Command::new(path)
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .quiet()
        .spawn()
        .ok()?;
    let started = Instant::now();
    loop {
        match child.try_wait().ok()? {
            Some(_) => break,
            None if started.elapsed() > Duration::from_secs(5) => {
                let _ = child.kill();
                return None;
            }
            None => std::thread::sleep(Duration::from_millis(25)),
        }
    }
    let mut text = String::new();
    child.stdout.take()?.read_to_string(&mut text).ok()?;
    text.lines()
        .next()
        .map(|line| line.trim().to_owned())
        .filter(|line| !line.is_empty())
}

/// Agents found on this computer.
pub fn detect_agents() -> Vec<StoryAgent> {
    AGENTS
        .iter()
        .filter_map(|(provider, name, program)| {
            let (path, origin) = find_program(provider, program)?;
            Some(StoryAgent {
                provider: (*provider).into(),
                name: (*name).into(),
                program: path.display().to_string(),
                origin: origin.into(),
                version: version_of(&path),
            })
        })
        .collect()
}

// ---------------------------------------------------------------------------------------------
// Command lines
// ---------------------------------------------------------------------------------------------

const INSTRUCTION: &str =
    "Follow the instructions you receive and answer in plain text, without using any tool.";

/// How to run one agent: its arguments, what to write to its input, and where its answer is when it
/// is not on its standard output.
#[derive(Debug, PartialEq)]
pub struct Plan {
    pub args: Vec<String>,
    pub stdin: Option<String>,
    pub answer_file: Option<PathBuf>,
}

fn strings(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| (*value).to_owned()).collect()
}

/// Every tool is off or sandboxed, no session is kept, and the folder is empty. The prompt goes
/// through the input (or a file), never the command line, so its size and quoting never matter.
pub fn plan(provider: &str, prompt: &str, folder: &Path) -> Option<Plan> {
    Some(match provider {
        "claude_code" => Plan {
            // `--setting-sources local` keeps the user's hooks (which would report this run to the
            // observer) out; the login is not part of the settings.
            args: strings(&[
                "-p",
                INSTRUCTION,
                "--tools",
                "",
                "--no-session-persistence",
                "--setting-sources",
                "local",
                "--output-format",
                "text",
            ]),
            stdin: Some(prompt.to_owned()),
            answer_file: None,
        },
        "codex" => {
            let answer = folder.join("answer.txt");
            let mut args = strings(&[
                "exec",
                "--sandbox",
                "read-only",
                "--skip-git-repo-check",
                "--ephemeral",
                "--color",
                "never",
                "-C",
            ]);
            args.push(folder.display().to_string());
            args.push("-o".into());
            args.push(answer.display().to_string());
            args.push("-".into());
            Plan {
                args,
                stdin: Some(prompt.to_owned()),
                answer_file: Some(answer),
            }
        }
        "gemini_cli" | "qwen_code" => Plan {
            args: strings(&["-p", INSTRUCTION]),
            stdin: Some(prompt.to_owned()),
            answer_file: None,
        },
        "opencode" => {
            let file = folder.join("prompt.md");
            std::fs::write(&file, prompt).ok()?;
            let mut args = strings(&["run", "-f"]);
            args.push(file.display().to_string());
            args.push(INSTRUCTION.into());
            Plan {
                args,
                stdin: None,
                answer_file: None,
            }
        }
        _ => return None,
    })
}

/// Removes colour codes some programs print even when their output is not a terminal.
pub fn strip_ansi(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            if chars.peek() == Some(&'[') {
                chars.next();
                for next in chars.by_ref() {
                    if next.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
            continue;
        }
        out.push(c);
    }
    out
}

// ---------------------------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------------------------

fn kill_tree(pid: u32) {
    #[cfg(target_os = "windows")]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .quiet()
            .output();
    }
    #[cfg(not(target_os = "windows"))]
    {
        // The agent runs in its own process group so its helpers go with it.
        let _ = Command::new("kill")
            .args(["-KILL", &format!("-{pid}")])
            .output();
        let _ = Command::new("kill")
            .args(["-KILL", &pid.to_string()])
            .output();
    }
}

/// Runs `program` with `plan`, waiting at most `timeout`; `cancel` stops it early.
pub fn run(
    program: &Path,
    plan: &Plan,
    folder: &Path,
    timeout: Duration,
    cancel: &AtomicBool,
) -> Result<String, StoryError> {
    let mut command = Command::new(program);
    command
        .args(&plan.args)
        .current_dir(folder)
        .stdin(if plan.stdin.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("NO_COLOR", "1")
        .quiet();
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = command
        .spawn()
        .map_err(|error| StoryError::new("failed", error.to_string()))?;
    let pid = child.id();

    if let (Some(text), Some(mut input)) = (plan.stdin.clone(), child.stdin.take()) {
        std::thread::spawn(move || {
            let _ = input.write_all(text.as_bytes());
        });
    }
    let read = |stream: Option<Box<dyn Read + Send>>| {
        std::thread::spawn(move || {
            let mut text = String::new();
            if let Some(mut stream) = stream {
                let mut bytes = Vec::new();
                let _ = stream.read_to_end(&mut bytes);
                text = String::from_utf8_lossy(&bytes).into_owned();
            }
            text
        })
    };
    let stdout = read(
        child
            .stdout
            .take()
            .map(|s| Box::new(s) as Box<dyn Read + Send>),
    );
    let stderr = read(
        child
            .stderr
            .take()
            .map(|s| Box::new(s) as Box<dyn Read + Send>),
    );

    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {}
            Err(error) => return Err(StoryError::new("failed", error.to_string())),
        }
        if cancel.load(Ordering::Relaxed) {
            kill_tree(pid);
            let _ = child.wait();
            return Err(StoryError::new("cancelled", ""));
        }
        if started.elapsed() > timeout {
            kill_tree(pid);
            let _ = child.wait();
            return Err(StoryError::new(
                "timeout",
                format!("{} s", timeout.as_secs()),
            ));
        }
        std::thread::sleep(Duration::from_millis(50));
    };
    let out = stdout.join().unwrap_or_default();
    let err = stderr.join().unwrap_or_default();
    if !status.success() {
        // The agent's own message is the useful part (not logged in, unknown model, quota…).
        let message = strip_ansi(if err.trim().is_empty() { &out } else { &err });
        let last: String = message
            .lines()
            .rev()
            .filter(|line| !line.trim().is_empty())
            .take(4)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>()
            .join("\n");
        return Err(StoryError::new("failed", last));
    }
    let answer = plan
        .answer_file
        .as_ref()
        .and_then(|path| std::fs::read_to_string(path).ok())
        .filter(|text| !text.trim().is_empty())
        .unwrap_or(out);
    let answer = strip_ansi(&answer).trim().to_owned();
    if answer.is_empty() {
        return Err(StoryError::new("empty", ""));
    }
    Ok(answer)
}

/// Writes a story with the agent `provider`, found on this computer.
pub fn generate(
    provider: &str,
    prompt: &str,
    cancel: &AtomicBool,
) -> Result<StoryText, StoryError> {
    let &(_, name, program) = AGENTS
        .iter()
        .find(|(key, _, _)| *key == provider)
        .ok_or_else(|| StoryError::new("not_installed", provider))?;
    let (path, _) =
        find_program(provider, program).ok_or_else(|| StoryError::new("not_installed", name))?;
    let folder = sandbox_dir();
    std::fs::create_dir_all(&folder)
        .map_err(|error| StoryError::new("failed", error.to_string()))?;
    let plan =
        plan(provider, prompt, &folder).ok_or_else(|| StoryError::new("not_installed", name))?;
    let started = Instant::now();
    let text = run(&path, &plan, &folder, TIMEOUT, cancel)?;
    // The prompt and the answer have no reason to stay on disk.
    for file in ["prompt.md", "answer.txt"] {
        let _ = std::fs::remove_file(folder.join(file));
    }
    Ok(StoryText {
        text,
        agent: name.into(),
        seconds: started.elapsed().as_secs_f64(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognises_the_report_folder_on_both_systems() {
        assert!(is_sandbox_path("/private/tmp/agent-observer-report"));
        assert!(is_sandbox_path(
            "C:\\Users\\me\\AppData\\Local\\Temp\\Agent-Observer-Report\\sub"
        ));
        assert!(!is_sandbox_path("/Users/me/agent-observer-report-notes"));
        assert!(!is_sandbox_path("/Users/me/work/api"));
    }

    #[test]
    fn switches_every_tool_off() {
        let folder = Path::new("/tmp/agent-observer-report");
        let claude = plan("claude_code", "hello", folder).unwrap();
        assert!(claude.args.windows(2).any(|pair| pair == ["--tools", ""]));
        assert!(
            claude
                .args
                .contains(&"--no-session-persistence".to_string())
        );
        assert!(
            claude
                .args
                .windows(2)
                .any(|pair| pair == ["--setting-sources", "local"])
        );
        assert_eq!(claude.stdin.as_deref(), Some("hello"));

        let codex = plan("codex", "hello", folder).unwrap();
        assert!(
            codex
                .args
                .windows(2)
                .any(|pair| pair == ["--sandbox", "read-only"])
        );
        assert!(codex.args.contains(&"--ephemeral".to_string()));
        assert_eq!(codex.args.last().map(String::as_str), Some("-"));
        assert!(codex.answer_file.is_some());

        for provider in ["gemini_cli", "qwen_code"] {
            let plan = plan(provider, "hello", folder).unwrap();
            assert_eq!(plan.args.first().map(String::as_str), Some("-p"));
        }
        assert!(plan("cursor", "hello", folder).is_none());
    }

    #[test]
    fn never_puts_the_prompt_on_the_command_line() {
        let folder = Path::new("/tmp/agent-observer-report");
        let secret = "SECRET-FACTS";
        for provider in ["claude_code", "codex", "gemini_cli", "qwen_code"] {
            let plan = plan(provider, secret, folder).unwrap();
            assert!(
                plan.args.iter().all(|arg| !arg.contains(secret)),
                "{provider}"
            );
        }
    }

    #[test]
    fn strips_colour_codes() {
        assert_eq!(strip_ansi("\u{1b}[31mred\u{1b}[0m text"), "red text");
    }

    /// Uses the agents installed here: `cargo test -- --ignored --nocapture real_agents`.
    #[test]
    #[ignore]
    fn real_agents() {
        for agent in detect_agents() {
            println!("{agent:?}");
        }
        let cancel = AtomicBool::new(false);
        for provider in ["claude_code", "codex"] {
            let result = generate(provider, "Reply with exactly the word: OK", &cancel);
            println!("{provider}: {result:?}");
        }
    }

    #[cfg(unix)]
    mod running {
        use super::*;

        fn plan_for(args: &[&str], stdin: Option<&str>) -> Plan {
            Plan {
                args: strings(args),
                stdin: stdin.map(str::to_owned),
                answer_file: None,
            }
        }

        #[test]
        fn returns_what_the_agent_prints() {
            let cancel = AtomicBool::new(false);
            let text = run(
                Path::new("/bin/cat"),
                &plan_for(&[], Some("une histoire\n")),
                Path::new("/tmp"),
                Duration::from_secs(5),
                &cancel,
            )
            .unwrap();
            assert_eq!(text, "une histoire");
        }

        #[test]
        fn reports_the_agents_own_error() {
            let cancel = AtomicBool::new(false);
            let error = run(
                Path::new("/bin/sh"),
                &plan_for(&["-c", "echo 'not logged in' >&2; exit 3"], None),
                Path::new("/tmp"),
                Duration::from_secs(5),
                &cancel,
            )
            .unwrap_err();
            assert_eq!(error.code, "failed");
            assert!(error.detail.contains("not logged in"));
        }

        #[test]
        fn stops_after_the_time_limit_and_when_cancelled() {
            let cancel = AtomicBool::new(false);
            let slow = plan_for(&["-c", "sleep 30"], None);
            let error = run(
                Path::new("/bin/sh"),
                &slow,
                Path::new("/tmp"),
                Duration::from_millis(200),
                &cancel,
            )
            .unwrap_err();
            assert_eq!(error.code, "timeout");

            let cancelled = AtomicBool::new(true);
            let error = run(
                Path::new("/bin/sh"),
                &slow,
                Path::new("/tmp"),
                Duration::from_secs(30),
                &cancelled,
            )
            .unwrap_err();
            assert_eq!(error.code, "cancelled");
        }

        #[test]
        fn an_empty_answer_is_an_error() {
            let cancel = AtomicBool::new(false);
            let error = run(
                Path::new("/bin/sh"),
                &plan_for(&["-c", "true"], None),
                Path::new("/tmp"),
                Duration::from_secs(5),
                &cancel,
            )
            .unwrap_err();
            assert_eq!(error.code, "empty");
        }
    }
}
