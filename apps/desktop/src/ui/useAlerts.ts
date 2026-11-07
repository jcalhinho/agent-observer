import { useEffect, useRef } from "react";
import type { AgentPulse, PulseStatus } from "./agentPulse";
import { budgetState, collisionKey, localDay, type BudgetState, type Collision } from "./analysis";
import { notify, setBadge } from "./notify";
import { attentionAlerts, budgetAlert, collisionAlerts, type Alert } from "./notifyRules";
import { needsYou } from "./useAgentPulses";

const COOLDOWN_MS = 60_000;

/**
 * Envoie les notifications système (état d'un agent, collision, budget) et met à jour le badge.
 * Rien n'est envoyé tant que la fenêtre est au premier plan : tu vois déjà l'écran.
 */
export function useAlerts({ pulses, collisions, spentToday, budget, enabled, now }: {
  pulses: AgentPulse[];
  collisions: Collision[];
  spentToday: number | null;
  budget: number | null;
  enabled: boolean;
  now: number;
}) {
  const statuses = useRef<Record<string, PulseStatus>>({});
  const knownCollisions = useRef<Set<string> | null>(null);
  const lastBudget = useRef<BudgetState>("none");
  const sent = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    void setBadge(pulses.filter((pulse) => needsYou(pulse.status)).length);
    const send = (alerts: Alert[]) => {
      if (!enabled || (typeof document !== "undefined" && document.hasFocus())) return;
      for (const alert of alerts) {
        const last = sent.current.get(alert.id);
        if (last !== undefined && now - last < COOLDOWN_MS) continue;
        sent.current.set(alert.id, now);
        void notify(alert.title, alert.body);
      }
    };

    // États : on compare à la fois précédente, sans rien dire au premier passage.
    const seen = pulses.filter((pulse) => pulse.status !== "never");
    if (Object.keys(statuses.current).length || !seen.length) send(attentionAlerts(statuses.current, seen));
    statuses.current = Object.fromEntries(seen.map((pulse) => [pulse.key, pulse.status]));

    // Collisions : ce qui est déjà là au lancement ne réveille pas.
    const fresh = knownCollisions.current === null;
    const known = knownCollisions.current ?? new Set<string>();
    if (!fresh) send(collisionAlerts(known, collisions, collisionKey));
    knownCollisions.current = new Set(collisions.map(collisionKey));

    // Budget.
    const state = budgetState(spentToday, budget);
    send([budgetAlert(lastBudget.current, state, spentToday, budget, localDay(now))].filter((alert): alert is Alert => alert !== null));
    lastBudget.current = state;
  }, [pulses, collisions, spentToday, budget, enabled, now]);
}
