import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type Configured = { provider: string; model: string; source: string };

const REFRESH_MS = 60_000;

/**
 * The model each agent is set to use (read from its own settings), by `SessionEvent.provider` key.
 * Shown only when no event of the agent has reported a model: what a session really ran with wins.
 */
export function useConfiguredModels(): Record<string, string> {
  const [models, setModels] = useState<Record<string, string>>({});
  useEffect(() => {
    let active = true;
    const load = () => invoke<Configured[]>("configured_models")
      .then((list) => { if (active) setModels(Object.fromEntries(list.map((entry) => [entry.provider, entry.model]))); })
      .catch(() => { /* web preview: no settings to read */ });
    void load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  return models;
}
