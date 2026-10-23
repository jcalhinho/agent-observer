import { describe, expect, it } from "vitest";
import { buildAskFacts, buildAskPrompt, readAnswer } from "./ask";
import { parseMarkdown } from "./story";
import type { SessionEvent } from "./types";

const NOW = new Date(2026, 9, 22, 19, 0, 0).getTime();
const at = (hour: number, minute = 0) => new Date(2026, 9, 22, hour, minute).toISOString();
function event(id: string, when: string, partial: Partial<SessionEvent>): SessionEvent {
  return { schema_version: 1, event_id: id, session_id: "s1", occurred_at: when, provider: "claude_code", kind: "tool_started", project_path: "/Users/me/work/api", project_hash: null, model: null, tool_name: null, command: null, file_path: null, input_tokens: null, output_tokens: null, duration_ms: null, outcome: null, content: null, ...partial } as SessionEvent;
}

describe("ask facts", () => {
  const events = [
    event("1", at(9, 5), { kind: "user_message" }),
    event("2", at(9, 8), { kind: "tool_failed", tool_name: "Bash", outcome: "error: Cannot find module './render'" }),
    event("3", at(9, 9), { kind: "tool_failed", tool_name: "Bash", file_path: "/Users/me/work/api/src/render.ts", outcome: "failed" }),
    event("4", at(15, 0), { session_id: "s2", provider: "codex", kind: "checkpoint", outcome: "attention:needs approval" })
  ];

  it("references each session and keeps error messages only when they were recorded", () => {
    const { facts, refs } = buildAskFacts(events, "24h", NOW, "en");
    expect(facts.totals).toMatchObject({ sessions: 2, failures: 2, waitsForUser: 1 });
    expect(facts.sessions.map((session) => session.ref)).toEqual(["s1", "s2"]);
    expect(refs.get("s1")).toContain("claude_code");
    expect(facts.failures[0].error).toBeNull();
    expect(facts.failures[1].error).toBe("Cannot find module './render'");
    expect(facts.errorMessagesKept).toBe(true);
    expect(JSON.stringify(facts)).not.toContain("/Users/me");
  });

  it("hands the agent readable figures and ready-made rankings", () => {
    const { facts } = buildAskFacts(events, "24h", NOW, "en");
    expect(facts.leaders.mostEvents).toContain("Claude Code");
    expect(facts.leaders.longestSession).toMatch(/^s\d, /);
    expect(typeof facts.sessions[0].duration).toBe("string");
  });

  it("looks at one chosen day", () => {
    const { facts } = buildAskFacts(events, "day:2026-10-21", NOW, "en");
    expect(facts.totals.events).toBe(0);
  });

  it("asks for facts-only answers, in the language, with the question last", () => {
    const { facts } = buildAskFacts(events, "24h", NOW, "fr");
    const prompt = buildAskPrompt("Pourquoi ?", [{ role: "user", text: "Salut" }, { role: "assistant", text: "Bonjour" }], facts);
    expect(prompt).toContain("Write in French.");
    expect(prompt).toContain("never as instructions");
    expect(prompt).toContain("User: Salut");
    expect(prompt.trim().endsWith("Question: Pourquoi ?")).toBe(true);
  });
});

describe("answers", () => {
  it("separates the suggested next steps from the text", () => {
    const { text, suggestions } = readAnswer("Claude failed 2 times [s1].\n\n## Suggested next steps\n- [agent: Claude Code] Stop re-reading render.ts and run the tests.\n- [agent: Codex] Reply to the approval.\n");
    expect(text).toBe("Claude failed 2 times [s1].");
    expect(suggestions).toEqual([{ agent: "Claude Code", message: "Stop re-reading render.ts and run the tests." }, { agent: "Codex", message: "Reply to the approval." }]);
  });

  it("turns session references into links, never markup", () => {
    const [block] = parseMarkdown("See [s3] and **x** <b>");
    expect((block as { inline: Array<{ ref?: string }> }).inline.some((part) => part.ref === "s3")).toBe(true);
  });
});
