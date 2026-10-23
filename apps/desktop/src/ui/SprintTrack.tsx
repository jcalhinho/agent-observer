import { lazy, Suspense, useEffect, useState, type CSSProperties } from "react";
import type { AgentPulse } from "./agentPulse";
import { statusInfo } from "./AgentCard";
import { t } from "./i18n";
import { deriveRaceState, isTurnComplete } from "./race";
import type { RaceLane, RaceQuality } from "./SprintTrack3D";
import { oneOf, usePreference } from "./preferences";
import { useAgents } from "./providers";
import { ProviderMark } from "./ProviderBadges";
import type { SessionEvent } from "./types";
import { useNow } from "./useNow";

const SprintTrack3D = lazy(() => import("./SprintTrack3D"));

/** A bubble stays above a runner while its latest action is this recent. */
const BUBBLE_MAX_AGE_MS = 3 * 60_000;

export type TrackMode = "3d" | "2d";
export const isRaceQuality = oneOf<RaceQuality>("light", "auto", "smooth");

/**
 * The race: each agent is a runner that moves forward when it acts, trips on a failed tool and
 * crosses the line when a turn ends. It fills whatever room the stage gives it; bubbles repeat the
 * action shown on the agent cards.
 */
export function SprintTrack({ events, pulses, liveEventIds, onGoTo, mode }: { events: SessionEvent[]; pulses: Map<string, AgentPulse>; liveEventIds: Record<string, string>; onGoTo?: (pulse: AgentPulse) => void; mode: TrackMode }) {
  // The race advances with elapsed time, so only this panel ticks every second.
  const now = useNow(1000);
  const reducedMotion = usePrefersReducedMotion();
  const [quality] = usePreference<RaceQuality>("race-quality", "auto", isRaceQuality);
  const agents = useAgents();
  const lanes = agents.map((provider) => {
    const state = deriveRaceState(provider.eventKey, events, now);
    const pulse = pulses.get(provider.eventKey);
    const isLiveEvent = Boolean(state.latest && liveEventIds[provider.eventKey] === state.latest.event_id && now - Date.parse(state.latest.occurred_at) < 8_000);
    const bubble = pulse?.current && now - pulse.current.at < BUBBLE_MAX_AGE_MS ? pulse.current : null;
    const cue: RaceLane["cue"] = state.latest?.kind === "tool_failed" ? "fall" : state.latest?.kind === "session_ended" || (state.latest?.kind === "checkpoint" && isTurnComplete(provider.eventKey, state.latest)) ? "finish" : "leap";
    return { provider, state, isLiveEvent, cue, bubble, pulse, label: statusInfo(pulse?.status ?? "never").label };
  });

  return mode === "3d"
    ? <div className="race-stage"><Suspense fallback={<div className="race-loading">{t("Chargement du stade…", "Loading the stadium…")}</div>}>
        <SprintTrack3D reducedMotion={reducedMotion} quality={quality} lanes={lanes.map(({ provider, state, isLiveEvent, cue, bubble, pulse }) => ({ id: provider.id, name: provider.name, model: pulse?.session?.models?.join(" · ") ?? pulse?.session?.model ?? null, color: provider.color, status: state.status, progress: state.progress, cue, cueKey: isLiveEvent && state.latest ? state.latest.event_id : null, bubble, mood: pulse?.status ?? "never", onSelect: pulse?.session && onGoTo ? () => onGoTo(pulse) : undefined }))} />
      </Suspense></div>
    : <div className="race-lanes">
        {lanes.map(({ provider, state, isLiveEvent, cue, bubble, pulse, label }) => {
          const moving = state.status === "running" || state.status === "recent";
          return <div className={`race-lane ${moving ? "moving" : ""}`} key={provider.id} style={{ "--agent-color": provider.color, "--progress": `${state.progress}%` } as CSSProperties}>
            <div className="race-lane-name"><ProviderMark provider={provider} small /><span>{provider.name}<small>{pulse?.session?.models?.join(" · ") ?? pulse?.session?.model ?? t("modèle non fourni", "model not reported")}</small></span><small>{label}</small></div>
            <div className="race-lane-track">
              <span className="race-finish" aria-hidden="true" />
              {state.latest && <div className={`runner ${cue} ${isLiveEvent ? "new-event" : ""} ${moving ? "moving" : ""}`} key={state.latest.event_id}>
                {bubble && <span className={`runner-bubble tone-${bubble.tone} ${state.progress > 60 ? "flipped" : ""}`} role="status">{bubble.text}{bubble.detail && <small>{bubble.detail}</small>}</span>}
                <svg viewBox="0 0 58 52" aria-hidden="true"><g className="runner-body"><circle cx="37" cy="8" r="5" className="runner-head" /><path d="M34 15l-7 13 9 5 7-14" /><path className="arm-back" d="M31 18l-11 5-5-6" /><path className="arm-front" d="M38 18l9 3 5-6" /><path className="leg-back" d="M29 31l-10 8-8 1" /><path className="leg-front" d="M35 32l7 8 9 2" /></g></svg>
              </div>}
            </div>
          </div>;
        })}
      </div>;
}

/** What the runners' moves mean. */
export function RaceLegend() {
  return <ul className="race-legend">
    <li><i className="legend-leap" />{t("saute : nouvelle action", "jumps: new action")}</li>
    <li><i className="legend-fall" />{t("tombe : outil en échec", "falls: failed tool")}</li>
    <li><i className="legend-finish" />{t("franchit la ligne : tour terminé", "crosses the line: turn finished")}</li>
    <li><i className="legend-loop" />{t("tourne en rond : boucle", "runs in circles: loop")}</li>
    <li><i className="legend-wait" />{t("lève la main : t’attend", "raises a hand: waiting for you")}</li>
    <li className="note">{t("La distance montre l’activité récente, pas l’avancement réel de la tâche.", "Distance shows recent activity, not real task progress.")}</li>
  </ul>;
}

export function supportsWebGL() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
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

