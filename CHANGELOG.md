# Changelog

All notable changes to Agent Observer are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.11.9] - 2026-10-26

### Fixed
- **The race could stay on "Waiting for an agent" while the database was full.** The latest events are
  read in one page of 500 rows, and a single row this version could not decode failed the whole page; the
  error was swallowed, so nothing was drawn. Unreadable rows are now skipped (and logged), the rest is shown,
  and a failed load is reported in the console instead of being hidden.

## [0.11.8] - 2026-10-26

### Fixed
- **A short turn looked like the runner did not move.** Qwen Code answers in about 8 seconds, and in that time
  the runner only went from 7 % to 11 % of the track before jumping to the finish. The first seconds of a turn
  now count the most (about 28 % after 8 seconds); the pace afterwards is steady and a turn still tops out at 92 %.

## [0.11.7] - 2026-10-26

0.11.6 was never published: its lock file was out of date and CI refused it. Same content, plus:

### Fixed
- The code of conduct has a real contact address (it was a placeholder).
- **The OpenCode runner only moved for 45 seconds after each event.** OpenCode writes nothing while the
  model thinks, so a 100-second answer left the runner standing still. A turn now runs from your message
  until OpenCode's own `idle` marker (new `Checkpoint` event), and a turn with no event for 5 minutes is
  over, like the other agents.

### Changed
- Screenshots regenerated from a coherent demo day (14 sessions across six agents, a story that matches
  the totals, no placeholder file names).


## [0.11.5] - 2026-10-25

### Changed
- **Screenshots redone** with demo data (Antigravity and GitHub Copilot, no real paths or project names).
  They showed Gemini CLI, which is no longer observed.
- **The Gemini CLI connector is gone** (`gemini_sessions.rs`, its setup command and Connectors entry):
  it had not been started since Antigravity replaced it. Gemini CLI history already stored stays readable.
- The Connectors page says five agents are read automatically (it said four), and the *Keep error
  messages* setting lists the agents that follow it (Claude Code, Antigravity, Codex, Qwen Code, OpenCode,
  GitHub Copilot).
- `apps/desktop/README.md` describes the six current agents.

### Fixed
- The model label under a runner in the 3D race was always French; it follows the interface language.

### Added
- `docs/WINDOWS.md`: a checklist of what to see, agent by agent, on a real Windows PC.


## [0.11.4] - 2026-10-25

### Fixed
- **A runner could stay in motion for ever.** A turn that never got its end event (interrupted with Esc,
  which Claude Code does not report, or a session closed mid-turn) stayed "running", and a stale turn won
  over the newer finished one. A turn with no event for 5 minutes is now over.
- **A runner that finished a turn now goes back to the start**: it stays on the line for 8 seconds, then
  jogs back, facing the start, and waits there.

## [0.11.3] - 2026-10-25

### Fixed
- **Hurdles made no sense**: they sat ahead of the runner, moved with it and stayed as long as there had
  been a failure in the last 15 minutes. A hurdle is now left on the spot of each tool failure of the turn in
  progress, does not move, and goes when the turn ends. They are also about three times bigger.

## [0.11.2] - 2026-10-24

### Changed
- **One face for every runner** (round eyes, brows, nose, smile): only the clothes (shirt and cap) tell the
  agents apart. 0.11.1 gave each agent its own face; that was not what was wanted.

## [0.11.1] - 2026-10-24

### Changed
- The pink cheeks are gone, runners have a face (eyes, brows, nose, mouth) and the cap's visor sits higher
  so it no longer hides the eyes. (Each agent had its own face in this version; see 0.11.2.)

### Removed
- **The coloured trail behind the runners** (the token flow): nothing told what it meant. The tokens per
  minute stay on the focus card.

## [0.11.0] - 2026-10-24

### Added
- **Context window meter** on every agent card, and with a trend on the focus card of a runner: the size of
  the latest request (new tokens + cache reads and writes) against the model's window, amber from 80 %, red
  from 95 %, with the share served from the cache and the number of compactions. Works for all six agents.
- The event schema has an optional `context_window` (also accepted by the open API). Codex
  (`model_context_window`) and GitHub Copilot (`maxPromptTokens`) report it; for the others a table of
  documented windows is used (Gemini, Claude 3/4/5, Qwen3-Coder, GPT-OSS). A model in neither gets no
  percentage, never a guess. If a request outgrows its table window, the smallest window that holds it is
  shown and the tooltip says so.
