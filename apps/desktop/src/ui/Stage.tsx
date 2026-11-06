import { type CSSProperties, type ReactNode } from "react";
import { Activity, ArrowUpRight, Info, Minimize2 } from "lucide-react";
import { statusInfo, since } from "./AgentCard";
import type { AgentPulse } from "./agentPulse";
import { CollectorStatus } from "./CollectorStatus";
import { t } from "./i18n";
import { ProviderMark } from "./ProviderBadges";
import { providerFor } from "./providers";
import type { SessionEvent } from "./types";
import { needsYou, useAgentPulses } from "./useAgentPulses";

/** One agent card: who, what it is doing, where, and since when. A click opens its details. */
function AgentTile({ pulse, now, place, onInspect }: { pulse: AgentPulse; now: number; place: string | null; onInspect: (pulse: AgentPulse) => void }) {
  const provider = providerFor(pulse.key);
  const status = statusInfo(pulse.status);
  const waiting = pulse.status === "waiting" || pulse.status === "stalled";
  const doing = pulse.status === "looping" && pulse.loop ? pulse.loop.evidence : pulse.current?.text ?? status.explanation;
  return <div className={`agent-tile status-${pulse.status}`} style={{ "--agent-color": provider?.color } as CSSProperties}>
    <button className="tile-main" onClick={() => onInspect(pulse)} title={`${provider?.name} · ${status.label}\n${doing}`}>
      {provider && <ProviderMark provider={provider} />}
      <span className="tile-text">
        <span className="tile-line"><b>{provider?.name}</b><span className="tile-state"><i />{waiting ? t("Répondre", "Reply") : status.label}</span></span>
        <span className="tile-doing">{doing}</span>
        <span className="tile-meta">{place ?? "—"} · {since(pulse.lastEventAt, now)}</span>
      </span>
      <ArrowUpRight size={14} className="tile-go" aria-hidden="true" />
    </button>
    <button className="tile-info" onClick={() => onInspect(pulse)} aria-label={t("Détails de l’agent", "Agent details")} title={t("Détails de l’agent", "Agent details")}><Info size={12} /></button>
  </div>;
}

/**
 * The main screen. A thin bar on top says who is watching and how many agents need you; the rest
 * is one card per agent, newest activity first.
 */
export function Stage({ agentEvents, collectorState, repositoryName, onInspect, onMini, onOpenConnectors, controls, alerts }: {
  agentEvents: SessionEvent[];
  collectorState: string;
  repositoryName: (pulse: AgentPulse) => string | null;
  onInspect: (pulse: AgentPulse) => void;
  onMini: () => void;
  onOpenConnectors: () => void;
  controls: ReactNode;
  alerts: ReactNode;
}) {
  const { pulses, now } = useAgentPulses(agentEvents);
  const seen = pulses.filter((pulse) => pulse.status !== "never");
  const working = pulses.filter((pulse) => pulse.status === "working").length;
  const attention = pulses.filter((pulse) => needsYou(pulse.status)).length;

  return <div className="stage">
    <header className="hud">
      <div className="hud-id"><span className="hud-mark"><Activity size={14} strokeWidth={2.4} /></span><b>AGENT OBSERVER</b><CollectorStatus state={collectorState} /></div>
      <div className="hud-count" aria-live="polite">
        <span className="count-live"><i />{working}<small>{t("au travail", "working")}</small></span>
        <span className={`count-need ${attention ? "on" : ""}`}><i />{attention}<small>{t("t’attendent", "need you")}</small></span>
      </div>
      <div className="hud-controls">
        {controls}
        <button className="icon-button" onClick={onMini} aria-label={t("Mode mini", "Mini mode")} title={t("Mode mini : une colonne dans un coin de l’écran", "Mini mode: a column in a corner of the screen")}><Minimize2 size={13} /></button>
      </div>
    </header>

    <div className="stage-alerts">{alerts}</div>

    {seen.length
      ? <div className="agent-grid" aria-label={t("Agents", "Agents")}>
          {seen.map((pulse) => <AgentTile key={pulse.key} pulse={pulse} now={now} place={repositoryName(pulse)} onInspect={onInspect} />)}
        </div>
      : <div className="stage-empty">
          <b>{t("En attente d’un agent", "Waiting for an agent")}</b>
          <p>{t("Lance une session avec Claude Code, Codex, Antigravity, GitHub Copilot, OpenCode ou Qwen Code : sa carte apparaîtra ici en quelques secondes.", "Start a session with Claude Code, Codex, Antigravity, GitHub Copilot, OpenCode or Qwen Code: its card will show up here within seconds.")}</p>
          <button className="button" onClick={onOpenConnectors}>{t("Voir les connecteurs", "See connectors")}</button>
        </div>}
  </div>;
}
