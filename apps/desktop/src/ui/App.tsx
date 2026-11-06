import { useMemo, useState } from "react";
import { Settings2 } from "lucide-react";
import { AgentCard } from "./AgentCard";
import { CollectorStatus } from "./CollectorStatus";
import { ConnectorSetupDialog, type ConnectorSetup } from "./ConnectorDialog";
import { t, useLang } from "./i18n";
import { agentName, useAgents } from "./providers";
import { SettingsPanel } from "./SettingsPanel";
import { needsYou, useAgentPulses } from "./useAgentPulses";
import { useObserver } from "./useObserver";

/**
 * L'écran unique. En haut, qui travaille et qui t'attend. En dessous, une carte par agent, les
 * plus urgents en premier. Tout le reste est dans le panneau des réglages.
 */
export function App() {
  useLang();
  useAgents();
  const observer = useObserver();
  const { pulses, now } = useAgentPulses(observer.events);
  const [settings, setSettings] = useState(false);
  const [connector, setConnector] = useState<ConnectorSetup | null>(null);

  const seen = useMemo(() => pulses.filter((pulse) => pulse.status !== "never"), [pulses]);
  const unseen = useMemo(() => pulses.filter((pulse) => pulse.status === "never"), [pulses]);
  const working = seen.filter((pulse) => pulse.status === "working").length;
  const attention = seen.filter((pulse) => needsYou(pulse.status)).length;

  return <div className="app">
    <header className="top">
      <div className="top-id">
        <b>AGENT OBSERVER</b>
        <CollectorStatus state={observer.collectorState} />
      </div>
      <div className="top-counts" aria-live="polite">
        <span className="count working"><i />{working} <small>{t("au travail", "working")}</small></span>
        <span className={`count need ${attention ? "on" : ""}`}><i />{attention} <small>{t("t’attendent", "need you")}</small></span>
      </div>
      <button className="icon-button" onClick={() => setSettings(true)} aria-label={t("Réglages", "Settings")} title={t("Réglages et connecteurs", "Settings and connectors")}>
        <Settings2 size={15} />
      </button>
    </header>

    <main className="board">
      {seen.length
        ? seen.map((pulse) => <AgentCard key={pulse.key} pulse={pulse} now={now} />)
        : <div className="empty">
            <b>{t("En attente d’un agent", "Waiting for an agent")}</b>
            <p>{t("Lance une session avec un de tes agents : sa carte apparaîtra ici en quelques secondes.", "Start a session with one of your agents: its card will show up here within seconds.")}</p>
            <button className="button primary" onClick={() => setSettings(true)}>{t("Brancher un agent", "Connect an agent")}</button>
          </div>}
    </main>

    {Boolean(unseen.length) && seen.length > 0 && <footer className="unseen">
      {t("Pas encore vus", "Not seen yet")} : {unseen.map((pulse) => agentName(pulse.key)).join(", ")}
      <button className="link" onClick={() => setSettings(true)}>{t("Brancher", "Connect")}</button>
    </footer>}

    {settings && <SettingsPanel
      onClose={() => setSettings(false)}
      onConfigure={setConnector}
      onExport={observer.exportHistory}
      onClear={observer.clearHistory}
    />}
    {connector && <ConnectorSetupDialog key={connector.kind} connector={connector} onClose={() => setConnector(null)} />}
  </div>;
}
