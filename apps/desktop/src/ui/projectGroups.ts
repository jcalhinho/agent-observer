import type { AgentPulse } from "./agentPulse";
import { placeOf } from "./AgentBar";

export type ProjectGroup = { key: string; label: string; path: string | null; pulses: AgentPulse[] };

/**
 * Les barres rangées par projet, dans l'ordre où le premier agent de chaque projet apparaît (les
 * agents qui t'attendent restent donc en tête). Les agents sans dossier connu finissent ensemble.
 */
export function groupByProject(pulses: AgentPulse[]): ProjectGroup[] {
  const groups = new Map<string, ProjectGroup>();
  let unknown: ProjectGroup | null = null;
  for (const pulse of pulses) {
    const place = placeOf(pulse.project);
    if (!place.full) {
      unknown ??= { key: "", label: place.label, path: null, pulses: [] };
      unknown.pulses.push(pulse);
      continue;
    }
    const key = place.full.replaceAll("\\", "/").replace(/\/+$/, "");
    const group = groups.get(key) ?? groups.set(key, { key, label: place.label, path: place.full, pulses: [] }).get(key)!;
    group.pulses.push(pulse);
  }
  return unknown ? [...groups.values(), unknown] : [...groups.values()];
}
