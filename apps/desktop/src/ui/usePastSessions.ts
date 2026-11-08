import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { demoEvents, demoHistory, isDemo } from "./demo";
import { pastSessions, sessionRowsFromEvents, type AgentSessionRows, type PastSession } from "./pastSessions";

/**
 * Les sessions passées d'un agent, lues dans la base locale. Relues quand l'agent change de session
 * (`currentSessionId`), pas à chaque événement.
 */
export function usePastSessions(provider: string, currentSessionId: string | null) {
  const [sessions, setSessions] = useState<PastSession[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Une de plus que la liste affichée, pour la session en cours qui en est retirée.
    const request: Promise<AgentSessionRows> = isDemo()
      ? Promise.resolve(sessionRowsFromEvents([...demoEvents(), ...demoHistory()], provider, 21))
      : invoke<AgentSessionRows>("agent_sessions", { provider, limit: 21 });
    request
      .then((rows) => { if (!cancelled) setSessions(pastSessions(rows, currentSessionId).slice(0, 20)); })
      .catch(() => { if (!cancelled) setSessions([]); });
    return () => { cancelled = true; };
  }, [provider, currentSessionId]);

  return sessions;
}
