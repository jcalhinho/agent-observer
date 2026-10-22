import { useMemo, useState } from "react";
import { t } from "./i18n";
import { since } from "./AgentCard";
import { EventHead, EventRow } from "./EventFeed";
import { EmptyState } from "./Explain";
import { providerFor } from "./providers";
import { SessionSummaryPanel } from "./SessionSummaryPanel";
import { sessionKey, type SessionEvent } from "./types";
import type { WorkspaceRepository } from "./workspace";


/** Every observed session, newest first, with its summary and full timeline. */
export function SessionsPage({ events, hasMore, loadingOlder, onLoadOlder, repositoryOf, now }: {
  events: SessionEvent[];
  hasMore: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  repositoryOf: (event: SessionEvent) => WorkspaceRepository | null;
  now: number;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const sessions = useMemo(() => {
    const grouped = new Map<string, SessionEvent[]>();
    for (const event of events) grouped.set(sessionKey(event), [...(grouped.get(sessionKey(event)) ?? []), event]);
    return [...grouped.entries()].sort((a, b) => b[1][0].occurred_at.localeCompare(a[1][0].occurred_at));
  }, [events]);
  const current = sessions.find(([key]) => key === selected) ?? sessions[0];
  const timeline = current?.[1] ?? [];
  const repository = timeline.map(repositoryOf).find(Boolean) ?? null;

  return <section className="panel">
    <div className="panel-bar">
      {sessions.length > 0 && <select className="field-select" value={current?.[0] ?? ""} onChange={(event) => setSelected(event.target.value)} aria-label={t("Session observée", "Observed session")}>
        {sessions.map(([key, items]) => {
          const provider = providerFor(items[0].provider);
          const place = repositoryOf(items[0])?.name ?? items[0].project_path?.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) ?? t("dossier inconnu", "unknown folder");
          return <option key={key} value={key}>{provider?.name ?? items[0].provider} · {place} · {since(Date.parse(items[0].occurred_at), now)} · {t(`${items.length} événements`, `${items.length} events`)}</option>;
        })}
      </select>}
      {hasMore && <button className="button small" onClick={onLoadOlder} disabled={loadingOlder}>{loadingOlder ? t("Chargement…", "Loading…") : t("Charger plus ancien", "Load older")}</button>}
    </div>
    {sessions.length ? <div className="stack">
      <SessionSummaryPanel key={current?.[0]} events={timeline} loadedEvents={events} hasMore={hasMore} repository={repository ? { root: repository.path, project_hash: repository.project_hash } : null} />
      <h3 className="block-title">{t("Chronologie", "Timeline")} <small>{t(`${timeline.length} événements, du plus récent au plus ancien`, `${timeline.length} events, newest first`)}</small></h3>
      <div className="event-list"><EventHead />{timeline.map((event) => <EventRow key={event.event_id} event={event} showDate />)}</div>
    </div> : <EmptyState title={t("Aucune session pour l’instant", "No session yet")}>{t("Lance une session avec l’un de tes agents : elle apparaîtra ici en direct. Si rien n’arrive, vérifie l’onglet Connecteurs.", "Start a session with one of your agents: it will show up here live. If nothing comes, check the Connectors tab.")}</EmptyState>}
  </section>;
}
