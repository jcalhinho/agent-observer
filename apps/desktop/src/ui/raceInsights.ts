import { isTurnComplete, progressAt } from "./race";

/*
 * What the race shows beyond "who moves": session time, token flow, recent failures, clean streaks,
 * the model family, the time of day and the replay clock. Pure, so it is tested.
 */

/** A lap is this many minutes of one session's work. */
export const LAP_MINUTES = 30;
const TOKEN_WINDOW_MS = 5 * 60_000;
const FAILURE_WINDOW_MS = 15 * 60_000;
export const MAX_HURDLES = 6;
const CONFETTI_STREAK = 3;
const FIREWORKS_STREAK = 6;

export type InsightEvent = {
  event_id: string;
  provider: string;
  session_id: string;
  occurred_at: string;
  kind: string;
  outcome?: string | null;
  input_tokens?: { value: number } | null;
  output_tokens?: { value: number } | null;
};

export type Celebration = "none" | "confetti" | "fireworks";

export type LaneInsights = {
  /** Work span of the agent's latest session, in minutes. */
  sessionMinutes: number;
  laps: number;
  /** Tokens per minute over the last five minutes. */
  tokensPerMinute: number;
  /** Failed tools in the last 15 minutes, capped. */
  recentFailures: number;
  /** Where on the track (0..100) each tool failed during the turn in progress, in the last 10 minutes: the hurdles. */
  failureMarks: number[];
  /** Completed turns in a row with no failed tool, ending with the latest. */
  streak: number;
  celebration: Celebration;
};

const at = (event: InsightEvent) => Date.parse(event.occurred_at);

export function celebrationFor(streak: number, laps: number): Celebration {
  if (streak >= FIREWORKS_STREAK || (streak >= CONFETTI_STREAK && laps >= 1)) return "fireworks";
  return streak >= CONFETTI_STREAK ? "confetti" : "none";
}

export function laneInsights(provider: string, events: InsightEvent[], now: number, turnStartedAt: number | null = null): LaneInsights {
  const own = events.filter((event) => event.provider === provider).sort((a, b) => at(a) - at(b));
  if (!own.length) return { sessionMinutes: 0, laps: 0, tokensPerMinute: 0, recentFailures: 0, failureMarks: [], streak: 0, celebration: "none" };

  const latestSession = own[own.length - 1].session_id;
  const session = own.filter((event) => event.session_id === latestSession);
  const sessionMinutes = Math.max(0, Math.round((at(session[session.length - 1]) - at(session[0])) / 60_000));
  const laps = Math.floor(sessionMinutes / LAP_MINUTES);

  let tokens = 0;
  let failures = 0;
  for (const event of own) {
    const age = now - at(event);
    if (age < 0) continue;
    if (age <= TOKEN_WINDOW_MS) tokens += (event.input_tokens?.value ?? 0) + (event.output_tokens?.value ?? 0);
    if (age <= FAILURE_WINDOW_MS && event.kind === "tool_failed") failures += 1;
  }
  const tokensPerMinute = tokens / (TOKEN_WINDOW_MS / 60_000);

  // Turns end at a completed checkpoint; a turn counts when none of its tools failed.
  let streak = 0;
  let clean = true;
  const turns: boolean[] = [];
  for (const event of own) {
    if (event.kind === "tool_failed") clean = false;
    if (event.kind === "session_ended" || (event.kind === "checkpoint" && isTurnComplete(provider, event))) {
      turns.push(clean);
      clean = true;
    }
  }
  for (let index = turns.length - 1; index >= 0 && turns[index]; index -= 1) streak += 1;

  return { sessionMinutes, laps, tokensPerMinute, recentFailures: Math.min(MAX_HURDLES, failures), failureMarks: failureMarks(session, now, turnStartedAt), streak, celebration: celebrationFor(streak, laps) };
}

const MARK_WINDOW_MS = 10 * 60_000;

/**
 * Where the runner was on the track when each tool failed, for the turn in progress only: a hurdle is
 * left on the spot of the failure, and the turn ending (or ten minutes passing) takes it away.
 */
