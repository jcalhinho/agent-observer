import { useMemo, useState, type ReactNode } from "react";
import { Activity, Coins, Database, History as HistoryIcon, Settings2, TriangleAlert, Wallet, Wrench, Zap } from "lucide-react";
import { AgentCard } from "./AgentCard";
import { AgentDetail } from "./AgentDetail";
import { budgetState, dailyTotals, detectCollisions, localDay } from "./analysis";
import { CollectorStatus } from "./CollectorStatus";
import { ConnectorSetupDialog, type ConnectorSetup } from "./ConnectorDialog";
import { t, useLang } from "./i18n";
import { History } from "./History";
import { compact, fleetTotals, percent, usd } from "./insights";
import { isBoolean, isNumber, usePreference } from "./preferences";
import { agentName, useAgents } from "./providers";
import { SettingsPanel } from "./SettingsPanel";
import { needsYou, useAgentPulses } from "./useAgentPulses";
import { useAlerts } from "./useAlerts";
import { revealFolder, useGit } from "./useGit";
import { useHistory } from "./useHistory";
import { useObserver } from "./useObserver";

type Filter = "all" | "active" | "attention";

function Kpi({ icon, label, value, sub, tone, title }: { icon: ReactNode; label: string; value: ReactNode; sub?: ReactNode; tone?: "good" | "bad"; title?: string }) {
  return <div className={`kpi ${tone ?? ""}`} title={title}>
    <span className="kpi-label">{icon}{label}</span>
    <b className="kpi-value">{value}</b>
    {sub && <small className="kpi-sub">{sub}</small>}
  </div>;
}

/**
 * L'écran unique. En haut, qui travaille et qui t'attend, puis les totaux de tous les agents
 * (tokens, cache, coût estimé). En dessous, une carte par agent, les plus urgents en premier ;
 * un clic ouvre le détail. Les réglages sont dans leur propre panneau.
 */