- **A notification when a context window passes 80 %** (once per session; below any more urgent situation),
  with its own switch in Settings.

### Limits
- Events recorded before this version carry no window: Codex and Copilot show a percentage from their next
  request on.
- What the context is made of (messages, system tools, MCP tools, skills) is computed by Claude Code's own
  `/context` and never written to disk, so it is not shown.

## [0.10.0] - 2026-10-24

### Added
- **The race shows more, in ten ways.** A token **trail** behind each runner; **hurdles** for the failures
  of the last 15 minutes (a wall when blocked); **flags** at the start for each 30 minutes of session; a
  **cap colour** by model family; a **spotlight** and a few seconds of camera on an agent that starts
  needing you; **confetti** for 3 clean turns in a row and **fireworks** for 6 (or 3 after 30 minutes),
  nothing for an ordinary turn; a **scoreboard** above the stands; a **sky** that follows the time of day
  (dawn, day, dusk with floodlights, starry night; **Settings › Display › Race sky**); a **replay** of the
  last hour in 30 seconds (▶ in the top bar); a **focus** on a runner (click it): the camera comes close and a
  card shows its session, token flow, failures and last actions.
- The legend explains each of them.

### Changed
- Clicking a runner now focuses it instead of going to the agent; *Go to the agent* is on the card and on the
  dock chips.

### Fixed
- **The race could lose its WebGL context.** The check for WebGL support ran on every refresh of the stage,
  opening a new WebGL context each second; browsers drop the oldest ones past a handful, which was the race's
  own. It is now asked once (and gives the context back). This probably explains flicker and heavy GPU use.

## [0.9.3] - 2026-10-24

### Changed
- **Gemini CLI is no longer read at all.** It was hidden in 0.7.0 but its connector kept collecting and
  storing its events. It is not started any more; its past events stay in the database (the only way to remove them is
  "Erase history" in Settings, which deletes every recorded event, not only Gemini's).

## [0.9.2] - 2026-10-24

### Fixed
- The "selected model" lookup was started once per agent card and once for the race, each asking the
  backend every minute (which can run a process listing). One shared poller now serves them all.

### Tests
- The OpenCode command line for the story and Ask is built by a function covered by a test (the
  `--model` argument was not tested in 0.9.1).

## [0.9.1] - 2026-10-24

### Fixed
- **Story and Ask with OpenCode used the wrong model.** Run without `--model`, OpenCode took the model of
  its config file, which may be one the user's key does not serve ("Invalid model name passed in
  model=…"). The app now passes the model the user picked last in OpenCode (`provider/model`, from its
  `state/opencode/model.json`, falling back to its config). The same lookup feeds the "selected" model shown
  on the cards. It follows `XDG_STATE_HOME` / `XDG_CONFIG_HOME` and the same default folders on macOS,
  Windows and Linux.

## [0.9.0] - 2026-10-24

### Added
- **GitHub Copilot connector.** Reads the event logs of Copilot's agent
  (`~/.copilot/session-state/<session>/events.jsonl`, `COPILOT_HOME` respected): Copilot CLI and the
  agent sessions of VS Code, which run on it. Sessions, turns, tokens, model, tool calls and failures
  (with "Keep error messages", their cleaned message). Message text, reasoning and tool results are never
  stored. "Go to agent" opens the folder in VS Code when the Copilot extension is installed.

### Limits
- The older Copilot Chat panel (`workspaceStorage/*/chatSessions`) is not read.
- Tool calls and failures follow the Copilot SDK's event names; only a text-only session was available to
  check them against, so report a session where they do not show.

## [0.8.0] - 2026-10-24

### Added
- **Antigravity: the selected model, by name.** Antigravity only writes an internal code
  (`MODEL_PLACEHOLDER_M319`). The app now asks Antigravity's own local language server (`127.0.0.1`,
  read-only, with the token that app was started with, read from the process list and never stored or
  logged) for the names that go with the codes, e.g. "Gemini 3.8 Flash (Medium)". Only model names are
  kept. The model shows on the race, the cards and the summaries.
