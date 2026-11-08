<div align="center">

# Agent Observer

**See what your coding agents are doing — and which one needs you — on one screen, without sending anything anywhere.**

A local desktop app for macOS, Windows and Linux that watches Claude Code, Codex, GitHub Copilot,
Antigravity, OpenCode, Qwen Code, Reasonix and Cursor work on your machine, live.

[![CI](https://github.com/jcalhinho/agent-observer/actions/workflows/ci.yml/badge.svg)](https://github.com/jcalhinho/agent-observer/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/jcalhinho/agent-observer?include_prereleases&sort=semver)](https://github.com/jcalhinho/agent-observer/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[Install](#install) · [Connect your agents](#connect-your-agents) · [What you see](#what-you-see) · [Reading the numbers](#reading-the-numbers) · [MCP server](#for-your-agents-a-read-only-mcp-server) · [Privacy](#privacy-and-data) · [Troubleshooting](#troubleshooting) · [Develop](#build-from-source-and-develop) · [Français](README.fr.md)

<img src="docs/media/screen.png" alt="Agent Observer: one screen with a bar per agent, the most urgent first" width="900">

</div>

---

## Contents

- [Why](#why)
- [Quick start](#quick-start)
- [Install](#install) — one line, installers, macOS, Windows, Linux, Homebrew, update, uninstall
- [Connect your agents](#connect-your-agents) — Claude Code, Cursor, the agents read automatically
- [What you see](#what-you-see) — top bar, alerts, bars, states, detail, status bar, history, column mode
- [Reading the numbers](#reading-the-numbers) — what every figure means and where it comes from
- [Subscription limits](#subscription-limits)
- [Alerts, notifications and budget](#alerts-notifications-and-budget)
- [Settings](#settings)
- [For your agents: a read-only MCP server](#for-your-agents-a-read-only-mcp-server)
- [Agents on another machine](#agents-on-another-machine)
- [Privacy and data](#privacy-and-data) — what is recorded, where, and how to erase it
- [Troubleshooting](#troubleshooting)
- [Build from source and develop](#build-from-source-and-develop) — tests, demo mode, layout, releases
- [Contributing](#contributing) · [License](#license)

## Why

Running two or three coding agents in parallel is now normal. Knowing which one has finished, which
one is waiting for your approval and which one has been failing the same command for five minutes is
not. Agent Observer answers one question at a glance: **who needs me right now?** — and then tells you
what each agent costs, how full its context is, and how close you are to your subscription limits.

It only **observes**. It never drives an agent, never edits your code, never modifies an agent's
settings for you, and has no telemetry. It makes no network request of its own.

> **Status:** early (0.x). The interface is in **English and French**; it follows your system language
> and can be changed in Settings.

## Quick start

1. **Install** (macOS or Linux):
   ```bash
   curl -fsSL https://raw.githubusercontent.com/jcalhinho/agent-observer/main/install.sh | bash
   ```
   On Windows, run the `-setup.exe` from the [Releases page](https://github.com/jcalhinho/agent-observer/releases).
2. **Open the app.** Codex, Copilot, Antigravity, OpenCode, Qwen Code and Reasonix are picked up
   automatically. For **Claude Code** (and Cursor), open **Settings › Agents › Configure** and paste the
   block it shows into the agent's settings file — see [Connect your agents](#connect-your-agents).
3. **Work as usual.** Each agent gets a bar as soon as it does something. The most urgent come first.

No agent at hand? Run the interface in demo mode: `npm run dev` in `apps/desktop`, then open
`http://127.0.0.1:1420/?demo` (made-up data, nothing is read or written).

## Install

### One line, macOS and Linux

```bash
curl -fsSL https://raw.githubusercontent.com/jcalhinho/agent-observer/main/install.sh | bash
```

The script picks the file for your system and processor from the **latest published release**, checks
it against the release's `SHA256SUMS.txt`, and installs it:

| System | Installed to | What it does |
| --- | --- | --- |
| macOS (Apple Silicon or Intel) | `/Applications/RepoWatcher Agent Observer.app` | Mounts the `.dmg`, closes a running copy, replaces the app, opens it. |
| Linux x86_64 | `~/.local/bin/agent-observer` | Installs the AppImage (needs FUSE 2: `libfuse2` on Ubuntu). |

Options, as environment variables: `AGENT_OBSERVER_VERSION=0.13.3` (a given version),
`AGENT_OBSERVER_DRY_RUN=1` (show what would happen, change nothing), `AGENT_OBSERVER_REPO=owner/repo`
(a fork). Read [`install.sh`](install.sh) first if you prefer. Files downloaded with `curl` are not
quarantined by macOS, so the unsigned app opens directly. Run the same line again to **update**.

### Installers

From the [Releases page](https://github.com/jcalhinho/agent-observer/releases); check them against
`SHA256SUMS.txt` from the same release.

| Platform | File |
| --- | --- |
| macOS, Apple Silicon (M1 and later) | `Agent-Observer_<version>_macos-arm64.dmg` |
| macOS, Intel | `Agent-Observer_<version>_macos-x64.dmg` |
| Windows 10/11, per-user install (recommended) | `Agent-Observer_<version>_windows-x64-setup.exe` |
| Windows 10/11, MSI for managed deployment | `Agent-Observer_<version>_windows-x64.msi` |
| Linux x86_64, Debian / Ubuntu | `Agent-Observer_<version>_linux-x64.deb` |
| Linux x86_64, any distribution | `Agent-Observer_<version>_linux-x64.AppImage` |
| MCP server for your agents | `agent-observer-mcp.mjs` (see [MCP server](#for-your-agents-a-read-only-mcp-server)) |

> [!IMPORTANT]
> Releases are **not signed** with an Apple Developer ID or a Windows code-signing certificate yet,
> so your system warns you the first time. The steps below are the standard way to open an app you
> trust. If in doubt, [build it from source](#build-from-source-and-develop). On a work computer,
> follow your organisation's software policy instead of bypassing it.

### macOS

1. Open the `.dmg` and drag **RepoWatcher Agent Observer** into **Applications**.
2. Open it once from **Applications**. macOS says it cannot verify the developer.
3. Allow it:
   - **macOS 15 Sequoia and later:** click **Done**, open **System Settings → Privacy & Security**,
     scroll to the message about the app, click **Open Anyway**, confirm with your password.
   - **macOS 14 and earlier:** in Finder, **right-click (or Control-click) the app → Open**, then **Open**.

If macOS says the app **"is damaged and can't be opened"**, it is the download quarantine flag on an
unsigned app, not actual damage:

```bash
xattr -dr com.apple.quarantine "/Applications/RepoWatcher Agent Observer.app"
```

### Windows

1. Run `…-setup.exe`. It installs for the current user, without administrator rights.
2. If **Microsoft Defender SmartScreen** shows *"Windows protected your PC"*, click **More info → Run anyway**.
3. WebView2 is already present on Windows 10/11; the installer fetches it if missing.

Check a download in PowerShell: `Get-FileHash .\Agent-Observer_*_windows-x64-setup.exe -Algorithm SHA256`.
[`docs/WINDOWS.md`](docs/WINDOWS.md) is a short checklist of what to expect for each agent on Windows.

### Linux

- **Debian / Ubuntu:** `sudo apt install ./Agent-Observer_<version>_linux-x64.deb` (pulls `libwebkit2gtk-4.1-0` and `libgtk-3-0`).
- **Any distribution:** `chmod +x Agent-Observer_<version>_linux-x64.AppImage && ./Agent-Observer_<version>_linux-x64.AppImage`
  (needs FUSE 2). The AppImage is built on Ubuntu 22.04 and runs on systems at least as recent.

### Homebrew (experimental)

Each release carries `agent-observer.rb`, a cask for a personal tap: put it in `Casks/` of a
`<you>/homebrew-tap` repository, then `brew install --cask <you>/tap/agent-observer`. Homebrew is
phasing out apps that are not signed by Apple, so this may stop working until the app is signed.

### First launch

Only one copy runs at a time: launching it again brings the existing window forward. The status next to
the logo says **Collecting** when the local collector is listening. Then [connect your agents](#connect-your-agents).

### Update and uninstall

- **Update:** run the install line again, or install the new release over the old one. Your history is kept.
- **Uninstall:** delete the app (macOS: drag it to the Bin; Windows: *Settings › Apps*; Linux:
  `sudo apt remove repo-watcher-agent-observer` or delete the AppImage). To remove your data too, delete the
  folders listed in [Where your data lives](#where-your-data-lives), and remove the hooks and status line you
  added to your agents' settings.

## Connect your agents

| Agent | How it is observed | What you have to do |
| --- | --- | --- |
| **Claude Code** | Official [HTTP hooks](https://docs.claude.com/en/docs/claude-code/hooks) posted to the local collector, plus token usage read from new lines of its transcripts (`~/.claude/projects/**.jsonl`; `CLAUDE_CONFIG_DIR` respected). | Paste the hooks block (below). Optional: the status line, for subscription limits. |
| **Cursor** | Cursor hooks posted to the local collector. | Paste the hooks block (below). |
| **Codex** | Appended rollout records in `~/.codex/sessions` (`CODEX_HOME` respected), including its subscription limits. | Nothing. |
| **GitHub Copilot** | The event logs of its agent in `~/.copilot/session-state/<session>/events.jsonl` (Copilot CLI and VS Code agent sessions; `COPILOT_HOME` respected), and the Copilot Chat panel of VS Code (its local `session-store.db`, read-only). | Nothing. |
| **Antigravity** | Its local files in `~/.gemini/antigravity`, read-only (conversation list and, for recent sessions, a step-by-step transcript). The model name comes from Antigravity's own local server (see [Privacy](#privacy-and-data)). | Nothing. |
| **OpenCode** | Its SQLite database (`~/.local/share/opencode/opencode*.db`; `OPENCODE_DB` / `OPENCODE_DATA_DIR` respected), read-only. | Nothing. |
| **Qwen Code** | Appended chat records in `~/.qwen/projects/<project>/chats`. | Nothing. |
| **Reasonix** | Its session files in `~/.reasonix/projects/<project>/sessions/*.wire.jsonl`, read-only. | Nothing. |

On Windows, `~` is `%USERPROFILE%`. **Settings › Agents › Configure** shows, for each agent, the folder it
reads and whether it was found.

**History is not imported.** Readers start at the end of existing files and observe new activity only,
from the moment the app runs; everything observed is then kept (within your retention). A Copilot Chat
bar appears with your next conversation.

### Claude Code

1. In the app, **Settings › Agents › Claude Code › Configure** shows a hooks block that already contains
   this installation's key.
2. Open `~/.claude/settings.json` (Windows: `%USERPROFILE%\.claude\settings.json`).
3. Add the block's `"hooks"` entry to the existing object — merge it with any hooks you already have,
   do not replace the file. It covers `UserPromptSubmit`, `PreToolUse`, `PostToolUse`,
   `PostToolUseFailure`, `Stop`, `Notification` and `SessionEnd`, each as an `http` hook to
   `http://127.0.0.1:43821/claude-hook` with a 2-second timeout.
4. New Claude Code sessions show up immediately. If the app is closed, the hooks give up after
   2 seconds without disturbing Claude Code.

The key is specific to this installation: if you reinstall the app on another computer, copy the block
again. The app never edits `settings.json` itself.

**Optional — subscription limits.** Claude Code only hands its 5-hour and weekly limits to its status line.
The same dialog offers a `statusLine` block: add it to `settings.json` and the status line becomes
`model · ctx · 5h · 7d` while passing the limits to the app (it uses `curl`; it replaces your own
status line if you have one; when the app is closed the line stays empty). See [Subscription limits](#subscription-limits).

### Cursor

**Settings › Agents › Cursor › Configure** shows a hooks block for `~/.cursor/hooks.json`
(Windows: `%USERPROFILE%\.cursor\hooks.json`). Merge it with the existing content and restart Cursor.
The hooks read this installation's key from its file and forward each event to the collector
(PowerShell on Windows, `python3` on macOS and Linux); they give up after 3 seconds if the app is closed.
Cursor does not report tokens, so its bars show "not reported" for them.

### Not connected yet

Continue, Cline, Roo Code, Aider and Gemini CLI. Sessions run in a cloud agent or in a desktop app that
keeps nothing on your computer cannot be observed. To add an agent, see
[Add a connector](#add-a-connector).

## What you see

### The screen

- **Top bar** — the collector status, the counts (**working**, **need you**), today's spend against your
  daily budget when you set one, and four buttons: **light / dark theme**, **history**, **settings**,
  and **shrink to a column**.
- **Alerts** — under the top bar: an agent close to its subscription limit, the daily budget close to or
  over its limit, two agents editing the same file or working in the same folder (with a link to open it).
- **Totals strip** — the latest session of each agent added up: tokens, cache hit rate, estimated cost,
  what the cache saved, tool calls (with failures and files edited).
- **Filter** — **All / Active / Need you**.
- **One bar per agent**, the most urgent first (going in circles, blocked, silent, waiting for you,
  working, idle). Click a bar, or press Enter on it, to open its detail.
- **Status bar** — always at the bottom (see below).
- **Not seen yet** — a footer lists the agents that sent nothing, with a link to connect them.

<img src="docs/media/card.png" alt="One agent bar: state, activity, figures, limits, git, tools" width="900">

### A bar

The first line says who, its state and what it does, then the same figures for every agent so they
line up from one bar to the next. A second line holds the rest. Hover anything for its explanation.

| Block | What it shows |
| --- | --- |
| **Identity** | The agent, the project folder (`~` for your home folder) and how it was launched (cli, vscode…). The folder icon opens the project folder (folders only, never a file). |
| **State** | One word, coloured by urgency (table below). |
| **Activity** | The tool in progress and its file or command, and the age of the last event. A detected loop or a series of failures replaces it, in colour. |
| **Goal** | Your latest request to the agent, in italics (only with prompt capture on). |
| **Tokens** | Total for the session, and how many were written (output). |
| **Cache** | The cache hit rate, and what the cache saved. |
| **Cost** | Estimated cost of the session, and $/h while the agent works. |
| **Context** | How full the context window is, with a small gauge. |
| **Tools** | Tool calls, failures (✗), turns and duration. |
| **Activity strip** | Events per minute over the last 15 minutes. |
| **Second line** | Subscription limits (5 h, 7 d), model (`+N` if several), how long the open turn has lasted, git branch / ahead / behind / changed files, tokens per minute and cost of this turn, a "cache falling" warning, collisions, and the most used tools with their failure counts. |
| **Bottom stripe** | The token split: cache read, cache write, new input, output. |

The gradient edge of each bar takes the agent's colour, orange when it goes in circles, red when it is blocked.

### States

| State | Meaning |
| --- | --- |
| **Going in circles** | It repeats the same actions without progress (same command, same file, same sequence among its last 24 calls) — it burns tokens for nothing. |
| **Blocked** | At least two tools failed in a row (in the last 10 minutes). |
| **Silent** | A turn is open but nothing has happened for more than 2 minutes — often waiting for your approval. |
| **Waiting for you** | Its last turn has finished (in the last 30 minutes); it is ready for your next message. |
| **Working** | Events arrived in the last 45 seconds, or its turn started less than 2 minutes ago. |
| **Idle** | No recent activity. |
| **Not seen yet** | Nothing received — check its connector. |

### The detail panel

Click a bar. The panel opens with:

1. **Latest request** (with prompt capture on), **collisions** and the **git repository** (branch,
   ahead / behind, changed files, recent commits) with an **Open folder** button.
2. **Subscription limits** of that agent, with their reset times (Codex and Claude Code).
3. **Session overview**, where every figure has its definition underneath: requests, tokens in and out,
   cache hit with the exact hit and miss counts, work time, estimated cost, context window.
4. **Session**: last activity, duration, turns, events, files edited, tool failures.
5. **Tokens, cache and cost**: the full breakdown, the cost without cache, what the cache saved, and the
   price table behind the estimate.
6. **Cache trend**, **pace**, **context curve** (with compactions), **models**, a **table of tools**, the
   **files touched** (read or edited) and a **timeline** of the latest actions.

<img src="docs/media/detail.png" alt="The detail panel of one agent" width="900">

`Esc` closes the panel; so does a click outside it.

### The status bar

At the bottom of the screen, always in view: **cache hit rate** across agents (hover for the exact hit
and miss token counts), the **fullest context window** and its agent, **tokens per minute** of the working
agents, the **nearest subscription limit**, the cost of the **latest sessions** and of **today**.

### History

The clock button in the top bar. Choose **Today, 7, 30 or 90 days**:

- **Spend** (estimated), with how many days could be priced and how many requests had no known price.
- **Tokens**, with the input split into cache hits and misses; **cache hit rate**; **requests** and
  **active days**.
- **Tokens per day** and **spend per day**, drawn apart (different units).
- **Day by day**: tokens, cache, requests, cost, saved, sessions and tool failures.
- **Breakdown by agent, model or project.**

Days with usage but no priced cost are flagged: they are not free days, their model is just not in the
price table. History reads the local database; its depth is your retention setting.

### Column mode and theme

- **Shrink to a column** (top right) turns the window into a narrow column on the right edge of the screen,
  kept on top by default (pin button to release it). The bars adapt to the width. The other button brings
  the full window back, at its previous size and place. The app remembers the mode for the next launch.
- **Light / dark theme** — the sun / moon button. The light theme is a light grey, with no white background.
  The choice is remembered.

## Reading the numbers

Every figure comes from what the agent itself reports. A value it does not report is shown as
**"—"** or **"not reported"**, never invented. Estimated values say so (**≈**), and a partial estimate
shows **≥**.

| Figure | Meaning |
| --- | --- |
| **Tokens** | Everything the agent reported for the session: new input + cache read + cache write + output. |
| **Written** | Output tokens (what the model generated). |
| **Cache read / cache write / new input** | Prompt tokens served from the provider's cache, written to it, and sent fresh. |
| **Cache hit rate** | Cache read ÷ (cache read + cache write + new input), i.e. **hit ÷ (hit + miss)**. Only for agents that report cache reads (Claude Code, Reasonix, Codex…). Higher is cheaper: keep the start of the prompt stable. |
| **Cache falling** | The latest requests hit the cache far less than before (the prompt prefix changed, or the cache expired): everything is read at full price. |
| **Estimated cost** | What the same tokens cost at each model's **public API list price** (`apps/desktop/src/ui/pricing.ts`). A subscription is not billed that way. A model missing from the price table is left out, and the cost then shows **≥**. |
| **Saved by cache** | Cost of the same requests with every cached token counted as normal input, minus the estimated cost. |
| **$/h, tokens/min** | Pace over the last 15 minutes, while the agent works. |
| **This turn** | Estimated cost since the start of the open turn. |
| **Context** | What the next request would carry (the latest prompt size) ÷ the model's context window. Amber from 80 %, red from 95 %. The window comes from the agent when it reports it, otherwise from a table of documented models; for an unknown model no percentage is shown. |
| **Compactions** | How many times the agent shrank its context. |
| **Turns** | Messages you sent (Codex: its turn markers; Cursor: its `stop` events). |
| **Requests** | Model responses that reported their usage. |
| **Work time** | The sum of the turns, from each message to the last activity before the next one: tool and approval waits included, pauses between turns not. Not shown for Cursor (no turn marker). |
| **Duration** | Wall-clock time between the first and the last event of the session. |
| **Files edited** | Distinct files changed by an edit / write / patch tool or reported as changed. |

## Subscription limits

What subscribers want to know is how much is left before the limit, not a dollar figure. The app shows
the limits **only as the agents report them**:

- **Codex** writes them in its session logs with every request (`rate_limits`: the 5-hour and weekly
  windows, percentage used, reset time). Nothing to do: they are read at startup from the latest file,
  then live. ChatGPT plans only, not with an API key.
- **Claude Code** writes them nowhere on disk: it only hands them to its status line (Pro and Max
  subscribers). Add the optional status line from **Settings › Agents › Claude Code** (see
  [Claude Code](#claude-code)); the limits appear after its next answer.
- The other agents do not report any.

They are shown on the agent's bar (`5 h ▬ 24 %`, `7 d ▬ 58 %`), in its detail with the reset times, in
the status bar (the nearest one), and as an alert from 80 % (red from 95 %). Only the percentages, the
window lengths, the reset times and the plan name are kept, **in memory**. A window that reset since the
last reading is shown as reset, not with its old percentage.

## Alerts, notifications and budget

| What | In the app | Native notification |
| --- | --- | --- |
| An agent starts going in circles, gets blocked or goes silent | its bar's state and edge | yes |
| An agent finishes and waits for you (after working) | its state | yes |
| Two agents edit the same file (within 20 minutes), or work in the same folder (within 10 minutes) | an alert with a link | yes |
| A subscription window reaches 80 % (red from 95 %) | an alert | — |
| Today's estimated cost reaches 80 % of your daily budget, then exceeds it | an alert and the spend chip turns amber, then red | yes |

Native notifications are only sent while the window is **not** in front, at most once per minute for the
same thing, and never on the first pass after launch. On macOS the dock badge shows how many agents need
you. Turn notifications off, or set the daily budget (0 = off), in **Settings › Alerts**.

## Settings

The gear button opens a panel; `Esc` or a click outside closes it.

| Section | What you can do |
| --- | --- |
| **Agents** | **Configure** next to each agent: for Claude Code and Cursor, the hooks block (and the optional status line) to copy; for the others, how it is observed, the folder it reads and whether it was found. |
| **Alerts** | System notifications on or off; daily budget in dollars (0 to turn it off). |
| **What is recorded** | Opt in to keep the text of your messages to agents, the commands agents run, and short cleaned error messages. All off by default. |
| **How long** | Retention: 7 days, 30 days (default), 90 days, 1 year or keep everything. Older events are purged at startup and every hour. |
| **My data** | **Export** your whole history to a `.json` file (an array of events); **erase** it. |
| **Language** | System language, English or French. |

## For your agents: a read-only MCP server

[`tools/mcp/agent-observer-mcp.mjs`](tools/mcp/agent-observer-mcp.mjs) is a small
[MCP](https://modelcontextprotocol.io) server (one file, Node 18+, no dependency) that lets an agent ask,
**before editing files, who else is working in this folder**.

**Get it** — from a clone of this repository, or from the latest release:

```bash
mkdir -p ~/.agent-observer
curl -fsSL -o ~/.agent-observer/agent-observer-mcp.mjs \
  https://github.com/jcalhinho/agent-observer/releases/latest/download/agent-observer-mcp.mjs
```

**Add it to your agents** (the Agent Observer app must be running):

| Agent | How |
| --- | --- |
| Claude Code | `claude mcp add --scope user agent-observer -- node ~/.agent-observer/agent-observer-mcp.mjs` |
| Codex | in `~/.codex/config.toml`: `[mcp_servers.agent-observer]` then `command = "node"` and `args = ["/Users/you/.agent-observer/agent-observer-mcp.mjs"]` |
| Cursor | in `~/.cursor/mcp.json`: `{ "mcpServers": { "agent-observer": { "command": "node", "args": ["/Users/you/.agent-observer/agent-observer-mcp.mjs"] } } }` |
| Any MCP client | command `node`, argument: the path of the file (stdio transport). |

**Tools**

| Tool | Arguments | Answers |
| --- | --- | --- |
| `who_else_is_here` | `path` (absolute folder), `minutes` (1–1440, default 30) | The agents active in that folder, or in a folder inside or above it, with the files they edited, their last tool and whether they wait for their user. |
| `recent_activity` | `minutes` (1–1440, default 60) | Every session seen recently: agent, folder, last tool, files edited, tool calls and failures. |
| `subscription_limits` | — | The limits the agents reported, with their reset times. |

A good instruction for an agent (for example in `CLAUDE.md` or `AGENTS.md`): *"Before editing files, call
`who_else_is_here` with the project folder; if another agent edited the same files in the last minutes,
tell me before going on."*

**How it works.** The server calls `GET http://127.0.0.1:43821/v1/activity` with this installation's key,
read from the app's folder (macOS `~/Library/Application Support/dev.repowatcher.agentobserver/collector-token`,
Windows `%APPDATA%\dev.repowatcher.agentobserver\collector-token`, Linux
`~/.config/dev.repowatcher.agentobserver/collector-token`). It is read-only and receives metadata only —
never prompt text, commands or error messages, even if you chose to keep them in the app. Environment
variables: `AGENT_OBSERVER_URL`, `AGENT_OBSERVER_TOKEN` or `AGENT_OBSERVER_TOKEN_FILE`.

## Agents on another machine

Agents running on a server, a cloud VM or a remote dev box can report through an SSH tunnel, without
opening any port:

```bash
ssh -R 43821:127.0.0.1:43821 you@server
```

This works for **Claude Code** (state, tools, files, limits — not tokens, which stay in its log on the
server) and **Cursor** hooks. Agents observed by reading files cannot be followed remotely.
[`docs/REMOTE.md`](docs/REMOTE.md) has the details, an `~/.ssh/config` example and the security notes.

## Privacy and data

Everything stays on your computer. The app makes **no network request of its own**. On `127.0.0.1`
only, with a per-installation key, it receives hooks (Claude Code, Cursor) and the optional Claude Code
status line, and answers the read-only activity summary used by the MCP server. It runs read-only
`git status` and `git log` in the project folders of your agents (with `core.fsmonitor` off, no optional
locks and a 4-second timeout).

**One local request to Antigravity.** Its files hold only an internal code for the selected model, so, to
show its name, the app asks Antigravity's own language server on `127.0.0.1` (read-only), using the key
that app was started with, read from the process list and kept in memory for that one request. Only model
names are kept from the answer. Nothing happens if Antigravity is not running.

| | |
| --- | --- |
| **Recorded by default** | The *shape* of the work: which agent, which session, which tool, which file path, when, how long, success or failure, model name and the token counts the agent itself reports. |
| **Opt-in** (Settings, off by default) | The text of your prompts, the shell commands agents run, and a short cleaned version of error messages (keys, tokens, passwords and your home folder removed). These can contain secrets; enable them knowingly. |
| **In memory only** | Subscription limits. |
| **Never recorded** | Agent responses, reasoning / thinking, tool outputs and results, file contents, transcript paths. |

### Where your data lives

| | macOS | Windows | Linux |
| --- | --- | --- | --- |
| History (`observer.sqlite3`) | `~/Library/Application Support/dev.repowatcher.agentobserver/` | `%LOCALAPPDATA%\dev.repowatcher.agentobserver\` | `~/.local/share/dev.repowatcher.agentobserver/` |
| Key (`collector-token`) | `~/Library/Application Support/dev.repowatcher.agentobserver/` | `%APPDATA%\dev.repowatcher.agentobserver\` | `~/.config/dev.repowatcher.agentobserver/` |

Interface preferences (theme, filter, column mode, budget…) are kept by the app's web view. Export and
erase the history from **Settings › My data**. The collector rejects any request without the key; the
read-only activity summary also refuses any request that comes from a web page. See
[SECURITY.md](SECURITY.md) for the threat model and how to report a vulnerability.

## Troubleshooting

**An agent does not show up.** Open **Settings › Agents › Configure** next to it: it says which folder the app reads and whether
it was found. Run the agent once, and send it a message: readers only see *new* activity. For Claude Code
and Cursor, check that the hooks block is merged in the right file and that the app was open.

**Claude Code shows up, but without tokens.** Tokens come from its transcripts in `~/.claude/projects`
(or `CLAUDE_CONFIG_DIR`). If the agent runs on another machine, its tokens are not visible.

**A bar shows "not reported" for tokens or cache.** That agent does not report them in what the app can
read (Cursor reports no tokens; some agents report no cache reads). The app does not estimate them.

**I don't see my Claude Code limits.** Claude Code only gives them to its status line, and only to Pro and
Max subscribers: add the optional status line from **Settings › Agents › Claude Code**; they appear after
its next answer. **Codex limits** appear with its next request, on a ChatGPT plan only.

**The cost is not what I am billed.** It is a yardstick at public API list prices, not an invoice.

**"Port 43821 is already in use".** Another copy of the app (or something else) holds it: quit the other copy.
Only one instance can collect hooks; the status next to the logo shows the collector state.

**macOS: "the app is damaged".** Quarantine flag on an unsigned app: see [macOS](#macos).

**Linux: the AppImage does not start.** Install FUSE 2 (`sudo apt install libfuse2` on Ubuntu), or use the `.deb`.

**Linux: the window stays blank.** A known WebKitGTK issue with some graphics drivers: start the app with
`WEBKIT_DISABLE_DMABUF_RENDERER=1` (and, if needed, `WEBKIT_DISABLE_COMPOSITING_MODE=1`).

**The MCP server says "Agent Observer is not running"** — open the app. **"refused the key"** — the key
changed (reinstall): nothing to do if the server reads it from the app's folder; update
`AGENT_OBSERVER_TOKEN` if you set it by hand.

**`install.sh` says no release was found.** It only sees **published** releases; a draft release is invisible.

## Build from source and develop

### Requirements

- [Node.js 22](https://nodejs.org/) and npm.
- [Rust](https://rustup.rs/) stable, **1.95 or later**, with `rustfmt` and `clippy`.
- The [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/): Xcode Command Line Tools on
  macOS; Microsoft C++ Build Tools and WebView2 on Windows; on Debian / Ubuntu:
  `sudo apt install libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev libssl-dev build-essential file patchelf`.

### Run and build

```bash
git clone https://github.com/jcalhinho/agent-observer.git
cd agent-observer
npm ci
npm run desktop:dev           # the app, with hot reload of the interface
npm run desktop:build         # installers in target/release/bundle/
npm run desktop:install-mac   # macOS: build the .app and install it in /Applications
```

Quit any installed copy first: only one instance can hold the collector port.

**Demo mode.** `npm run dev` in `apps/desktop`, then `http://127.0.0.1:1420/?demo`: the interface filled
with made-up agents, limits and history, without Tauri. Use it for UI work and screenshots.

### Tests (what CI runs on macOS, Windows and Linux)

```bash
npm run desktop:typecheck                                        # TypeScript
npx vitest run apps/desktop                                      # interface logic
npm run test:mcp                                                 # MCP server
npm run build --workspace @repo-watcher/agent-observer-desktop   # interface build (embedded by the Rust app)
cargo fmt --all --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
```

Build the interface once before `cargo clippy` / `cargo test`, otherwise Tauri stops with
*"frontendDist … doesn't exist"*.

### Project layout

```
apps/desktop/
  src/ui/                 React interface: App.tsx (the screen), AgentBar.tsx, AgentDetail.tsx, History.tsx,
                          SettingsPanel.tsx; pure logic with Vitest tests next to it: agentPulse.ts (states),
                          loopDetector.ts, contextUsage.ts, sessionSummary.ts, insights.ts (cache, cost),
                          analysis.ts (collisions, pace, budget, days), limitsView.ts, pricing.ts, i18n.ts
  src-tauri/src/          Rust: main.rs (collector, SQLite store, commands), one reader per agent
                          (claude_transcripts.rs, codex_rollout.rs, copilot_sessions.rs, copilot_chat.rs,
                          antigravity_sessions.rs, opencode_sessions.rs, qwen_sessions.rs, reasonix_sessions.rs),
                          limits.rs, activity.rs, git_info.rs, redact.rs
crates/session-events/    the provider-neutral event model shared by every reader
tools/mcp/                the read-only MCP server and its tests
packaging/homebrew/       the cask generator used by the release workflow
install.sh                the one-line installer
docs/                     CONNECTORS (add an agent), DESIGN (UI rules), REMOTE, WINDOWS, media
```

[`COMPRENDRE.md`](COMPRENDRE.md) (in French) is a three-minute tour of the code.

### Architecture

```
agent CLIs ──hooks, status line (HTTP, 127.0.0.1 + key)──┐
           ──local logs / SQLite (read-only)──────────────┤
                                                          ▼
              Rust readers (apps/desktop/src-tauri/src/*)  →  SessionEvent (crates/session-events)
                                                          ▼
              SQLite store + Tauri commands / events (main.rs) · limits in memory (limits.rs)
                                                          ▼
              React UI (apps/desktop/src/ui) — one screen: totals, one bar per agent, detail, history

              GET /v1/activity (read-only, key) ──▶ tools/mcp (MCP server for your agents)
```

- **`crates/session-events`** — every measured value carries its origin (`Provider`, `LocalObservation`,
  `Derived`, `Estimated`): a reader omits what it cannot observe rather than inventing it.
- **Readers** — one module per agent that turns hooks, JSONL logs or SQLite rows into `SessionEvent`s,
  dropping private content before anything is stored.
- **Desktop shell** — Tauri 2: the loopback collector (axum), the SQLite store (rusqlite), subscription
  limits, git state and the read-only activity summary.
- **UI** — React 19 + Vite. All logic lives in plain `.ts` modules with tests; components stay thin.

### Add a connector

A new agent is a Rust reader: it reads what the agent already writes (logs, a local database) or receives
(hooks) and turns it into `SessionEvent`s, metadata only. See [`docs/CONNECTORS.md`](docs/CONNECTORS.md) and
[CONTRIBUTING.md](CONTRIBUTING.md#adding-a-connector).

### Add or fix a model price

Prices are in [`apps/desktop/src/ui/pricing.ts`](apps/desktop/src/ui/pricing.ts) (USD per million tokens,
standard tier, cache prices only when the provider publishes them). Cite the provider's official pricing
page and the date you read it — see [CONTRIBUTING.md](CONTRIBUTING.md).

### Release

1. Bump the version in `apps/desktop/src-tauri/tauri.conf.json`, `apps/desktop/package.json`,
   `apps/desktop/src-tauri/Cargo.toml`, and the matching entries of `Cargo.lock` and `package-lock.json`;
   move the **Unreleased** notes of `CHANGELOG.md` under the new version.
2. Tag it and push the tag: `git tag vX.Y.Z && git push origin vX.Y.Z` (the tag must match the version).
3. The *Release* workflow builds macOS (arm64, x64), Windows and Linux, writes `SHA256SUMS.txt`, the
   Homebrew cask and attaches the MCP server, and opens a **draft** release.
4. **Publish** the draft: `install.sh` and `releases/latest` only see published releases.

Signing is switched on by repository secrets (Apple Developer ID and notarization, Windows certificate):
see the header of [`.github/workflows/release.yml`](.github/workflows/release.yml).

## Contributing

Bug reports, connector requests, model prices, translations and code are all welcome — start with
[CONTRIBUTING.md](CONTRIBUTING.md). Everyone taking part is expected to follow the
[Code of Conduct](CODE_OF_CONDUCT.md). Security issues: [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE). Agent Observer is an independent project, not affiliated with Anthropic, OpenAI, Google,
GitHub, Alibaba, Anysphere or the OpenCode project. Product names belong to their owners.
