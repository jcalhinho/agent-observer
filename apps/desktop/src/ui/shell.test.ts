import { describe, expect, it } from "vitest";
import { initialShell, reserved, shellReducer } from "./shell";

describe("shell", () => {
  it("opens a tab, switches tabs in place and closes on the same tab", () => {
    let state = shellReducer(initialShell(), { type: "toggle", edge: "left", tab: "agents" });
    expect(state.drawers.left.tab).toBe("agents");
    state = shellReducer(state, { type: "toggle", edge: "left", tab: "sessions" });
    expect(state.drawers.left.tab).toBe("sessions");
    state = shellReducer(state, { type: "toggle", edge: "left", tab: "sessions" });
    expect(state.drawers.left.tab).toBeNull();
    expect(state.order).toEqual([]);
  });

  it("stacks the drawer opened last on top", () => {
    let state = shellReducer(initialShell(), { type: "open", edge: "left", tab: "agents" });
    state = shellReducer(state, { type: "open", edge: "right", tab: "story" });
    state = shellReducer(state, { type: "open", edge: "left", tab: "sessions" });
    expect(state.order).toEqual(["right", "left"]);
  });

  it("keeps pinned drawers when the rest is closed, and gives them room on the stage", () => {
    let state = shellReducer(initialShell(), { type: "open", edge: "right", tab: "story" });
    state = shellReducer(state, { type: "open", edge: "bottom", tab: "feed" });
    state = shellReducer(state, { type: "pin", edge: "right" });
    expect(reserved(state)).toEqual({ left: 0, right: 520, top: 0, bottom: 0 });
    state = shellReducer(state, { type: "closeLoose" });
    expect(state.drawers.right.tab).toBe("story");
    expect(state.drawers.bottom.tab).toBeNull();
    expect(state.order).toEqual(["right"]);
  });

  it("never shrinks a drawer below its minimum", () => {
    const state = shellReducer(initialShell(), { type: "size", edge: "left", size: 50 });
    expect(state.drawers.left.size).toBe(320);
  });
});
