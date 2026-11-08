import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Activity, Coins, Database, Gauge, History as HistoryIcon, Maximize2, Minimize2, Moon, Pin, PinOff, Settings2, Sun, TriangleAlert, Wallet, Wrench, Zap } from "lucide-react";
import { AgentBar } from "./AgentBar";
import { AgentDetail } from "./AgentDetail";
import { budgetState, dailyTotals, detectCollisions, localDay } from "./analysis";
import { CollectorStatus } from "./CollectorStatus";
import { ConnectorSetupDialog, type ConnectorSetup } from "./ConnectorDialog";
import { t, useLang } from "./i18n";
import { History } from "./History";
import { cacheCounts, compact, fleetTotals, percent, usd } from "./insights";
import { isBoolean, isNumber, usePreference } from "./preferences";
import { agentName, useAgents } from "./providers";
import { SettingsPanel } from "./SettingsPanel";
import { needsYou, useAgentPulses } from "./useAgentPulses";
import { useAlerts } from "./useAlerts";
import { enterMiniWindow, leaveMiniWindow, setMiniPinned } from "./miniWindow";
import { revealFolder, useGit } from "./useGit";
import { useHistory } from "./useHistory";
import { useObserver } from "./useObserver";
import { useTheme } from "./useTheme";
import { useLimits } from "./useLimits";
import { limitAlerts, resetText } from "./limitsView";

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
 * (tokens, cache, coût estimé). En dessous, une barre par agent, en colonne, les plus urgents en premier ;
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
  const [theme, toggleTheme] = useTheme();
  const limits = useLimits();
  const [mini, setMini] = usePreference("mini-mode", false, isBoolean);
  const [pinned, setPinned] = usePreference("mini-pinned", true, isBoolean);

  // Au démarrage en mode réduit, la fenêtre reprend sa place dans le coin de l'écran.
  useEffect(() => { if (mini) void enterMiniWindow(pinned); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const goMini = () => { setMini(true); void enterMiniWindow(pinned); };
  const leaveMini = () => { setMini(false); void leaveMiniWindow(); };
  const togglePin = () => { setPinned(!pinned); void setMiniPinned(!pinned); };

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
  const history = useHistory(observer.events, historyOpen ? period : 1);
  // Null quand rien n'a pu être chiffré aujourd'hui : on n'affiche pas un faux « 0 $ ».
  const spentToday = useMemo(() => dailyTotals(history.events, bucket, 1, history.presence).find((day) => day.day === localDay(bucket))?.cost ?? null, [history.events, history.presence, bucket]);
  const fleet = useMemo(() => {
    let hits = 0, misses = 0, perMin = 0, widest: { name: string; percent: number } | null = null;
    for (const pulse of seen) {
      const counts = cacheCounts(pulse.summary?.tokens ?? null);
      if (counts) { hits += counts.hit; misses += counts.miss; }
      if (pulse.burn && (pulse.status === "working" || pulse.status === "looping" || pulse.status === "blocked")) perMin += pulse.burn.tokensPerMin;
      if (pulse.context?.percent != null && (!widest || pulse.context.percent > widest.percent)) widest = { name: agentName(pulse.key), percent: pulse.context.percent };
    }
    return { hits, misses, perMin, widest };
  }, [seen]);
  const limitWarnings = useMemo(() => limitAlerts(limits, bucket), [limits, bucket]);
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

  return <div className={`app ${mini ? "mini" : ""}`}>
    <header className="top">
      <div className="top-id">
        <span className="logo" aria-hidden="true"><Activity size={14} /></span>
        {!mini && <b>Agent Observer</b>}
        <CollectorStatus state={observer.collectorState} compact={mini} />
      </div>
      <div className="top-counts" aria-live="polite">
        <span className="count working"><i />{working} <small>{t("au travail", "working")}</small></span>
        <span className={`count need ${attention ? "on" : ""}`}><i />{attention} <small>{mini ? t("à voir", "to check") : t("t’attendent", "need you")}</small></span>
      </div>
      {budget > 0 && <span className={`count spend ${budgetLevel}`} title={t("Coût estimé d’aujourd’hui, au tarif API, face à ton budget", "Today's estimated cost, at API list price, against your budget")}><Wallet size={12} />{spentToday === null ? "—" : `≈ ${usd(spentToday)}`}<small>/ {usd(budget)}</small></span>}
      <div className="top-actions">
        <button className="icon-button" onClick={toggleTheme} aria-label={theme === "dark" ? t("Passer au thème clair", "Switch to the light theme") : t("Passer au thème sombre", "Switch to the dark theme")} title={theme === "dark" ? t("Thème clair", "Light theme") : t("Thème sombre", "Dark theme")}>{theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}</button>
        {!mini && <button className="icon-button" onClick={() => setHistoryOpen(true)} aria-label={t("Historique", "History")} title={t("Historique par jour", "History by day")}><HistoryIcon size={15} /></button>}
        {!mini && <button className="icon-button" onClick={() => setSettings(true)} aria-label={t("Réglages", "Settings")} title={t("Réglages et connecteurs", "Settings and connectors")}><Settings2 size={15} /></button>}
        {mini && <button className="icon-button" onClick={togglePin} aria-pressed={pinned} title={pinned ? t("La fenêtre reste au premier plan — cliquer pour l’en retirer", "The window stays on top — click to release it") : t("Garder la fenêtre au premier plan", "Keep the window on top")}>{pinned ? <Pin size={15} /> : <PinOff size={15} />}</button>}
        <button className="icon-button" onClick={mini ? leaveMini : goMini} aria-label={mini ? t("Revenir au tableau de bord complet", "Back to the full dashboard") : t("Réduire en colonne", "Shrink to a column")} title={mini ? t("Revenir au tableau de bord complet", "Back to the full dashboard") : t("Réduire en colonne, au premier plan", "Shrink to a column, on top")}>{mini ? <Maximize2 size={15} /> : <Minimize2 size={15} />}</button>
      </div>
    </header>

    {(budgetLevel === "near" || budgetLevel === "over" || collisions.length > 0 || limitWarnings.length > 0) && <section className="alerts" role="status" aria-label={t("Alertes", "Alerts")}>
      {(budgetLevel === "near" || budgetLevel === "over") && spentToday !== null && <div className={`alert ${budgetLevel === "over" ? "bad" : "warn"}`}>
        <Wallet size={14} /><span>{budgetLevel === "over" ? t("Budget du jour dépassé", "Daily budget exceeded") : t("Budget du jour bientôt atteint", "Daily budget almost reached")} : <b>≈ {usd(spentToday)}</b> {t("sur", "of")} {usd(budget)}</span>
      </div>}
      {limitWarnings.map((warning) => <div key={`${warning.provider}:${warning.label}`} className={`alert ${warning.level === "over" ? "bad" : "warn"}`}>
        <Gauge size={14} /><span><b>{agentName(warning.provider)}</b> · {t(`limite de ${warning.label} utilisée à ${percent(warning.percent / 100)}`, `${warning.label} limit ${percent(warning.percent / 100)} used`)} · {resetText(warning.resetsAt, bucket)}</span>
      </div>)}
      {collisions.map((collision) => <div key={`${collision.kind}:${collision.path}`} className="alert warn">
        <TriangleAlert size={14} />
        <span><b>{collision.agents.map(agentName).join(" + ")}</b> {collision.kind === "file" ? t("modifient le même fichier", "are editing the same file") : t("travaillent dans le même projet", "are working in the same project")} · <code>{collision.path.split("/").filter(Boolean).slice(-2).join("/")}</code></span>
        <button className="link" onClick={() => void revealFolder(collision.kind === "file" ? collision.path.split("/").slice(0, -1).join("/") || "/" : collision.path)}>{t("ouvrir", "open")}</button>
      </div>)}
    </section>}

    {!mini && seen.length > 0 && <section className="kpis" aria-label={t("Totaux de la dernière session de chaque agent", "Totals over each agent’s latest session")}>
      <Kpi icon={<Zap size={12} />} label="Tokens" value={totals.tokens === null ? "—" : compact(totals.tokens)} sub={totals.output !== null ? t(`dont ${compact(totals.output)} écrits`, `${compact(totals.output)} written`) : t("non rapportés", "not reported")} title={t("Tokens lus (cache compris) et écrits, sur la session la plus récente de chaque agent.", "Tokens read (cache included) and written, over each agent’s latest session.")} />
      <Kpi icon={<Database size={12} />} label={t("Cache", "Cache")} value={totals.cacheHit === null ? "—" : percent(totals.cacheHit)} sub={totals.cacheHit === null ? t("aucun agent ne le rapporte", "no agent reports it") : t("du prompt servi par le cache", "of the prompt served from cache")} tone={totals.cacheHit !== null && totals.cacheHit >= 0.8 ? "good" : undefined} title={t("Part des tokens lus qui viennent du cache du fournisseur (moins cher). Seuls les agents qui le rapportent comptent.", "Share of tokens read that come from the provider cache (cheaper). Only agents that report it count.")} />
      <Kpi icon={<Coins size={12} />} label={t("Coût estimé", "Estimated cost")} value={totals.cost === null ? "—" : `${totals.costPartial ? "≥ " : "≈ "}${usd(totals.cost)}`} sub={totals.cost === null ? t("modèles hors table des prix", "models not in the price table") : totals.costPartial ? t("certains modèles non chiffrés", "some models not priced") : t("au tarif API", "at API list price")} title={t("Au tarif API public des modèles. Un abonnement (Claude, Copilot…) ne facture pas ainsi.", "At the models’ public API price. A subscription (Claude, Copilot…) is not billed this way.")} />
      <Kpi icon={<Coins size={12} />} label={t("Gagné par le cache", "Saved by cache")} value={totals.saved === null ? "—" : `≈ ${usd(totals.saved)}`} sub={totals.saved === null ? t("rien à comparer", "nothing to compare") : t("vs. sans aucun cache", "vs. no cache at all")} tone={totals.saved !== null ? "good" : undefined} title={t("Ce que les mêmes requêtes auraient coûté de plus sans cache.", "What the same requests would have cost on top without a cache.")} />
      <Kpi icon={<Wrench size={12} />} label={t("Outils", "Tool calls")} value={totals.toolCalls} sub={totals.failures > 0 ? t(`${totals.failures} échec(s) · ${totals.filesChanged} fichier(s) modifié(s)`, `${totals.failures} failed · ${totals.filesChanged} file(s) edited`) : t(`${totals.filesChanged} fichier(s) modifié(s)`, `${totals.filesChanged} file(s) edited`)} tone={totals.failures > 0 ? "bad" : undefined} />
    </section>}

    {!mini && seen.length > 1 && <nav className="toolbar" aria-label={t("Filtrer les agents", "Filter agents")}>
      <div className="segmented" role="group">
        {filters.map(([key, label, count]) => <button key={key} className={filter === key ? "on" : ""} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}<b>{count}</b></button>)}
      </div>
      <small>{t("Chiffres de la session la plus récente de chaque agent", "Figures cover each agent’s latest session")}</small>
    </nav>}

    <main className="board bars">
      {seen.length
        ? shown.length
          ? shown.map((pulse) => <AgentBar key={pulse.key} pulse={pulse} now={now} onOpen={setOpenKey} git={gitOf(pulse)} collisions={collisionsOf(pulse.key)} limits={limits[pulse.key]} />)
          : <div className="empty"><b>{t("Personne ici", "Nobody here")}</b><p>{t("Aucun agent ne correspond à ce filtre en ce moment.", "No agent matches this filter right now.")}</p></div>
        : <div className="empty">
            <b>{t("En attente d’un agent", "Waiting for an agent")}</b>
            <p>{t("Lance une session avec un de tes agents : sa barre apparaîtra ici en quelques secondes.", "Start a session with one of your agents: its bar will show up here within seconds.")}</p>
            <button className="button primary" onClick={() => setSettings(true)}>{t("Brancher un agent", "Connect an agent")}</button>
          </div>}
    </main>

    {!mini && seen.length > 0 && <footer className="statusbar" aria-label={t("Résumé en direct", "Live summary")}>
      <span title={fleet.hits + fleet.misses > 0 ? `Hit ${fleet.hits.toLocaleString()} · Miss ${fleet.misses.toLocaleString()}` : t("Aucun agent ne rapporte son cache", "No agent reports its cache")}><Database size={11} />Cache <b>{totals.cacheHit === null ? "—" : percent(totals.cacheHit)}</b></span>
      <span title={fleet.widest ? t(`Le contexte le plus rempli : ${fleet.widest.name}`, `The fullest context: ${fleet.widest.name}`) : undefined}>{t("Contexte", "Context")} <b>{fleet.widest ? percent(fleet.widest.percent / 100) : "—"}</b>{fleet.widest ? <small>{fleet.widest.name}</small> : null}</span>
      <span title={t("Tokens par minute, agents au travail, sur les 15 dernières minutes", "Tokens per minute, working agents, over the last 15 minutes")}><Zap size={11} /><b>{fleet.perMin > 0 ? compact(fleet.perMin) : "—"}</b> tokens/min</span>
      {limitWarnings[0] ? <span className={`limit-chip ${limitWarnings[0].level}`} title={resetText(limitWarnings[0].resetsAt, bucket)}><Gauge size={11} />{agentName(limitWarnings[0].provider)} {limitWarnings[0].label} <b>{percent(limitWarnings[0].percent / 100)}</b></span> : null}
      <span className="grow" />
      <span title={t("Dernière session de chaque agent, au tarif API", "Latest session of each agent, at API price")}>{t("Sessions", "Sessions")} <b>{totals.cost === null ? "—" : `${totals.costPartial ? "≥ " : "≈ "}${usd(totals.cost)}`}</b></span>
      <span title={t("Coût estimé d’aujourd’hui, toutes sessions, au tarif API", "Estimated cost today, all sessions, at API price")}>{t("Aujourd’hui", "Today")} <b>{history.loading ? "…" : spentToday === null ? "—" : `≈ ${usd(spentToday)}`}</b></span>
    </footer>}
    {Boolean(unseen.length) && seen.length > 0 && <footer className="unseen">
      {t("Pas encore vus", "Not seen yet")} : {unseen.map((pulse) => agentName(pulse.key)).join(", ")}
      <button className="link" onClick={() => setSettings(true)}>{t("Brancher", "Connect")}</button>
    </footer>}

    {opened && <AgentDetail pulse={opened} now={now} onClose={() => setOpenKey(null)} git={gitOf(opened)} collisions={collisionsOf(opened.key)} limits={limits[opened.key]} />}
    {historyOpen && <History events={history.events} presence={history.presence} now={now} period={period} onPeriod={setPeriod} loading={history.loading} truncated={history.truncated} onClose={() => setHistoryOpen(false)} />}
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
