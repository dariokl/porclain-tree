import { expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { mountTerminal } from "../../src/terminal/view";
import { createChangesState } from "../../src/git/status";
import type { PreviewSelection } from "../../src/preview";

test("file search captures its own typing and paste, opens results, and restores CLI input", async () => {
  const setup = await createTestRenderer({ width: 120, height: 26, exitOnCtrlC: false });
  const selected: PreviewSelection[] = [];
  const session = mountTerminal(setup.renderer, {
    executable: process.execPath,
    args: ["-e", 'process.stdin.setRawMode(true); process.stdout.write("raw-ready\\r\\n"); process.stdin.on("data", b => process.stdout.write("BYTES:" + b.toString("hex") + "\\r\\n"));'],
  }, process.cwd(), createChangesState([{ path: "other.ts", indexStatus: " ", worktreeStatus: "M" }]), "fixture", "dark", (selection) => {
    if (selection) selected.push(selection);
    session.setPreview(selection ? { kind: "ready", selection, text: "file contents" } : { kind: "closed" });
  }, { paths: ["src/App.ts", "tests/app.test.ts", "README.md"], error: null });
  async function frame(text: string) {
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      await setup.renderOnce();
      if (setup.captureCharFrame().includes(text)) return;
      await Bun.sleep(10);
    }
    throw new Error(`Missing ${text}:\n${setup.captureCharFrame()}`);
  }
  async function click(text: string) {
    await setup.renderOnce();
    const rows = setup.captureCharFrame().split("\n");
    const y = rows.findIndex((row) => row.slice(0, 34).includes(text));
    const x = rows[y]?.indexOf(text) ?? -1;
    if (x < 0 || y < 0) throw new Error(`Missing ${text}:\n${setup.captureCharFrame()}`);
    await setup.mockMouse.click(x + 1, y);
  }
  try {
    await frame("raw-ready");
    await click("Search files");
    await setup.mockInput.typeText("APP");
    await frame("app.test.ts");
    expect(setup.captureCharFrame()).toContain("2/3");
    expect(setup.captureCharFrame()).toContain("other.ts");
    expect(setup.captureCharFrame()).not.toContain("README.md");
    setup.mockInput.pressEnter();
    await frame("File snapshot");
    expect(selected.at(-1)).toEqual({ path: "src/App.ts", comparison: "file" });
    await click("APP");
    setup.mockInput.pressKey("a", { ctrl: true }); setup.mockInput.pressKey("k", { ctrl: true });
    await setup.mockInput.typeText("README");
    await frame("1/3");
    expect(setup.captureCharFrame()).not.toContain("File snapshot");
    setup.mockInput.pressEnter();
    await frame("File snapshot");
    expect(selected.at(-1)).toEqual({ path: "README.md", comparison: "file" });
    setup.mockInput.pressKey("q");
    await frame("raw-ready");
    expect(setup.captureCharFrame()).not.toContain("BYTES:");
    await click("README");
    setup.mockInput.pressKey("a", { ctrl: true }); setup.mockInput.pressKey("k", { ctrl: true });
    await setup.mockInput.pasteBracketedText("tests/app");
    await frame("1/3");
    await click("app.test.ts");
    await frame("File snapshot");
    expect(selected.at(-1)).toEqual({ path: "tests/app.test.ts", comparison: "file" });
    setup.mockInput.pressKey("q"); await frame("raw-ready");
    await click("tests/app");
    setup.mockInput.pressCtrlC();
    setup.mockInput.pressEscape();
    await frame("Search files");
    await frame("BYTES:03");
    expect(setup.captureCharFrame()).toContain("README.md");
    await setup.mockInput.typeText("y"); await frame("BYTES:79");
    await click("Search files");
    await setup.mockInput.typeText("missing"); await frame("No matching files");
    setup.mockInput.pressKey("g", { ctrl: true });
    await setup.renderOnce();
    await setup.mockInput.typeText("x"); await frame("BYTES:78");
    setup.mockInput.pressKey("g", { ctrl: true });
    await frame("missing");
    await click("missing");
    await setup.mockMouse.click(50, 3);
    await setup.mockInput.typeText("z"); await frame("BYTES:7a");
    await click("missing");
    setup.resize(80, 20);
    await setup.renderOnce();
    await setup.mockInput.typeText("w"); await frame("BYTES:77");
  } finally { await session.dispose(); await setup.dispose(); }
});
