import { createCliRenderer } from "@opentui/core";
import type { CommandSpec } from "./command";
import { loadGitProject } from "./git/client";
import { pollGitStatus } from "./git/polling";
import { applyStatus, createChangesState } from "./git/status";
import { mountTerminal } from "./terminal/view";

export type AppResult =
  | Readonly<{ ok: true; exitCode: number }>
  | Readonly<{ ok: false; exitCode: 2; error: string }>;

export async function runApp(command: CommandSpec, cwd: string): Promise<AppResult> {
  const project = await loadGitProject(cwd);
  if (!project.ok) return { ok: false, exitCode: 2, error: project.error };

  const renderer = await createCliRenderer({
    exitOnCtrlC: false, exitSignals: [], consoleMode: "disabled", openConsoleOnError: false,
  });
  let state = createChangesState(project.changes);
  let session: ReturnType<typeof mountTerminal> | undefined;
  let polling: ReturnType<typeof pollGitStatus> | undefined;
  let signalCode: number | undefined;
  const failure = Promise.withResolvers<never>();
  const stop = (code: number) => {
    signalCode ??= code;
    if (session) void session.dispose().catch(failure.reject);
  };
  const onTerm = () => stop(143);
  const onHangup = () => stop(129);
  const onInterrupt = () => stop(130);
  const onError = (event: { error: Error }) => failure.reject(event.error);
  process.on("SIGTERM", onTerm);
  process.on("SIGHUP", onHangup);
  process.on("SIGINT", onInterrupt);
  renderer.on("render:error", onError);
  renderer.on("handler:error", onError);
  try {
    const mounted = mountTerminal(renderer, command, cwd, state);
    session = mounted;
    polling = pollGitStatus(project.root, (result) => {
      state = applyStatus(state, result);
      mounted.setChanges(state);
    });
    renderer.start();
    const code = await Promise.race([mounted.exited, failure.promise, polling.done.then(() => mounted.exited)]);
    return { ok: true, exitCode: signalCode ?? code };
  } finally {
    try {
      try {
        await polling?.stop();
      } finally {
        await session?.dispose();
      }
    } finally {
      renderer.destroy();
      try {
        await renderer.closed;
      } finally {
        process.off("SIGTERM", onTerm);
        process.off("SIGHUP", onHangup);
        process.off("SIGINT", onInterrupt);
      }
    }
  }
}
