import { beforeAll, describe, expect, it } from "vitest";
import { setLang } from "./i18n";
import { limitAlerts, windowLabel, windowView, windowsOf } from "./limitsView";
import type { LimitSnapshot } from "./useLimits";

beforeAll(() => setLang("fr"));

const now = Date.parse("2026-11-08T10:00:00Z");
const inSeconds = (seconds: number) => Math.round(now / 1000) + seconds;

describe("limites d'abonnement", () => {
  it("nomme les fenêtres d'après leur durée", () => {
    expect(windowLabel(300, "?")).toBe("5 h");
    expect(windowLabel(299, "?")).toBe("5 h");
    expect(windowLabel(10080, "?")).toBe("7 j");
    expect(windowLabel(null, "courte")).toBe("courte");
  });

  it("classe le niveau et n'affiche plus une fenêtre déjà remise à zéro", () => {
    expect(windowView({ used_percent: 42, window_minutes: 300, resets_at: inSeconds(3600) }, now, "?").level).toBe("ok");
    expect(windowView({ used_percent: 85, window_minutes: 300, resets_at: inSeconds(3600) }, now, "?").level).toBe("near");
    expect(windowView({ used_percent: 100, window_minutes: 300, resets_at: null }, now, "?").level).toBe("over");
    const reset = windowView({ used_percent: 99, window_minutes: 300, resets_at: inSeconds(-60) }, now, "?");
    expect(reset.level).toBe("reset");
    expect(reset.percent).toBeNull();
  });

  it("alerte sur les fenêtres pleines, la plus pleine d'abord", () => {
    const snapshot = (provider: string, primary: number, secondary: number): LimitSnapshot => ({ provider, observed_at: "", plan: null,
      primary: { used_percent: primary, window_minutes: 300, resets_at: inSeconds(1800) },
      secondary: { used_percent: secondary, window_minutes: 10080, resets_at: inSeconds(86400) } });
    const alerts = limitAlerts({ codex: snapshot("codex", 50, 97), claude_code: snapshot("claude_code", 82, 10) }, now);
    expect(alerts.map((alert) => [alert.provider, alert.label, alert.level])).toEqual([["codex", "7 j", "over"], ["claude_code", "5 h", "near"]]);
    expect(windowsOf(undefined, now)).toEqual([]);
  });
});
