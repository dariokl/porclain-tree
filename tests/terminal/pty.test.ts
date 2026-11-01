import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { startPty } from "../../src/terminal/pty";

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for child output");
    await Bun.sleep(10);
  }
}

function capture() {
  let text = "";
  const decoder = new TextDecoder();
  return {
    data: (bytes: Uint8Array) => { text += decoder.decode(bytes, { stream: true }); },
    text: () => text,
    wait: (marker: string) => waitFor(() => text.includes(marker)),
  };
}

async function waitForStopped(pid: number): Promise<void> {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    try {
      const contents = await readFile(`/proc/${pid}/stat`, "utf8");
      const state = contents.slice(contents.lastIndexOf(") ") + 2)[0];
      if (state === "Z" || state === "X") return;
    } catch (error: unknown) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
      throw error;
    }
    await Bun.sleep(10);
  }
  throw new Error(`Owned process ${pid} is still running after disposal`);
}

describe("PTY lifecycle", () => {
  test("gives the child a real TTY and preserves its exit code", async () => {
    const output = capture();
    const session = startPty({
      executable: "sh",
      args: ["-c", "test -t 0 && test -t 1 && test -t 2 && printf 'tty-ready\\n'; exit 7"],
    }, { cwd: process.cwd(), cols: 80, rows: 24, onData: output.data });
    try {
      expect(await session.exited).toBe(7);
      await output.wait("tty-ready");
    } finally {
      await session.dispose();
    }
  });

  test("passes arguments literally instead of executing a shell string", async () => {
    const output = capture();
    const session = startPty({
      executable: "sh",
      args: ["-c", "printf '<%s>\\n' \"$@\"", "fixture", "a b", "$(printf substituted)", ""],
    }, { cwd: process.cwd(), cols: 80, rows: 24, onData: output.data });
    try {
      expect(await session.exited).toBe(0);
      await output.wait("<>");
      expect(output.text()).toContain("<a b>");
      expect(output.text()).toContain("<$(printf substituted)>");
    } finally {
      await session.dispose();
    }
  });

  test("forwards input and terminal dimensions to a live child", async () => {
    const output = capture();
    const session = startPty({
      executable: "sh",
      args: ["-c", "stty size; read -r answer; stty size; printf 'answer:%s\\n' \"$answer\""],
    }, { cwd: process.cwd(), cols: 80, rows: 24, onData: output.data });
    try {
      await output.wait("24 80");
      session.resize(52, 17);
      session.write("hello world\n");
      await output.wait("answer:hello world");
      expect(output.text()).toContain("17 52");
      expect(await session.exited).toBe(0);
      session.resize(60, 20);
    } finally {
      await session.dispose();
    }
  });

  test("a missing executable fails without leaving a live session", () => {
    expect(() => startPty({ executable: "/nonexistent/porclaintree-fixture", args: [] }, {
      cwd: process.cwd(), cols: 80, rows: 24, onData: () => {},
    })).toThrow();
  });

  test("disposal is idempotent and terminates the child and its descendant", async () => {
    const output = capture();
    const session = startPty({ executable: "sh", args: ["-c", "sleep 30 & echo descendant:$!; wait"] }, {
      cwd: process.cwd(), cols: 80, rows: 24, onData: output.data,
    });
    try {
      await output.wait("descendant:");
      await waitFor(() => /descendant:\d+/.test(output.text()));
      const descendant = Number(/descendant:(\d+)/.exec(output.text())?.[1]);
      await Promise.all([session.dispose(), session.dispose()]);
      expect(await session.exited).not.toBe(0);
      // Linux may briefly retain a non-running orphan as a zombie.
      await waitForStopped(descendant);
      expect(() => session.write("ignored after close")).not.toThrow();
    } finally {
      await session.dispose();
    }
  });

  test("disposal stops ordinary interactive Bash jobs in separate process groups", async () => {
    const output = capture();
    const session = startPty({ executable: "bash", args: ["--noprofile", "--norc", "-i"] }, {
      cwd: process.cwd(), cols: 80, rows: 24, onData: output.data,
    });
    let job: number | undefined;
    let stopped = false;
    try {
      session.write("sleep 30 & printf 'job:%s\\n' \"$!\"\n");
      await waitFor(() => /job:\d+/.test(output.text()));
      job = Number(/job:(\d+)/.exec(output.text())?.[1]);
      await session.dispose();
      await waitForStopped(job);
      stopped = true;
    } finally {
      if (job !== undefined && !stopped) {
        try { process.kill(job, "SIGKILL"); } catch (error: unknown) {
          if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
        }
      }
      await session.dispose();
    }
  });
});