function failureMarks(session: InsightEvent[], now: number, turnStartedAt: number | null): number[] {
  if (turnStartedAt === null) return [];
  const inTurn = session.filter((event) => at(event) >= turnStartedAt && at(event) <= now);
  const marks: number[] = [];
  inTurn.forEach((event, index) => {
    if (event.kind !== "tool_failed" || now - at(event) > MARK_WINDOW_MS) return;
    marks.push(progressAt(index + 1, Math.max(0, (at(event) - turnStartedAt) / 1000)));
  });
  return marks.slice(-MAX_HURDLES);
}

// ---------------------------------------------------------------------------------------------
// Model family: the colour of the cap
// ---------------------------------------------------------------------------------------------

export type Family = "claude" | "gemini" | "gpt" | "qwen" | "glm" | "deepseek" | "copilot" | "unknown";

export const FAMILIES: Record<Family, { label: string; color: string }> = {
  claude: { label: "Claude", color: "#e07b4f" },
  gemini: { label: "Gemini", color: "#4f8df0" },
  gpt: { label: "GPT", color: "#2fb585" },
  qwen: { label: "Qwen", color: "#8c7cf0" },
  glm: { label: "GLM", color: "#e0b341" },
  deepseek: { label: "DeepSeek", color: "#d0549a" },
  copilot: { label: "Copilot", color: "#c58bf2" },
  unknown: { label: "?", color: "#9aa3b2" }
};

/** The family a model name belongs to. Qwen is tested first: `claude-qwen` is a Qwen model behind a Claude-style name. */
export function modelFamily(model: string | null | undefined): Family {
  const name = (model ?? "").toLowerCase();
  if (!name) return "unknown";
  if (/qwen/.test(name)) return "qwen";
  if (/claude|sonnet|opus|haiku|fable/.test(name)) return "claude";
  if (/gemini|gemma/.test(name)) return "gemini";
  if (/glm/.test(name)) return "glm";
  if (/deepseek/.test(name)) return "deepseek";
  if (/mai-code|copilot/.test(name)) return "copilot";
  if (/gpt|openai|codex|\bo[134](-|$)/.test(name)) return "gpt";
  return "unknown";
}

// ---------------------------------------------------------------------------------------------
// Time of day
// ---------------------------------------------------------------------------------------------

export type Daypart = "dawn" | "day" | "dusk" | "night";

export function daypartAt(date: Date): Daypart {
  const hour = date.getHours();
  if (hour >= 5 && hour < 8) return "dawn";
  if (hour >= 8 && hour < 18) return "day";
  if (hour >= 18 && hour < 21) return "dusk";
  return "night";
}

export type Lighting = { hemiSky: string; hemiGround: string; hemi: number; sun: string; sunIntensity: number; floodlights: boolean; stars: boolean; moon: boolean };

/** What the user can ask for: the local time of day (default), or one fixed moment. */
export type DaypartSetting = "auto" | Daypart;

export const LIGHTING: Record<Daypart, Lighting> = {
  day: { hemiSky: "#eaf6ff", hemiGround: "#8cc67a", hemi: 1.7, sun: "#fff3dc", sunIntensity: 1.35, floodlights: false, stars: false, moon: false },
  dawn: { hemiSky: "#ffe2c8", hemiGround: "#8cae7a", hemi: 1.35, sun: "#ffc78f", sunIntensity: 1.0, floodlights: false, stars: false, moon: false },
  dusk: { hemiSky: "#f2c3b8", hemiGround: "#6f8f72", hemi: 1.15, sun: "#ff9d6b", sunIntensity: 0.9, floodlights: true, stars: false, moon: false },
  night: { hemiSky: "#8fa6ff", hemiGround: "#3e5a4a", hemi: 0.85, sun: "#b9c7ff", sunIntensity: 0.5, floodlights: true, stars: true, moon: true }
};

// ---------------------------------------------------------------------------------------------
// Replay of the last hour
// ---------------------------------------------------------------------------------------------

export const REPLAY_WINDOW_MS = 60 * 60_000;
export const REPLAY_DURATION_MS = 30_000;

/** The moment the race shows `now - startedAt` milliseconds into a replay that began at `anchor - window`. */
export function replayClock(anchor: number, startedAt: number, now: number, windowMs = REPLAY_WINDOW_MS, durationMs = REPLAY_DURATION_MS) {
  const progress = Math.min(1, Math.max(0, (now - startedAt) / durationMs));
  return { virtualNow: anchor - windowMs + progress * windowMs, progress, done: progress >= 1 };
}

export function formatMinutes(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")}`;
}
