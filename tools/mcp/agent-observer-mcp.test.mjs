import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { defaultTokenFile, handle, overlaps } from "./agent-observer-mcp.mjs";

const TEST_TOKEN = "test-token-123";
const now = new Date().toISOString();
const fixture = {
  generated_at: now,
  window_minutes: 30,
  sessions: [
    { agent: "codex", session_id: "s1", project_path: "/work/api", started_at: now, last_event_at: now, events: 9, tool_calls: 4, failures: 1, last_tool: "apply_patch", last_file: "/work/api/src/main.rs", files_edited: ["/work/api/src/main.rs"], model: "gpt-5", waiting_for_user: false },
    { agent: "claude_code", session_id: "s2", project_path: "/work/web", started_at: now, last_event_at: now, events: 3, tool_calls: 1, failures: 0, last_tool: "Read", last_file: null, files_edited: [], model: null, waiting_for_user: true }
  ],
  limits: [{ provider: "codex", observed_at: now, plan: "plus", primary: { used_percent: 86, window_minutes: 300, resets_at: Math.round(Date.now() / 1000) + 3600 }, secondary: null }]
};

function fakeObserver() {
  const seen = [];
  const server = createServer((request, response) => {
    seen.push({ url: request.url, auth: request.headers.authorization });
    if (request.headers.authorization !== `Bearer ${TEST_TOKEN}`) {
      response.writeHead(401).end();
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(fixture));
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, seen, url: `http://127.0.0.1:${server.address().port}` })));
}

test("folders overlap when one contains the other", () => {
  assert.ok(overlaps("/work/api", "/work/api/"));
  assert.ok(overlaps("/work/api/src", "/work/api"));
  assert.ok(overlaps("/work", "/work/api"));
  assert.ok(!overlaps("/work/api", "/work/api2"));
  assert.ok(overlaps("C:\\Users\\me\\proj", "c:/users/me/proj/src"));
});

test("token file follows the app's config folder", () => {
  assert.equal(defaultTokenFile("darwin", {}, "/Users/me"), "/Users/me/Library/Application Support/dev.repowatcher.agentobserver/collector-token");
  assert.equal(defaultTokenFile("linux", {}, "/home/me"), "/home/me/.config/dev.repowatcher.agentobserver/collector-token");
  assert.equal(defaultTokenFile("linux", { XDG_CONFIG_HOME: "/cfg" }, "/home/me"), "/cfg/dev.repowatcher.agentobserver/collector-token");
  assert.equal(defaultTokenFile("win32", { APPDATA: "C:\\Users\\me\\AppData\\Roaming" }, "C:\\Users\\me"), "C:\\Users\\me\\AppData\\Roaming\\dev.repowatcher.agentobserver\\collector-token");
  assert.equal(defaultTokenFile("win32", {}, "C:\\Users\\me"), "C:\\Users\\me\\AppData\\Roaming\\dev.repowatcher.agentobserver\\collector-token");
});

test("who_else_is_here keeps only the sessions around the folder", async () => {
  const { server, seen, url } = await fakeObserver();
  try {
    const env = { AGENT_OBSERVER_URL: url, AGENT_OBSERVER_TOKEN: TEST_TOKEN };
    const answer = await handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "who_else_is_here", arguments: { path: "/work/api/src" } } }, env);
    assert.equal(answer.result.isError, false);
    assert.deepEqual(answer.result.structuredContent.sessions.map((session) => session.agent), ["codex"]);
    assert.match(answer.result.content[0].text, /files edited: \/work\/api\/src\/main\.rs/);
    assert.equal(seen[0].url, "/v1/activity?minutes=30");
    assert.equal(seen[0].auth, `Bearer ${TEST_TOKEN}`);
    const none = await handle({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "who_else_is_here", arguments: { path: "/elsewhere", minutes: 5000 } } }, env);
    assert.match(none.result.content[0].text, /No agent was active/);
    assert.equal(seen[1].url, "/v1/activity?minutes=1440");
    const limits = await handle({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "subscription_limits", arguments: {} } }, env);
    assert.match(limits.result.content[0].text, /codex \(plus\).*\n {2}short window: 86% used, resets in 60 min/);
    const refused = await handle({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "recent_activity", arguments: {} } }, { ...env, AGENT_OBSERVER_TOKEN: "wrong" });
    assert.equal(refused.result.isError, true);
    assert.match(refused.result.content[0].text, /refused the token/);
    const bad = await handle({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "who_else_is_here", arguments: {} } }, env);
    assert.equal(bad.result.isError, true);
  } finally {
    server.close();
  }
});

test("a closed app is reported as such", async () => {
  const answer = await handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "recent_activity", arguments: {} } }, { AGENT_OBSERVER_URL: "http://127.0.0.1:9", AGENT_OBSERVER_TOKEN: TEST_TOKEN });
  assert.equal(answer.result.isError, true);
  assert.match(answer.result.content[0].text, /not running/);
});

test("speaks MCP over stdio", async () => {
  const { server, url } = await fakeObserver();
  const child = spawn(process.execPath, [fileURLToPath(new URL("./agent-observer-mcp.mjs", import.meta.url))], { env: { ...process.env, AGENT_OBSERVER_URL: url, AGENT_OBSERVER_TOKEN: TEST_TOKEN } });
  const answers = [];
  let buffer = "";
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      answers.push(JSON.parse(buffer.slice(0, index)));
      buffer = buffer.slice(index + 1);
    }
  });
  const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
  const waitFor = async (count) => {
    for (let i = 0; i < 100 && answers.length < count; i += 1) await new Promise((resolve) => setTimeout(resolve, 30));
  };
  try {
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "recent_activity", arguments: { minutes: 10 } } });
    send({ jsonrpc: "2.0", id: 4, method: "nope" });
    await waitFor(4);
    const byId = Object.fromEntries(answers.map((answer) => [answer.id, answer]));
    assert.equal(byId[1].result.protocolVersion, "2025-06-18");
    assert.deepEqual(byId[1].result.capabilities, { tools: {} });
    assert.deepEqual(byId[2].result.tools.map((tool) => tool.name), ["who_else_is_here", "recent_activity", "subscription_limits"]);
    assert.ok(byId[2].result.tools.every((tool) => tool.annotations.readOnlyHint && !("run" in tool)));
    assert.match(byId[3].result.content[0].text, /2 session\(s\) in the last 10 min/);
    assert.equal(byId[4].error.code, -32601);
    assert.equal(answers.length, 4, "the notification gets no answer");
  } finally {
    child.kill();
    server.close();
  }
});
