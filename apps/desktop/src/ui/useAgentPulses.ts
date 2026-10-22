import { useMemo } from "react";
import { agentPulse, sortPulses } from "./agentPulse";
import { useAgents } from "./providers";
import type { SessionEvent } from "./types";
import { useNow } from "./useNow";

/** One pulse per agent, the ones that need you first, refreshed every second. */
export function useAgentPulses(agentEvents: SessionEvent[]) {
  const now = useNow(1000);
  const agents = useAgents();
  const pulses = useMemo(() => sortPulses(agents.map((provider) => agentPulse(provider.eventKey, agentEvents, now))), [agents, agentEvents, now]);
  return { pulses, now };
}

export const needsYou = (status: string) => status === "looping" || status === "blocked" || status === "stalled" || status === "waiting";
