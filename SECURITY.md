# Security Policy

Agent Observer sees a lot about how you work: file paths, tool names, timings, and — if you
opt in — your prompts and the commands your agents run. We take its security seriously.

## Reporting a vulnerability

**Please do not open a public issue, discussion or pull request for a security problem.**

Report it privately through GitHub:
**[Security → Report a vulnerability](https://github.com/jcalhinho/agent-observer/security/advisories/new)**.

Include what you can: affected version and OS, the steps or a proof of concept, and the
impact you expect. You will get an acknowledgement within **5 days** and an assessment
within **14 days**. We will keep you informed, agree on a disclosure date with you (90 days
at most by default), and credit you in the advisory unless you prefer otherwise.

## Supported versions

Agent Observer is pre-1.0: only the **latest release** receives security fixes.

## Scope

In scope — please report:

- **The local collector** (`127.0.0.1:43821`: Claude Code and Cursor hooks, the Claude Code status
  line, the read-only `GET /v1/activity`): reaching it from another machine, from a web page in a
  browser (CSRF, DNS rebinding, CORS), or without the bearer token; bypassing or leaking the token;
  reading private text through `/v1/activity`; crashing the app or exhausting memory/disk with
  crafted requests.
- **The MCP server** (`tools/mcp`): anything that makes it write, or return private text.
- **The collector token** (`collector-token` in the app config directory): weak generation,
  disclosure through the UI, logs, exports or the hook fragments.
- **Privacy guarantees**: content that should never be stored (agent responses, reasoning,
  tool outputs, file contents) ending up in the database or in an export; prompts or commands
  stored while their capture switch is off.
- **Connectors**: crafted agent logs, transcripts or databases leading to code execution,
  path traversal, writes outside the app's data directory, or any write to an agent's files.
- **Git inspection**: a malicious repository in an agent's project folder causing command
  execution or writes (the app only runs `git status` and `git log`, with `core.fsmonitor` off,
  no optional locks and a timeout), or "open folder" opening anything but a folder.
- **The desktop shell**: Tauri capability or CSP weaknesses, script injection in the UI from
  observed data (file names, tool names, prompts).
- **Release integrity**: problems with how installers and checksums are built and published.
- **In-app updates** (releases built with an update signing key): installing an update that is not
  signed by the project's key, downgrades, or the check being made without the user clicking it.
- **The diagnostic** (*Settings › Diagnostic*, *Copy diagnostic*): private text or an unmasked home folder
  in the copied text.

Out of scope:

- Attacks that need an attacker already running code as your user, or with access to your
  user's files (they can read the agents' own logs directly).
- The security of the observed agents themselves.
- Warnings from Gatekeeper or SmartScreen about unsigned builds — known and documented until
  releases are signed.
- Missing hardening without a demonstrated impact (we still welcome it as a normal issue).

## How Agent Observer limits exposure

- The app makes no network request of its own; in a release built with an update signing key, the
  update check runs only when the user clicks **Check**, and an update is installed only if its minisign
  signature matches the public key built into the app.
- The collector binds to the loopback interface only and requires a random per-installation
  bearer token on every request, compared without early exit. `GET /v1/activity` also refuses any
  request carrying an `Origin` header (a web page), and only returns metadata: never prompt text,
  commands or error messages, even when the user keeps them.
- Subscription limits (Codex logs, Claude Code status line) are kept in memory only: percentages,
  window lengths and reset times.
- Agent databases are opened read-only; agent settings are never edited by the app.
- Private content is dropped by the connectors before anything is written to disk.
- One local request to Antigravity: to name the model selected there (its files only hold an internal
  code), the app asks Antigravity's own language server on `127.0.0.1`, read-only, with the token that app
  was started with (read from the process list, kept in memory for the request, never logged, stored or
  sent anywhere). Only model names are kept from the answer; account and plan fields are dropped unread.
  Nothing happens if Antigravity is not running.
- The process list is read every 4 seconds (name, command line, working folder) to recognise agents that
  write nothing readable, and Aider. Only the recognised agent, its start time and its working folder are
  recorded; command lines are never stored or logged.
- No telemetry and no network request of its own.
