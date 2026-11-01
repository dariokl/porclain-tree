import { describe, expect, test } from "bun:test";
import { reduceSidebar, sidebarColumns } from "../src/sidebar";

describe("sidebar controls", () => {
  test("collapses in narrow terminals and restores the requested visibility", () => {
    expect(sidebarColumns(99, true)).toBe(0);
    expect(sidebarColumns(100, true)).toBe(28);
    expect(sidebarColumns(120, false)).toBe(0);
    expect(sidebarColumns(120, true)).toBe(28);
  });

  test("a single toggle hides the sidebar without forwarding a control key", () => {
    const state = Object.freeze({ visible: true, lastToggleAt: null });
    expect(reduceSidebar(state, { type: "toggle", at: 100 })).toEqual({
      state: { visible: false, lastToggleAt: 100 },
      sendControlG: false,
    });
    expect(state.visible).toBe(true);
  });

  test("a double toggle restores visibility and forwards exactly one literal Ctrl+G", () => {
    expect(reduceSidebar({ visible: false, lastToggleAt: 100 }, { type: "toggle", at: 400 })).toEqual({
      state: { visible: true, lastToggleAt: null },
      sendControlG: true,
    });
  });

  test("a late toggle changes visibility without sending Ctrl+G", () => {
    expect(reduceSidebar({ visible: false, lastToggleAt: 100 }, { type: "toggle", at: 401 })).toEqual({
      state: { visible: true, lastToggleAt: 401 },
      sendControlG: false,
    });
  });

  test("ordinary input breaks the double-toggle sequence without toggling", () => {
    expect(reduceSidebar({ visible: false, lastToggleAt: 100 }, { type: "input" })).toEqual({
      state: { visible: false, lastToggleAt: null },
      sendControlG: false,
    });
  });
});
