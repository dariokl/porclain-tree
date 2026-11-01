import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
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
