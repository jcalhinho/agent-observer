import { LogicalPosition, LogicalSize, currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { readPreference, writePreference } from "./preferences";

const MINI_WIDTH = 420;
const MARGIN = 16;
const FULL_MIN = { width: 1120, height: 720 };

/**
 * Réduit la fenêtre en une colonne étroite dans le coin haut-droit de l'écran, éventuellement
 * gardée au premier plan. Le cadre de la grande fenêtre est mémorisé pour `leaveMiniWindow`.
 * Sans effet hors Tauri (aperçu web).
 */
export async function enterMiniWindow(pinned: boolean) {
  try {
    const appWindow = getCurrentWindow();
    const scale = await appWindow.scaleFactor();
    const [size, position] = await Promise.all([appWindow.outerSize(), appWindow.outerPosition()]);
    if (size.toLogical(scale).width > MINI_WIDTH + 100) {
      saveFrame({ ...size.toLogical(scale), ...position.toLogical(scale) });
    }
    await appWindow.setMinSize(new LogicalSize(320, 360));
    const monitor = await currentMonitor();
    if (monitor) {
      const area = { x: monitor.workArea.position.x / monitor.scaleFactor, y: monitor.workArea.position.y / monitor.scaleFactor, width: monitor.workArea.size.width / monitor.scaleFactor, height: monitor.workArea.size.height / monitor.scaleFactor };
      const height = Math.min(980, area.height - MARGIN * 2);
      await appWindow.setSize(new LogicalSize(MINI_WIDTH, height));
      await appWindow.setPosition(new LogicalPosition(area.x + area.width - MINI_WIDTH - MARGIN, area.y + MARGIN));
    } else {
      await appWindow.setSize(new LogicalSize(MINI_WIDTH, 820));
    }
    await appWindow.setAlwaysOnTop(pinned);
  } catch {
    /* aperçu web ou permission absente : la disposition réduite s'applique quand même */
  }
}

export async function setMiniPinned(pinned: boolean) {
  try {
    await getCurrentWindow().setAlwaysOnTop(pinned);
  } catch { /* aperçu web */ }
}

export async function leaveMiniWindow() {
  try {
    const appWindow = getCurrentWindow();
    await appWindow.setAlwaysOnTop(false);
    await appWindow.setMinSize(new LogicalSize(FULL_MIN.width, FULL_MIN.height));
    const frame = readFrame();
    await appWindow.setSize(new LogicalSize(Math.max(FULL_MIN.width, frame?.width ?? 1440), Math.max(FULL_MIN.height, frame?.height ?? 920)));
    if (frame) await appWindow.setPosition(new LogicalPosition(frame.x, frame.y));
    else await appWindow.center();
  } catch { /* aperçu web */ }
}

type Frame = { width: number; height: number; x: number; y: number };

const isFrame = (value: unknown): value is Frame => typeof value === "object" && value !== null && ["width", "height", "x", "y"].every((key) => Number.isFinite((value as Record<string, unknown>)[key]));

function saveFrame(frame: Frame) {
  writePreference("full-window-frame", frame);
}

function readFrame(): Frame | null {
  return readPreference<Frame | null>("full-window-frame", null, (value): value is Frame | null => value === null || isFrame(value));
}
