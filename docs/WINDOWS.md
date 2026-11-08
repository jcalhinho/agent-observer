# Windows test checklist

Agent Observer is built and tested on Windows by CI (compile, unit tests, installers), but the
agent integrations read files that only exist on a computer where the agents are installed. This
checklist is what to go through on a real Windows PC before trusting a release there. Each line says
what to do and what you should see. Report anything that differs with the
[bug template](../.github/ISSUE_TEMPLATE/bug_report.yml) (version, Windows version, the agent and where it runs).

## Install

- [ ] Run `Agent-Observer_<version>_windows-x64-setup.exe`. SmartScreen shows *Windows protected
      your PC* because the installer is not signed: **More info › Run anyway**.
- [ ] The app opens, the status in the header says *Collecting*, no console window flashes in the
      background.

## Connectors (open the agent, send one prompt, watch its bar)

| Agent | Where the app reads | You should see |
| --- | --- | --- |
| Claude Code | HTTP hooks (set up in **Settings › Claude Code**) + `%USERPROFILE%\.claude\projects` | A bar with live actions, tokens and the model |
| Codex | `%USERPROFILE%\.codex\sessions` | A bar, tokens, cost estimate, subscription limits |
| Qwen Code | `%USERPROFILE%\.qwen\projects` | A bar, tokens and model |
| OpenCode | `%USERPROFILE%\.local\share\opencode` (or `OPENCODE_DB`) | A bar, tokens; the model matches the one picked in OpenCode |
| Antigravity | `%USERPROFILE%\.gemini\antigravity` | A bar per conversation; the model name (for example *Gemini … (Medium)*) |
| GitHub Copilot | `%USERPROFILE%\.copilot\session-state` (or `COPILOT_HOME`), CLI and VS Code agent | A bar, tools and failures, the model |

For each, **Settings** shows the folder it looks at and whether it was found. If a bar
does not appear, that line tells you which folder to check.

## What the app does around the agents

- [ ] **Notifications**: let an agent finish a turn while the window is in the background → a system
      notification (the dock badge exists on macOS only).
- [ ] **Open folder** (folder icon on a bar): opens the project folder in Explorer, never a file.
- [ ] **Git** row on a bar: branch and changed files of the project; no console window flashes.
- [ ] **Shrink to a column** (top right): the window moves to the right edge of the screen, kept on top;
      the other button brings the full window back.
- [ ] **Light / dark theme** button: the whole screen switches, no white background in light mode.
- [ ] **History**: today, 7, 30 and 90 days fill from the local database.
- [ ] **Uninstall** from *Settings › Apps* removes the app.

## Signing

Releases are unsigned until the repository has the signing secrets (see the header of
[`release.yml`](../.github/workflows/release.yml)). Nothing in the app depends on it: signing only
removes the SmartScreen warning.
