import type { DiffSelection, GitDiffResult } from "./git/diff";

export type DiffPreviewState =
  | Readonly<{ kind: "closed" }>
  | Readonly<{ kind: "loading"; selection: DiffSelection }>
  | Readonly<{ kind: "ready"; selection: DiffSelection; text: string }>
  | Readonly<{ kind: "error"; selection: DiffSelection; error: string }>;

export function createDiffPreview(
  read: (selection: DiffSelection, signal: AbortSignal) => Promise<GitDiffResult>,
  publish: (state: DiffPreviewState) => void,
  fail: (error: unknown) => void,
): Readonly<{ select: (selection: DiffSelection | null) => void; stop: () => Promise<void> }> {
  let sequence = 0;
  let pending: Readonly<{ selection: DiffSelection; sequence: number }> | null = null;
  let active: AbortController | undefined;
  let worker: Promise<void> | undefined;
  let stopped = false;
  async function run(): Promise<void> {
    while (pending && !stopped) {
      const request = pending;
      pending = null;
      const controller = new AbortController(); active = controller;
      let result: GitDiffResult;
      try { result = await read(request.selection, controller.signal); }
      finally { active = undefined; }
      if (!stopped && !controller.signal.aborted && request.sequence === sequence) {
        publish(result.ok ? { kind: "ready", selection: request.selection, text: result.text }
          : { kind: "error", selection: request.selection, error: result.error });
      }
    }
  }
  function pump(): void {
    if (worker || stopped || !pending) return;
    worker = run();
    void worker.then(() => { worker = undefined; pump(); }, (error: unknown) => {
      worker = undefined; stopped = true; pending = null; fail(error);
    });
  }
  return {
    select(selection) {
      if (stopped) return;
      const current = ++sequence;
      active?.abort();
      pending = selection ? { selection, sequence: current } : null;
      publish(selection ? { kind: "loading", selection } : { kind: "closed" });
      pump();
    },
    async stop() { stopped = true; pending = null; active?.abort(); await worker; },
  };
}
