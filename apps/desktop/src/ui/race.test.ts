import { describe, expect, it } from "vitest";
import { deriveRaceState, FINISH_HOLD_MS, progressAt, type RaceEvent } from "./race";

const baseTime = Date.parse("2026-10-20T12:00:00.000Z");

function event(provider: string, kind: string, seconds: number, outcome?: string): RaceEvent {
  return {
    event_id: `${provider}-${kind}-${seconds}`,
    session_id: "session-1",
    occurred_at: new Date(baseTime + seconds * 1000).toISOString(),
    provider,
    kind,
    outcome
  };
}

describe("provider race state", () => {
  it("keeps a Claude turn running through tool events until its stop checkpoint", () => {
    const events = [
      event("claude_code", "user_message", 0),
      event("claude_code", "tool_started", 3),
      event("claude_code", "tool_finished", 6)
    ];
    const running = deriveRaceState("claude_code", events, baseTime + 7_000);
    expect(running.status).toBe("running");
    expect(running.activityCount).toBe(3);
    expect(running.progress).toBeGreaterThan(0);

    const finished = deriveRaceState("claude_code", [...events, event("claude_code", "checkpoint", 8)], baseTime + 9_000);
    expect(finished.status).toBe("finished");
    expect(finished.progress).toBe(100);
  });

  it("uses Codex turn markers even when the first task-start event is session_started", () => {
    const started = event("codex", "session_started", 0, "turn-started:t1");
    expect(deriveRaceState("codex", [started], baseTime + 1_000).status).toBe("running");

    const completed = event("codex", "checkpoint", 4, "turn-complete:t1");
    expect(deriveRaceState("codex", [started, completed], baseTime + 5_000).status).toBe("finished");
  });

  it("keeps an OpenCode turn running between its events, and ends it on the idle checkpoint", () => {
    const message = event("opencode", "user_message", 0);
    expect(deriveRaceState("opencode", [message], baseTime + 10_000).status).toBe("running");
    // the model thinks for 100 s without writing anything: still running
    expect(deriveRaceState("opencode", [message], baseTime + 100_000).status).toBe("running");
    const idle = event("opencode", "checkpoint", 120, "turn-completed");
    expect(deriveRaceState("opencode", [message, idle], baseTime + 121_000).status).toBe("finished");
  });

  it("still labels the activity of signal-only agents as recent, then idle", () => {
    const message = event("antigravity", "user_message", 0);
    expect(deriveRaceState("antigravity", [message], baseTime + 10_000).status).toBe("recent");
    expect(deriveRaceState("antigravity", [message], baseTime + 46_000).status).toBe("idle");
  });

  it("does not show activity for another provider's events", () => {
    expect(deriveRaceState("gemini_cli", [event("codex", "user_message", 0)], baseTime + 1_000).status).toBe("ready");
  });

  it("matches Gemini CLI's stored provider key and expires recent activity", () => {
    const message = event("gemini_cli", "user_message", 0);
    expect(deriveRaceState("gemini_cli", [message], baseTime + 10_000).status).toBe("recent");
    expect(deriveRaceState("gemini_cli", [message], baseTime + 46_000).status).toBe("idle");
  });

  it("places a turn on the track with the same formula everywhere", () => {
    const events = [event("claude_code", "user_message", 0), event("claude_code", "tool_started", 3), event("claude_code", "tool_finished", 6)];
    const state = deriveRaceState("claude_code", events, baseTime + 20_000);
    expect(state.progress).toBe(progressAt(state.activityCount, 20));
    expect(progressAt(1, 0)).toBe(7);
    // a turn of a few seconds is already well on its way, and the runner never goes backwards
    expect(progressAt(1, 8)).toBeGreaterThanOrEqual(25);
    const ramp = [0, 2, 5, 10, 30, 60, 120, 300].map((seconds) => progressAt(1, seconds));
    expect([...ramp].sort((a, b) => a - b)).toEqual(ramp);
    expect(progressAt(500, 9999)).toBe(92);
  });

  it("stops running a turn that went silent, so it cannot win over a newer finished one", () => {
    const stale = [
      { ...event("claude_code", "user_message", 0), session_id: "old" },
      { ...event("claude_code", "tool_started", 10), session_id: "old" }
    ];
    const newer = [
      { ...event("claude_code", "user_message", 3600), session_id: "new" },
      { ...event("claude_code", "checkpoint", 3660), session_id: "new" }
    ];
    // An hour in: the old turn was left open long ago, the new one finished a minute ago.
    const state = deriveRaceState("claude_code", [...stale, ...newer], baseTime + 3_665_000);
    expect(state.status).toBe("finished");
    expect(state.progress).toBe(100);
    // Alone, the old turn is idle, not running.
    expect(deriveRaceState("claude_code", stale, baseTime + 3_665_000).status).toBe("idle");
    // A turn that is still being fed stays running.
    expect(deriveRaceState("claude_code", stale, baseTime + 60_000).status).toBe("running");
  });

  it("sends a finished runner back to the start after a short hold", () => {
    const events = [event("claude_code", "user_message", 0), event("claude_code", "checkpoint", 5)];
    expect(deriveRaceState("claude_code", events, baseTime + 8_000).progress).toBe(100);
    const later = deriveRaceState("claude_code", events, baseTime + 5_000 + FINISH_HOLD_MS + 1_000);
    expect(later.status).toBe("idle");
    expect(later.progress).toBe(0);
  });
});
