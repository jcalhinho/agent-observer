import { describe, expect, it } from "vitest";
import { pastSessions, sessionRowsFromEvents } from "./pastSessions";
import type { SessionEvent } from "./types";

let counter = 0;
function event(session: string, kind: string, at: string, extra: Partial<SessionEvent> = {}): SessionEvent {
  counter += 1;
  return { event_id: `e${counter}`, session_id: session, occurred_at: at, provider: "codex", kind, project_path: null, tool_name: null, file_path: null, ...extra };
}
const sourced = (value: number) => ({ value, origin: "provider" });

describe("past sessions", () => {
  const events = [
    event("a", "session_started", "2026-11-01T10:00:00.000Z", { project_path: "/work/api" }),
    event("a", "tool_started", "2026-11-01T10:01:00.000Z", { tool_name: "shell" }),
    event("a", "tool_finished", "2026-11-01T10:02:00.000Z", { tool_name: "shell" }),
    event("a", "tool_failed", "2026-11-01T10:03:00.000Z", { tool_name: "read" }),
    event("a", "model_usage", "2026-11-01T10:30:00.000Z", { model: { value: "gpt-5.5", origin: "provider" }, input_tokens: sourced(1000), output_tokens: sourced(100) }),
    event("b", "model_usage", "2026-11-02T09:00:00.000Z", { model: { value: "unknown-model", origin: "provider" }, input_tokens: sourced(50) }),
    event("now", "session_started", "2026-11-08T09:00:00.000Z"),
    { ...event("x", "session_started", "2026-11-08T09:00:00.000Z"), provider: "claude_code" }
  ];

  it("sums up each session from the rows and leaves out the current one", () => {
    const rows = sessionRowsFromEvents(events, "codex");
    expect(rows.sessions.map((session) => session.session_id)).toEqual(["now", "b", "a"]);
    const list = pastSessions(rows, "now");
    expect(list.map((session) => session.id)).toEqual(["b", "a"]);
    const a = list[1];
    expect(a).toMatchObject({ project: "/work/api", events: 5, toolCalls: 2, failures: 1, tokens: 1100, observedMs: 30 * 60_000 });
    expect(a.cost?.value).toBeGreaterThan(0);
    expect(a.cost?.partial).toBe(false);
  });

  it("shows no cost when the model is not priced and no tokens when none were reported", () => {
    const list = pastSessions(sessionRowsFromEvents(events, "codex"), null);
    expect(list.find((session) => session.id === "b")).toMatchObject({ tokens: 50, cost: null });
    expect(list.find((session) => session.id === "now")).toMatchObject({ tokens: null, cost: null, toolCalls: 0 });
  });
});
