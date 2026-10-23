import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Bot, CircleHelp, Feather, GitBranch, MessageCircleQuestion, Plug, Settings2 } from "lucide-react";
import type { AgentPulse } from "./agentPulse";
import { eventsInRange, isDayRange, isDayText, timeAxis, type AnalyticsRange } from "./analytics";
import { AskPanel } from "./AskPanel";
import { AgentsPanel } from "./AgentsPanel";
import { ConnectorSetupDialog, type ConnectorSetup } from "./ConnectorDialog";
import { ConnectorsPage } from "./ConnectorsPage";
import { DailyReportPage } from "./DailyReportPage";
import { Deck, STAGE_MAX, type TabDef } from "./Deck";
import { Workbench } from "./Workbench";
import { FocusToast } from "./FocusToast";
import { HelpContent } from "./HelpPanel";
import { t, useLang } from "./i18n";
import { MiniView } from "./MiniView";
import { enterMiniWindow, leaveMiniWindow, setMiniPinned } from "./miniWindow";
import { NotificationCenter } from "./NotificationCenter";
import { isBoolean, isNumber, isString, oneOf, usePreference } from "./preferences";
import { agentName, setCustomProviders, useAgents, type CustomConnectorInfo } from "./providers";
import { RepositoriesPage } from "./RepositoriesPage";
import { SessionAnalytics } from "./SessionAnalytics";
import { SessionsPage } from "./SessionsPage";
import { SettingsPage } from "./SettingsPage";
import { useShell } from "./shell";
import { Stage } from "./Stage";
import { StoryPanel } from "./StoryPanel";
import { StoryScheduler } from "./StoryScheduler";
import { sessionKey } from "./types";
import { needsYou, useAgentPulses } from "./useAgentPulses";
import { useAnalyticsEvents } from "./useAnalyticsEvents";
import { useDialogFocus } from "./useDialogFocus";
import { useFocusAgent } from "./useFocusAgent";
import { useNow } from "./useNow";
import { useObserver } from "./useObserver";
import { useWorkspace } from "./useWorkspace";
import { filterByRepository, pathKey, type RepositoryFilter } from "./workspace";
import { RepositoryFilterSelect, WorkspaceSwitcher, useRepositoryActivity } from "./WorkspaceViews";

const isRelative = oneOf("15m", "1h", "24h", "all");
const isRange = (value: unknown): value is AnalyticsRange => isRelative(value) || isDayText(value);

/** The number of agents that need you, on the tab that opens them. Ticks on its own. */
function AttentionBadge({ events }: { events: Parameters<typeof useAgentPulses>[0] }) {
  const { pulses } = useAgentPulses(events);
  const count = pulses.filter((pulse) => needsYou(pulse.status)).length;
  return count ? <>{count}</> : null;
}

