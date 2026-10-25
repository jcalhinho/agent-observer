import { lazy, Suspense, useEffect, useMemo, useState, type CSSProperties } from "react";
import { X } from "lucide-react";
import { since, statusInfo } from "./AgentCard";
import { ContextMeter } from "./ContextMeter";
import { agentPulse, type AgentPulse } from "./agentPulse";
import { formatCompact } from "./analytics";
import { locale, t } from "./i18n";
import { deriveRaceState, isTurnComplete } from "./race";
import { daypartAt, FAMILIES, formatMinutes, laneInsights, modelFamily, replayClock, type Daypart, type DaypartSetting } from "./raceInsights";
import type { RaceLane, RaceQuality } from "./SprintTrack3D";
import { oneOf, usePreference } from "./preferences";
import { ProviderMark } from "./ProviderBadges";
import { useAgents, type Provider } from "./providers";
import type { SessionEvent } from "./types";
import { useConfiguredModels } from "./useConfiguredModels";
import { useNow } from "./useNow";

const SprintTrack3D = lazy(() => import("./SprintTrack3D"));

/** A bubble stays above a runner while its latest action is this recent. */
const BUBBLE_MAX_AGE_MS = 3 * 60_000;
/** A replay needs the events that were recent at its start: three hours before it are enough. */
const REPLAY_LOOKBACK_MS = 3 * 60 * 60_000;

export type TrackMode = "3d" | "2d";
export const isRaceQuality = oneOf<RaceQuality>("light", "auto", "smooth");

/** A replay of the last hour, played in thirty seconds: when it started in real time, and the moment it ends on. */
export type Replay = { anchor: number; startedAt: number };

export type LaneView = {
  provider: Provider;
  state: ReturnType<typeof deriveRaceState>;
  pulse: AgentPulse | undefined;
  cue: RaceLane["cue"];
  cueKey: string | null;
  bubble: AgentPulse["current"];
  label: string;
  model: string | null;
  capColor: string;
  familyLabel: string;
  insights: ReturnType<typeof laneInsights>;
};

/**
 * The race: each agent is a runner that moves forward when it acts, trips on a failed tool and
 * crosses the line when a turn ends. It also shows how long a session has lasted (flags), the
 * failures of the last minutes (hurdles), the family of the model (the cap) and the time of day. A click on a runner brings the camera close and opens its card. It fills
 * whatever room the stage gives it; bubbles repeat the action shown on the agent cards.
 */
