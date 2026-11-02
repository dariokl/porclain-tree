import { expect, test } from "bun:test";
import { sidebarTheme } from "../../src/terminal/theme";

test("sidebar uses neutral light/dark palettes and a dark fallback for unknown modes", () => {
  expect(sidebarTheme("light").background).toBe("#f1f1ed");
  expect(sidebarTheme("dark").background).toBe("#141615");
  expect(sidebarTheme(null)).toEqual(sidebarTheme("dark"));
});
