import { useMemo, useState } from "react";
import { EmptyState } from "./Explain";
import { EventFeed } from "./EventFeed";
import { t } from "./i18n";
import type { SessionEvent } from "./types";

const needsAttention = (event: SessionEvent) => event.kind === "tool_failed" || (event.kind === "checkpoint" && (/error|fail|cancel/i.test(event.outcome ?? "") || (event.outcome ?? "").startsWith("attention:")));

/** Everything the agents did, newest first; or only what went wrong or waited for you. */
export function FeedPanel({ events, only }: { events: SessionEvent[]; only: "all" | "attention" }) {
  const [limit] = useState(500);
  const shown = useMemo(() => (only === "attention" ? events.filter(needsAttention) : events).slice(0, limit), [events, only, limit]);
  return shown.length
    ? <EventFeed events={shown} />
    : <EmptyState title={only === "attention" ? t("Rien à signaler", "Nothing to report") : t("Rien pour l’instant", "Nothing yet")}>{only === "attention" ? t("Aucun échec ni attente sur les événements chargés.", "No failure or wait in the loaded events.") : t("Les actions de tes agents s’afficheront ici dès qu’ils travailleront.", "Your agents’ actions will show up here as soon as they work.")}</EmptyState>;
}
