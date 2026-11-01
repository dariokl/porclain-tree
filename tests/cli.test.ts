import { expect, test } from "bun:test";

const cli = new URL("../src/cli.ts", import.meta.url).pathname;

test("missing command prints usage and exits 2 without initializing the terminal", async () => {
  const child = Bun.spawn([process.execPath, cli], { stdout: "pipe", stderr: "pipe" });
  const [code, stderr, stdout] = await Promise.all([
    child.exited, new Response(child.stderr).text(), new Response(child.stdout).text(),
  ]);
  expect(code).toBe(2);
  expect(stderr).toContain("Usage:");
  expect(stdout).toBe("");
  expect(stderr).not.toContain("\x1b");
});

test("noninteractive invocation reports the limitation instead of starting the child", async () => {
  const child = Bun.spawn([process.execPath, cli, "--", "sh", "-c", "exit 9"], {
    stdin: "ignore", stdout: "pipe", stderr: "pipe",
  });
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  expect(code).toBe(2);
  expect(stderr).toContain("interactive terminal");
});
