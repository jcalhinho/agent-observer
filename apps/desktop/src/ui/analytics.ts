import { locale, t } from "./i18n";
import type { SessionEvent } from "./types";

/** Time windows offered above the charts; "all" spans the loaded events. */
export type AnalyticsRange = "15m" | "1h" | "24h" | "all" | `day:${string}`;

export const RANGES: AnalyticsRange[] = ["15m", "1h", "24h", "all"];

/** A calendar day in local time, as a range: `day:2026-10-23`. */
export const dayRange = (date: Date): AnalyticsRange => `day:${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
export const isDayRange = (range: AnalyticsRange): range is `day:${string}` => range.startsWith("day:");
/** Midnight to midnight of a day range, local time (the next midnight is exclusive). */
export function dayWindow(range: `day:${string}`) {
  const [year, month, day] = range.slice(4).split("-").map(Number);
  return { start: new Date(year, month - 1, day).getTime(), end: new Date(year, month - 1, day + 1).getTime() };
}
export const isToday = (range: AnalyticsRange, now = Date.now()) => isDayRange(range) && range === dayRange(new Date(now));
export const isDayText = (value: unknown): value is AnalyticsRange => typeof value === "string" && /^day:\d{4}-\d{2}-\d{2}$/.test(value);

export function rangeLabel(range: AnalyticsRange) {
  if (isDayRange(range)) return new Date(dayWindow(range).start).toLocaleDateString(locale(), { day: "numeric", month: "short" });
  return range === "all" ? t("Tout", "All") : range === "15m" ? "15 min" : range === "1h" ? "1 h" : "24 h";
}

const MINUTE = 60_000;
const RANGE_SPECS: Record<"15m" | "1h" | "24h", { span: number; buckets: number }> = {
  "15m": { span: 15 * MINUTE, buckets: 30 },
  "1h": { span: 60 * MINUTE, buckets: 30 },
  "24h": { span: 24 * 60 * MINUTE, buckets: 24 }
};

export type TimeAxis = { start: number; end: number; bucketMs: number; buckets: number };

/** Bucket boundaries for a range; "all" stretches from the oldest loaded event to now. */
export function timeAxis(events: SessionEvent[], range: AnalyticsRange, now: number): TimeAxis {
  if (isDayRange(range)) {
    const { start, end } = dayWindow(range);
    return { start, end, bucketMs: (end - start) / 24, buckets: 24 };
  }
  if (range !== "all") {
    const { span, buckets } = RANGE_SPECS[range];
    return { start: now - span, end: now, bucketMs: span / buckets, buckets };
  }
  const oldest = events.reduce((min, event) => Math.min(min, Date.parse(event.occurred_at)), now);
  const buckets = 36;
  const span = Math.max(15 * MINUTE, now - oldest);
  return { start: now - span, end: now, bucketMs: span / buckets, buckets };
}

export function eventsInRange(events: SessionEvent[], axis: TimeAxis) {
  return events.filter((event) => {
    const time = Date.parse(event.occurred_at);
    return time >= axis.start && time <= axis.end;
  });
}

export type Series = { key: string; values: number[] };

/** Per-provider counts (or summed values) per time bucket, in the given provider order. */
export function bucketSeries(events: SessionEvent[], providerKeys: string[], axis: TimeAxis, value: (event: SessionEvent) => number = () => 1): Series[] {
  const rows = new Map(providerKeys.map((key) => [key, Array.from({ length: axis.buckets }, () => 0)]));
  for (const event of events) {
    const row = rows.get(event.provider);
    if (!row) continue;
    const index = Math.min(axis.buckets - 1, Math.floor((Date.parse(event.occurred_at) - axis.start) / axis.bucketMs));
    if (index >= 0) row[index] += value(event);
  }
  return providerKeys.map((key) => ({ key, values: rows.get(key)! }));
}

/** Prompt tokens the model read, cached or not. */
const promptTokens = (event: SessionEvent) => (event.input_tokens?.value || 0) + (event.cache_read_tokens?.value || 0) + (event.cache_write_tokens?.value || 0);
export const totalTokens = (event: SessionEvent) => promptTokens(event) + (event.output_tokens?.value || 0);

export type AgentToolCalls = { key: string; succeeded: number; failed: number };

/** Finished vs failed tool calls per provider; started events are not counted twice. */
export function toolCallsByAgent(events: SessionEvent[], providerKeys: string[]): AgentToolCalls[] {
  return providerKeys.map((key) => {
    const own = events.filter((event) => event.provider === key);
    return {
      key,
      succeeded: own.filter((event) => event.kind === "tool_finished").length,
      failed: own.filter((event) => event.kind === "tool_failed").length
    };
  }).filter((row) => row.succeeded + row.failed > 0);
}

export type ToolUsage = { name: string; calls: number; failed: number };

export function topTools(events: SessionEvent[], limit = 15): ToolUsage[] {
  const usage = new Map<string, ToolUsage>();
  for (const event of events) {
    if (!event.tool_name || (event.kind !== "tool_started" && event.kind !== "tool_failed")) continue;
    const row = usage.get(event.tool_name) ?? { name: event.tool_name, calls: 0, failed: 0 };
    if (event.kind === "tool_started") row.calls += 1;
    else row.failed += 1;
    usage.set(event.tool_name, row);
  }
  return [...usage.values()].sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name)).slice(0, limit);
}

/** Tool names that modify the file they target. */
export const WRITE_TOOL = /edit|write|patch|create|replace|multi_?edit|file_changed/i;

export type FileTouch = { path: string; reads: number; writes: number };

/** Most touched files, split between reads and modifications (by tool name or file_changed events). */
export function topFiles(events: SessionEvent[], limit = 15): FileTouch[] {
  const files = new Map<string, FileTouch>();
  for (const event of events) {
    if (!event.file_path || (event.kind !== "tool_started" && event.kind !== "file_changed")) continue;
    const row = files.get(event.file_path) ?? { path: event.file_path, reads: 0, writes: 0 };
    if (event.kind === "file_changed" || WRITE_TOOL.test(event.tool_name || "")) row.writes += 1;
    else row.reads += 1;
    files.set(event.file_path, row);
  }
  return [...files.values()].sort((a, b) => b.reads + b.writes - (a.reads + a.writes) || a.path.localeCompare(b.path)).slice(0, limit);
}

export type AgentTokens = { key: string; input: number; output: number };

export function tokensByAgent(events: SessionEvent[], providerKeys: string[]): AgentTokens[] {
  return providerKeys.map((key) => {
    const own = events.filter((event) => event.provider === key);
    return {
      key,
      input: own.reduce((sum, event) => sum + promptTokens(event), 0),
      output: own.reduce((sum, event) => sum + (event.output_tokens?.value || 0), 0)
    };
  }).filter((row) => row.input + row.output > 0);
}

export type AgentTurns = { key: string; turns: number; averageMs: number; longestMs: number };

/** Turn durations exactly as reported on checkpoint events; turns without a duration are not estimated. */
export function turnDurations(events: SessionEvent[], providerKeys: string[]): AgentTurns[] {
  return providerKeys.map((key) => {
    const durations = events
      .filter((event) => event.provider === key && event.kind === "checkpoint" && event.duration_ms)
      .map((event) => event.duration_ms!.value);
    return {
      key,
      turns: durations.length,
      averageMs: durations.length ? durations.reduce((sum, value) => sum + value, 0) / durations.length : 0,
      longestMs: durations.length ? Math.max(...durations) : 0
    };
  }).filter((row) => row.turns > 0);
}

export type ModelUsage = { model: string; requests: number; tokens: number };

export function modelsUsed(events: SessionEvent[], limit = 12): ModelUsage[] {
  const models = new Map<string, ModelUsage>();
  for (const event of events) {
    if (event.kind !== "model_usage" || !event.model) continue;
    const row = models.get(event.model.value) ?? { model: event.model.value, requests: 0, tokens: 0 };
    row.requests += 1;
    row.tokens += totalTokens(event);
    models.set(event.model.value, row);
  }
  return [...models.values()].sort((a, b) => b.tokens - a.tokens || b.requests - a.requests).slice(0, limit);
}

export function formatCompact(value: number) {
  return new Intl.NumberFormat(locale(), { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function formatDuration(ms: number) {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toLocaleString(locale(), { maximumFractionDigits: 1 })} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min ${String(Math.round(seconds % 60)).padStart(2, "0")} s`;
}