export function SprintTrack({ events, pulses, liveEventIds, onGoTo, mode, replay, onReplayEnd }: { events: SessionEvent[]; pulses: Map<string, AgentPulse>; liveEventIds: Record<string, string>; onGoTo?: (pulse: AgentPulse) => void; mode: TrackMode; replay: Replay | null; onReplayEnd: () => void }) {
  // The race advances with elapsed time, so only this panel ticks (faster while a replay plays).
  const now = useNow(replay ? 400 : 1000);
  const reducedMotion = usePrefersReducedMotion();
  const [quality] = usePreference<RaceQuality>("race-quality", "auto", isRaceQuality);
  const agents = useAgents();
  const configured = useConfiguredModels();
  const [focusId, setFocusId] = useState<string | null>(null);
  const daypart = useDaypart();

  const clock = replay ? replayClock(replay.anchor, replay.startedAt, now) : null;
  const raceNow = clock ? clock.virtualNow : now;
  useEffect(() => { if (clock?.done) onReplayEnd(); }, [clock?.done, onReplayEnd]);
  useEffect(() => {
    if (!focusId) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setFocusId(null); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [focusId]);

  const pool = useMemo(() => replay ? events.filter((event) => { const at = Date.parse(event.occurred_at); return at <= replay.anchor && at >= replay.anchor - REPLAY_LOOKBACK_MS; }) : events, [events, replay]);
  const shown = useMemo(() => clock ? pool.filter((event) => Date.parse(event.occurred_at) <= raceNow) : events, [clock, pool, raceNow, events]);

  const lanes: LaneView[] = agents.map((provider) => {
    const state = deriveRaceState(provider.eventKey, shown, raceNow);
    const pulse = clock ? agentPulse(provider.eventKey, shown, raceNow) : pulses.get(provider.eventKey);
    const live = clock ? Boolean(state.latest) : Boolean(state.latest && liveEventIds[provider.eventKey] === state.latest.event_id && now - Date.parse(state.latest.occurred_at) < 8_000);
    const bubble = pulse?.current && raceNow - pulse.current.at < BUBBLE_MAX_AGE_MS ? pulse.current : null;
    const cue: RaceLane["cue"] = state.latest?.kind === "tool_failed" ? "fall" : state.latest?.kind === "session_ended" || (state.latest?.kind === "checkpoint" && isTurnComplete(provider.eventKey, state.latest)) ? "finish" : "leap";
    const model = pulse?.session?.models?.join(" · ") ?? pulse?.session?.model ?? configured[provider.eventKey] ?? null;
    const family = modelFamily(pulse?.session?.model ?? pulse?.session?.models?.[0] ?? configured[provider.eventKey]);
    return { provider, state, pulse, cue, cueKey: live && state.latest ? state.latest.event_id : null, bubble, label: statusInfo(pulse?.status ?? "never").label, model, capColor: FAMILIES[family].color, familyLabel: FAMILIES[family].label, insights: laneInsights(provider.eventKey, shown, raceNow, state.startedAt) };
  });
  const focused = lanes.find((lane) => lane.provider.id === focusId) ?? null;

  const toggleFocus = (id: string) => setFocusId((current) => current === id ? null : id);
  const lanes3d: RaceLane[] = lanes.map((lane) => ({
    id: lane.provider.id, name: lane.provider.name, model: lane.model, color: lane.provider.color,
    status: lane.state.status, progress: lane.state.progress, cue: lane.cue, cueKey: lane.cueKey, bubble: lane.bubble,
    mood: lane.pulse?.status ?? "never", onSelect: lane.state.latest ? () => toggleFocus(lane.provider.id) : undefined,
    capColor: lane.capColor, statusLabel: lane.label, sessionMinutes: lane.insights.sessionMinutes, laps: lane.insights.laps,
    cost: lane.pulse?.session?.cost ?? null, hurdleMarks: lane.insights.failureMarks,
    celebration: lane.insights.celebration, focused: lane.provider.id === focusId
  }));

  return mode === "3d"
    ? <div className="race-stage" data-daypart={daypart}><Suspense fallback={<div className="race-loading">{t("Chargement du stade…", "Loading the stadium…")}</div>}>
        <SprintTrack3D reducedMotion={reducedMotion} quality={quality} lanes={lanes3d} daypart={daypart} focusId={focusId} onBlur={() => setFocusId(null)} />
      </Suspense>
      {clock && <ReplayBar virtualNow={clock.virtualNow} progress={clock.progress} onStop={onReplayEnd} />}
      {focused && <FocusCard lane={focused} now={raceNow} onGoTo={onGoTo} onClose={() => setFocusId(null)} />}
    </div>
    : <div className="race-lanes">
        {clock && <ReplayBar virtualNow={clock.virtualNow} progress={clock.progress} onStop={onReplayEnd} />}
        {lanes.map(({ provider, state, cueKey, cue, bubble, pulse, label, model, capColor, insights }) => {
          const moving = state.status === "running" || state.status === "recent";
          return <div className={`race-lane ${moving ? "moving" : ""}`} key={provider.id} style={{ "--agent-color": provider.color, "--progress": `${state.progress}%` } as CSSProperties}>
            <div className="race-lane-name"><ProviderMark provider={provider} small /><span>{provider.name}<small><i className="family-dot" style={{ background: capColor }} />{model ?? t("modèle non fourni", "model not reported")}{insights.sessionMinutes ? ` · ${formatMinutes(insights.sessionMinutes)}` : ""}</small></span><small>{label}</small></div>
            <div className="race-lane-track">
              <span className="race-finish" aria-hidden="true" />
              {state.latest && <div className={`runner ${cue} ${cueKey ? "new-event" : ""} ${moving ? "moving" : ""}`} key={state.latest.event_id}>
                {bubble && <span className={`runner-bubble tone-${bubble.tone} ${state.progress > 60 ? "flipped" : ""}`} role="status">{bubble.text}{bubble.detail && <small>{bubble.detail}</small>}</span>}
                <svg viewBox="0 0 58 52" aria-hidden="true"><g className="runner-body"><circle cx="37" cy="8" r="5" className="runner-head" /><path d="M34 15l-7 13 9 5 7-14" /><path className="arm-back" d="M31 18l-11 5-5-6" /><path className="arm-front" d="M38 18l9 3 5-6" /><path className="leg-back" d="M29 31l-10 8-8 1" /><path className="leg-front" d="M35 32l7 8 9 2" /></g></svg>
              </div>}
            </div>
          </div>;
        })}
      </div>;
}

export const isDaypartSetting = oneOf<DaypartSetting>("auto", "dawn", "day", "dusk", "night");

/** The local time of day, checked every minute, unless the user fixed one in Settings. */
function useDaypart(): Daypart {
  const minute = useNow(60_000);
  const [setting] = usePreference<DaypartSetting>("race-daypart", "auto", isDaypartSetting);
  return setting === "auto" ? daypartAt(new Date(minute)) : setting;
}

export function ReplayBar({ virtualNow, progress, onStop }: { virtualNow: number; progress: number; onStop: () => void }) {
  const clock = new Date(virtualNow).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
  return <div className="replay-bar" role="status">
    <b>{t("Replay de la dernière heure", "Replay of the last hour")}</b>
    <span>{clock}</span>
    <i className="replay-progress" aria-hidden="true"><i style={{ width: `${Math.round(progress * 100)}%` }} /></i>
    <button className="icon-button" onClick={onStop} aria-label={t("Arrêter le replay", "Stop the replay")} title={t("Arrêter le replay", "Stop the replay")}><X size={13} /></button>
  </div>;
}

/** What one runner is doing, close up: its session, its token flow, its failures and its last actions. */
export function FocusCard({ lane, now, onGoTo, onClose }: { lane: LaneView; now: number; onGoTo?: (pulse: AgentPulse) => void; onClose: () => void }) {
  const { provider, pulse, insights } = lane;
  const status = statusInfo(pulse?.status ?? "never");
  const doing = pulse?.status === "looping" && pulse.loop ? pulse.loop.evidence : pulse?.current?.text ?? status.explanation;
  return <aside className="focus-card" style={{ "--agent-color": provider.color } as CSSProperties} aria-label={t(`Détails de ${provider.name}`, `${provider.name} details`)}>
    <header>
      <ProviderMark provider={provider} small />
      <span><b>{provider.name}</b><small>{status.label}</small></span>
      <button className="icon-button" onClick={onClose} aria-label={t("Fermer", "Close")} title={t("Fermer (Échap)", "Close (Esc)")}><X size={13} /></button>
    </header>
    <p className="focus-doing">{doing}</p>
    <p className="focus-model"><i className="family-dot" style={{ background: lane.capColor }} />{lane.model ?? t("modèle non fourni", "model not reported")} <small>{lane.familyLabel === "?" ? "" : lane.familyLabel}</small></p>
    <dl className="focus-stats">
      <div><dt>{t("Session", "Session")}</dt><dd>{insights.sessionMinutes ? formatMinutes(insights.sessionMinutes) : "—"}{insights.laps ? <small>{insights.laps} {insights.laps > 1 ? t("tours", "laps") : t("tour", "lap")}</small> : null}</dd></div>
      <div><dt>{t("Tokens / min", "Tokens / min")}</dt><dd>{insights.tokensPerMinute ? formatCompact(Math.round(insights.tokensPerMinute)) : "—"}</dd></div>
      <div><dt>{t("Échecs (15 min)", "Failures (15 min)")}</dt><dd>{insights.recentFailures}</dd></div>
      <div><dt>{t("Tours propres", "Clean turns")}</dt><dd>{insights.streak}</dd></div>
    </dl>
    {pulse?.context && <ContextMeter usage={pulse.context} trend />}
    {pulse && pulse.recent.length > 0 && <ul className="focus-recent">{pulse.recent.slice(0, 4).map((action) => <li key={action.id}><span>{action.text}</span><small>{since(action.at, now)}</small></li>)}</ul>}
    {onGoTo && pulse?.session && <button className="button small primary" onClick={() => onGoTo(pulse)}>{t("Aller à l’agent", "Go to the agent")}</button>}
  </aside>;
}

/** What the runners' moves mean. */
export function RaceLegend() {
  return <ul className="race-legend">
    <li><i className="legend-leap" />{t("saute : nouvelle action", "jumps: new action")}</li>
    <li><i className="legend-fall" />{t("tombe : outil en échec", "falls: failed tool")}</li>
    <li><i className="legend-finish" />{t("franchit la ligne : tour terminé, puis retourne au départ", "crosses the line: turn finished, then jogs back to the start")}</li>
    <li><i className="legend-loop" />{t("tourne en rond : boucle", "runs in circles: loop")}</li>
    <li><i className="legend-wait" />{t("lève la main : t’attend, un projecteur l’éclaire", "raises a hand: waiting for you, under a spotlight")}</li>
    <li><i className="legend-hurdle" />{t("haie sur la piste : un outil a échoué là, pendant le tour en cours ; un mur = bloqué", "hurdle on the track: a tool failed there, during the turn in progress; a wall = blocked")}</li>
    <li><i className="legend-flag" />{t("drapeaux au départ : un par tranche de 30 min de session", "flags at the start: one per 30 minutes of session")}</li>
    <li><i className="legend-cap" />{t("casquette : famille du modèle (grise si inconnu)", "cap: family of the model (grey when unknown)")}</li>
    <li><i className="legend-party" />{t("confettis : 3 tours propres de suite ; feu d’artifice : 6, ou 3 après 30 min", "confetti: 3 clean turns in a row; fireworks: 6, or 3 after 30 min")}</li>
    <li className="note">{t("Clique un coureur pour t’en approcher. Le tableau au-dessus des gradins résume chaque agent.", "Click a runner to move in on it. The board above the stands sums up each agent.")}</li>
    <li className="note">{t("La distance montre l’activité récente, pas l’avancement réel de la tâche.", "Distance shows recent activity, not real task progress.")}</li>
  </ul>;
}

let webglSupport: boolean | null = null;

/**
 * Whether WebGL works here. Asked once: every probe opens a WebGL context, and the browser drops the
 * oldest ones past a handful (it was the race's own), so this must not run on every render.
 */
export function supportsWebGL() {
  if (webglSupport !== null) return webglSupport;
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2") || canvas.getContext("webgl");
    webglSupport = Boolean(context);
    // Give the context back right away.
    context?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    webglSupport = false;
  }
  return webglSupport;
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return;
    const update = () => setReduced(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

