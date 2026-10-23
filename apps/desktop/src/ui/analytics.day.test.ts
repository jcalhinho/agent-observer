import { describe, expect, it } from "vitest";
import { dayRange, dayWindow, eventsInRange, isDayRange, isDayText, isToday, rangeLabel, timeAxis } from "./analytics";
import type { SessionEvent } from "./types";

const event = (at: Date) => ({ event_id: String(at.getTime()), session_id: "s", occurred_at: at.toISOString(), provider: "codex", kind: "tool_started" }) as SessionEvent;

describe("calendar days as ranges", () => {
  it("round-trips a local day, midnight to midnight", () => {
    const range = dayRange(new Date(2026, 9, 23, 15, 30));
    expect(range).toBe("day:2026-10-23");
    expect(isDayRange(range)).toBe(true);
    const { start, end } = dayWindow("day:2026-10-23");
    expect(start).toBe(new Date(2026, 9, 23).getTime());
    expect(end).toBe(new Date(2026, 9, 24).getTime());
  });

  it("builds a 24-slot axis for the day and keeps only that day's events", () => {
    const axis = timeAxis([], "day:2026-10-23", new Date(2026, 9, 24, 10).getTime());
    expect(axis.buckets).toBe(24);
    expect(axis.end - axis.start).toBe(24 * 60 * 60_000);
    const inside = event(new Date(2026, 9, 23, 12));
    const outside = event(new Date(2026, 9, 24, 0, 30));
    expect(eventsInRange([inside, outside], axis)).toEqual([inside]);
  });

  it("knows which day is today and rejects malformed days", () => {
    const now = new Date(2026, 9, 23, 9).getTime();
    expect(isToday("day:2026-10-23", now)).toBe(true);
    expect(isToday("day:2026-10-22", now)).toBe(false);
    expect(isDayText("day:2026-10-23")).toBe(true);
    expect(isDayText("day:23/10/2026")).toBe(false);
    expect(isDayText("24h")).toBe(false);
    expect(rangeLabel("24h")).toBe("24 h");
  });
});
