import { beforeAll, describe, expect, it } from "vitest";
import { setLang } from "./i18n";
import { budgetState, burnRate, workTime, cacheTrend, collisionKey, costSince, dailyTotals, detectCollisions, localDay } from "./analysis";
import type { SessionEvent } from "./types";

const now = Date.parse("2026-11-07T12:00:00.000Z");
let counter = 0;
beforeAll(() => setLang("en"));

function event(provider: string, kind: string, secondsAgo: number, extra: Partial<SessionEvent> = {}): SessionEvent {
  counter += 1;
  return { event_id: `e${counter}`, session_id: `${provider}-s`, occurred_at: new Date(now - secondsAgo * 1000).toISOString(), provider, kind, project_path: null, tool_name: null, file_path: null, ...extra };
}
const sourced = (value: number) => ({ value, origin: "provider" });
const usage = (provider: string, secondsAgo: number, input: number, output: number, read?: number, model = "deepseek-v4-flash") =>
  event(provider, "model_usage", secondsAgo, { model: { value: model, origin: "provider" }, input_tokens: sourced(input), output_tokens: sourced(output), ...(read === undefined ? {} : { cache_read_tokens: sourced(read) }) });

describe("collisions", () => {
  it("flags two agents editing the same file within 20 minutes", () => {
    const found = detectCollisions([
      event("claude_code", "tool_started", 120, { tool_name: "Edit", file_path: "/work/app/src/main.rs", project_path: "/work/app" }),
      event("codex", "tool_started", 60, { tool_name: "apply_patch", file_path: "/work/app/src/main.rs", project_path: "/work/app" })
    ], now);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: "file", path: "/work/app/src/main.rs", agents: ["claude_code", "codex"] });
  });

  it("does not flag reads, old edits or a single agent", () => {
    expect(detectCollisions([
      event("claude_code", "tool_started", 60, { tool_name: "Read", file_path: "/work/app/a.ts" }),
      event("codex", "tool_started", 60, { tool_name: "Read", file_path: "/work/app/a.ts" }),
      event("claude_code", "tool_started", 3 * 3600, { tool_name: "Edit", file_path: "/work/app/b.ts" }),
      event("codex", "tool_started", 60, { tool_name: "Edit", file_path: "/work/app/b.ts" }),
      event("codex", "tool_started", 30, { tool_name: "Edit", file_path: "/work/app/b.ts" })
    ], now)).toEqual([]);
  });

  it("flags two agents active in the same project without a shared file, but not in the home folder", () => {
    const shared = detectCollisions([
      event("claude_code", "tool_started", 60, { tool_name: "Edit", file_path: "/work/app/a.ts", project_path: "/work/app" }),
      event("qwen_code", "tool_started", 30, { tool_name: "Edit", file_path: "/work/app/web/b.ts", project_path: "/work/app/web" })
    ], now);
    expect(shared).toHaveLength(1);
    expect(shared[0]).toMatchObject({ kind: "repo", path: "/work/app", agents: ["claude_code", "qwen_code"] });
    const home = detectCollisions([
      event("claude_code", "tool_started", 60, { project_path: "/Users/me" }),
      event("codex", "tool_started", 30, { project_path: "/Users/me" })
    ], now);
    expect(home).toEqual([]);
  });

  it("gives a stable key", () => {
    const [collision] = detectCollisions([
      event("a", "tool_started", 60, { tool_name: "Edit", file_path: "/x/y/z.ts" }),
      event("b", "tool_started", 30, { tool_name: "Edit", file_path: "/x/y/z.ts" })
    ], now);
    expect(collisionKey(collision)).toBe("file:/x/y/z.ts:a+b");
  });
});

describe("cache trend", () => {
  const series = (rates: number[]) => rates.map((rate, index) => usage("reasonix", (rates.length - index) * 60, Math.round(1000 * (1 - rate)), 10, Math.round(1000 * rate)));
  it("is null without cache reads or with a single request", () => {
    expect(cacheTrend([usage("reasonix", 10, 1000, 10)])).toBeNull();
    expect(cacheTrend(series([0.9]))).toBeNull();
  });
  it("notices a collapse of the hit rate", () => {
    const trend = cacheTrend(series([0.95, 0.96, 0.97, 0.95, 0.2]))!;
    expect(trend.dropped).toBe(true);
    expect(trend.drops).toBe(1);
    expect(trend.last).toBeCloseTo(0.2);
  });
  it("stays calm when the rate is steady or was never high", () => {
    expect(cacheTrend(series([0.9, 0.92, 0.91, 0.9, 0.89]))!.dropped).toBe(false);
    expect(cacheTrend(series([0.1, 0.1, 0.1, 0.1, 0.0]))!.dropped).toBe(false);
  });
});

