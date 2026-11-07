import { beforeAll, describe, expect, it } from "vitest";
import { setLang } from "./i18n";
import { cacheHitRate, compact, costInsight, costWithoutCache, duration, fleetTotals, percent, usd } from "./insights";
import { summarizeSession, type SummaryEvent } from "./sessionSummary";

beforeAll(() => setLang("en"));

const sourced = (value: number) => ({ value, origin: "provider" });
let counter = 0;
function usage(model: string, input: number, output: number, cacheRead?: number, cacheWrite?: number): SummaryEvent {
  counter += 1;
  return {
    event_id: `u${counter}`, session_id: "s", occurred_at: `2026-10-21T12:00:${String(counter).padStart(2, "0")}.000Z`, provider: "reasonix", kind: "model_usage",
    model: { value: model, origin: "provider" }, input_tokens: sourced(input), output_tokens: sourced(output),
    cache_read_tokens: cacheRead === undefined ? null : sourced(cacheRead), cache_write_tokens: cacheWrite === undefined ? null : sourced(cacheWrite)
  };
}

describe("formatting", () => {
  it("compacts counts, prices and durations", () => {
    expect(compact(950)).toBe("950");
    expect(compact(12_400)).toBe("12.4k");
    expect(compact(3_200_000)).toBe("3.2M");
    expect(usd(0.004)).toBe("<$0.01");
    expect(usd(1.5)).toBe("$1.50");
    expect(usd(42.4)).toBe("$42");
    expect(percent(0.9)).toBe("90%");
    expect(percent(0.9951)).toBe("99.5%");
    expect(duration(30_000)).toBe("30 s");
    expect(duration(47 * 60_000)).toBe("47 min");
    expect(duration(73 * 60_000)).toBe("1 h 13");
  });
});

describe("cache hit rate", () => {
  it("is the share of the prompt served from the cache", () => {
    expect(cacheHitRate({ input: 100, output: 5, cacheRead: 900, cacheWrite: 0, origins: [], usageEvents: 1 })).toBeCloseTo(0.9);
  });
  it("is unknown, not zero, when the agent reports no cache reads", () => {
    expect(cacheHitRate({ input: 100, output: 5, cacheRead: null, cacheWrite: null, origins: [], usageEvents: 1 })).toBeNull();
    expect(cacheHitRate(null)).toBeNull();
  });
});

describe("what the cache saved", () => {
  const events = [usage("deepseek-v4-flash", 200, 100, 9_800), usage("deepseek-v4-flash", 100, 50, 19_900)];

  it("prices the same requests without any cache and reports the difference", () => {
    const summary = summarizeSession(events)!;
    const insight = costInsight(events, summary)!;
    // With cache: 300 input * 0.3 + 29,700 read * 0.006 + 150 output * 1.2 (per million, peak or not).
    expect(insight.value).toBeGreaterThan(0);
    expect(insight.withoutCache).toBeGreaterThan(insight.value);
    expect(insight.saved).toBeCloseTo((insight.withoutCache ?? 0) - insight.value, 8);
    expect(insight.partial).toBe(false);
  });

  it("has no baseline without cache reads", () => {
    expect(costWithoutCache([usage("deepseek-v4-flash", 1000, 100)])).toBeNull();
  });

  it("does not guess when a model is missing from the price table", () => {
    const mixed = [...events, usage("some-unknown-model", 100, 10, 500)];
    const insight = costInsight(mixed, summarizeSession(mixed)!)!;
    expect(insight.partial).toBe(true);
    expect(insight.saved).toBeNull();
  });
});

describe("fleet totals", () => {
  it("adds up tokens, cache and cost over the agents that report them", () => {
    const one = [usage("deepseek-v4-flash", 100, 10, 900)];
    const two = [usage("deepseek-v4-flash", 300, 20, 100)];
    const pulse = (list: SummaryEvent[]) => {
      const summary = summarizeSession(list)!;
      return { summary, cost: costInsight(list, summary), session: { toolCalls: 3, failures: 1, filesChanged: 2 } };
    };
    const totals = fleetTotals([pulse(one), pulse(two), { summary: null, cost: null, session: null }]);
    expect(totals.agents).toBe(2);
    expect(totals.tokens).toBe(100 + 900 + 10 + 300 + 100 + 20);
    expect(totals.output).toBe(30);
    expect(totals.cacheHit).toBeCloseTo(1000 / 1400);
    expect(totals.toolCalls).toBe(6);
    expect(totals.failures).toBe(2);
    expect(totals.filesChanged).toBe(4);
    expect(totals.cost).toBeGreaterThan(0);
  });

  it("stays null when nobody reports the figure", () => {
    const totals = fleetTotals([{ summary: null, cost: null, session: { toolCalls: 0, failures: 0, filesChanged: 0 } }]);
    expect(totals.tokens).toBeNull();
    expect(totals.cacheHit).toBeNull();
    expect(totals.cost).toBeNull();
  });
});
