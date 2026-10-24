import { describe, expect, it } from "vitest";
import { celebrationFor, daypartAt, formatMinutes, laneInsights, LAP_MINUTES, MAX_HURDLES, modelFamily, replayClock, type InsightEvent } from "./raceInsights";

const NOW = Date.parse("2026-10-24T12:00:00.000Z");
const minute = (ago: number) => new Date(NOW - ago * 60_000).toISOString();
function event(kind: string, ago: number, partial: Partial<InsightEvent> = {}): InsightEvent {
  return { event_id: `${kind}-${ago}`, provider: "claude_code", session_id: "s1", occurred_at: minute(ago), kind, ...partial };
}

describe("lane insights", () => {
  it("counts the work span of the latest session in laps", () => {
    const events = [event("user_message", 70), event("tool_started", 5)];
    const insights = laneInsights("claude_code", events, NOW);
    expect(insights.sessionMinutes).toBe(65);
    expect(insights.laps).toBe(Math.floor(65 / LAP_MINUTES));
    expect(laneInsights("codex", events, NOW).sessionMinutes).toBe(0);
  });

  it("measures the token flow over the last five minutes", () => {
    const burst = (ago: number, tokens: number) => event("model_usage", ago, { input_tokens: { value: tokens }, output_tokens: { value: 0 } });
    const quiet = laneInsights("claude_code", [event("user_message", 1), burst(20, 9_000_000)], NOW);
    expect(quiet.tokensPerMinute).toBe(0);
    const some = laneInsights("claude_code", [burst(2, 5_000)], NOW);
    expect(some.tokensPerMinute).toBe(1000);
  });

  it("counts recent failures, capped, and ignores old ones", () => {
    const failures = Array.from({ length: 9 }, (_, index) => event("tool_failed", index + 1));
    expect(laneInsights("claude_code", [...failures, event("tool_failed", 40)], NOW).recentFailures).toBe(MAX_HURDLES);
    expect(laneInsights("claude_code", [event("tool_failed", 40)], NOW).recentFailures).toBe(0);
  });

  it("leaves a hurdle where each tool failed during the turn in progress, and none outside it", () => {
    const turnStart = NOW - 5 * 60_000;
    const events = [
      event("tool_failed", 20), // an earlier turn
      event("user_message", 5), event("tool_started", 4.5), event("tool_failed", 4), event("tool_started", 3), event("tool_failed", 2)
    ];
    const marks = laneInsights("claude_code", events, NOW, turnStart).failureMarks;
    expect(marks).toHaveLength(2);
    expect(marks[1]).toBeGreaterThan(marks[0]);
    expect(marks.every((mark) => mark > 0 && mark <= 92)).toBe(true);
    // The marks do not move with time at a fixed point of the turn, and vanish when no turn is open.
    expect(laneInsights("claude_code", events, NOW, null).failureMarks).toEqual([]);
    expect(laneInsights("claude_code", [event("user_message", 30), event("tool_failed", 29)], NOW, NOW - 30 * 60_000).failureMarks).toEqual([]);
  });

  it("counts clean completed turns in a row, broken by a failure", () => {
    const turn = (end: number, failed = false) => [...(failed ? [event("tool_failed", end + 1)] : []), event("checkpoint", end, { outcome: "turn-complete" })];
    expect(laneInsights("claude_code", [...turn(50), ...turn(40), ...turn(30)], NOW).streak).toBe(3);
    expect(laneInsights("claude_code", [...turn(50), ...turn(40, true), ...turn(30), ...turn(20)], NOW).streak).toBe(2);
    expect(laneInsights("claude_code", [...turn(50), ...turn(40, true)], NOW).streak).toBe(0);
    // A permission request is a pause, not the end of a turn.
    expect(laneInsights("claude_code", [event("checkpoint", 5, { outcome: "attention:needs approval" })], NOW).streak).toBe(0);
  });

  it("celebrates in proportion: nothing for an ordinary turn", () => {
    expect(celebrationFor(1, 0)).toBe("none");
    expect(celebrationFor(2, 5)).toBe("none");
    expect(celebrationFor(3, 0)).toBe("confetti");
    expect(celebrationFor(3, 1)).toBe("fireworks");
    expect(celebrationFor(6, 0)).toBe("fireworks");
  });
});

describe("model family", () => {
  it("names the family of each model, Qwen before Claude for claude-qwen", () => {
    expect(modelFamily("claude-qwen")).toBe("qwen");
    expect(modelFamily("claude-sonnet-4-6")).toBe("claude");
    expect(modelFamily("Gemini 3.8 Flash (Medium)")).toBe("gemini");
    expect(modelFamily("gpt-5.6-luna")).toBe("gpt");
    expect(modelFamily("glm-5.3-flash")).toBe("glm");
    expect(modelFamily("mai-code-1.1-flash")).toBe("copilot");
    expect(modelFamily("big-pickle")).toBe("unknown");
    expect(modelFamily(null)).toBe("unknown");
  });
});

describe("time of day and replay", () => {
  it("splits the local day into four parts", () => {
    const at = (hour: number) => daypartAt(new Date(2026, 9, 24, hour, 30));
    expect([at(4), at(6), at(12), at(18), at(20), at(21), at(23)]).toEqual(["night", "dawn", "day", "dusk", "dusk", "night", "night"]);
  });

  it("replays the last hour in thirty seconds and stops there", () => {
    expect(replayClock(NOW, 1000, 1000).virtualNow).toBe(NOW - 3_600_000);
    expect(replayClock(NOW, 1000, 16_000).progress).toBe(0.5);
    expect(replayClock(NOW, 1000, 16_000).virtualNow).toBe(NOW - 1_800_000);
    const end = replayClock(NOW, 1000, 99_000);
    expect(end.done).toBe(true);
    expect(end.virtualNow).toBe(NOW);
  });

  it("writes minutes the short way", () => {
    expect([formatMinutes(7), formatMinutes(59), formatMinutes(65), formatMinutes(180)]).toEqual(["7 min", "59 min", "1 h 05", "3 h 00"]);
  });
});