describe("burn rate", () => {
  it("is null without any model request in the window", () => {
    expect(burnRate([event("reasonix", "tool_started", 10)], now)).toBeNull();
  });
  it("reports tokens per minute and dollars per hour for priced models", () => {
    const burn = burnRate([usage("reasonix", 600, 1_000_000, 0, 0), usage("reasonix", 30, 1_000_000, 0, 0)], now)!;
    expect(burn.tokensPerMin).toBeCloseTo(2_000_000 / 10, 0);
    expect(burn.usdPerHour).not.toBeNull();
    expect(burn.usdPerHour!).toBeGreaterThan(0);
  });
  it("gives no dollar rate for a model it cannot price", () => {
    const burn = burnRate([usage("x", 30, 1000, 10, undefined, "mystery-model")], now)!;
    expect(burn.usdPerHour).toBeNull();
    expect(burn.tokensPerMin).toBeGreaterThan(0);
  });
  it("prices what was spent since a moment", () => {
    const spend = costSince([usage("reasonix", 600, 1_000_000, 0, 0), usage("reasonix", 30, 1_000_000, 0, 0)], now - 60_000)!;
    const all = costSince([usage("reasonix", 600, 1_000_000, 0, 0), usage("reasonix", 30, 1_000_000, 0, 0)], 0)!;
    expect(spend.value).toBeCloseTo(all.value / 2, 6);
  });
});

describe("budget", () => {
  it("compares the day's spend to the limit", () => {
    expect(budgetState(null, 10)).toBe("none");
    expect(budgetState(5, null)).toBe("none");
    expect(budgetState(5, 10)).toBe("ok");
    expect(budgetState(8, 10)).toBe("near");
    expect(budgetState(10, 10)).toBe("over");
  });
});

describe("daily totals", () => {
  it("groups by local day, agent and project, and keeps the days apart", () => {
    const yesterday = 26 * 3600;
    const days = dailyTotals([
      usage("reasonix", 60, 100, 10, 900),
      { ...usage("reasonix", 30, 100, 10, 900), project_path: "/work/app" },
      usage("claude_code", yesterday, 1000, 100, undefined, "claude-sonnet-5-5"),
      event("claude_code", "tool_failed", 20)
    ], now, 7);
    expect(days.map((day) => day.day)).toEqual([localDay(now), localDay(now - yesterday * 1000)].sort().reverse());
    const today = days.find((day) => day.day === localDay(now))!;
    expect(today.tokens).toBe(2 * (100 + 10 + 900));
    expect(today.cacheHit).toBeCloseTo(0.9);
    expect(today.failures).toBe(1);
    expect(today.byAgent.reasonix.tokens).toBe(2020);
    expect(Object.keys(today.byProject).sort()).toEqual(["", "/work/app"]);
    expect(today.cost).toBeGreaterThan(0);
    expect(today.saved).toBeGreaterThan(0);
  });
  it("drops days older than the window", () => {
    expect(dailyTotals([usage("reasonix", 40 * 86400, 1, 1)], now, 14)).toEqual([]);
  });
});

describe("workTime", () => {
  const ev = (kind: string, at: string, provider = "claude_code", outcome: string | null = null) => ({ provider, kind, outcome, occurred_at: at });
  it("somme les tours sans compter les pauses entre deux", () => {
    const events = [
      ev("user_message", "2026-11-07T10:00:00Z"), ev("tool_finished", "2026-11-07T10:01:00Z"),
      ev("user_message", "2026-11-07T11:00:00Z"), ev("tool_finished", "2026-11-07T11:00:30Z")
    ];
    expect(workTime(events)).toBe(90_000);
  });
  it("est nul quand les tours ne sont pas marqués", () => {
    expect(workTime([ev("tool_finished", "2026-11-07T10:00:00Z")])).toBeNull();
    expect(workTime([])).toBeNull();
  });
  it("lit les tours de Codex par leur marqueur", () => {
    const events = [
      ev("checkpoint", "2026-11-07T10:00:00Z", "codex", "turn-started:a"), ev("tool_finished", "2026-11-07T10:00:20Z", "codex"),
      ev("checkpoint", "2026-11-07T10:05:00Z", "codex", "turn-started:b"), ev("tool_finished", "2026-11-07T10:05:10Z", "codex")
    ];
    expect(workTime(events)).toBe(30_000);
  });
});

describe("dailyTotals : requêtes et cache exact", () => {
  it("compte les requêtes et sépare lus et manqués", () => {
    const at = new Date().toISOString();
    const usage = (id: string, input: number, read: number) => ({ event_id: id, session_id: "s", provider: "claude_code", kind: "model_usage", occurred_at: at, project_path: null, input_tokens: { value: input, origin: "reported" }, output_tokens: { value: 10, origin: "reported" }, cache_read_tokens: { value: read, origin: "reported" } }) as unknown as SessionEvent;
    const [day] = dailyTotals([usage("a", 100, 900), usage("b", 50, 450)], Date.now(), 1);
    expect(day.requests).toBe(2);
    expect(day.hit).toBe(1350);
    expect(day.miss).toBe(150);
    expect(day.prompt).toBe(1500);
  });
});
