import type { CommandSpec } from "../command";
import { readdir, readFile } from "node:fs/promises";

type PtyOptions = Readonly<{
  cwd: string;
  cols: number;
  rows: number;
  onData: (bytes: Uint8Array) => void;
}>;

export type PtySession = Readonly<{
  pid: number;
  exited: Promise<number>;
  write: (data: string | Uint8Array) => void;
  resize: (cols: number, rows: number) => void;
  dispose: () => Promise<void>;
}>;

function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    // Bun's POSIX PTY child starts its own session and process group.
    process.kill(-pid, signal);
  } catch (error: unknown) {
    if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
  }
}

async function signalSession(sessionId: number, signal: NodeJS.Signals): Promise<void> {
  const groups = new Set([sessionId]);
  if (process.platform === "linux") {
    // Interactive shells put ordinary jobs in their own groups in the same
    // session. Enumerate that session only; detached sessions are not ours.
    for (const pid of await readdir("/proc")) {
      if (!/^\d+$/.test(pid)) continue;
      let stat: string;
      try {
        stat = await readFile(`/proc/${pid}/stat`, "utf8");
      } catch (error: unknown) {
        if (error instanceof Error && "code" in error
          && (error.code === "ENOENT" || error.code === "ESRCH" || error.code === "EACCES")) continue;
        throw error;
      }
      const fields = stat.slice(stat.lastIndexOf(") ") + 2).split(" ");
      const group = Number(fields[2]);
      if (Number(fields[3]) === sessionId && Number.isInteger(group) && group > 0) groups.add(group);
    }
  }
  for (const group of groups) signalGroup(group, signal);
}

export function startPty(command: CommandSpec, options: PtyOptions): PtySession {
  // Inline PTY options make Bun establish the child's own session/group.
  // A reusable Bun.Terminal does not do that on Bun 1.3.14.
  const child = Bun.spawn([command.executable, ...command.args], {
    cwd: options.cwd,
    env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
    terminal: {
      cols: options.cols,
      rows: options.rows,
      data: (_terminal, bytes) => options.onData(bytes),
    },
  });
  const terminal = child.terminal;
  if (!terminal) {
    child.kill();
    throw new Error("The runtime did not attach a PTY");
  }
  let finished = false;
  const exited = child.exited.then((code) => { finished = true; return code; });

  let disposal: Promise<void> | undefined;
  const shutdown = async (): Promise<void> => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await signalSession(child.pid, "SIGTERM");
      await Promise.race([
        exited,
        new Promise<void>((resolve) => { timeout = setTimeout(resolve, 250); }),
      ]);
      await signalSession(child.pid, "SIGKILL");
      await exited;
    } finally {
      clearTimeout(timeout);
      terminal.close();
    }
  };

  return {
    pid: child.pid,
    exited,
    write(data) {
      if (!disposal && !terminal.closed && !finished) terminal.write(data);
    },
    resize(cols, rows) {
      if (!disposal && !terminal.closed && !finished) {
        terminal.resize(Math.max(1, cols), Math.max(1, rows));
      }
    },
    dispose: () => disposal ??= shutdown(),
  };
}
