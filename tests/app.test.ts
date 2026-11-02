import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTestRenderer } from "@opentui/core/testing";
import { EmbeddedTerminalRenderable } from "@opentui/core";
import { runApp } from "../src/app";
import { startPty } from "../src/terminal/pty";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function directory(git = false): Promise<string> {
  const root = await mkdtemp("/tmp/porclaintree-app-");
  directories.push(root);
  if (git) {
    const child = Bun.spawn(["git", "init", "-q", root], { stdout: "ignore", stderr: "pipe" });
    const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    if (code !== 0) throw new Error(stderr);
  }
  return root;
}

function launch(cwd: string, script: string) {
  let output = "";
  const decoder = new TextDecoder();
  const cli = new URL("../src/cli.ts", import.meta.url).pathname;
  const session = startPty({ executable: process.execPath, args: [cli, "--", "sh", "-c", script] }, {
    cwd, cols: 120, rows: 30,
    onData(bytes) { output += decoder.decode(bytes, { stream: true }); },
  });
  return {
    session,
    async waitFor(marker: string) {
      const deadline = Date.now() + 3000;
      while (!output.includes(marker)) {
        if (Date.now() > deadline) throw new Error(`Application did not display ${marker}`);
        await Bun.sleep(10);
      }
    },
  };
}

test("application rejects a non-Git directory before starting the command", async () => {
  const result = await runApp({ executable: "sh", args: ["-c", "exit 9"] }, await directory());
  expect(result.ok).toBe(false);
  expect(result.exitCode).toBe(2);
});

test("application preserves the nested child cwd, input, and exit code", async () => {
  const root = await directory(true);
  const nested = join(root, "nested");
  await mkdir(nested);
  const { session, waitFor } = launch(nested, "printf 'APP_CWD:%s\\nAPP_READY\\n' \"$PWD\"; read -r line; exit 7");
  try {
    await waitFor(`APP_CWD:${nested}`);
    await waitFor("APP_READY");
    session.write("go\r");
    expect(await session.exited).toBe(7);
  } finally {
    await session.dispose();
  }
});

test("application handles external termination and releases its terminal", async () => {
  const { session, waitFor } = launch(await directory(true), "printf 'APP_READY\\n'; read -r line");
  try {
    await waitFor("APP_READY");
    process.kill(session.pid, "SIGTERM");
    expect(await session.exited).toBe(143);
    await waitFor("\x1b[?1049l");
  } finally {
    await session.dispose();
  }
});


test("actual CLI searches files, previews files and diffs, then restores child input", async () => {
  const root = await directory(true);
  await writeFile(join(root, "preview.txt"), "actual-diff-content\n");
  await mkdir(join(root, "src"));
  await writeFile(join(root, "src/needle.ts"), "search-preview-content\n");
  const setup = await createTestRenderer({ width: 120, height: 30, exitOnCtrlC: false });
  let child: ReturnType<typeof startPty> | undefined;
  const host = new EmbeddedTerminalRenderable(setup.renderer, { width: 120, height: 30 });
  setup.renderer.root.add(host);
  const cli = new URL("../src/cli.ts", import.meta.url).pathname;
  child = startPty({ executable: process.execPath, args: [cli, "--", "sh", "-c", "stty -echo; echo APP_READY; read -r line; exit 7"] }, {
    cwd: root, cols: 120, rows: 30, onData: (bytes) => host.write(bytes),
  });
  async function frame(marker: string) {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      await setup.renderOnce();
      if (setup.captureCharFrame().includes(marker)) return;
      await Bun.sleep(10);
    }
    throw new Error(`Missing ${marker} in actual CLI: ${setup.captureCharFrame()}`);
  }
  try {
    await frame("APP_READY");
    const rows = setup.captureCharFrame().split("\n").flatMap((row, index) => row.includes("preview.txt") ? [index] : []);
    expect(rows).toHaveLength(2);
    const [fileRow, diffRow] = rows;
    if (fileRow === undefined || diffRow === undefined) throw new Error("Missing file/diff entries");
    const searchRow = setup.captureCharFrame().split("\n").findIndex((row) => row.includes("Search files"));
    if (searchRow < 0) throw new Error("Missing search field");
    child.write(`\x1b[<0;5;${searchRow + 1}M\x1b[<0;5;${searchRow + 1}m`);
    child.write("NEEDLE");
    await frame("needle.ts");
    expect(setup.captureCharFrame()).toContain("1/2");
    child.write("\r");
    await frame("File snapshot");
    await frame("search-preview-content");
    child.write("q"); await frame("APP_READY");
    child.write(`\x1b[<0;5;${searchRow + 1}M\x1b[<0;5;${searchRow + 1}m`);
    child.write("\x1b");
    await frame("Search files");
    child.write(`\x1b[<0;11;${fileRow + 1}M\x1b[<0;11;${fileRow + 1}m`);
    await frame("File snapshot");
    await frame("actual-diff-content");
    expect(setup.captureCharFrame()).toContain("Working-tree contents");
    child.write("q"); await frame("APP_READY");
    child.write(`\x1b[<0;11;${diffRow + 1}M\x1b[<0;11;${diffRow + 1}m`);
    await frame("+actual-diff-content");
    expect(setup.captureCharFrame()).toContain("Untracked · file vs empty");
    child.write("q");
    await frame("APP_READY");
    child.write("done\r");
    expect(await child.exited).toBe(7);
  } finally { await child.dispose(); await setup.dispose(); }
});
