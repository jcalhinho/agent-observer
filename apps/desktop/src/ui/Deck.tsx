import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Pin, PinOff, X } from "lucide-react";
import { t } from "./i18n";
import { EDGES, reserved, SIZES, type Edge, type ShellAction, type ShellState } from "./shell";

export type TabDef = {
  id: string;
  edge: Edge;
  label: string;
  icon: LucideIcon;
  /** A count or a word shown on the tab. */
  badge?: ReactNode;
  tone?: "warn" | "bad" | "live";
  content: ReactNode;
};

const RAIL = { side: 40, bar: 34 };
const EXIT_MS = 180;

/** Keeps a drawer on screen while it slides away. */
function useExit(open: boolean) {
  const [shown, setShown] = useState(open);
  useEffect(() => {
    if (open) { setShown(true); return; }
    const timer = window.setTimeout(() => setShown(false), EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [open]);
  return shown;
}

/**
 * The frame of the app: the stage in the middle, a rail of tabs on each edge, and the drawers that
 * slide in from those edges. Loose drawers float over the stage; pinned ones give it room.
 */
export function Deck({ stage, tabs, state, dispatch }: { stage: ReactNode; tabs: TabDef[]; state: ShellState; dispatch: (action: ShellAction) => void }) {
  const room = reserved(state);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !(event.target as HTMLElement)?.closest("input, textarea, select")) dispatch({ type: "closeLoose" }); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch]);

  const style = { "--rail-side": `${RAIL.side}px`, "--rail-bar": `${RAIL.bar}px`, "--room-left": `${room.left}px`, "--room-right": `${room.right}px`, "--room-top": `${room.top}px`, "--room-bottom": `${room.bottom}px` } as CSSProperties;
  return <div className="deck" style={style}>
    <main className="stage-frame">{stage}</main>
    {EDGES.map((edge) => <Rail key={edge} edge={edge} tabs={tabs.filter((tab) => tab.edge === edge)} active={state.drawers[edge].tab} onPick={(tab) => dispatch({ type: "toggle", edge, tab })} />)}
    {EDGES.map((edge) => <Drawer key={edge} edge={edge} tabs={tabs.filter((tab) => tab.edge === edge)} state={state} dispatch={dispatch} />)}
  </div>;
}

function Rail({ edge, tabs, active, onPick }: { edge: Edge; tabs: TabDef[]; active: string | null; onPick: (tab: string) => void }) {
  return <nav className={`rail rail-${edge}`} aria-label={edge}>
    {tabs.map((tab) => <button key={tab.id} className={`rail-tab ${tab.tone ? `tone-${tab.tone}` : ""}`} aria-pressed={active === tab.id} onClick={() => onPick(tab.id)} title={tab.label}>
      <tab.icon size={15} strokeWidth={1.8} />
      <span className="rail-label">{tab.label}</span>
      {tab.badge !== undefined && tab.badge !== null && tab.badge !== false && <b className="rail-badge">{tab.badge}</b>}
    </button>)}
  </nav>;
}

function Drawer({ edge, tabs, state, dispatch }: { edge: Edge; tabs: TabDef[]; state: ShellState; dispatch: (action: ShellAction) => void }) {
  const drawer = state.drawers[edge];
  const open = drawer.tab !== null;
  const shown = useExit(open);
  const last = useRef(drawer.tab);
  if (drawer.tab) last.current = drawer.tab;
  const tab = tabs.find((candidate) => candidate.id === (drawer.tab ?? last.current));
  const drag = useRef<{ start: number; size: number } | null>(null);
  if (!shown || !tab) return null;

  const horizontal = edge === "left" || edge === "right";
  const sign = edge === "left" || edge === "top" ? 1 : -1;
  const onDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { start: horizontal ? event.clientX : event.clientY, size: drawer.size };
  };
  const onMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const delta = ((horizontal ? event.clientX : event.clientY) - drag.current.start) * sign;
    const limit = (horizontal ? window.innerWidth : window.innerHeight) * 0.9;
    dispatch({ type: "size", edge, size: Math.min(limit, drag.current.size + delta) });
  };
  const onUp = () => { drag.current = null; };

  const z = 20 + Math.max(0, state.order.indexOf(edge));
  const style = { [horizontal ? "width" : "height"]: drawer.size, zIndex: z } as CSSProperties;
  return <aside className={`drawer drawer-${edge} ${open ? "" : "closing"}`} style={style} aria-label={tab.label}>
    <header className="drawer-head">
      <div className="drawer-tabs" role="tablist">
        {tabs.map((candidate) => <button key={candidate.id} role="tab" aria-selected={candidate.id === tab.id} className={`drawer-tab ${candidate.tone ? `tone-${candidate.tone}` : ""}`} onClick={() => dispatch({ type: "open", edge, tab: candidate.id })}>
          <candidate.icon size={13} strokeWidth={1.8} />{candidate.label}{candidate.badge !== undefined && candidate.badge !== null && candidate.badge !== false && <b>{candidate.badge}</b>}
        </button>)}
      </div>
      <button className="icon-button" onClick={() => dispatch({ type: "pin", edge })} aria-pressed={drawer.pinned} aria-label={drawer.pinned ? t("Détacher", "Unpin") : t("Épingler : garder ouvert et réserver la place", "Pin: keep open and make room")} title={drawer.pinned ? t("Détacher : le tiroir flotte de nouveau sur la scène", "Unpin: the drawer floats over the stage again") : t("Épingler : le tiroir reste ouvert et la scène lui laisse la place", "Pin: the drawer stays open and the stage makes room")}>{drawer.pinned ? <PinOff size={13} /> : <Pin size={13} />}</button>
      <button className="icon-button" onClick={() => dispatch({ type: "close", edge })} aria-label={t("Fermer", "Close")} title={t("Fermer (Échap)", "Close (Esc)")}><X size={13} /></button>
    </header>
    <div className="drawer-body" key={tab.id}>{tab.content}</div>
    <div className="drawer-grip" role="separator" aria-orientation={horizontal ? "vertical" : "horizontal"} aria-label={t("Redimensionner", "Resize")} aria-valuemin={SIZES[edge].min} aria-valuenow={drawer.size} tabIndex={0} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
      onKeyDown={(event) => {
        const step = (event.shiftKey ? 80 : 20) * (event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1) * sign;
        if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) { event.preventDefault(); dispatch({ type: "size", edge, size: drawer.size + step }); }
      }} />
  </aside>;
}