- **Cost for Antigravity** at API rates, when the model is priced (Gemini, Claude). GPT-OSS has no
  published price in the table yet: its cost stays unknown.
- Menu-style model names ("Claude Sonnet 4.6 (Thinking)") match the price table.

### Limits
- The model is the one selected when a step is seen: Antigravity does not record it per step.

## [0.7.0] - 2026-10-24

### Added
- **Antigravity connector.** Reads `~/.gemini/antigravity` read-only: every conversation (project, state,
  last activity) and, for recent sessions, the step-by-step transcript (tokens, tool calls, failures and,
  with "Keep error messages", their cleaned message). "Go to agent" opens the Antigravity app. Nothing
  recorded from before the app started; message text and file contents are never stored.
- **The model each agent is set to use** (Claude Code, Codex, Qwen Code, OpenCode) is read from the
  agent's own settings and shown, marked "selected", when no session has reported a model yet.
  OpenCode uses the model picked last in its interface, not only its config file.

### Changed
- **Gemini CLI is no longer shown**: Antigravity replaces it in the race, charts and connectors. Its
  connector stays in the code and its past events stay in the database; Gemini CLI can still write
  the story or answer Ask when it is the installed agent.

## [0.6.2] - 2026-10-24

### Changed
- Race: the name tags now sit behind the runners instead of over them, so heads stay visible.
- README: new hero image (the whole window), and the docs describe the files and commit subjects Ask uses.

## [0.6.1] - 2026-10-24

### Fixed
- The race is centred again in a wide stage: the camera no longer drifts towards the leader, which
  pushed the start line out of the frame.

## [0.6.0] - 2026-10-24

### Added
- **Ask knows which files were edited.** Each session lists the files its agent edited (up to six),
  and Ask can name them exactly.
- **Ask can tell a fix from a feature, as an inference.** For the main sessions, the subjects of the
  Git commits made during the session are added to the facts (read locally, shown in the preview
  before anything is sent) and the agent is told to label any fix/feature call as an inference.
- **Ask covers the whole period.** Sessions beyond the listed ones are summed per project instead of
  being dropped.
- **Keep error messages now covers Codex, Gemini CLI, Qwen Code and OpenCode**, not only Claude Code.
  Codex failures are now detected from non-zero exit codes (they were never flagged before).

### Fixed
- "Files changed" was always 0 except for Cursor: edits made through editing tools (Edit, Write,
  apply_patch, replace…) now count, per distinct file, in Ask, the daily story, the report and the
  agent cards.

## [0.5.1] - 2026-10-24

### Fixed
- Ask: answers no longer mix up figures between sessions or agents. Each session carries its own agent, duration and tokens, in readable units (58 h 53 min, 284.6M), and rankings ("who worked the most", "longest session", "most expensive") are computed by the app and copied by the agent.
- Ask: answers start with the answer in one sentence instead of "it depends".

## [0.5.0] - 2026-10-24

### Added

- **Ask.** A chat about the history: *"why were there errors?"*, *"which agent worked the most?"*. It
  uses an agent you already have (same engine, same consent and same restrictions as the daily
  story: no tools, empty folder, no session kept, nothing sent before you agree) on facts the app
  selects for the chosen period. Answers cite sessions as `[s3]`, a click opens them in the history,
  and they may end with suggested next steps to copy; the app never sends anything to an agent.
- **Browse by day.** A period bar offers 15 min, 1 h, 24 h, All, or a calendar day (arrows and date
  picker). It drives the charts, the history and Ask. A past day is read from the local database
  (`load_analytics_events` takes an upper bound), the charts get a 24-hour axis.
- **Keep error messages (opt-in).** A short, single-line, cleaned version (300 characters; keys,
  tokens, passwords and your home folder removed) of the errors of failed tools, so Ask can explain
  "why". Off by default, Claude Code only for now.

### Changed

- **New layout.** Every tab is in one bar at the top; each tab's drawer still slides in from an edge
  (left: Agents, Repositories; right: Story, Ask; top: Connectors, Settings, Help) and the tab shows
  which. The side and bottom rails are gone.
