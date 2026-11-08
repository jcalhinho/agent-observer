import { narrateEvent, type Narration } from "./activity-copy";
import { contextUsage, type ContextUsage } from "./contextUsage";
import { detectLoop, type LoopFinding } from "./loopDetector";
import { burnRate, cacheTrend, costSince, workTime, type Burn, type CacheTrend, type Spend } from "./analysis";
import { costInsight, type CostInsight } from "./insights";
import { summarizeSession, type SessionSummary } from "./sessionSummary";
import type { SessionEvent } from "./types";

/** Outils qui ecrivent : sert a compter les fichiers touches. */
const WRITE_TOOL = /edit|write|patch|create|replace|multi_?edit|file_changed/i;

/**
 * At-a-glance state of one agent, ordered by how much it needs the user:
 * looping (repeats itself without progress) → blocked (repeated failures) → stalled (turn open but silent) → waiting (turn finished, waiting
 * for the next prompt) → working → idle → never seen.
 */
export type PulseStatus = "looping" | "blocked" | "stalled" | "waiting" | "working" | "idle" | "never";

const PULSE_ORDER: PulseStatus[] = ["looping", "blocked", "stalled", "waiting", "working", "idle", "never"];

type PulseAction = Narration & { id: string; at: number };

export type AgentPulse = {
  key: string;
  status: PulseStatus;
  lastEventAt: number | null;
  /** Narration of the latest describable event. */
  current: PulseAction | null;
  recent: PulseAction[];
  /** Start of the turn in progress, when one is open. */
  turnStartedAt: number | null;
  failureStreak: number;
  /** Set when the open turn repeats itself without progress. */
  loop: LoopFinding | null;
  session: {
    id: string;
    turns: number;
    toolCalls: number;
    failures: number;
    inputTokens: number | null;
    outputTokens: number | null;
    filesChanged: number;
    /** Estimated USD cost, only when every priced model is known; null otherwise. */
    cost: number | null;
    model: string | null;
    /** Every model reported in this session, in first-seen order. */
    models?: string[];
  } | null;
  /**
   * Le modele de la reponse la plus recente. A ne pas confondre avec
   * `session.model`, qui est le PREMIER modele vu dans la session : un agent
   * qui demarre sur un petit modele, ou qui en utilise un pour une tache de
   * fond, garderait sinon ce nom-la jusqu'au bout.
   */
  model: string | null;
  /** Tous les modeles vus dans la session, du plus recent au plus ancien. */
  modelsSeen: string[];
  /** Comment l'agent a ete lance, quand il le dit (« vscode », « cli »…). */
  launchMode: string | null;
  /** Where the latest event happened, to name its repository. */
  project: { project_path: string | null; file_path: string | null; project_hash: string | null } | null;
  /** Events per minute over the last 15 minutes, oldest first. */
  spark: number[];
  /** How full the context window is, when the agent reports the size of its requests. */
  context: ContextUsage | null;
  /** Le résumé complet de la session en cours : outils, fichiers, tokens, modèles. */
  summary: SessionSummary | null;
  /** Coût estimé et économie due au cache, quand les modèles sont connus de la table des prix. */
  cost: CostInsight | null;
  /** Les dernières actions de la session, la plus récente d'abord. */
  timeline: PulseAction[];
  /** Début de la session en cours. */
  sessionStartedAt: number | null;
  /** Ce que le dernier message de l'utilisateur demandait, quand la capture des prompts est activée. */
  goal: { text: string; at: number } | null;
  /** Le rythme de consommation sur les 15 dernières minutes. */
  burn: Burn | null;
  /** Temps de travail : somme des tours de la session (null si les tours ne sont pas marqués). */
  workMs: number | null;
  /** Ce que le tour en cours a coûté jusqu'ici. */
  turnSpend: Spend | null;
  /** Comment le taux de cache évolue, et s'il vient de s'effondrer. */
  cacheTrend: CacheTrend | null;
};

const WORKING_WINDOW_MS = 45_000;
const STALLED_AFTER_MS = 2 * 60_000;
const WAITING_WINDOW_MS = 30 * 60_000;
const BLOCKED_WINDOW_MS = 10 * 60_000;
const SPARK_MINUTES = 15;
const TIMELINE_LENGTH = 40;

function isTurnEnd(event: SessionEvent) {
  if (event.kind === "session_ended") return true;
  if (event.kind !== "checkpoint") return false;
  // Codex also emits checkpoints when a turn starts.
  return !(event.outcome ?? "").startsWith("turn-started");
}

function isTurnStart(event: SessionEvent) {
  return event.kind === "user_message" || (event.kind === "checkpoint" && (event.outcome ?? "").startsWith("turn-started"));
}

/** Le dernier message de l'utilisateur, quand son texte a été capturé (réglage facultatif). */
function latestGoal(events: SessionEvent[]): AgentPulse["goal"] {
  const message = events.find((event) => event.kind === "user_message" && event.content?.trim());
  if (!message?.content) return null;
  return { text: message.content.replace(/\s+/g, " ").trim().slice(0, 160), at: Date.parse(message.occurred_at) };
}

