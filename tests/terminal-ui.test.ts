import { expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { mountTerminal } from "../src/terminal";

async function waitForFrame(setup: Awaited<ReturnType<typeof createTestRenderer>>, text: string) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    await setup.renderOnce();
    if (setup.captureCharFrame().includes(text)) return;
    // The upstream helper settles render tasks; real PTY I/O also needs an OS turn.
    await Bun.sleep(10);
  }
  throw new Error(`Missing ${JSON.stringify(text)} in frame:\n${setup.captureCharFrame()}`);
}

test("sidebar toggle and narrow-terminal collapse resize the actual child", async () => {
  const setup = await createTestRenderer({ width: 120, height: 30, exitOnCtrlC: false });
  const session = mountTerminal(setup.renderer, {
    executable: "sh",
    args: ["-c", "stty -echo; echo ready; while read -r line; do stty size; done"],
  }, process.cwd());
  async function askSize(expected: string) {
    await setup.mockInput.typeText("size");
    setup.mockInput.pressEnter();
    await waitForFrame(setup, expected);
  }
  try {
    await waitForFrame(setup, "ready");
    await askSize("30 92");
    setup.mockInput.pressKey("g", { ctrl: true });
    await setup.renderOnce();
    await askSize("30 120");
    setup.mockInput.pressKey("g", { ctrl: true });
    await setup.renderOnce();
    await askSize("30 92");
    setup.resize(80, 20);
    await setup.renderOnce();
    await askSize("20 80");
    setup.resize(120, 30);
    await setup.renderOnce();
    await askSize("30 92");
  } finally {
    await session.dispose();
    await setup.dispose();
  }
});

test("ordinary keys, arrows, Ctrl+C, Unicode paste, and literal Ctrl+G reach the child", async () => {
  const setup = await createTestRenderer({ width: 140, height: 30, exitOnCtrlC: false });
  const session = mountTerminal(setup.renderer, {
    executable: process.execPath,
    args: ["-e", `
      process.stdin.setRawMode(true);
      process.stdout.write("\\x1b[?2004hraw-ready\\r\\n");
      process.stdin.on("data", bytes => process.stdout.write("BYTES:" + bytes.toString("hex") + "\\r\\n"));
    `],
  }, process.cwd());
  try {
    await waitForFrame(setup, "raw-ready");
    await setup.mockInput.typeText("x");
    await waitForFrame(setup, "BYTES:78");
    setup.mockInput.pressArrow("up");
    await waitForFrame(setup, "BYTES:1b5b41");
    setup.mockInput.pressCtrlC();
    await waitForFrame(setup, "BYTES:03");
    setup.mockInput.pressKey("j", { ctrl: true });
    await waitForFrame(setup, "BYTES:0a");
    await setup.mockInput.pasteBracketedText("č\none");
    await waitForFrame(setup, "1b5b3230307ec48d0a6f6e651b5b3230317e");
    setup.mockInput.pressKey("g", { ctrl: true });
    setup.mockInput.pressKey("g", { ctrl: true });
    await waitForFrame(setup, "BYTES:07");
  } finally {
    await session.dispose();
    await setup.dispose();
  }
});
