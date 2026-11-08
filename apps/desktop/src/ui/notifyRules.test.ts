import { beforeAll, describe, expect, it } from "vitest";
import { setLang } from "./i18n";
import { budgetAlert, attentionAlerts, collisionAlerts, trayStatusText } from "./notifyRules";
import { collisionKey } from "./analysis";

beforeAll(() => setLang("en"));
const pulse = (key: string, status: Parameters<typeof attentionAlerts>[1][number]["status"], extra = {}) => ({ key, status, failureStreak: 0, loop: null, ...extra });

describe("attention alerts", () => {
  it("says nothing on the first pass or when nothing changed", () => {
    expect(attentionAlerts({}, [pulse("codex", "looping")])).toEqual([]);
    expect(attentionAlerts({ codex: "looping" }, [pulse("codex", "looping")])).toEqual([]);
  });
  it("flags an agent that starts going round in circles, with the evidence", () => {
    const [alert] = attentionAlerts({ qwen_code: "working" }, [pulse("qwen_code", "looping", { loop: { evidence: "“npm test” repeated 8 times" } })]);
    expect(alert.id).toBe("qwen_code:looping");
    expect(alert.body).toContain("npm test");
  });
  it("flags blocked and silent agents", () => {
    expect(attentionAlerts({ codex: "working" }, [pulse("codex", "blocked", { failureStreak: 3 })])[0].body).toContain("3");
    expect(attentionAlerts({ codex: "working" }, [pulse("codex", "stalled")])[0].id).toBe("codex:stalled");
  });
  it("tells you an agent finished only when it was actually working", () => {
    expect(attentionAlerts({ codex: "working" }, [pulse("codex", "waiting")])).toHaveLength(1);
    expect(attentionAlerts({ codex: "idle" }, [pulse("codex", "waiting")])).toEqual([]);
  });
  it("stays quiet when an agent goes back to work or idle", () => {
    expect(attentionAlerts({ codex: "blocked" }, [pulse("codex", "working")])).toEqual([]);
    expect(attentionAlerts({ codex: "waiting" }, [pulse("codex", "idle")])).toEqual([]);
  });
});

describe("collision and budget alerts", () => {
  const collision = { kind: "file" as const, path: "/work/app/src/main.rs", agents: ["claude_code", "codex"], lastAt: 1 };
  it("announces a collision once", () => {
    const first = collisionAlerts(new Set(), [collision], collisionKey);
    expect(first).toHaveLength(1);
    expect(first[0].body).toContain("src/main.rs");
    expect(collisionAlerts(new Set([collisionKey(collision)]), [collision], collisionKey)).toEqual([]);
  });
  it("announces a budget threshold when it is crossed", () => {
    expect(budgetAlert("ok", "near", 8, 10, "2026-11-07")?.id).toBe("budget:near:2026-11-07");
    expect(budgetAlert("near", "over", 11, 10, "2026-11-07")?.id).toBe("budget:over:2026-11-07");
    expect(budgetAlert("over", "near", 9, 10, "2026-11-07")).toBeNull();
    expect(budgetAlert("ok", "ok", 1, 10, "d")).toBeNull();
    expect(budgetAlert("none", "none", null, null, "d")).toBeNull();
  });
});

describe("trayStatusText", () => {
  it("says who needs you, then who works", () => {
    expect(trayStatusText(["waiting", "working", "blocked", "idle"])).toEqual({ needYou: 2, text: "2 need you · 1 working" });
    expect(trayStatusText(["stalled"])).toEqual({ needYou: 1, text: "1 needs you" });
    expect(trayStatusText(["working", "working"])).toEqual({ needYou: 0, text: "2 working" });
    expect(trayStatusText(["idle"])).toEqual({ needYou: 0, text: "No active agent" });
    expect(trayStatusText([])).toEqual({ needYou: 0, text: "No active agent" });
  });

  it("speaks French too", () => {
    setLang("fr");
    try {
      expect(trayStatusText(["waiting", "looping", "working"]).text).toBe("2 t’attendent · 1 au travail");
      expect(trayStatusText(["waiting"]).text).toBe("1 t’attend");
      expect(trayStatusText([]).text).toBe("Aucun agent actif");
    } finally {
      setLang("en");
    }
  });
});
