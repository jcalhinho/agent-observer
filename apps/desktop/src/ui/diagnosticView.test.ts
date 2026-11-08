import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setLang } from "./i18n";
import { agentSummary, bytes, diagnosticText, hideHome, type Diagnostic } from "./diagnosticView";

beforeAll(() => setLang("fr"));
afterAll(() => setLang("fr"));

const now = Date.parse("2026-11-08T12:00:00Z");
const diagnostic: Diagnostic = {
  version: "0.13.4", os: "macos", arch: "aarch64", collector: "listening", started_at: "2026-11-08T11:00:00Z", home: "/Users/ana",
  database: { path: "/Users/ana/Library/Application Support/x/observer.sqlite3", size_bytes: 4_404_019, events: 12345, oldest: "2026-10-10T08:00:00+00:00", newest: "2026-11-08T11:59:00+00:00", retention_days: 30 },
  providers: [{ provider: "claude_code", events: 120, last_event_at: "2026-11-08T11:58:00Z", last_received_at: "2026-11-08T11:58:00Z" }],
  rejected_requests: 2
};

describe("diagnostic", () => {
  it("masque le dossier personnel, et seulement lui", () => {
    expect(hideHome("/Users/ana/.codex/sessions", "/Users/ana")).toBe("~/.codex/sessions");
    expect(hideHome("/Users/anais/x", "/Users/ana")).toBe("/Users/anais/x");
    expect(hideHome("C:\\Users\\ana\\.qwen", "C:\\Users\\ana\\")).toBe("~\\.qwen");
    expect(hideHome("/opt/x", "")).toBe("/opt/x");
  });

  it("donne des tailles lisibles", () => {
    expect(bytes(512)).toBe("512 o");
    expect(bytes(4_404_019)).toBe("4,2 Mo");
    expect(bytes(20_480)).toBe("20 Ko");
  });

  it("résume chaque agent : d'où il est lu et ce qu'il a apporté", () => {
    const hooks = agentSummary({ key: "claude_code", name: "Claude Code", source: null, stats: diagnostic.providers[0] }, diagnostic.home, now);
    expect(hooks).toEqual({ where: "hooks", activity: "120 événement(s) depuis le lancement, reçu il y a 2 min" });
    const codex = agentSummary({ key: "codex", name: "Codex", source: { path: "/Users/ana/.codex/sessions", found: false }, stats: null }, diagnostic.home, now);
    expect(codex).toEqual({ where: "~/.codex/sessions, introuvable", activity: "rien reçu depuis le lancement" });
  });

  it("écrit un diagnostic à coller, sans dossier personnel", () => {
    const text = diagnosticText(diagnostic, [
      { key: "claude_code", name: "Claude Code", source: null, stats: diagnostic.providers[0] },
      { key: "codex", name: "Codex", source: { path: "/Users/ana/.codex/sessions", found: true }, stats: null }
    ], now);
    expect(text).toBe([
      "Agent Observer 0.13.4 — macos aarch64",
      "Collecteur : listening, lancé il y a 1 h",
      "Base : ~/Library/Application Support/x/observer.sqlite3 · 12,3k événement(s) · 4,2 Mo · du 2026-10-10 au 2026-11-08 · rétention 30 j",
      "Requêtes refusées par le collecteur (clé absente ou fausse, contenu illisible) : 2",
      "Agents :",
      "- Claude Code (hooks) : 120 événement(s) depuis le lancement, reçu il y a 2 min",
      "- Codex (~/.codex/sessions, trouvé) : rien reçu depuis le lancement"
    ].join("\n"));
    expect(text).not.toContain("/Users/ana");
  });

  it("parle anglais aussi", () => {
    setLang("en");
    try {
      const text = diagnosticText({ ...diagnostic, database: { ...diagnostic.database, retention_days: 0, oldest: null, newest: null } }, [], now);
      expect(text).toContain("Collector: listening, started 1 h ago");
      expect(text).toContain("· 4.2 MB ·");
      expect(text).toContain("· everything kept");
      expect(text).toContain("Agents:");
    } finally {
      setLang("fr");
    }
  });
});
