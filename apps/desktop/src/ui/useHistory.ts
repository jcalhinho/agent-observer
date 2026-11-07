import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { demoHistory, isDemo } from "./demo";
import { isActiveProvider } from "./providers";
import { compareEventsNewestFirst, type SessionEvent } from "./types";

const PAGE = 500;
const MAX_PAGES = 60;

/**
 * Les événements des `days` derniers jours, lus par pages dans la base locale (les plus récents
 * d'abord), puis fusionnés avec ceux qui arrivent en direct. Ne charge rien tant que `enabled`
 * est faux. `truncated` dit que la limite de pages a été atteinte avant le début de la période.
 */
export function useHistory(live: SessionEvent[], days: number, enabled: boolean) {
  const [base, setBase] = useState<SessionEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const cutoff = Date.now() - days * 86_400_000;
      const collected: SessionEvent[] = [];
      let cursor: { at: string; id: string } | null = null;
      let capped = false;
      try {
        if (isDemo()) {
          collected.push(...demoHistory());
        } else {
          for (let page = 0; page < MAX_PAGES; page += 1) {
            const rows: SessionEvent[] = await invoke<SessionEvent[]>("load_session_events", { limit: PAGE, beforeOccurredAt: cursor?.at ?? null, beforeEventId: cursor?.id ?? null });
            if (cancelled) return;
            if (!rows.length) break;
            collected.push(...rows.filter((event) => isActiveProvider(event.provider)));
            const oldest: SessionEvent = rows[rows.length - 1];
            cursor = { at: oldest.occurred_at, id: oldest.event_id };
            if (Date.parse(oldest.occurred_at) < cutoff) break;
            capped = page === MAX_PAGES - 1;
          }
        }
      } catch {
        /* hors application de bureau : seule la démo a un historique */
      }
      if (!cancelled) {
        setBase(collected);
        setTruncated(capped);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [days, enabled]);

  const events = useMemo(() => {
    if (!enabled) return live;
    const byId = new Map<string, SessionEvent>();
    for (const event of base) byId.set(event.event_id, event);
    for (const event of live) byId.set(event.event_id, event);
    return [...byId.values()].sort(compareEventsNewestFirst);
  }, [base, live, enabled]);

  return { events, loading, truncated };
}
