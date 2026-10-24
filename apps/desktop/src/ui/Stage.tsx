import { useState, type CSSProperties, type ReactNode } from "react";
import { Activity, ArrowUpRight, Info, Minimize2, PanelsTopLeft } from "lucide-react";
import { statusInfo, since } from "./AgentCard";
import type { AgentPulse } from "./agentPulse";
import { CollectorStatus } from "./CollectorStatus";
import { t } from "./i18n";
import { ProviderMark } from "./ProviderBadges";
import { providerFor } from "./providers";
import { RaceLegend, SprintTrack, supportsWebGL, type TrackMode } from "./SprintTrack";
import { oneOf, usePreference } from "./preferences";
import type { SessionEvent } from "./types";
import { needsYou, useAgentPulses } from "./useAgentPulses";

const isMode = oneOf("3d", "2d");

/** One agent in the dock: who, what it is doing, and whether it needs you. A click goes to it. */
function DockChip({ pulse, now, place, onGoTo, onInspect }: { pulse: AgentPulse; now: number; place: string | null; onGoTo: (pulse: AgentPulse) => void; onInspect: (pulse: AgentPulse) => void }) {
  const provider = providerFor(pulse.key);
  const status = statusInfo(pulse.status);
  const waiting = pulse.status === "waiting" || pulse.status === "stalled";
  const doing = pulse.status === "looping" && pulse.loop ? pulse.loop.evidence : pulse.current?.text ?? status.explanation;
  return <div className={`dock-chip status-${pulse.status}`} style={{ "--agent-color": provider?.color } as CSSProperties}>
    <button className="dock-main" onClick={() => onGoTo(pulse)} disabled={!pulse.session} title={`${provider?.name} · ${status.label}\n${doing}`}>
      {provider && <ProviderMark provider={provider} small />}
      <span className="dock-text">
        <span className="dock-line"><b>{provider?.name}</b><span className="dock-state"><i />{waiting ? t("Répondre", "Reply") : status.label}</span></span>
        <span className="dock-doing">{doing}</span>
        <span className="dock-meta">{place ?? "—"} · {since(pulse.lastEventAt, now)}</span>
      </span>
      <ArrowUpRight size={13} className="dock-go" aria-hidden="true" />
    </button>
    <button className="dock-info" onClick={() => onInspect(pulse)} aria-label={t("Détails de l’agent", "Agent details")} title={t("Détails de l’agent", "Agent details")}><Info size={12} /></button>
  </div>;
}

/**
 * The middle of the window: the race fills it, a thin bar floats over the top (who is watching,
 * who needs you, what to filter) and a dock of agents sits along the bottom.
 */
export function Stage({ events, agentEvents, liveEventIds, collectorState, repositoryName, onGoTo, onInspect, onMini, onOpenConnectors, controls, alerts }: {
  events: SessionEvent[];
  agentEvents: SessionEvent[];
  liveEventIds: Record<string, string>;
  collectorState: string;
  repositoryName: (pulse: AgentPulse) => string | null;
  onGoTo: (pulse: AgentPulse) => void;
  onInspect: (pulse: AgentPulse) => void;
  onMini: () => void;
  onOpenConnectors: () => void;
  controls: ReactNode;
  alerts: ReactNode;
}) {
  const { pulses, now } = useAgentPulses(agentEvents);
  const [mode, setMode] = usePreference<TrackMode>("race-mode", supportsWebGL() ? "3d" : "2d", isMode);
  const [legend, setLegend] = useState(false);
  const seen = pulses.filter((pulse) => pulse.status !== "never");
  const working = pulses.filter((pulse) => pulse.status === "working").length;
  const attention = pulses.filter((pulse) => needsYou(pulse.status)).length;
  const pulseByKey = new Map(pulses.map((pulse) => [pulse.key, pulse]));

  return <div className="stage">
    <div className="stage-track"><SprintTrack events={events} pulses={pulseByKey} liveEventIds={liveEventIds} onGoTo={onGoTo} mode={mode} /></div>

    <header className="hud">
      <div className="hud-id"><span className="hud-mark"><Activity size={14} strokeWidth={2.4} /></span><b>AGENT OBSERVER</b><CollectorStatus state={collectorState} /></div>
      <div className="hud-count" aria-live="polite">
        <span className="count-live"><i />{working}<small>{t("au travail", "working")}</small></span>
        <span className={`count-need ${attention ? "on" : ""}`}><i />{attention}<small>{t("t’attendent", "need you")}</small></span>
      </div>
      <div className="hud-controls">
        {controls}
        <div className="segmented" role="group" aria-label={t("Rendu de la course", "Race view")}>{(["3d", "2d"] as const).map((value) => <button key={value} aria-pressed={mode === value} onClick={() => setMode(value)}>{value === "3d" ? "3D" : "2D"}</button>)}</div>
        <button className="icon-button" onClick={() => setLegend((value) => !value)} aria-pressed={legend} aria-label={t("Légende de la course", "Race legend")} title={t("Légende de la course", "Race legend")}><PanelsTopLeft size={13} /></button>
        <button className="icon-button" onClick={onMini} aria-label={t("Mode mini", "Mini mode")} title={t("Mode mini : une colonne dans un coin de l’écran", "Mini mode: a column in a corner of the screen")}><Minimize2 size={13} /></button>
      </div>
    </header>
    {legend && <div className="hud-legend"><RaceLegend /></div>}
    <div className="stage-alerts">{alerts}</div>

    {!seen.length && <div className="stage-empty">
      <b>{t("En attente d’un agent", "Waiting for an agent")}</b>
      <p>{t("Lance une session avec Claude Code, Codex, Antigravity, OpenCode ou Qwen Code : son coureur et sa carte apparaîtront ici en quelques secondes.", "Start a session with Claude Code, Codex, Antigravity, OpenCode or Qwen Code: its runner and card will show up here within seconds.")}</p>
      <button className="button" onClick={onOpenConnectors}>{t("Voir les connecteurs", "See connectors")}</button>
    </div>}

    <footer className="dock" aria-label={t("Agents", "Agents")}>
      {seen.map((pulse) => <DockChip key={pulse.key} pulse={pulse} now={now} place={repositoryName(pulse)} onGoTo={onGoTo} onInspect={onInspect} />)}
    </footer>
  </div>;
}
