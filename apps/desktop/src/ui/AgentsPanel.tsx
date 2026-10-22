import { useEffect, useRef } from "react";
import { AgentCard } from "./AgentCard";
import type { AgentPulse } from "./agentPulse";
import { t } from "./i18n";
import { agentName } from "./providers";
import type { SessionEvent } from "./types";
import { needsYou, useAgentPulses } from "./useAgentPulses";

/** Every agent in full: what it is doing, its numbers, its activity. The one you asked about is lit. */
export function AgentsPanel({ agentEvents, repositoryName, onGoTo, focusKey }: { agentEvents: SessionEvent[]; repositoryName: (pulse: AgentPulse) => string | null; onGoTo: (pulse: AgentPulse) => void; focusKey: string | null }) {
  const { pulses, now } = useAgentPulses(agentEvents);
  const seen = pulses.filter((pulse) => pulse.status !== "never");
  const unseen = pulses.filter((pulse) => pulse.status === "never");
  const attention = seen.filter((pulse) => needsYou(pulse.status)).length;
  const lit = useRef<HTMLDivElement>(null);
  useEffect(() => { lit.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [focusKey]);

  return <section className="panel">
    <p className="panel-lead">{seen.length ? (attention ? t(`${attention} agent${attention > 1 ? "s" : ""} t’attendent : affichés en premier.`, `${attention} agent${attention > 1 ? "s need" : " needs"} you: shown first.`) : t("Aucun agent n’a besoin de toi pour l’instant.", "No agent needs you right now.")) : t("Aucun agent observé pour l’instant.", "No agent observed yet.")}</p>
    <div className="card-list">{seen.map((pulse) => <div key={pulse.key} ref={pulse.key === focusKey ? lit : undefined} className={pulse.key === focusKey ? "is-lit" : ""}><AgentCard pulse={pulse} now={now} repository={repositoryName(pulse)} onGoTo={onGoTo} /></div>)}</div>
    {unseen.length > 0 && <p className="panel-note">{t("Pas encore vus", "Not seen yet")} : {unseen.map((pulse) => agentName(pulse.key)).join(", ")}.</p>}
  </section>;
}
