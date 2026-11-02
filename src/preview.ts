import type { DiffSelection } from "./git/diff";

export type PreviewSelection = DiffSelection | Readonly<{ path: string; comparison: "file" }>;
export type PreviewResult = Readonly<{ ok: true; text: string }> | Readonly<{ ok: false; error: string }>;

export type PreviewState =
  | Readonly<{ kind: "closed" }>
  | Readonly<{ kind: "loading"; selection: PreviewSelection }>
  | Readonly<{ kind: "ready"; selection: PreviewSelection; text: string }>
  | Readonly<{ kind: "error"; selection: PreviewSelection; error: string }>;

export function createPreview(
  read: (selection: PreviewSelection, signal: AbortSignal) => Promise<PreviewResult>,
  publish: (state: PreviewState) => void,
  fail: (error: unknown) => void,
): Readonly<{ select: (selection: PreviewSelection | null) => void; stop: () => Promise<void> }> {
  let sequence = 0;
  let pending: Readonly<{ selection: PreviewSelection; sequence: number }> | null = null;
  let active: AbortController | undefined;
  let worker: Promise<void> | undefined;
  let stopped = false;
  async function run(): Promise<void> {
    while (pending && !stopped) {
      const request = pending;
      pending = null;
      const controller = new AbortController(); active = controller;
      let result: PreviewResult;
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
