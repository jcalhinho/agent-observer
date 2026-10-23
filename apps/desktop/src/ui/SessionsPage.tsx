import { useMemo, useState } from "react";
import { t } from "./i18n";
import { since } from "./AgentCard";
import { EventHead, EventRow } from "./EventFeed";
import { EmptyState } from "./Explain";
import { providerFor } from "./providers";
import { SessionSummaryPanel } from "./SessionSummaryPanel";
import { sessionKey, type SessionEvent } from "./types";
import type { WorkspaceRepository } from "./workspace";


const needsAttention = (event: SessionEvent) => event.kind === "tool_failed" || (event.kind === "checkpoint" && (/error|fail|cancel/i.test(event.outcome ?? "") || (event.outcome ?? "").startsWith("attention:")));

/** The sessions of the chosen period, newest first, with the summary and timeline of one of them. */
export function SessionsPage({ events, repositoryOf, now, selected, onSelect }: {
  events: SessionEvent[];
  repositoryOf: (event: SessionEvent) => WorkspaceRepository | null;
  now: number;
  selected: string | null;
  onSelect: (key: string) => void;
}) {
  const [only, setOnly] = useState<"all" | "attention">("all");
  const sessions = useMemo(() => {
    const grouped = new Map<string, SessionEvent[]>();
    for (const event of events) grouped.set(sessionKey(event), [...(grouped.get(sessionKey(event)) ?? []), event]);
    return [...grouped.entries()].sort((a, b) => b[1][0].occurred_at.localeCompare(a[1][0].occurred_at));
  }, [events]);
  const current = sessions.find(([key]) => key === selected) ?? sessions[0];
  const timeline = current?.[1] ?? [];
  const shown = only === "attention" ? timeline.filter(needsAttention) : timeline;
  const repository = timeline.map(repositoryOf).find(Boolean) ?? null;

  return <section className="panel">
    <div className="panel-bar">
      <h3 className="block-title">{t("Historique", "History")} <small>{t(`${sessions.length} session${sessions.length > 1 ? "s" : ""}`, `${sessions.length} session${sessions.length === 1 ? "" : "s"}`)}</small></h3>
      {sessions.length > 0 && <select className="field-select" value={current?.[0] ?? ""} onChange={(event) => onSelect(event.target.value)} aria-label={t("Session observée", "Observed session")}>
        {sessions.map(([key, items]) => {
          const provider = providerFor(items[0].provider);
          const place = repositoryOf(items[0])?.name ?? items[0].project_path?.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) ?? t("dossier inconnu", "unknown folder");
          return <option key={key} value={key}>{provider?.name ?? items[0].provider} · {place} · {since(Date.parse(items[0].occurred_at), now)} · {t(`${items.length} événements`, `${items.length} events`)}</option>;
        })}
      </select>}
    </div>
    {sessions.length ? <div className="stack">
      <SessionSummaryPanel key={current?.[0]} events={timeline} loadedEvents={events} hasMore={false} repository={repository ? { root: repository.path, project_hash: repository.project_hash } : null} />
      <div className="block-line">
        <h3 className="block-title">{t("Chronologie", "Timeline")} <small>{t(`${shown.length} événements, du plus récent au plus ancien`, `${shown.length} events, newest first`)}</small></h3>
        <div className="segmented" role="group" aria-label={t("Filtrer la chronologie", "Filter the timeline")}>
          <button aria-pressed={only === "all"} onClick={() => setOnly("all")}>{t("Tout", "All")}</button>
          <button aria-pressed={only === "attention"} onClick={() => setOnly("attention")}>{t("À surveiller", "Needs a look")}</button>
        </div>
      </div>
      {shown.length ? <div className="event-list"><EventHead />{shown.map((event) => <EventRow key={event.event_id} event={event} showDate />)}</div> : <p className="panel-note">{t("Rien à signaler dans cette session.", "Nothing to report in this session.")}</p>}
    </div> : <EmptyState title={t("Aucune session sur cette période", "No session in this period")}>{t("Choisis une autre période ou un autre jour. Si rien n’arrive en direct, vérifie les connecteurs (menu du haut).", "Pick another period or day. If nothing arrives live, check the connectors (top menu).")}</EmptyState>}
  </section>;
}
