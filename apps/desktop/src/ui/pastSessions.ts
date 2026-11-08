import { estimateCost } from "./sessionSummary";
import type { SessionEvent } from "./types";

/** Une session enregistrée, résumée par la base (`agent_sessions`). */
type StoredSession = {
  session_id: string;
  project_path: string | null;
  started_at: string;
  last_at: string;
  events: number;
  tool_calls: number;
  failures: number;
};
export type AgentSessionRows = { sessions: StoredSession[]; usage: SessionEvent[] };

export type PastSession = {
  id: string;
  project: string | null;
  startedAt: number;
  /** Du premier au dernier événement observé. */
  observedMs: number;
  events: number;
  toolCalls: number;
  failures: number;
  /** Null quand aucun événement de la session n'a rapporté de tokens. */
  tokens: number | null;
  /** Null quand aucun modèle de la session n'est dans la table des prix. */
  cost: { value: number; partial: boolean } | null;
};

const tokensOf = (event: SessionEvent) => (event.input_tokens?.value ?? 0) + (event.output_tokens?.value ?? 0) + (event.cache_read_tokens?.value ?? 0) + (event.cache_write_tokens?.value ?? 0);

/** Les sessions passées d'un agent, la plus récente d'abord, sans la session en cours. */
export function pastSessions(rows: AgentSessionRows, currentSessionId: string | null): PastSession[] {
  const usageBySession = new Map<string, SessionEvent[]>();
  for (const event of rows.usage) (usageBySession.get(event.session_id) ?? usageBySession.set(event.session_id, []).get(event.session_id)!).push(event);
  return rows.sessions
    .filter((session) => session.session_id !== currentSessionId)
    .map((session) => {
      const usage = usageBySession.get(session.session_id) ?? [];
      const priced = usage.length ? estimateCost(usage) : null;
      const startedAt = Date.parse(session.started_at);
      return {
        id: session.session_id,
        project: session.project_path,
        startedAt,
        observedMs: Math.max(0, Date.parse(session.last_at) - startedAt),
        events: session.events,
        toolCalls: session.tool_calls,
        failures: session.failures,
        tokens: usage.length ? usage.reduce((sum, event) => sum + tokensOf(event), 0) : null,
        cost: priced ? { value: priced.value, partial: priced.unpricedEvents > 0 } : null
      };
    })
    .sort((a, b) => b.startedAt - a.startedAt);
}

/**
 * Les mêmes lignes que `agent_sessions`, calculées à partir d'événements en mémoire : sert à la
 * démo, hors de l'application de bureau.
 */
export function sessionRowsFromEvents(events: SessionEvent[], provider: string, limit = 20): AgentSessionRows {
  const own = events.filter((event) => event.provider === provider);
  const bySession = new Map<string, SessionEvent[]>();
  for (const event of own) (bySession.get(event.session_id) ?? bySession.set(event.session_id, []).get(event.session_id)!).push(event);
  const sessions: StoredSession[] = [...bySession].map(([id, list]) => {
    const ordered = [...list].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
    const tools = new Map<string, { started: number; ended: number }>();
    for (const event of ordered) {
      if (event.kind !== "tool_started" && event.kind !== "tool_finished" && event.kind !== "tool_failed") continue;
      const entry = tools.get(event.tool_name ?? "") ?? { started: 0, ended: 0 };
      if (event.kind === "tool_started") entry.started += 1; else entry.ended += 1;
      tools.set(event.tool_name ?? "", entry);
    }
    return {
      session_id: id,
      project_path: [...ordered].reverse().find((event) => event.project_path)?.project_path ?? null,
      started_at: ordered[0].occurred_at,
      last_at: ordered[ordered.length - 1].occurred_at,
      events: ordered.length,
      tool_calls: [...tools.values()].reduce((sum, entry) => sum + Math.max(entry.started, entry.ended), 0),
      failures: ordered.filter((event) => event.kind === "tool_failed").length
    };
  }).sort((a, b) => b.last_at.localeCompare(a.last_at)).slice(0, limit);
  const kept = new Set(sessions.map((session) => session.session_id));
  return { sessions, usage: own.filter((event) => kept.has(event.session_id) && tokensOf(event) > 0) };
}
