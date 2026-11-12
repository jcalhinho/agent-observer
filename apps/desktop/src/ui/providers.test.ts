import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { activeAgents, activeProviders, providerFor, providers } from "./providers";

// Provider::key() in the session-events crate is what the backend serializes in SessionEvent.provider.
const backendSource = readFileSync(new URL("../../../../crates/session-events/src/lib.rs", import.meta.url), "utf8");
const keyFn = backendSource.slice(backendSource.indexOf("pub const fn key"));
const backendKeys = [...keyFn.slice(0, keyFn.indexOf("\n    }\n")).matchAll(/=> "([a-z_]+)"/g)].map((match) => match[1]);

describe("provider table", () => {
  it("uses exactly the backend provider keys as event keys", () => {
    expect(backendKeys.length).toBeGreaterThan(0);
    expect(providers.map((provider) => provider.eventKey).sort()).toEqual([...backendKeys].sort());
  });

  it("only races providers that have a local connector", () => {
    expect(activeProviders.every((provider) => provider.connector)).toBe(true);
  });
});

describe("active providers", () => {
  it("shows every agent with a connector, and only those (Cline and Roo Code have none yet)", () => {
    expect(activeProviders.map((provider) => provider.name).sort()).toEqual([
      "Aider", "Amp", "Antigravity", "Claude Code", "CodeBuddy", "Codex", "Continue", "Crush", "Cursor", "Gemini CLI",
      "GitHub Copilot", "Goose", "Hermes", "Kimi Code", "Kiro CLI", "MiniMax Code", "OpenCode", "Qoder CLI", "Qwen Code",
      "Reasonix", "Trae CLI", "Zed", "dsh", "iFlow CLI", "jcode", "omp", "pi"
    ]);
    expect(providers.filter((provider) => provider.connector).length).toBe(activeProviders.length);
  });
});
