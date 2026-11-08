#!/usr/bin/env node
// Read-only MCP server for Agent Observer: lets an agent ask "who else is working in this folder?"
// before it edits files, and see recent activity and subscription limits.
//
// No dependency: Node 18+ only. It talks MCP (JSON-RPC 2.0, one message per line) on stdin/stdout
// and reads GET http://127.0.0.1:43821/v1/activity with this installation's token. It never writes
// anything, and the app never sends prompt text, commands or error messages through it.
//
// Claude Code:  claude mcp add agent-observer -- node /path/to/agent-observer-mcp.mjs
// Codex:        [mcp_servers.agent-observer] command = "node", args = ["/path/to/agent-observer-mcp.mjs"]
//
// Environment (all optional):
//   AGENT_OBSERVER_URL         default http://127.0.0.1:43821
//   AGENT_OBSERVER_TOKEN       the token itself, or
//   AGENT_OBSERVER_TOKEN_FILE  where to read it (default: the app's config folder)

import { readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { posix, win32 } from "node:path";
import { createInterface } from "node:readline";

const SERVER = { name: "agent-observer", version: "0.13.3" };
const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const IDENTIFIER = "dev.repowatcher.agentobserver";

export function defaultTokenFile(os = platform(), env = process.env, home = homedir()) {
  // Separators of the target system, whatever machine computes the path.
  const { join } = os === "win32" ? win32 : posix;
  if (os === "darwin") return join(home, "Library", "Application Support", IDENTIFIER, "collector-token");
  if (os === "win32") return join(env.APPDATA ?? join(home, "AppData", "Roaming"), IDENTIFIER, "collector-token");
  return join(env.XDG_CONFIG_HOME ?? join(home, ".config"), IDENTIFIER, "collector-token");
}

function token(env = process.env) {
  if (env.AGENT_OBSERVER_TOKEN) return env.AGENT_OBSERVER_TOKEN.trim();
  const file = env.AGENT_OBSERVER_TOKEN_FILE ?? defaultTokenFile();
  try {
    return readFileSync(file, "utf8").trim();
  } catch {
    throw new Error(`Agent Observer's token was not found at ${file}. Open the app once, or set AGENT_OBSERVER_TOKEN.`);
  }
}

/** Same folder, or one inside the other: both agents can touch the same files. */
export function normalizePath(path) {
  let value = String(path).replace(/\\/g, "/");
  if (value.length > 1) value = value.replace(/\/+$/, "");
  return /^[a-zA-Z]:\//.test(value) ? value.toLowerCase() : value;
}

export function overlaps(a, b) {
  const x = normalizePath(a);
  const y = normalizePath(b);
  return x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`);
}

async function activity(minutes, env = process.env) {
  const base = (env.AGENT_OBSERVER_URL ?? "http://127.0.0.1:43821").replace(/\/+$/, "");
  const bearer = token(env);
  let response;
  try {
    response = await fetch(`${base}/v1/activity?minutes=${minutes}`, {
      headers: { Authorization: `Bearer ${bearer}` },
      signal: AbortSignal.timeout(3000)
    });
  } catch {
    throw new Error(`Agent Observer is not running (nothing answers on ${base}). Open the app and try again.`);
  }
  if (response.status === 401) throw new Error("Agent Observer refused the token: it changed, read it again from the app's folder.");
  if (!response.ok) throw new Error(`Agent Observer answered ${response.status}.`);
  return response.json();
}

const ago = (iso, now) => {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  return seconds < 90 ? `${seconds}s ago` : seconds < 5400 ? `${Math.round(seconds / 60)} min ago` : `${Math.round(seconds / 3600)} h ago`;
};

function describe(session, now) {
  const parts = [`${session.agent} — ${session.waiting_for_user ? "waiting for its user" : "active"} ${ago(session.last_event_at, now)}`];
  if (session.project_path) parts.push(`  folder: ${session.project_path}`);
  if (session.last_tool) parts.push(`  last tool: ${session.last_tool}${session.last_file ? ` on ${session.last_file}` : ""}`);
  if (session.files_edited.length) parts.push(`  files edited: ${session.files_edited.join(", ")}`);
  parts.push(`  ${session.tool_calls} tool calls, ${session.failures} failed, session ${session.session_id}`);
  return parts.join("\n");
}

const minutesArg = (value, fallback) => {
  const number = Number(value ?? fallback);
  return Number.isFinite(number) ? Math.min(1440, Math.max(1, Math.round(number))) : fallback;
};

export const TOOLS = [
  {
    name: "who_else_is_here",
    title: "Who else is working in this folder?",
    description: "Lists the AI coding agents (Claude Code, Codex, Cursor, Copilot...) that were active in a folder, or in a folder inside or above it, during the last minutes, with the files they edited. Call it before editing files to avoid working on top of another agent.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute path of the folder you are working in." },
        minutes: { type: "number", description: "How far back to look, 1 to 1440 minutes (default 30)." }
      },
      required: ["path"]
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async run(args, env) {
      if (typeof args.path !== "string" || !args.path.trim()) throw new Error("`path` must be the absolute path of a folder.");
      const minutes = minutesArg(args.minutes, 30);
      const data = await activity(minutes, env);
      const now = Date.now();
      const here = data.sessions.filter((session) => session.project_path && overlaps(session.project_path, args.path));
      const text = here.length
        ? `${here.length} session(s) active in or around ${args.path} in the last ${minutes} min:\n\n${here.map((session) => describe(session, now)).join("\n\n")}`
        : `No agent was active in or around ${args.path} in the last ${minutes} min.`;
      return { text, structured: { path: args.path, window_minutes: minutes, sessions: here } };
    }
  },
  {
    name: "recent_activity",
    title: "Recent activity of all agents",
    description: "Summarizes every agent session seen by Agent Observer in the last minutes: folder, last tool, files edited, failures, and whether it waits for its user.",
    inputSchema: { type: "object", properties: { minutes: { type: "number", description: "How far back to look, 1 to 1440 minutes (default 60)." } } },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async run(args, env) {
      const minutes = minutesArg(args.minutes, 60);
      const data = await activity(minutes, env);
      const now = Date.now();
      const text = data.sessions.length
        ? `${data.sessions.length} session(s) in the last ${minutes} min:\n\n${data.sessions.map((session) => describe(session, now)).join("\n\n")}`
        : `No agent activity in the last ${minutes} min.`;
      return { text, structured: { window_minutes: minutes, sessions: data.sessions } };
    }
  },
  {
    name: "subscription_limits",
    title: "Subscription usage limits",
    description: "The usage limits the agents themselves reported (Codex 5-hour and weekly windows; Claude Code when its optional status line is set up): percentage used and reset time.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async run(_args, env) {
      const data = await activity(1, env);
      const now = Date.now() / 1000;
      const window = (name, value) => {
        if (!value) return null;
        const reset = value.resets_at ? Math.round((value.resets_at - now) / 60) : null;
        if (reset !== null && reset <= 0) return `  ${name}: reset since the last reading`;
        return `  ${name}: ${Math.round(value.used_percent)}% used${reset !== null ? `, resets in ${reset} min` : ""}`;
      };
      const text = data.limits.length
        ? data.limits.map((limit) => [`${limit.provider}${limit.plan ? ` (${limit.plan})` : ""}, reported ${ago(limit.observed_at, Date.now())}`, window("short window", limit.primary), window("long window", limit.secondary)].filter(Boolean).join("\n")).join("\n\n")
        : "No agent has reported subscription limits yet.";
      return { text, structured: { limits: data.limits } };
    }
  }
];

export async function handle(message, env = process.env) {
  const { id, method, params } = message;
  const reply = (result) => ({ jsonrpc: "2.0", id, result });
  const error = (code, text) => ({ jsonrpc: "2.0", id, error: { code, message: text } });
  if (id === undefined || id === null) return null; // notifications need no answer
  switch (method) {
    case "initialize": {
      const asked = params?.protocolVersion;
      return reply({
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: SERVER,
        instructions: "Read-only view of the AI coding agents observed by Agent Observer on this computer. Use who_else_is_here before editing files in a shared folder."
      });
    }
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: TOOLS.map(({ run, ...tool }) => tool) });
    case "tools/call": {
      const tool = TOOLS.find((candidate) => candidate.name === params?.name);
      if (!tool) return error(-32602, `Unknown tool: ${params?.name}`);
      try {
        const { text, structured } = await tool.run(params?.arguments ?? {}, env);
        return reply({ content: [{ type: "text", text }], structuredContent: structured, isError: false });
      } catch (failure) {
        return reply({ content: [{ type: "text", text: failure instanceof Error ? failure.message : String(failure) }], isError: true });
      }
    }
    default:
      return error(-32601, `Method not found: ${method}`);
  }
}

function serve() {
  const lines = createInterface({ input: process.stdin });
  lines.on("line", async (line) => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })}\n`);
      return;
    }
    const answer = await handle(message);
    if (answer) process.stdout.write(`${JSON.stringify(answer)}\n`);
  });
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("agent-observer-mcp.mjs")) serve();
