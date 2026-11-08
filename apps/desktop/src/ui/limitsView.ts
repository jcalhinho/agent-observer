import { duration } from "./insights";
import { locale, t } from "./i18n";
import type { LimitSnapshot, LimitWindow } from "./useLimits";

export type WindowView = {
  /** « 5 h », « 7 j »… d'après la durée rapportée. */
  label: string;
  /** Pourcentage consommé ; null quand la fenêtre s'est remise à zéro depuis le relevé. */
  percent: number | null;
  /** Heure de remise à zéro, en millisecondes. */
  resetsAt: number | null;
  level: "ok" | "near" | "over" | "reset";
};

export function windowLabel(minutes: number | null, fallback: string) {
  if (!minutes || minutes <= 0) return fallback;
  if (minutes % 1440 === 0 || minutes >= 6 * 1440) return t(`${Math.round(minutes / 1440)} j`, `${Math.round(minutes / 1440)} d`);
  // Codex écrit parfois 299 pour la fenêtre de 5 h : on arrondit à l'heure.
  return `${Math.max(1, Math.round(minutes / 60))} h`;
}

export function windowView(window: LimitWindow, now: number, fallback: string): WindowView {
  const resetsAt = window.resets_at !== null ? window.resets_at * 1000 : null;
  // La fenêtre a déjà été remise à zéro : le pourcentage relevé ne vaut plus, on ne l'affiche pas.
  if (resetsAt !== null && resetsAt <= now) return { label: windowLabel(window.window_minutes, fallback), percent: null, resetsAt, level: "reset" };
  const percent = Math.max(0, window.used_percent);
  return { label: windowLabel(window.window_minutes, fallback), percent, resetsAt, level: percent >= 95 ? "over" : percent >= 80 ? "near" : "ok" };
}

/** Les fenêtres d'un relevé, la courte d'abord. */
export function windowsOf(snapshot: LimitSnapshot | undefined, now: number): WindowView[] {
  if (!snapshot) return [];
  return [
    snapshot.primary ? windowView(snapshot.primary, now, t("courte", "short")) : null,
    snapshot.secondary ? windowView(snapshot.secondary, now, t("longue", "long")) : null
  ].filter((view): view is WindowView => view !== null);
}

/** « dans 2 h 10 » quand c'est aujourd'hui, sinon « lun. 14:20 ». */
export function resetText(resetsAt: number | null, now: number) {
  if (resetsAt === null) return t("remise à zéro inconnue", "reset time unknown");
  const left = resetsAt - now;
  if (left <= 0) return t("remise à zéro passée", "already reset");
  if (left < 20 * 3_600_000) return t(`remise à zéro dans ${duration(left)}`, `resets in ${duration(left)}`);
  const date = new Date(resetsAt);
  return t(`remise à zéro ${date.toLocaleDateString(locale(), { weekday: "short" })} ${date.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" })}`, `resets ${date.toLocaleDateString(locale(), { weekday: "short" })} ${date.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" })}`);
}

export type LimitAlert = { provider: string; label: string; percent: number; level: "near" | "over"; resetsAt: number | null };

/** Les fenêtres proches de leur limite (80 % et plus), la plus pleine d'abord. */
export function limitAlerts(limits: Record<string, LimitSnapshot>, now: number): LimitAlert[] {
  const alerts: LimitAlert[] = [];
  for (const snapshot of Object.values(limits)) {
    for (const view of windowsOf(snapshot, now)) {
      if ((view.level === "near" || view.level === "over") && view.percent !== null) alerts.push({ provider: snapshot.provider, label: view.label, percent: view.percent, level: view.level, resetsAt: view.resetsAt });
    }
  }
  return alerts.sort((a, b) => b.percent - a.percent);
}
