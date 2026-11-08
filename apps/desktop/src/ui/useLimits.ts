import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { demoLimits, isDemo } from "./demo";

export type LimitWindow = { used_percent: number; window_minutes: number | null; resets_at: number | null };
export type LimitSnapshot = { provider: string; observed_at: string; primary: LimitWindow | null; secondary: LimitWindow | null; plan: string | null };

/**
 * Les limites d'usage d'abonnement que chaque agent a rapportées (Codex dans ses journaux, Claude
 * Code par sa barre d'état facultative). Rechargées quand le collecteur en reçoit de nouvelles.
 */
export function useLimits(): Record<string, LimitSnapshot> {
  const [limits, setLimits] = useState<Record<string, LimitSnapshot>>({});
  useEffect(() => {
    if (isDemo()) {
      setLimits(Object.fromEntries(demoLimits(Date.now()).map((snapshot) => [snapshot.provider, snapshot])));
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const list = await invoke<LimitSnapshot[]>("subscription_limits");
        if (!cancelled) setLimits(Object.fromEntries(list.map((snapshot) => [snapshot.provider, snapshot])));
      } catch { /* hors application de bureau */ }
    };
    void load();
    let unlisten: (() => void) | undefined;
    listen("limits-updated", () => { void load(); }).then((stop) => { if (cancelled) stop(); else unlisten = stop; }).catch(() => {});
    const timer = window.setInterval(load, 60_000);
    return () => { cancelled = true; unlisten?.(); window.clearInterval(timer); };
  }, []);
  return limits;
}
