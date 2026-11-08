# Connecting an agent

Agent Observer ships with built-in connectors for Claude Code, Codex, Antigravity, GitHub Copilot, OpenCode,
Qwen Code, Reasonix and Cursor (Gemini CLI is no longer observed: Antigravity replaces it, and nothing of Gemini
CLI is read any more). A new agent is added as a built-in connector, in Rust.

> The open local API (`POST /v1/events` and custom connectors) was removed in 0.13 with the move to a
> single screen. The collector now only accepts the hooks of Claude Code and Cursor, the optional Claude
> Code status line, and answers the read-only `GET /v1/activity` used by the MCP server
> ([`tools/mcp`](../tools/mcp/agent-observer-mcp.mjs)).

## Built-in connector (Rust)

Built-in connectors live in `apps/desktop/src-tauri/src/`, one module per agent
(`codex_rollout.rs`, `qwen_sessions.rs`, `opencode_sessions.rs`,
`claude_transcripts.rs`). They follow the same pattern:

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
   check the projection on real local data without printing its content.

Pull requests adding a connector should state which agent versions were tested and what the
connector cannot observe.
