<div align="center">

# Agent Observer

**See what your coding agents are doing — and which one needs you — on one simple screen, without sending anything anywhere.**

A local desktop app for macOS, Windows and Linux that watches Claude Code, Codex, GitHub Copilot,
Antigravity, OpenCode, Qwen Code, Reasonix and Cursor work on your machine, live.

[![CI](https://github.com/jcalhinho/agent-observer/actions/workflows/ci.yml/badge.svg)](https://github.com/jcalhinho/agent-observer/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/jcalhinho/agent-observer?include_prereleases&sort=semver)](https://github.com/jcalhinho/agent-observer/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[Download](#install) · [What you see](#what-you-see) · [Privacy](#privacy) · [Remote agents](docs/REMOTE.md) · [MCP](#for-your-agents-a-read-only-mcp-server) · [Build from source](#build-from-source) · [Contributing](CONTRIBUTING.md) · [Français](README.fr.md)

<img src="docs/media/screen.png" alt="Agent Observer: one screen with a bar per agent, the most urgent first" width="900">

</div>

---

## Why

Running two or three coding agents in parallel is now normal. Knowing which one has
finished, which one is waiting for your approval and which one has been failing the same
command for five minutes is not. Agent Observer answers one question at a glance:
**who needs me right now?**

It only **observes**. It never drives an agent, never edits your code, never modifies an
agent's settings for you, and has no telemetry. It makes no network request of its own.

> **Status:** early (0.x). The interface is available in **English and French** (it follows
> your system language; change it in Settings).

## What you see

One screen: a **totals strip** on top, then **one bar per agent, stacked in a column**, the most
urgent first, and a **live status bar** at the bottom. A filter (**All / Active / Need you**) narrows
the board. Click a bar to open its detail.

**The top bar** has the counts (working, need you), today's spend against your budget when you set one,
and four buttons: light / dark theme, history, settings, and **shrink to a column** (a narrow window in
the corner of the screen, optionally kept on top).

**Alerts** appear under the top bar: an agent close to its subscription limit, a daily budget about to
be exceeded, two agents editing the same file or working in the same folder. Native notifications and
the dock badge tell you when an agent loops, is blocked, stalls or waits for you (only while the window
is not focused; one switch in Settings).

**The totals strip** adds up the latest session of each agent: tokens, cache hit rate, estimated
cost, what the cache saved, and tool calls (with failures and files edited).

<img src="docs/media/card.png" alt="One agent bar: state, activity, figures, limits, git, tools" width="900">

**Each bar** shows, on its first line, who, its state and what it does, then the same figures for every
agent so they line up: tokens, cache, cost, context, tools, activity. A second line holds the rest.

| Block | What it shows |
| --- | --- |
| **State** | One word, coloured by urgency, with the age of the last activity. |
| **Activity** | The tool in progress and its file or command. A detected loop or a series of failures replaces it, in colour. |
| **Goal** | The latest request you gave the agent (only with prompt capture on). |
| **Where, how, which model** | The project folder (`~` for your home folder), how the agent was launched (terminal, VS Code…), the latest model it reported (`+N` when several were used) and how long the open turn has lasted. |
| **Figures** | Total tokens (and written), the **cache hit rate** (and what it saved), estimated cost (and $/h while it works), how full the context window is, tool calls with failures, turns and duration. |
| **Activity strip** | Events per minute over the last 15 minutes. |
| **Subscription limits** | The 5-hour and weekly windows, as the agent reports them (see below). |
| **Git** | Branch, commits ahead/behind, changed files — read-only `git` calls, 4 s timeout. |
| **Pace** | Tokens per minute and cost of the current turn; a warning when the cache hit rate collapses. |
| **Collisions** | Another agent editing the same file or working in the same folder. |
| **Tools** | The most used tools, with their failure counts. |

The gradient edge of each bar takes the agent's colour, orange when it goes in circles, red when it is blocked.

**The detail panel** (click a bar) opens with a **session overview** where every figure has its definition
underneath — requests, tokens in and out, cache hit with the exact hit and miss counts, work time (the sum
of the turns), estimated cost, context window — then the subscription limits, the git repository, the full
token breakdown and the price table behind the estimate, the cache trend, the pace, the context curve, the
models, a table of tools, the files touched and a timeline of the latest actions.

<img src="docs/media/detail.png" alt="The detail panel of one agent" width="900">

**The status bar** at the bottom keeps the essentials in view: cache hit rate (hover for the exact hit
and miss counts), the fullest context window, tokens per minute, the nearest subscription limit, the cost
of the latest sessions and of today.

**History** (top bar) shows spend, tokens, cache and requests per day over today, 7, 30 or 90 days, with
separate charts for tokens and spend, a table day by day and a breakdown by agent, model or project. Days
with usage but no priced cost are flagged as such: they are not free days.

### Subscription limits

What subscribers want to know is how much is left before the limit, not a dollar figure. The app shows
the limits **only as the agents report them**:

- **Codex** writes them in its session logs with every request (`rate_limits`: the 5-hour and weekly
  windows, percentage used, reset time). Nothing to do; they show up at the next request (ChatGPT plan
  only, not with an API key).
- **Claude Code** writes them nowhere on disk: it only hands them to its status line (Pro and Max
  subscribers). **Settings › Claude Code** gives an optional status line block that passes them to the
  app and shows `model · ctx · 5h · 7d`. It replaces your own status line if you have one.
- The other agents do not report any.

Only the percentages, the window lengths and the reset times are kept, in memory. A window that has
reset since the last reading is shown as reset, not with its old percentage.

Figures the agent does not report are shown as *not reported* or "—", never invented. The cost is an
estimate at API list prices: a subscription (Claude, Copilot…) is not billed that way, and a model missing
from the price table is left out, so the cost shows "≥" when part of the session could not be priced.
The cache hit rate only exists for agents that report cache reads (for example Claude Code and Reasonix).

| State | Meaning |
| --- | --- |
| **Going in circles** | It repeats the same actions without progress (same command, same file, same sequence) — it burns tokens for nothing. |
| **Blocked** | At least two tools failed in a row. |
| **Silent** | A turn is open but nothing has happened for more than 2 minutes — often waiting for your approval. |
| **Waiting for you** | Its last turn has finished; it is ready for your next message. |
| **Working** | Events arrived in the last 45 seconds. |
| **Idle** | No recent activity. |
| **Not seen yet** | Nothing received — check its connector. Listed in a small footer. |

The context bar turns amber from 80 % and red from 95 %. The window comes from the agent when it
reports it, otherwise from a small table of documented models; for an unknown model the bar shows
the token count and no percentage rather than a guess.

**Try it without any agent:** run `npm run dev` in `apps/desktop` and open `http://127.0.0.1:1420/?demo`.
It fills the screen with made-up events (nothing is read or written).

### Settings

The button in the top bar opens a panel that slides in; close it and you are back on the single screen.

- **Connectors**: which agents are detected, and how to connect them (for Claude Code, the hooks
  fragment to copy, and the optional status line for its subscription limits).
- **Alerts**: native notifications on or off, and an optional daily budget.
- **What is recorded**: prompts, shell commands and error messages are off by default.
- **Retention**: from 7 days to forever.
- **Export / erase** your local history.
- **Language**: English or French.

## Supported agents

| Agent | How it is observed | What you have to do |
| --- | --- | --- |
| **Claude Code** | Official [HTTP hooks](https://docs.claude.com/en/docs/claude-code/hooks) posted to the local collector, plus token usage read from new lines of its transcripts (`~/.claude/projects/**.jsonl`, `CLAUDE_CONFIG_DIR` respected). | Copy the settings fragment shown in **Settings › Connectors** into `~/.claude/settings.json`. The app never edits it for you. |
| **Codex** | Appended JSONL rollout records in `~/.codex/sessions` (`CODEX_HOME` respected). | Nothing. |
| **GitHub Copilot** | Two sources, both read-only: the event logs of its agent in `~/.copilot/session-state/<session>/events.jsonl` (Copilot CLI and the agent sessions of VS Code; `COPILOT_HOME` respected), and the Copilot Chat panel of VS Code (its local `session-store.db`: turns and files touched, never the assistant's text). | Nothing. |
| **Antigravity** | Its local files in `~/.gemini/antigravity`, opened **read-only**: the list of conversations and, for recent sessions, a step-by-step transcript (tokens, tools, failures). Antigravity only records a code for the selected model, so the app asks Antigravity's own local server (`127.0.0.1`, read-only, see [Privacy](#privacy)) for its name. | Nothing. |
| **OpenCode** | Its local SQLite database (`~/.local/share/opencode/opencode*.db`, `OPENCODE_DB` / `OPENCODE_DATA_DIR` respected), opened **read-only**. | Nothing. |
| **Qwen Code** | Appended JSONL chat records in `~/.qwen/projects/<project>/chats`. | Nothing. |
| **Reasonix** | Its session files in `~/.reasonix/projects/<project>/sessions/*.wire.jsonl` (written by Reasonix Studio), read-only. | Nothing. |
| **Cursor** | Cursor hooks posted to the local collector. | Copy the fragment shown in **Settings › Connectors**. |

On Windows, `~` is `%USERPROFILE%`. Log-based connectors start at the end of existing files
and observe new records only: history from before the app was started is not imported. The first
read of the Copilot Chat panel does the same, so a Copilot Chat bar appears with your next conversation.

Not connected yet: Continue, Cline, Roo Code, Aider and Gemini CLI. Sessions run in a cloud
agent or a desktop app that keeps nothing on your computer cannot be observed. To add an
agent, see [adding a connector](#add-your-own-agent).

**Agents on a server or in a remote dev box:** Claude Code and Cursor can report through an SSH
tunnel (`ssh -R 43821:127.0.0.1:43821 you@server`), without opening any port. See
[`docs/REMOTE.md`](docs/REMOTE.md) for what works and what does not.

## For your agents: a read-only MCP server

[`tools/mcp/agent-observer-mcp.mjs`](tools/mcp/agent-observer-mcp.mjs) is a small MCP server (Node 18+,
no dependency) that lets an agent ask, before editing files, **who else is working in this folder**:

| Tool | Answers |
| --- | --- |
| `who_else_is_here` | The agents active in a folder, or in a folder inside or above it, during the last minutes, with the files they edited. |
| `recent_activity` | Every session seen recently: folder, last tool, files edited, failures, waiting for its user or not. |
| `subscription_limits` | The limits the agents reported, with their reset times. |

```bash
claude mcp add agent-observer -- node /path/to/agent-observer/tools/mcp/agent-observer-mcp.mjs
```

It is read-only: it calls `GET http://127.0.0.1:43821/v1/activity` with this installation's key (read
from the app's folder) and gets metadata only — never prompt text, commands or error messages, even if
you chose to keep them in the app.

## Privacy

Everything stays on your computer. The app makes no network request of its own. On `127.0.0.1` only,
with a per-installation key, it receives hooks (Claude Code, Cursor) and the optional Claude Code status
line, and answers the read-only activity summary used by the MCP server. It runs read-only `git status`
and `git log` in the project folders of your agents, with hardened options and a timeout.

**One local request to Antigravity.** Its files hold only an internal code for the selected model, so, to show its name, the app asks Antigravity's own language server on `127.0.0.1` (read-only), using the token that app was started with, read from the process list and kept in memory for that one request. Only model names are kept from the answer. Nothing happens if Antigravity is not running.

**Recorded by default** — the *shape* of the work: which agent, which session, which tool,
which file path, when, how long, success or failure, model name and the token counts the
agent itself reports. Subscription limits are kept in memory only.

**Opt-in** (Settings, off by default) — the text of your prompts, the shell commands
agents run, and a short cleaned version of error messages (keys, tokens, passwords and your
home folder removed). These can contain secrets; enable them knowingly.

**Never recorded** — agent responses, reasoning / thinking, tool outputs and results, file
contents, transcript paths.

- Events are stored in a local SQLite database in the OS app-data directory
  (`~/Library/Application Support/dev.repowatcher.agentobserver/` on macOS,
  `%LOCALAPPDATA%\dev.repowatcher.agentobserver\` on Windows).
- Retention is configurable (7 days to forever); older events are purged at startup and
  every hour. History can be exported to JSON or erased from Settings.
- The collector listens on `127.0.0.1:43821` only and rejects requests without the
  per-installation bearer key generated on first launch. The read-only activity summary also
  refuses any request that comes from a web page.

See [SECURITY.md](SECURITY.md) for the threat model and how to report a vulnerability.

## Install

**macOS and Linux, one line** — downloads the right file from the latest published release, checks it
against `SHA256SUMS.txt` and installs it (`/Applications` on macOS, `~/.local/bin/agent-observer` on Linux):

```bash
curl -fsSL https://raw.githubusercontent.com/jcalhinho/agent-observer/main/install.sh | bash
```

Read [`install.sh`](install.sh) first if you prefer; `AGENT_OBSERVER_DRY_RUN=1` shows what it would
do without changing anything. Files downloaded this way are not quarantined by macOS, so the unsigned
app opens without the steps below.

Or download the installer from the [Releases page](https://github.com/jcalhinho/agent-observer/releases),
and check it against `SHA256SUMS.txt` from the same release.

| Platform | File |
| --- | --- |
| macOS, Apple Silicon (M1 and later) | `Agent-Observer_<version>_macos-arm64.dmg` |
| macOS, Intel | `Agent-Observer_<version>_macos-x64.dmg` |
| Windows 10/11, per-user install (recommended) | `Agent-Observer_<version>_windows-x64-setup.exe` |
| Windows 10/11, MSI for managed deployment | `Agent-Observer_<version>_windows-x64.msi` |
| Linux x86_64, Debian / Ubuntu | `Agent-Observer_<version>_linux-x64.deb` |
| Linux x86_64, any distribution | `Agent-Observer_<version>_linux-x64.AppImage` (needs FUSE 2) |

**Homebrew (experimental).** Each release also carries `agent-observer.rb`, a cask for a personal
tap: put it in `Casks/` of a `<you>/homebrew-tap` repository, then
`brew install --cask <you>/tap/agent-observer`. Homebrew is phasing out apps that are not signed by
Apple, so this may stop working until the app is signed.

> [!IMPORTANT]
> Early releases are **not signed** with an Apple Developer ID or a Windows code-signing
> certificate yet, so your OS will warn you the first time. The steps below are the standard
> way to open an app you trust. If in doubt, [build it from source](#build-from-source).
> On a work computer, follow your organisation's software policy instead of bypassing it.

### macOS

1. Open the `.dmg` and drag **Agent Observer** into **Applications**.
2. Open it once from **Applications**. macOS says it cannot verify the developer.
3. Allow it, depending on your macOS version:
   - **macOS 15 Sequoia and later:** click **Done**, open **System Settings → Privacy &
     Security**, scroll down to the message about the app and click **Open Anyway**, then
     confirm with your password.
   - **macOS 14 and earlier:** in Finder, **right-click (or Control-click) the app → Open**,
     then **Open** in the dialog.

You only need to do this once. If macOS says the app **"is damaged and can't be opened"**,
it is the download quarantine flag on an unsigned app, not actual damage. Remove it in
Terminal:

```bash
xattr -dr com.apple.quarantine "/Applications/RepoWatcher Agent Observer.app"
```

### Windows

1. Run `…-setup.exe`. It installs for the current user, without administrator rights.
2. If **Microsoft Defender SmartScreen** shows *"Windows protected your PC"*, click
   **More info → Run anyway**.
3. WebView2 is already present on Windows 10/11; the installer fetches it if missing.

Using it on Windows and something looks off? [`docs/WINDOWS.md`](docs/WINDOWS.md) is a short checklist of what to expect for each agent.

Verify the checksum in PowerShell before running it:

```powershell
Get-FileHash .\Agent-Observer_*_windows-x64-setup.exe -Algorithm SHA256
```

### First launch

1. Open **Settings** (top right) and check that your agents are detected. For Claude Code, copy the
   displayed fragment into `~/.claude/settings.json` (the token in it is specific to this
   computer).
2. Work as usual with your agents — the bars fill themselves.

Only one instance runs at a time: launching it again brings the existing window forward.

## Build from source

Requirements: [Node.js 22](https://nodejs.org/), [Rust](https://rustup.rs/) stable (1.95 or
later) and the [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS
(Xcode Command Line Tools on macOS; Microsoft C++ Build Tools and WebView2 on Windows;
WebKitGTK 4.1 on Linux).

```bash
git clone https://github.com/jcalhinho/agent-observer.git
cd agent-observer
npm ci
npm run desktop:dev      # development, with hot reload
npm run desktop:build    # installers in target/release/bundle/
```

Tests: `npm test` in `apps/desktop` for the interface, `npm run test:mcp` for the MCP server, and
`cargo test --workspace` for the Rust side (build the interface first: Tauri embeds it).
[`COMPRENDRE.md`](COMPRENDRE.md) (in French) is a three-minute tour of the code.

## Architecture

```
agent CLIs ──hooks, status line (HTTP, 127.0.0.1 + key)──┐
           ──local logs / SQLite (read-only)──────────────┤
                                              ▼
                      Rust readers (apps/desktop/src-tauri/src/*_sessions.rs, codex_rollout.rs, copilot_chat.rs, …)
                                              │  SessionEvent (crates/session-events)
                                              ▼
                      SQLite store + Tauri commands/events (src-tauri/src/main.rs)
                                              │
                                              ▼
                      React UI (apps/desktop/src/ui) — one screen: totals, one bar per agent, a detail panel

            GET /v1/activity (read-only, key) ──▶ tools/mcp (MCP server for your agents)
```

- **`crates/session-events`** — the provider-neutral event model shared by every reader.
  Each measured value carries its origin (`Provider`, `LocalObservation`, `Derived`,
  `Estimated`): a reader omits what it cannot observe rather than inventing it.
- **Readers** (`apps/desktop/src-tauri/src/`) — one Rust module per agent that turns its
  hooks, JSONL logs or SQLite rows into `SessionEvent`s, dropping private content before
  anything is stored.
- **Desktop shell** — Tauri 2: the loopback collector (axum), the SQLite store (rusqlite), the
  subscription limits (`limits.rs`), git state (`git_info.rs`) and the read-only activity summary
  (`activity.rs`).
- **UI** — React 19 + Vite. The state of an agent (`agentPulse.ts`), loop detection, context
  usage, session totals, the cache and cost figures (`insights.ts`), collisions, pace and history
  (`analysis.ts`) and limits (`limitsView.ts`) live in plain `.ts` modules with Vitest tests.

## Add your own agent

A new agent is a Rust reader in the desktop app: it reads what the agent already writes (logs, a local
database) or receives (hooks), and turns it into `SessionEvent`s. See
[`docs/CONNECTORS.md`](docs/CONNECTORS.md) and [CONTRIBUTING.md](CONTRIBUTING.md#adding-a-connector).

## FAQ

**Does it send my code or prompts anywhere?**
No. There is no telemetry and the app makes no network request of its own. Prompts and
commands are not even stored locally unless you turn them on.

**Does it slow my agents down?**
Log readers only read new lines of files the agents already write. Claude Code hooks are
fire-and-forget HTTP calls with a 2-second timeout; if the app is closed, Claude Code just
carries on.

**Why doesn't a bar show token counts, or a cache rate?**
Because that agent doesn't report them in what the app can read. The app shows *not
reported* rather than an estimate.

**Is the cost what I am billed?**
No. It is what the same tokens would cost at each model's public API price, so it is a
yardstick, not an invoice. Subscriptions are billed differently, and a model that is not in the
price table is left out (the cost then shows "≥").

**Can it see sessions started before I opened it?**
No. Readers observe new activity from the moment the app runs; earlier history is not
imported. Everything observed since then stays available, within your retention setting.

**Why don't I see my Claude Code limits?**
Claude Code only gives them to its status line, and only to Pro and Max subscribers. Add the optional
status line from **Settings › Claude Code**; the limits appear after its next answer.

**Port 43821 is already in use.**
Another copy of the app (or something else) holds it. Only one instance can collect hooks;
Settings › Connectors shows the collector status.

**Why isn't the app signed?**
Code-signing certificates cost money and time; the release pipeline is ready to sign and
notarize as soon as they are available. Meanwhile every release ships SHA-256 checksums and
is built by GitHub Actions from the tagged source, and `install.sh` checks them for you.

## Contributing

Bug reports, connector requests, translations and code are all welcome — start
with [CONTRIBUTING.md](CONTRIBUTING.md). Everyone taking part is expected to follow the
[Code of Conduct](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE). Agent Observer is an independent project, not affiliated with Anthropic,
OpenAI, Google, GitHub, Alibaba or the OpenCode project. Product names belong to their owners.