- **The race takes at most half of the window** (a splitter shrinks it further). The other half is
  the workbench: **charts and history side by side** for the chosen period, always visible. The
  Sessions, Charts, Live feed and Needs a look tabs are replaced by it (the history has a "Needs a
  look" filter).
- The agent dock is a single row; the alert banner sits at the top left of the race.
- The camera frames a wide, short race.

### Removed

- The bottom drawers and the left, right and bottom rails.
- "Load older" in the sessions list (the history now follows the chosen period).

### Security

- Ask uses the same restricted agent run as the story; the facts sent never contain message text,
  commands or folders, and error messages only if you turned that option on.

## [0.4.0] - 2026-10-23

### Changed

- **A rounder, softer race.** No more cubes or sharp edges: the stands are arcs that bend around
  the track, the crowd is made of little capsules, the track has rounded corners and rounded
  lines, the finish is a rainbow arch, the meadow is a round island, trees and clouds are made of
  soft spheres and the runners are built from capsules and spheres, with eyes and rosy cheeks.
  The speech bubbles have a curved tail.
- **A much lighter race**, for Windows laptops and high-density screens in particular. The 3D
  scene no longer uses real-time shadows (soft round shadows instead) or a shadow map; it draws at
  a resolution that fits a pixel budget instead of the full size of a large or high-DPI screen,
  at 30 frames per second instead of 60, and not at all while the window is hidden; trees, crowd
  and track markings are drawn in a handful of calls; texture memory is trimmed.

### Added

- Settings › Display › **3D race quality**: *Light* (low resolution, 20 fps), *Automatic* (default)
  or *Smooth* (sharper, 60 fps).

## [0.3.1] - 2026-10-23

### Fixed

- Windows: the daily story failed with "not a valid Win32 application (error 193)". The program
  lookup picked the extensionless shell script npm installs next to `claude.cmd`; only files
  Windows can start (`.exe`, `.com`, `.cmd`, `.bat`) are now chosen, best first. A failure to
  start an agent now names the program it tried.

## [0.3.0] - 2026-10-23

A new interface, built around the race and sliding drawers, and a story of the day written by an
agent you already have.

### Added

- **The daily story.** An agent already installed (Claude Code, Codex, Gemini CLI, Qwen Code or
  OpenCode — as a command, an editor extension, or Claude's desktop app) writes the story of the
  last 24 hours, on demand and every day at a chosen time (18:00 by default; caught up at the next
  launch if the app was closed). It runs once, with every tool switched off, in an empty folder,
  with no session kept, on a summary of numbers and names. Off until allowed once per agent, with
  the exact summary shown first. No key, nothing to install. Works on macOS and Windows.
  Stories are kept locally (60 at most), can be copied, saved as Markdown or deleted, and are erased
  with the history.
- Runs started for a story never appear in the observer (the report folder is ignored).
- A language-neutral Markdown reader for stories that cannot inject markup.

### Changed

- **New interface and graphic charter ("flight deck").** The race is now the stage that fills the
  window, with a bar over it (agents working, agents that need you, workspace, repository filter,
  race view) and a dock of agent chips along the bottom. Everything else lives in **drawers** that
  slide in from the four edges, each edge with a rail of tabs: Agents, Sessions and Repositories on
  the left; Story and Charts on the right; Live feed and Needs a look at the bottom; Connectors,
  Settings and Help at the top. Drawers resize by dragging their inner edge, can be pinned so the
  stage makes room, and close with `Esc`.
- New look: near-black instrument panels, hairline rules, square corners, small-caps labels and
  tabular mono numbers; the chrome is monochrome so the agents' colours and the status colours are
  the only saturated ones.
- The repository filter is a select in the stage bar instead of a row of chips.
- The 24 h report moved into the Story drawer; its reminder is now a daily notification at the
  story time instead of a rolling 24 hours.
- The sessions list is a select; its summary and timeline stack in one column.

### Removed

- The Overview page, the per-section resizing and maximize controls, the tab bar and the help
  side panel (replaced by the stage, the drawers and the Help tab).

### Security

- The story feature is the only code path that can make anything leave the computer; it is opt-in,
  per agent, previewable and documented in the README and `SECURITY.md`.
- The agent is started with its tools off (`--tools ""` for Claude Code, a read-only sandbox for
  Codex), without persisting a session, in an empty temporary folder, and the prompt goes through
  its input, never its command line.

## [0.2.0] - 2026-10-22

### Changed

- **Minimal, dense interface.** One 40 px header with the tabs inline, one-line section titles
  (the explanation moved into the "i" next to the title), agent cards cut from about 500 px to
  about 110 px (identity, current action, numbers, activity strip), flat surfaces, smaller type
  and spacing. The overview now fits a laptop screen with the race and the first charts visible.
- No scrollbars in navigation: tabs and repository chips wrap instead of scrolling.
- Every scrolling area has a sticky header: event feed and timeline column titles, table
  headers, the sessions list title, chart card titles, help sections.
- Default section heights are smaller (existing custom heights are reset once).
- The 24 h report is available in English and French and follows the new style.
- Race labels, buttons and the mini window follow the denser layout; mini mode shows five agents
  in about 600 px.

### Added

- A notice when the repository filter hides activity, naming where agents are working and
  offering to show everything.
- `docs/DESIGN.md`: the design rules (density, no scrolling navigation, sticky headers, tokens).
- Report screenshots and refreshed screenshots for every page.

### Fixed

- A negative turn duration could show on a card when the clocks differed slightly.

## [0.1.2] - 2026-10-22

### Fixed

- "Go to agent" now finds sessions running in Claude Desktop, the Codex app and editor
  extensions (they were ignored, so the app tried to start a command line that may not exist).
- A stopped session is brought back where it was seen, or with what is installed: its command
  line, its desktop app, then an editor that has its extension. A command that does not exist is
  never run.

### Security

- tokio 1.54.1 (RUSTSEC-2026-0384).
- GitHub Actions are pinned to commit SHAs.

## [0.1.1] - 2026-10-22

### Fixed

- Windows: console windows no longer flash open and closed in a loop. Background `git`,
  `netstat` and `clip` calls now run without a console window.

## [0.1.0] - 2026-10-21

<!-- Set the date to the day the v0.1.0 tag is pushed. -->

First public version.

### Added

- **Desktop app** for macOS and Windows, built with Tauri 2 and React: a local collector on
  `127.0.0.1:43821` protected by a per-installation bearer token, and a local SQLite event
  store.
- **Connectors** for five agents:
  - Claude Code through its official HTTP hooks, plus provider-reported token usage
    (including cache reads and writes) from its session transcripts;
  - Codex from its JSONL rollout logs;
  - Gemini CLI from its local chat records;
  - OpenCode from its SQLite database, opened read-only;
  - Qwen Code from its JSONL chat records.
- A Cursor hooks connector in the native runtime, hidden from the interface for now.
- **Agent cards** that put the agents needing you first, with plain-language statuses
  (blocked, silent, waiting for you, working, idle, not seen yet) and a narration of what
  each agent is doing.
- **Mini mode**: a compact, optionally always-on-top column of agent cards in a corner of the
  screen.
- **Race**: a low-poly 3D stadium where each agent runs on a 100 m track, hopping on events,
  falling on failed tools and finishing at the end of a turn, with speech bubbles; respects
  reduced motion.
- **Analytics** over 15 minutes, 1 hour, 24 hours or the whole history: event rate, tool
  calls and failures, input/output/cache tokens by agent and model.
- **Estimated cost** per session for models with a sourced public price (Claude models),
  always labelled as an estimate.
- **Workspaces**: a folder of Git repositories (up to four levels deep) or a VS Code
  `.code-workspace` file; events attached to their repository, worktrees included; a
  repositories table with branch, ahead/behind, uncommitted changes and agent activity; a
  per-repository filter.
- **Sessions**: every observed session with an end-of-session summary (duration, turns,
  tools, failures, tokens, estimated cost, commits in the session window) and its full event
  timeline, with paging through older events.
- **Settings**: opt-in capture of prompt text and of agent commands (both off by default),
  event retention from 7 days to forever with hourly purge, JSON export and erase of the
  local history.
- In-app help explaining every status, number and term; resizable and full-screen dashboard
  sections.
- Single-instance app: a second launch brings the running window forward.
- macOS `.app` / `.dmg` and Windows NSIS / MSI bundles; `npm run desktop:install-mac` for a
  local macOS install.

### Security

- Workspaces, Git repositories and agent databases are only ever read, never written.
- Agent responses, reasoning, tool outputs and file contents are never persisted.

[Unreleased]: https://github.com/jcalhinho/agent-observer/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/jcalhinho/agent-observer/releases/tag/v0.1.0