export function agentPulse(key: string, events: SessionEvent[], now: number): AgentPulse {
  const own = events.filter((event) => event.provider === key).sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at));
  const spark = Array.from({ length: SPARK_MINUTES }, () => 0);
  for (const event of own) {
    const age = now - Date.parse(event.occurred_at);
    if (age >= 0 && age < SPARK_MINUTES * 60_000) spark[SPARK_MINUTES - 1 - Math.floor(age / 60_000)] += 1;
  }
  if (!own.length) return { key, status: "never", lastEventAt: null, current: null, recent: [], turnStartedAt: null, failureStreak: 0, loop: null, session: null, model: null, modelsSeen: [], launchMode: null, project: null, spark, context: null, summary: null, cost: null, timeline: [], sessionStartedAt: null, goal: null, workMs: null, burn: null, turnSpend: null, cacheTrend: null };

  const latest = own[0];
  const lastEventAt = Date.parse(latest.occurred_at);
  const recent: PulseAction[] = [];
  for (const event of own) {
    const narration = narrateEvent(event);
    if (narration) recent.push({ ...narration, id: event.event_id, at: Date.parse(event.occurred_at) });
    if (recent.length >= 4) break;
  }

  // Consecutive failed tool results, newest first.
  let failureStreak = 0;
  for (const event of own) {
    if (event.kind === "tool_failed") failureStreak += 1;
    else if (event.kind === "tool_finished" || isTurnEnd(event)) break;
  }

  let turnStartedAt: number | null = null;
  for (const event of own) {
    if (isTurnEnd(event)) break;
    if (isTurnStart(event)) {
      turnStartedAt = Date.parse(event.occurred_at);
      break;
    }
  }
  const age = now - lastEventAt;
  const turnOpen = !isTurnEnd(latest);

  const sessionEvents = own.filter((event) => event.session_id === latest.session_id);
  const loop = turnOpen && age < BLOCKED_WINDOW_MS ? detectLoop(sessionEvents) : null;

  let status: PulseStatus;
  if (loop) status = "looping";
  else if (failureStreak >= 2 && age < BLOCKED_WINDOW_MS) status = "blocked";
  else if (turnOpen && age < WORKING_WINDOW_MS) status = "working";
  else if (turnOpen && turnStartedAt !== null && age < WAITING_WINDOW_MS && age >= STALLED_AFTER_MS) status = "stalled";
  else if (turnOpen && turnStartedAt !== null && age < STALLED_AFTER_MS) status = "working";
  else if (!turnOpen && age < WAITING_WINDOW_MS && latest.kind !== "session_ended") status = "waiting";
  else status = "idle";

  const summary = summarizeSession(sessionEvents);
  const timeline: PulseAction[] = [];
  for (const event of sessionEvents) {
    const narration = narrateEvent(event);
    if (narration) timeline.push({ ...narration, id: event.event_id, at: Date.parse(event.occurred_at) });
    if (timeline.length >= TIMELINE_LENGTH) break;
  }
  // `own` va du plus recent au plus ancien : le premier modele rencontre est
  // donc celui de la derniere reponse.
  const reported = sessionEvents.map((event) => event.model?.value).filter((value): value is string => Boolean(value));
  return {
    model: reported[0] ?? null,
    modelsSeen: [...new Set(reported)],
    launchMode: sessionEvents.find((event) => event.launch_mode)?.launch_mode ?? null,
    key,
    status,
    lastEventAt,
    current: recent[0] ?? null,
    recent,
    turnStartedAt: turnOpen ? turnStartedAt : null,
    failureStreak,
    loop,
    session: summary && {
      id: summary.sessionId,
      turns: summary.turns.count,
      toolCalls: summary.tools.reduce((sum, tool) => sum + tool.count, 0),
      failures: summary.failures.count,
      inputTokens: summary.tokens && (summary.tokens.input !== null || summary.tokens.cacheRead !== null || summary.tokens.cacheWrite !== null) ? (summary.tokens.input ?? 0) + (summary.tokens.cacheRead ?? 0) + (summary.tokens.cacheWrite ?? 0) : null,
      outputTokens: summary.tokens?.output ?? null,
      filesChanged: new Set(sessionEvents.filter((event) => event.file_path && (event.kind === "file_changed" || (event.kind === "tool_started" && WRITE_TOOL.test(event.tool_name || "")))).map((event) => event.file_path)).size,
      cost: summary.cost && summary.cost.unpricedEvents === 0 ? summary.cost.value : null,
      model: summary.models[0]?.name ?? null,
      models: summary.models.map((model) => model.name)
    },
    project: { project_path: latest.project_path, file_path: latest.file_path, project_hash: latest.project_hash ?? null },
    spark,
    context: contextUsage(own),
    summary,
    cost: summary ? costInsight(sessionEvents, summary) : null,
    timeline,
    sessionStartedAt: summary ? Date.parse(summary.startedAt) : null,
    goal: latestGoal(sessionEvents),
    workMs: workTime(sessionEvents),
    burn: burnRate(sessionEvents, now),
    turnSpend: turnOpen && turnStartedAt !== null ? costSince(sessionEvents, turnStartedAt) : null,
    cacheTrend: cacheTrend(sessionEvents)
  };
}

export function sortPulses(pulses: AgentPulse[]) {
  return [...pulses].sort((a, b) => PULSE_ORDER.indexOf(a.status) - PULSE_ORDER.indexOf(b.status) || (b.lastEventAt ?? 0) - (a.lastEventAt ?? 0));
}
