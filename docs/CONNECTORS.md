# Connecting an agent

Agent Observer ships with built-in connectors for Claude Code, Codex, Antigravity, GitHub Copilot, OpenCode,
Qwen Code, Reasonix, Cursor, Continue, Hermes, Gemini CLI, pi, omp, Kimi Code, Goose, Crush, Zed and Aider, and
recognises Amp, Kiro CLI, Trae CLI, Qoder CLI, CodeBuddy, MiniMax Code, jcode, dsh and iFlow CLI by their
process. A new agent is added as a built-in connector, in Rust.

> The open local API (`POST /v1/events` and custom connectors) was removed in 0.13 with the move to a
> single screen. The collector now only accepts the hooks of Claude Code and Cursor, the optional Claude
> Code status line, and answers the read-only `GET /v1/activity` used by the MCP server
> ([`tools/mcp`](../tools/mcp/agent-observer-mcp.mjs)).

## Built-in connector (Rust)

Built-in connectors live in `apps/desktop/src-tauri/src/`, one module per agent
(`codex_rollout.rs`, `qwen_sessions.rs`, `opencode_sessions.rs`, `continue_sessions.rs`,
`claude_transcripts.rs`…). The readers added in 0.18 share `tail.rs`: `Tail` reads the lines appended to a
file (a file that existed before the app started is read from its end), `Poll` is one reader and
`tail::spawn` runs it on its own thread; `provider`, `derived` and `estimated` tag each value with its
origin. They follow the same pattern:

1. **Find the data the agent already writes** (logs, local database) or receives (hooks). Never
   change the agent's settings; read-only access.
2. **Read only what is appended after startup** — no history import — and survive truncated or
   rotated files.
3. **Project records to `SessionEvent`** (`crates/session-events`): metadata only. Prompt text and
   commands go through the shared capture policy; assistant text, reasoning and tool outputs are
   never stored. Values the agent does not report stay `None`: never estimate silently.
4. **Use stable event ids** when a record can be read twice (UUID v5 from the agent's own ids).
5. **Spawn the monitor** in `main.rs` and add the agent to `Provider` in `crates/session-events`
   and to the provider table in `apps/desktop/src/ui/providers.ts` (keys must match — a test checks it).
6. **Test with fixtures** built in the test (see the `tests` modules of existing connectors) and
   check the projection on real local data without printing its content. Write the fixtures from the
   agent's **official source code** (its log writer, its schema), and say in the module comment which
   files of that source the format comes from — as `continue_sessions.rs` does.
7. **Show it**: add the folders the connector reads to `source_paths` in `main.rs` (the `source_setup`
   command returns them and whether one exists) and the agent's kind to `SOURCE_KINDS` in
   `ConnectorDialog.tsx`, so **Settings › Agents › Configure** and **Settings › Diagnostic** can say where the
   connector reads. Its colour in `activeProviders` only marks its own bar and badge, next to its name: keep
   it in the contrast range given in the comment there.
8. **Watch its format**: add the source file (or documentation page) that defines the format to the
   `watch` list of [`.driftguard.yml`](../.driftguard.yml), narrowed with `start`/`end` to the part the
   connector reads, then `driftguard watch . --update`. The weekly DriftGuard job then says when it changes.

**An agent that writes nothing readable** (closed source, unpublished format) can still be shown as running:
add its executable name to `agent_named` in `process_watch.rs`, taken from a source that launches it (not
guessed), and leave out names other programs commonly use.

Pull requests adding a connector should state which agent versions were tested and what the
connector cannot observe.
