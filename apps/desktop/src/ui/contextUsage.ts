/*
 * How full the context window of an agent is: the size of its latest request (new input plus what was
 * served from or written to the cache) against the size of the model's window. Pure, so it is tested.
 */

export type ContextEvent = {
  kind: string;
  occurred_at: string;
  session_id: string;
  model?: { value: string } | null;
  input_tokens?: { value: number } | null;
  cache_read_tokens?: { value: number } | null;
  cache_write_tokens?: { value: number } | null;
  context_window?: { value: number } | null;
};

export type ContextState = "ok" | "warn" | "full" | "unknown";

export type ContextUsage = {
  /** Tokens in the latest request of the latest session. */
  used: number;
  /** Size of the window, or null when neither the agent nor the table knows it. */
  window: number | null;
  /** 0..100 (clamped), or null without a window. */
  percent: number | null;
  /** Share of the request served from the cache, 0..1, when the agent reports cache reads. */
  cachedShare: number | null;
  state: ContextState;
  /** Size of each request of the session, oldest first, at most `MAX_POINTS` of them. */
  series: number[];
  /** How many times the context fell sharply: the agent compacted it. */
  compactions: number;
  model: string | null;
  /** Where the window comes from: the agent, the table of known models, or the size itself (it grew past the table). */
  windowSource: "reported" | "table" | "observed" | null;
};

export const WARN_AT = 0.8;
export const FULL_AT = 0.95;
const MAX_POINTS = 30;
const COMPACTION_DROP = 0.6;
const COMPACTION_MIN = 30_000;
/** Windows a model can come in, for when it grew past the one the table says. */
const TIERS = [200_000, 256_000, 400_000, 1_000_000, 2_000_000];

/**
 * Windows of models that agents do not report one for. Documented sizes only; a model that is not
 * here has no percentage rather than a guessed one.
 */
const WINDOWS: Array<[RegExp, number]> = [
  [/^gemini[-\s]/, 1_048_576],
  [/^claude-(?:opus|sonnet|haiku)-[34](?:-|$)/, 200_000],
  [/^claude-(?:opus|sonnet|haiku)-5/, 1_000_000],
  [/^qwen3-coder-(?:plus|flash)/, 1_000_000],
  [/gpt-oss/, 131_072]
];

export function windowOf(model: string | null | undefined): number | null {
  const name = (model ?? "").trim().toLowerCase().replace(/\s*\((?:minimal|low|medium|high|thinking)\)\s*$/, "").replace(/\s+/g, "-");
  if (!name) return null;
  return WINDOWS.find(([pattern]) => pattern.test(name))?.[1] ?? null;
}

const sizeOf = (event: ContextEvent) => (event.input_tokens?.value ?? 0) + (event.cache_read_tokens?.value ?? 0) + (event.cache_write_tokens?.value ?? 0);
const at = (event: ContextEvent) => Date.parse(event.occurred_at);

/** `events` are those of one agent, in any order. Null when no request reported its size. */
export function contextUsage(events: ContextEvent[]): ContextUsage | null {
  const usage = events.filter((event) => event.kind === "model_usage" && sizeOf(event) > 0).sort((a, b) => at(a) - at(b));
  if (!usage.length) return null;
  const session = usage.filter((event) => event.session_id === usage[usage.length - 1].session_id);
  const last = session[session.length - 1];
  const sizes = session.map(sizeOf);
  const used = sizes[sizes.length - 1];
  const model = [...session].reverse().find((event) => event.model?.value)?.model?.value ?? null;

  let window = [...session].reverse().find((event) => event.context_window?.value)?.context_window?.value ?? null;
  let windowSource: ContextUsage["windowSource"] = window ? "reported" : null;
  if (!window) {
    const known = windowOf(model);
    if (known) {
      window = known;
      windowSource = "table";
      if (used > known) {
        window = TIERS.find((tier) => tier >= used) ?? null;
        windowSource = window ? "observed" : null;
      }
    }
  }

  const percent = window ? Math.min(100, Math.round((used / window) * 1000) / 10) : null;
  const ratio = window ? used / window : null;
  const state: ContextState = ratio === null ? "unknown" : ratio >= FULL_AT ? "full" : ratio >= WARN_AT ? "warn" : "ok";
  const cachedShare = last.cache_read_tokens ? Math.min(1, (last.cache_read_tokens.value ?? 0) / used) : null;

  let compactions = 0;
  for (let index = 1; index < sizes.length; index += 1) {
    if (sizes[index - 1] >= COMPACTION_MIN && sizes[index] < sizes[index - 1] * COMPACTION_DROP) compactions += 1;
  }
  const step = Math.max(1, Math.ceil(sizes.length / MAX_POINTS));
  const series = sizes.filter((_, index) => index % step === 0 || index === sizes.length - 1);

  return { used, window, percent, cachedShare, state, series, compactions, model, windowSource };
}
