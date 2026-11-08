import { beforeAll, describe, expect, it } from "vitest";
import { agentPulse } from "./agentPulse";
import { setLang } from "./i18n";
import { groupByProject } from "./projectGroups";
import type { SessionEvent } from "./types";

const now = Date.parse("2026-11-08T12:00:00.000Z");
beforeAll(() => setLang("en"));

const started = (provider: string, project: string | null): SessionEvent => ({
  event_id: `${provider}-1`, session_id: `${provider}-s`, occurred_at: new Date(now - 60_000).toISOString(), provider, kind: "session_started", project_path: project, tool_name: null, file_path: null
});

describe("groupByProject", () => {
  it("keeps the order of the bars and puts agents without a folder last", () => {
    const events = [started("claude_code", "/work/api"), started("codex", null), started("qwen_code", "/work/web"), started("cursor", "/work/api/")];
    const pulses = ["claude_code", "codex", "qwen_code", "cursor"].map((key) => agentPulse(key, events, now));
    const groups = groupByProject(pulses);
    expect(groups.map((group) => [group.label, group.pulses.map((pulse) => pulse.key)])).toEqual([
      ["api", ["claude_code", "cursor"]],
      ["web", ["qwen_code"]],
      ["unknown folder", ["codex"]]
    ]);
  });
});
