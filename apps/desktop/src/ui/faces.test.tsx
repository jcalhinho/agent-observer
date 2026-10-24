import { describe, expect, it } from "vitest";
import { faceFor, FACES } from "./SprintTrack3D";

const signature = (id: string) => JSON.stringify(faceFor(id));

describe("runner faces", () => {
  it("gives every known agent a face of its own", () => {
    const ids = Object.keys(FACES);
    expect(ids.length).toBeGreaterThanOrEqual(6);
    expect(new Set(ids.map(signature)).size).toBe(ids.length);
    // Distinct on what is seen from afar: skin and the way the eyes and mouth look.
    const looks = ids.map((id) => `${faceFor(id).skin}|${faceFor(id).eyes}|${faceFor(id).mouth}`);
    expect(new Set(looks).size).toBe(ids.length);
  });

  it("keeps the same face for the same agent, including custom connectors", () => {
    expect(signature("custom:my-bot")).toBe(signature("custom:my-bot"));
    expect(signature("custom:my-bot")).not.toBe(signature("custom:other-bot"));
  });

  it("covers the agents that are raced", () => {
    for (const id of ["claude_code", "antigravity", "codex", "qwen", "opencode", "copilot"]) expect(FACES[id]).toBeDefined();
  });
});
