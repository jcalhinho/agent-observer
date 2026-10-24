import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { agentPulse } from "./agentPulse";
import { providerById } from "./providers";
import { FAMILIES, laneInsights } from "./raceInsights";
import { FocusCard, ReplayBar, type LaneView } from "./SprintTrack";
import type { SessionEvent } from "./types";

const NOW = Date.parse("2026-10-24T12:00:00.000Z");
const at = (secondsAgo: number) => new Date(NOW - secondsAgo * 1000).toISOString();
function event(id: string, secondsAgo: number, partial: Partial<SessionEvent>): SessionEvent {
  return { schema_version: 1, event_id: id, session_id: "s1", occurred_at: at(secondsAgo), provider: "claude_code", kind: "tool_started", project_path: "/work/api", project_hash: null, model: { value: "claude-sonnet-4-6", origin: "provider" }, tool_name: null, command: null, file_path: null, input_tokens: null, output_tokens: null, duration_ms: null, outcome: null, content: null, ...partial } as SessionEvent;
}

describe("the focus card and the replay bar", () => {
  const events = [
    event("1", 3000, { kind: "user_message" }),
    event("2", 120, { tool_name: "Edit", file_path: "/work/api/src/a.ts" }),
    event("3", 100, { kind: "tool_failed", tool_name: "Bash", outcome: "failed" }),
    event("4", 60, { kind: "model_usage", input_tokens: { value: 20_000, origin: "provider" }, output_tokens: { value: 1_000, origin: "provider" } })
  ];
  const lane: LaneView = {
    provider: providerById("claude_code"),
    state: { status: "running", latest: { event_id: "4", session_id: "s1", occurred_at: at(60), provider: "claude_code", kind: "model_usage" }, progress: 40, activityCount: 4, startedAt: NOW - 3_000_000 },
    pulse: agentPulse("claude_code", events, NOW),
    cue: "leap", cueKey: null, bubble: null, label: "Working", model: "claude-sonnet-4-6",
    capColor: FAMILIES.claude.color, familyLabel: FAMILIES.claude.label,
    insights: laneInsights("claude_code", events, NOW)
  };

  it("shows the session, the token flow, the failures and the last actions of the runner", () => {
    const html = renderToStaticMarkup(<FocusCard lane={lane} now={NOW} onGoTo={() => undefined} onClose={() => undefined} />);
    expect(html).toContain("Claude Code");
    expect(html).toContain("claude-sonnet-4-6");
    expect(html).toMatch(/Session<\/dt><dd>49 min/);
    expect(html).toContain("focus-recent");
    expect(html).toMatch(/Aller à l’agent|Go to the agent/);
  });

  it("offers no way to the agent when it has no session yet", () => {
    const html = renderToStaticMarkup(<FocusCard lane={{ ...lane, pulse: undefined, model: null }} now={NOW} onClose={() => undefined} />);
    expect(html).not.toMatch(/Aller à l’agent|Go to the agent/);
    expect(html).toMatch(/modèle non fourni|model not reported/);
  });

  it("shows the replay clock and how far it has played", () => {
    const html = renderToStaticMarkup(<ReplayBar virtualNow={NOW - 1_800_000} progress={0.5} onStop={() => undefined} />);
    expect(html).toContain("width:50%");
    expect(html).toMatch(/Replay/);
  });
});
