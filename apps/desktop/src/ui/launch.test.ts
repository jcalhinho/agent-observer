import { describe, expect, it } from "vitest";
import { launchOf } from "./launch";
import { setLang } from "./i18n";

describe("launchOf", () => {
  it("names where each agent's sessions were opened", () => {
    setLang("fr");
    expect(launchOf("claude_code", "claude-desktop")).toEqual({ kind: "app", label: "app Claude", raw: "claude-desktop" });
    expect(launchOf("claude_code", "claude-vscode")?.kind).toBe("editor");
    expect(launchOf("claude_code", "sdk-cli")?.label).toBe("lancé par un programme");
    expect(launchOf("codex", "Codex Desktop")?.label).toBe("app de bureau");
    expect(launchOf("codex", "codex_exec")?.kind).toBe("program");
    expect(launchOf("hermes", "telegram")?.label).toBe("messagerie (telegram)");
    expect(launchOf("hermes", "desktop")?.label).toBe("app Hermes");
    expect(launchOf("qwen_code", "web-shell")?.kind).toBe("web");
    expect(launchOf("github_copilot", "vscode")?.kind).toBe("editor");
  });

  it("keeps an unknown value as written, and nothing when there is nothing", () => {
    setLang("en");
    expect(launchOf("codex", "brand_new_client")).toEqual({ kind: "other", label: "brand_new_client", raw: "brand_new_client" });
    expect(launchOf("codex", "cli")?.label).toBe("terminal");
    expect(launchOf("codex", "  ")).toBeNull();
    expect(launchOf("codex", null)).toBeNull();
  });
});
