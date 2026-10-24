import { describe, expect, it } from "vitest";
import { contextUsage, windowOf, type ContextEvent } from "./contextUsage";

const T0 = Date.parse("2026-10-24T10:00:00.000Z");
function usage(minute: number, size: { input?: number; read?: number; write?: number }, partial: Partial<ContextEvent> = {}): ContextEvent {
  return {
    kind: "model_usage", occurred_at: new Date(T0 + minute * 60_000).toISOString(), session_id: "s1", model: { value: "claude-sonnet-5-5" },
    input_tokens: size.input === undefined ? null : { value: size.input },
    cache_read_tokens: size.read === undefined ? null : { value: size.read },
    cache_write_tokens: size.write === undefined ? null : { value: size.write },
    ...partial
  };
}

describe("context usage", () => {
  it("adds new input and cache reads and writes, as Claude Code counts them", () => {
    const result = contextUsage([usage(0, { input: 2, read: 570_193, write: 423 }, { context_window: { value: 1_000_000 } })])!;
    expect(result.used).toBe(570_618);
    expect(result.percent).toBe(57.1);
    expect(result.windowSource).toBe("reported");
    expect(result.state).toBe("ok");
    expect(result.cachedShare).toBeCloseTo(0.9993, 3);
  });

  it("takes the window the agent reports over the table", () => {
    const result = contextUsage([usage(0, { input: 100_000 }, { model: { value: "gpt-5.6" }, context_window: { value: 258_400 } })])!;
    expect(result.window).toBe(258_400);
    expect(result.percent).toBe(38.7);
  });

  it("warns at 80 % and 95 %", () => {
    const at = (size: number) => contextUsage([usage(0, { input: size }, { context_window: { value: 100_000 } })])!.state;
    expect([at(79_999), at(80_000), at(94_999), at(95_000)]).toEqual(["ok", "warn", "warn", "full"]);
  });

  it("has no percentage for a model it does not know, rather than a guess", () => {
    const result = contextUsage([usage(0, { input: 5_000 }, { model: { value: "claude-qwen" } })])!;
    expect(result.window).toBeNull();
    expect(result.percent).toBeNull();
    expect(result.state).toBe("unknown");
    expect(result.windowSource).toBeNull();
  });

  it("raises a table window the context has grown past, and says so", () => {
    const result = contextUsage([usage(0, { input: 300_000 }, { model: { value: "claude-sonnet-4-6" } })])!;
    expect(result.window).toBe(400_000);
    expect(result.windowSource).toBe("observed");
  });

  it("reads the latest session only and counts compactions", () => {
    const events = [
      usage(0, { input: 900_000 }, { session_id: "old" }),
      usage(10, { input: 120_000 }), usage(20, { input: 180_000 }), usage(30, { input: 40_000 }), usage(40, { input: 60_000 })
    ];
    const result = contextUsage(events)!;
    expect(result.used).toBe(60_000);
    expect(result.compactions).toBe(1);
    expect(result.series).toEqual([120_000, 180_000, 40_000, 60_000]);
  });

  it("ignores events that are not requests, and returns null without any", () => {
    expect(contextUsage([{ ...usage(0, { input: 10 }), kind: "tool_started" }])).toBeNull();
    expect(contextUsage([])).toBeNull();
  });

  it("downsamples a long session but keeps the latest point", () => {
    const events = Array.from({ length: 100 }, (_, index) => usage(index, { input: 1000 + index }));
    const result = contextUsage(events)!;
    expect(result.series.length).toBeLessThanOrEqual(31);
    expect(result.series.at(-1)).toBe(1099);
  });
});

describe("windows of known models", () => {
  it("knows documented ones and nothing else", () => {
    expect(windowOf("Gemini 3.8 Flash (Medium)")).toBe(1_048_576);
    expect(windowOf("claude-opus-4-6")).toBe(200_000);
    expect(windowOf("claude-sonnet-5-5")).toBe(1_000_000);
    expect(windowOf("claude-qwen")).toBeNull();
    expect(windowOf(null)).toBeNull();
  });
});
