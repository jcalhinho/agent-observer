import { useEffect, useReducer } from "react";
import { readPreference, writePreference } from "./preferences";

/*
 * The shell: four edges of the window (left, right, top, bottom), each with a rail of tabs that
 * opens a drawer. The state is plain data so it can be tested and remembered between launches.
 */

export type Edge = "left" | "right" | "top";
export const EDGES: Edge[] = ["left", "right", "top"];

export type DrawerState = { tab: string | null; size: number; pinned: boolean };
export type ShellState = { drawers: Record<Edge, DrawerState>; /** Open drawers, the one opened last on top. */ order: Edge[] };

export const SIZES: Record<Edge, { initial: number; min: number }> = {
  left: { initial: 460, min: 320 },
  right: { initial: 520, min: 360 },
  top: { initial: 430, min: 220 }
};

export type ShellAction =
  | { type: "toggle"; edge: Edge; tab: string }
  | { type: "open"; edge: Edge; tab: string }
  | { type: "close"; edge: Edge }
  | { type: "closeLoose" }
  | { type: "size"; edge: Edge; size: number }
  | { type: "pin"; edge: Edge };

export function initialShell(): ShellState {
  const drawers = {} as Record<Edge, DrawerState>;
  for (const edge of EDGES) drawers[edge] = { tab: null, size: SIZES[edge].initial, pinned: false };
  return { drawers, order: [] };
}

const withTop = (order: Edge[], edge: Edge) => [...order.filter((other) => other !== edge), edge];

export function shellReducer(state: ShellState, action: ShellAction): ShellState {
  const { edge } = action as { edge: Edge };
  switch (action.type) {
    case "toggle":
      return state.drawers[edge].tab === action.tab ? shellReducer(state, { type: "close", edge }) : shellReducer(state, { type: "open", edge, tab: action.tab });
    case "open":
      return { drawers: { ...state.drawers, [edge]: { ...state.drawers[edge], tab: action.tab } }, order: withTop(state.order, edge) };
    case "close":
      return { drawers: { ...state.drawers, [edge]: { ...state.drawers[edge], tab: null } }, order: state.order.filter((other) => other !== edge) };
    case "closeLoose": {
      const drawers = { ...state.drawers };
      for (const other of EDGES) if (!drawers[other].pinned) drawers[other] = { ...drawers[other], tab: null };
      return { drawers, order: state.order.filter((other) => drawers[other].tab !== null) };
    }
    case "size":
      return { ...state, drawers: { ...state.drawers, [edge]: { ...state.drawers[edge], size: Math.max(SIZES[edge].min, Math.round(action.size)) } } };
    case "pin":
      return { ...state, drawers: { ...state.drawers, [edge]: { ...state.drawers[edge], pinned: !state.drawers[edge].pinned } } };
  }
}

/** Space the stage gives up to pinned drawers; loose drawers float over it. */
export function reserved(state: ShellState): Record<Edge, number> {
  const out = {} as Record<Edge, number>;
  for (const edge of EDGES) out[edge] = state.drawers[edge].pinned && state.drawers[edge].tab !== null ? state.drawers[edge].size : 0;
  return out;
}

function isShell(value: unknown): value is ShellState {
  if (!value || typeof value !== "object") return false;
  const shell = value as ShellState;
  return Boolean(shell.drawers) && EDGES.every((edge) => {
    const drawer = shell.drawers[edge];
    return drawer && (drawer.tab === null || typeof drawer.tab === "string") && Number.isFinite(drawer.size) && typeof drawer.pinned === "boolean";
  }) && Array.isArray(shell.order);
}

/** The shell state, remembered between launches (drawers stay open only if they were pinned). */
export function useShell() {
  const [state, dispatch] = useReducer(shellReducer, undefined, () => {
    const stored = readPreference<ShellState | null>("shell", null, (value): value is ShellState | null => value === null || isShell(value));
    if (!stored) return initialShell();
    // An older layout may remember an edge that no longer exists.
    return shellReducer({ ...stored, order: stored.order.filter((edge) => EDGES.includes(edge)) }, { type: "closeLoose" });
  });
  useEffect(() => { writePreference("shell", state); }, [state]);
  return [state, dispatch] as const;
}