export function App() {
  useLang();
  useAgents();
  useEffect(() => { invoke<CustomConnectorInfo[]>("list_custom_connectors").then(setCustomProviders).catch(() => undefined); }, []);
  const observer = useObserver();
  const [shell, dispatch] = useShell();
  const [range, setRange] = usePreference<AnalyticsRange>("analytics-range", "24h", isRange);
  const [split, setSplit] = usePreference("stage-split", 0.46, isNumber);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [storedFilter, setRepositoryFilter] = usePreference<RepositoryFilter>("repository-filter", "all", isString);
  const [miniMode, setMiniMode] = usePreference("mini-mode", false, isBoolean);
  const [miniPinned, setMiniPinnedPreference] = usePreference("mini-pinned", true, isBoolean);
  const [connectorSetup, setConnectorSetup] = useState<ConnectorSetup | null>(null);
  const [inspected, setInspected] = useState<string | null>(null);
  const narrowWindow = useNarrowWindow();
  const compact = miniMode || narrowWindow;

  // Agents always look at the last 24 hours; charts follow the chosen period. Both read the whole
  // local database for their window, merged with live events.
  const agentWindow = useAnalyticsEvents("24h", observer.events);
  const chartWindow = useAnalyticsEvents(range, observer.events);
  const workspace = useWorkspace(agentWindow.events);
  const filter: RepositoryFilter = storedFilter === "all" || storedFilter === "outside" || workspace.repositories.some((repository) => pathKey(repository.path) === pathKey(storedFilter)) ? storedFilter : "all";
  const scope = useMemo(() => ({
    events: filterByRepository(observer.events, filter, workspace.repositoryOf),
    agentEvents: filterByRepository(agentWindow.events, filter, workspace.repositoryOf),
    chartEvents: filterByRepository(chartWindow.events, filter, workspace.repositoryOf)
  }), [observer.events, agentWindow.events, chartWindow.events, filter, workspace.repositoryOf]);
  const { activity: repositoryActivity, outside } = useRepositoryActivity(chartWindow.events, workspace);
  const sessionCount = useMemo(() => new Set(observer.events.map(sessionKey)).size, [observer.events]);
  const claudeHooks = useMemo(() => observer.events.some((event) => event.provider === "claude_code" && event.kind !== "model_usage" && event.kind !== "session_started"), [observer.events]);

  const focus = useFocusAgent();
  const goToAgent = (pulse: AgentPulse) => {
    if (!pulse.session) return;
    void focus.goTo({ provider: pulse.key, sessionId: pulse.session.id, projectPath: pulse.project?.project_path ?? null, agentName: agentName(pulse.key) });
  };
  const watcher = <NotificationCenter events={agentWindow.events} onGoTo={(target) => void focus.goTo(target)} />;
  const toast = <FocusToast toast={focus.toast} onReveal={(path) => void focus.revealFolder(path)} onDismiss={focus.dismiss} />;
  const repositoryName = (pulse: AgentPulse) => (pulse.project ? workspace.repositoryOf(pulse.project)?.name ?? null : null);

  useDialogFocus(() => setConnectorSetup(null), [connectorSetup]);

  useEffect(() => {
    // The corner placement is re-applied when the app starts in mini mode.
    if (miniMode) void enterMiniWindow(miniPinned);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function goMini() {
    setMiniMode(true);
    void enterMiniWindow(miniPinned);
  }

  function leaveMini() {
    setMiniMode(false);
    void leaveMiniWindow();
  }

  if (compact) {
    return <><MiniView agentEvents={agentWindow.events} collectorState={observer.collectorState} pinned={miniPinned} onTogglePin={() => { setMiniPinnedPreference(!miniPinned); void setMiniPinned(!miniPinned); }} onExpand={leaveMini} repositoryName={repositoryName} onGoTo={goToAgent} />{watcher}{toast}<StoryScheduler events={agentWindow.events} /></>;
  }

  const tabs: TabDef[] = [
    { id: "agents", edge: "left", label: t("Agents", "Agents"), icon: Bot, badge: <AttentionBadge events={scope.agentEvents} />, tone: "warn", content: <AgentsPanel agentEvents={scope.agentEvents} repositoryName={repositoryName} onGoTo={goToAgent} focusKey={inspected} /> },
    { id: "repositories", edge: "left", label: t("Dépôts", "Repositories"), icon: GitBranch, badge: workspace.repositories.length || null, content: <RepositoriesPage model={workspace} activity={repositoryActivity} events={chartWindow.events} onFilter={(next) => setRepositoryFilter(next)} /> },
    { id: "story", edge: "right", label: t("Histoire", "Story"), icon: Feather, content: <><StoryPanel events={agentWindow.events} /><DailyReportPage events={agentWindow.events} hasMore={observer.hasMore} /></> },
    { id: "ask", edge: "right", label: t("Demander", "Ask"), icon: MessageCircleQuestion, content: <AskPanel events={scope.chartEvents} range={range} onOpenSession={(key) => { setSelectedSession(key); dispatch({ type: "close", edge: "right" }); }} /> },
    { id: "connectors", edge: "top", label: t("Connecteurs", "Connectors"), icon: Plug, badge: claudeHooks ? null : "!", tone: claudeHooks ? undefined : "warn", content: <ConnectorsTab events={agentWindow.events} onConfigure={setConnectorSetup} /> },
    { id: "settings", edge: "top", label: t("Réglages", "Settings"), icon: Settings2, content: <SettingsPage onExport={observer.exportHistory} onClear={observer.clearHistory} onMini={goMini} /> },
    { id: "help", edge: "top", label: t("Aide", "Help"), icon: CircleHelp, content: <HelpContent /> }
  ];

  const stage = <Stage
    events={scope.events}
    agentEvents={scope.agentEvents}
    liveEventIds={observer.liveEventIds}
    collectorState={observer.collectorState}
    repositoryName={repositoryName}
    onGoTo={goToAgent}
    onInspect={(pulse) => { setInspected(pulse.key); dispatch({ type: "open", edge: "left", tab: "agents" }); }}
    onMini={goMini}
    onOpenConnectors={() => dispatch({ type: "open", edge: "top", tab: "connectors" })}
    controls={<><WorkspaceSwitcher model={workspace} /><RepositoryFilterSelect model={workspace} filter={filter} onFilter={setRepositoryFilter} activity={repositoryActivity} outside={outside} total={chartWindow.events.length} /></>}
    alerts={watcher}
  />;

  const workbench = <Workbench
    range={range}
    onRange={setRange}
    charts={<SessionAnalytics events={scope.chartEvents} range={range} dataset={chartWindow} repositoryOf={workspace.repositories.length && filter === "all" ? workspace.repositoryOf : undefined} />}
    history={<HistoryTab events={scope.chartEvents} range={range} repositoryOf={workspace.repositoryOf} selected={selectedSession} onSelect={setSelectedSession} />}
  />;

  return <>
    <Deck stage={stage} workbench={workbench} tabs={tabs} state={shell} dispatch={dispatch} split={Math.min(STAGE_MAX, split)} onSplit={setSplit} />
    {toast}
    {connectorSetup && <ConnectorSetupDialog key={connectorSetup.kind} connector={connectorSetup} onClose={() => setConnectorSetup(null)} />}
    <StoryScheduler events={agentWindow.events} />
  </>;
}

/** The history shows relative times: it ticks slowly on its own. */
function HistoryTab({ events, range, repositoryOf, selected, onSelect }: { events: Parameters<typeof SessionsPage>[0]["events"]; range: AnalyticsRange; repositoryOf: Parameters<typeof SessionsPage>[0]["repositoryOf"]; selected: string | null; onSelect: (key: string) => void }) {
  const now = useNow(30_000);
  // A chosen day shows that day only, whatever else was loaded.
  const shown = useMemo(() => (isDayRange(range) ? eventsInRange(events, timeAxis([], range, now)) : events), [events, range, now]);
  return <SessionsPage events={shown} repositoryOf={repositoryOf} now={now} selected={selected} onSelect={onSelect} />;
}

function ConnectorsTab({ events, onConfigure }: Omit<Parameters<typeof ConnectorsPage>[0], "now">) {
  const now = useNow(10_000);
  return <ConnectorsPage events={events} now={now} onConfigure={onConfigure} />;
}

/** The deck needs room: a window narrowed by hand switches to the mini layout. */
function useNarrowWindow() {
  const query = "(max-width: 700px)";
  const [narrow, setNarrow] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return;
    const update = () => setNarrow(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return narrow;
}
