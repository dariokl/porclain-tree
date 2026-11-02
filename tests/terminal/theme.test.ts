import { expect, test } from "bun:test";
import { sidebarTheme } from "../../src/terminal/theme";

test("sidebar provides black and white palettes for the manual switch", () => {
  expect(sidebarTheme("light").background).toBe("#ffffff");
  expect(sidebarTheme("dark").background).toBe("#000000");
});