export function App() {
  useLang();
  useAgents();
  const observer = useObserver();
  const { pulses, now } = useAgentPulses(observer.events);
  const [settings, setSettings] = useState(false);
  const [connector, setConnector] = useState<ConnectorSetup | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [period, setPeriod] = useState(7);
  const [notifications, setNotifications] = usePreference("notifications", true, isBoolean);
  const [budget, setBudget] = usePreference("dailyBudget", 0, isNumber);

  const seen = useMemo(() => pulses.filter((pulse) => pulse.status !== "never"), [pulses]);
  const unseen = useMemo(() => pulses.filter((pulse) => pulse.status === "never"), [pulses]);
  const working = seen.filter((pulse) => pulse.status === "working").length;
  const attention = seen.filter((pulse) => needsYou(pulse.status)).length;
  const totals = useMemo(() => fleetTotals(seen), [seen]);
  const shown = seen.filter((pulse) => filter === "all" || (filter === "attention" ? needsYou(pulse.status) : pulse.status === "working" || pulse.status === "looping" || pulse.status === "blocked"));
  const opened = openKey ? pulses.find((pulse) => pulse.key === openKey) ?? null : null;

  // Les analyses qui croisent les agents sont recalculées toutes les 5 secondes, pas à chaque événement.
  const bucket = Math.floor(now / 5000) * 5000;
  const collisions = useMemo(() => detectCollisions(observer.events, bucket), [observer.events, bucket]);
  const history = useHistory(observer.events, historyOpen ? period : 1, historyOpen || budget > 0);
  const spentToday = useMemo(() => budget > 0 ? dailyTotals(history.events, bucket, 1).find((day) => day.day === localDay(bucket))?.cost ?? 0 : null, [budget, history.events, bucket]);
  const budgetLevel = budgetState(spentToday, budget || null);
  const git = useGit(seen.map((pulse) => pulse.project?.project_path ?? null));
  useAlerts({ pulses, collisions, spentToday, budget: budget || null, enabled: notifications, now: bucket });
  const collisionsOf = (key: string) => collisions.filter((collision) => collision.agents.includes(key));
  const gitOf = (pulse: { project: { project_path: string | null } | null }) => pulse.project?.project_path ? git[pulse.project.project_path] : undefined;

  const filters: Array<[Filter, string, number]> = [
    ["all", t("Tous", "All"), seen.length],
    ["active", t("Actifs", "Active"), seen.filter((pulse) => pulse.status === "working" || pulse.status === "looping" || pulse.status === "blocked").length],
    ["attention", t("T’attendent", "Need you"), attention]
  ];

  return <div className="app">
    <header className="top">
      <div className="top-id">
        <span className="logo" aria-hidden="true"><Activity size={14} /></span>
        <b>Agent Observer</b>
        <CollectorStatus state={observer.collectorState} />
      </div>
      <div className="top-counts" aria-live="polite">
        <span className="count working"><i />{working} <small>{t("au travail", "working")}</small></span>
        <span className={`count need ${attention ? "on" : ""}`}><i />{attention} <small>{t("t’attendent", "need you")}</small></span>
      </div>
      {budget > 0 && spentToday !== null && <span className={`count spend ${budgetLevel}`} title={t("Coût estimé d’aujourd’hui, au tarif API, face à ton budget", "Today's estimated cost, at API list price, against your budget")}><Wallet size={12} />≈ {usd(spentToday)}<small>/ {usd(budget)}</small></span>}
      <button className="icon-button" onClick={() => setHistoryOpen(true)} aria-label={t("Historique", "History")} title={t("Historique par jour", "History by day")}><HistoryIcon size={15} /></button>
      <button className="icon-button" onClick={() => setSettings(true)} aria-label={t("Réglages", "Settings")} title={t("Réglages et connecteurs", "Settings and connectors")}>
        <Settings2 size={15} />
      </button>
    </header>

    {(budgetLevel === "near" || budgetLevel === "over" || collisions.length > 0) && <section className="alerts" role="status" aria-label={t("Alertes", "Alerts")}>
      {(budgetLevel === "near" || budgetLevel === "over") && spentToday !== null && <div className={`alert ${budgetLevel === "over" ? "bad" : "warn"}`}>
        <Wallet size={14} /><span>{budgetLevel === "over" ? t("Budget du jour dépassé", "Daily budget exceeded") : t("Budget du jour bientôt atteint", "Daily budget almost reached")} : <b>≈ {usd(spentToday)}</b> {t("sur", "of")} {usd(budget)}</span>
      </div>}
      {collisions.map((collision) => <div key={`${collision.kind}:${collision.path}`} className="alert warn">
        <TriangleAlert size={14} />
        <span><b>{collision.agents.map(agentName).join(" + ")}</b> {collision.kind === "file" ? t("modifient le même fichier", "are editing the same file") : t("travaillent dans le même projet", "are working in the same project")} · <code>{collision.path.split("/").filter(Boolean).slice(-2).join("/")}</code></span>
        <button className="link" onClick={() => void revealFolder(collision.kind === "file" ? collision.path.split("/").slice(0, -1).join("/") || "/" : collision.path)}>{t("ouvrir", "open")}</button>
      </div>)}
    </section>}

    {seen.length > 0 && <section className="kpis" aria-label={t("Totaux de la dernière session de chaque agent", "Totals over each agent’s latest session")}>
      <Kpi icon={<Zap size={12} />} label="Tokens" value={totals.tokens === null ? "—" : compact(totals.tokens)} sub={totals.output !== null ? t(`dont ${compact(totals.output)} écrits`, `${compact(totals.output)} written`) : t("non rapportés", "not reported")} title={t("Tokens lus (cache compris) et écrits, sur la session la plus récente de chaque agent.", "Tokens read (cache included) and written, over each agent’s latest session.")} />
      <Kpi icon={<Database size={12} />} label={t("Cache", "Cache")} value={totals.cacheHit === null ? "—" : percent(totals.cacheHit)} sub={totals.cacheHit === null ? t("aucun agent ne le rapporte", "no agent reports it") : t("du prompt servi par le cache", "of the prompt served from cache")} tone={totals.cacheHit !== null && totals.cacheHit >= 0.8 ? "good" : undefined} title={t("Part des tokens lus qui viennent du cache du fournisseur (moins cher). Seuls les agents qui le rapportent comptent.", "Share of tokens read that come from the provider cache (cheaper). Only agents that report it count.")} />
      <Kpi icon={<Coins size={12} />} label={t("Coût estimé", "Estimated cost")} value={totals.cost === null ? "—" : `${totals.costPartial ? "≥ " : "≈ "}${usd(totals.cost)}`} sub={totals.cost === null ? t("modèles hors table des prix", "models not in the price table") : totals.costPartial ? t("certains modèles non chiffrés", "some models not priced") : t("au tarif API", "at API list price")} title={t("Au tarif API public des modèles. Un abonnement (Claude, Copilot…) ne facture pas ainsi.", "At the models’ public API price. A subscription (Claude, Copilot…) is not billed this way.")} />
      <Kpi icon={<Coins size={12} />} label={t("Gagné par le cache", "Saved by cache")} value={totals.saved === null ? "—" : `≈ ${usd(totals.saved)}`} sub={totals.saved === null ? t("rien à comparer", "nothing to compare") : t("vs. sans aucun cache", "vs. no cache at all")} tone={totals.saved !== null ? "good" : undefined} title={t("Ce que les mêmes requêtes auraient coûté de plus sans cache.", "What the same requests would have cost on top without a cache.")} />
      <Kpi icon={<Wrench size={12} />} label={t("Outils", "Tool calls")} value={totals.toolCalls} sub={totals.failures > 0 ? t(`${totals.failures} échec(s) · ${totals.filesChanged} fichier(s) modifié(s)`, `${totals.failures} failed · ${totals.filesChanged} file(s) edited`) : t(`${totals.filesChanged} fichier(s) modifié(s)`, `${totals.filesChanged} file(s) edited`)} tone={totals.failures > 0 ? "bad" : undefined} />
    </section>}

    {seen.length > 1 && <nav className="toolbar" aria-label={t("Filtrer les agents", "Filter agents")}>
      <div className="segmented" role="group">
        {filters.map(([key, label, count]) => <button key={key} className={filter === key ? "on" : ""} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}<b>{count}</b></button>)}
      </div>
      <small>{t("Chiffres de la session la plus récente de chaque agent", "Figures cover each agent’s latest session")}</small>
    </nav>}

    <main className="board">
      {seen.length
        ? shown.length
          ? shown.map((pulse) => <AgentCard key={pulse.key} pulse={pulse} now={now} onOpen={setOpenKey} git={gitOf(pulse)} collisions={collisionsOf(pulse.key)} />)
          : <div className="empty"><b>{t("Personne ici", "Nobody here")}</b><p>{t("Aucun agent ne correspond à ce filtre en ce moment.", "No agent matches this filter right now.")}</p></div>
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

    {opened && <AgentDetail pulse={opened} now={now} onClose={() => setOpenKey(null)} git={gitOf(opened)} collisions={collisionsOf(opened.key)} />}
    {historyOpen && <History events={history.events} now={now} period={period} onPeriod={setPeriod} loading={history.loading} truncated={history.truncated} onClose={() => setHistoryOpen(false)} />}
    {settings && <SettingsPanel
      alerts={{ notifications, onNotifications: setNotifications, budget, onBudget: setBudget }}
      onClose={() => setSettings(false)}
      onConfigure={setConnector}
      onExport={observer.exportHistory}
      onClear={observer.clearHistory}
    />}
    {connector && <ConnectorSetupDialog key={connector.kind} connector={connector} onClose={() => setConnector(null)} />}
  </div>;
}
