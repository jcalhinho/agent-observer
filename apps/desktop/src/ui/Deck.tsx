import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { PanelLeft, PanelRight, PanelTop, Pin, PinOff, X } from "lucide-react";
import { t } from "./i18n";
import { EDGES, reserved, SIZES, type Edge, type ShellAction, type ShellState } from "./shell";

export type TabDef = {
  id: string;
  /** The edge its drawer slides in from. */
  edge: Edge;
  label: string;
  icon: LucideIcon;
  /** A count or a word shown on the tab. */
  badge?: ReactNode;
  tone?: "warn" | "bad" | "live";
  content: ReactNode;
};

const BAR = 38;
const EXIT_MS = 180;
/** The race never takes more than half of the window; the rest is the workbench. */
export const STAGE_MAX = 0.5;
export const STAGE_MIN = 0.22;

const EDGE_ICON: Record<Edge, LucideIcon> = { left: PanelLeft, right: PanelRight, top: PanelTop };
const EDGE_HINT: Record<Edge, () => string> = {
  left: () => t("s’ouvre depuis la gauche", "opens from the left"),
  right: () => t("s’ouvre depuis la droite", "opens from the right"),
  top: () => t("s’ouvre depuis le haut", "opens from the top")
};

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
 * The frame of the app: one bar of tabs along the top, the stage (the race, at most half of the
 * window) over the workbench (charts and history), and drawers that slide in from the left, the
 * right or the top depending on the tab. Loose drawers float over everything; pinned ones make room.
 */
export function Deck({ stage, workbench, tabs, state, dispatch, split, onSplit }: { stage: ReactNode; workbench: ReactNode; tabs: TabDef[]; state: ShellState; dispatch: (action: ShellAction) => void; split: number; onSplit: (fraction: number) => void }) {
  const room = reserved(state);
  const body = useRef<HTMLDivElement>(null);
  const drag = useRef<boolean>(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !(event.target as HTMLElement)?.closest("input, textarea, select")) dispatch({ type: "closeLoose" }); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch]);

  const style = { "--bar": `${BAR}px`, "--room-left": `${room.left}px`, "--room-right": `${room.right}px`, "--room-top": `${room.top}px`, "--stage": `${Math.min(STAGE_MAX, Math.max(STAGE_MIN, split)) * 100}%` } as CSSProperties;
  const resize = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current || !body.current) return;
    const box = body.current.getBoundingClientRect();
    onSplit(Math.min(STAGE_MAX, Math.max(STAGE_MIN, (event.clientY - box.top) / box.height)));
  };
  return <div className="deck" style={style}>
    <nav className="topbar" aria-label={t("Onglets", "Tabs")}>
      {tabs.map((tab, index) => {
        const Hint = EDGE_ICON[tab.edge];
        const active = state.drawers[tab.edge].tab === tab.id;
        return <span key={tab.id} className="topbar-item">
          {index > 0 && tabs[index - 1].edge !== tab.edge && <i className="topbar-gap" aria-hidden="true" />}
          <button className={`topbar-tab ${tab.tone ? `tone-${tab.tone}` : ""}`} aria-pressed={active} onClick={() => dispatch({ type: "toggle", edge: tab.edge, tab: tab.id })} title={`${tab.label} · ${EDGE_HINT[tab.edge]()}`}>
            <tab.icon size={14} strokeWidth={1.8} />
            <span>{tab.label}</span>
            {tab.badge !== undefined && tab.badge !== null && tab.badge !== false && <b className="topbar-badge">{tab.badge}</b>}
            <Hint size={11} className="topbar-edge" aria-hidden="true" />
          </button>
        </span>;
      })}
    </nav>

    <div className="deck-body" ref={body}>
      <main className="stage-frame">{stage}</main>
      <div className="splitter" role="separator" aria-orientation="horizontal" aria-label={t("Redimensionner la course", "Resize the race")} aria-valuemin={STAGE_MIN * 100} aria-valuemax={STAGE_MAX * 100} aria-valuenow={Math.round(Math.min(STAGE_MAX, split) * 100)} tabIndex={0}
        onPointerDown={(event) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = true; }}
        onPointerMove={resize} onPointerUp={() => { drag.current = false; }} onPointerCancel={() => { drag.current = false; }}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); onSplit(Math.min(STAGE_MAX, Math.max(STAGE_MIN, split + (event.key === "ArrowDown" ? 0.02 : -0.02)))); }
        }} />
      <section className="workbench">{workbench}</section>
    </div>

    {EDGES.map((edge) => <Drawer key={edge} edge={edge} tabs={tabs.filter((tab) => tab.edge === edge)} state={state} dispatch={dispatch} />)}
  </div>;
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
      <button className="icon-button" onClick={() => dispatch({ type: "pin", edge })} aria-pressed={drawer.pinned} aria-label={drawer.pinned ? t("Détacher", "Unpin") : t("Épingler : garder ouvert et réserver la place", "Pin: keep open and make room")} title={drawer.pinned ? t("Détacher : le tiroir flotte de nouveau par-dessus", "Unpin: the drawer floats over again") : t("Épingler : le tiroir reste ouvert et la place lui est réservée", "Pin: the drawer stays open and room is made for it")}>{drawer.pinned ? <PinOff size={13} /> : <Pin size={13} />}</button>
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
