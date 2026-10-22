import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildDailyReport } from "./dailyReport";
import { currentLang, setLang, type Lang } from "./i18n";
import type { SessionEvent } from "./types";

const NOW = Date.parse("2026-10-22T12:00:00Z");

function event(id: string, minutesAgo: number, partial: Partial<SessionEvent>): SessionEvent {
  return {
    schema_version: 1, event_id: id, session_id: "s1", occurred_at: new Date(NOW - minutesAgo * 60_000).toISOString(), provider: "codex", kind: "tool_started",
    project_path: "/work/api", project_hash: null, model: null, tool_name: null, command: null, file_path: null, input_tokens: null, output_tokens: null, duration_ms: null, outcome: null, content: null, ...partial
  } as SessionEvent;
}

describe("24 h report", () => {
  let before: Lang;
  beforeAll(() => { before = currentLang(); });
  afterAll(() => setLang(before));

  it("counts what happened and says so in the chosen language", () => {
    const events = [event("a", 5, {}), event("b", 4, { kind: "tool_failed" }), event("c", 3, { kind: "file_changed", file_path: "/work/api/a.ts" })];
    setLang("en");
    const english = buildDailyReport(events, NOW);
    expect(english.events).toHaveLength(3);
    expect(english.failures).toBe(1);
    expect(english.editorial.summary).toBe("1 agent worked on 1 project, with 3 events observed.");
    expect(english.editorial.highlights).toContain("1 failure(s) to review");
    setLang("fr");
    const french = buildDailyReport(events, NOW);
    expect(french.editorial.summary).toBe("1 agent a travaillé sur 1 projet, avec 3 événements observés.");
    expect(french.editorial.highlights).toContain("1 échec(s) à examiner");
  });

  it("stays ready when nothing happened", () => {
    setLang("en");
    const report = buildDailyReport([], NOW);
    expect(report.editorial.summary).toBe("No agent activity was captured in the last 24 hours.");
    expect(report.agents).toEqual([]);
  });
});
