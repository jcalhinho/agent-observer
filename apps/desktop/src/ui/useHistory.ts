import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { SessionPresence } from "./analysis";
import { demoHistory, isDemo } from "./demo";
import { isActiveProvider } from "./providers";
import { compareEventsNewestFirst, type SessionEvent } from "./types";

type HistoryRows = { events: SessionEvent[]; presence: SessionPresence[]; truncated: boolean };

/**
 * Ce que l'historique additionne sur les `days` derniers jours, demandé à la base locale en une
 * requête filtrée : les événements qui portent des tokens, les échecs d'outils et, pour compter
 * les sessions, une ligne par session et par quart d'heure. Les événements qui arrivent en direct
 * s'y ajoutent. `truncated` dit que la base en avait plus que la limite d'une requête.
 */
export function useHistory(live: SessionEvent[], days: number) {
  const [rows, setRows] = useState<HistoryRows>({ events: [], presence: [], truncated: false });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const request: Promise<HistoryRows> = isDemo()
      ? Promise.resolve({ events: demoHistory(), presence: [], truncated: false })
      : invoke<HistoryRows>("load_history", { days: days + 1 });
    request
      .then((next) => {
        if (cancelled) return;
        setRows({
          events: next.events.filter((event) => isActiveProvider(event.provider)),
          presence: next.presence.filter((seen) => isActiveProvider(seen.provider)),
          truncated: next.truncated
        });
      })
      // Hors application de bureau, seule la démo a un historique.
      .catch(() => undefined)
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [days]);

  const events = useMemo(() => {
    const byId = new Map<string, SessionEvent>();
    for (const event of rows.events) byId.set(event.event_id, event);
    for (const event of live) byId.set(event.event_id, event);
    return [...byId.values()].sort(compareEventsNewestFirst);
  }, [rows.events, live]);

  return { events, presence: rows.presence, loading, truncated: rows.truncated };
}
