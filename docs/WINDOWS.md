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

## Connectors (open the agent, send one prompt, watch the card)

| Agent | Where the app reads | You should see |
| --- | --- | --- |
| Claude Code | HTTP hooks (set up in **Connectors › Claude Code › Set up**) + `%USERPROFILE%\.claude\projects` | A card with live actions, tokens and the model |
| Codex | `%USERPROFILE%\.codex\sessions` | A card, tokens, cost estimate |
| Qwen Code | `%USERPROFILE%\.qwen\projects` | A card, tokens and model |
| OpenCode | `%USERPROFILE%\.local\share\opencode` (or `OPENCODE_DB`) | A card, tokens; the model matches the one picked in OpenCode |
| Antigravity | `%USERPROFILE%\.gemini\antigravity` | A card per conversation; the model name (for example *Gemini … (Medium)*) |
| GitHub Copilot | `%USERPROFILE%\.copilot\session-state` (or `COPILOT_HOME`), CLI and VS Code agent | A card, tools and failures, the model |

For each, **Connectors › Details** shows the folder it looks at and whether it was found. If a card
does not appear, that line tells you which folder to check.

## What the app does around the agents

- [ ] **Go to agent** (card, notification, race): brings the right terminal or editor window to the
      front (Windows Terminal, PowerShell, VS Code).
- [ ] **Notifications**: finish a turn → a system notification; click it → the agent's window.
- [ ] **Ask / Story**: with an installed agent, an answer comes back; with OpenCode, the model of the
      last prompt is used (no *Invalid model name* error).
- [ ] **Context meter** on the cards of the agents that report a window size.
- [ ] **Race**: runners start, run while the agent works, and jog back to the start a few seconds
      after the turn ends; **2D** and **3D** both draw (no white canvas).
- [ ] **Uninstall** from *Settings › Apps* removes the app.

## Signing

Releases are unsigned until the repository has the signing secrets (see the header of
[`release.yml`](../.github/workflows/release.yml)). Nothing in the app depends on it: signing only
removes the SmartScreen warning.
