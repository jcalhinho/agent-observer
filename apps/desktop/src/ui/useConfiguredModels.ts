import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";

type Configured = { provider: string; model: string; source: string };

const REFRESH_MS = 60_000;
const NONE: Record<string, string> = {};

/*
 * One shared poller for every view that shows a model: the cards and the race all read the same
 * answer, so the backend is asked once a minute, not once per card.
 */
let models: Record<string, string> = NONE;
let timer: number | undefined;
const listeners = new Set<() => void>();

function load() {
  invoke<Configured[]>("configured_models")
    .then((list) => {
      models = Object.fromEntries(list.map((entry) => [entry.provider, entry.model]));
      listeners.forEach((listener) => listener());
    })
    // Web preview (no backend): there are no settings to read.
    .catch(() => undefined);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    load();
    timer = window.setInterval(load, REFRESH_MS);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) { window.clearInterval(timer); timer = undefined; }
  };
}

/**
 * The model each agent is set to use (read from its own settings), by `SessionEvent.provider` key.
 * Shown only when no event of the agent has reported a model: what a session really ran with wins.
 */
export function useConfiguredModels(): Record<string, string> {
  return useSyncExternalStore(subscribe, () => models);
}
