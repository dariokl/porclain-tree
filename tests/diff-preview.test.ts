import { expect, test } from "bun:test";
import { createDiffPreview } from "../src/diff-preview";
import type { DiffPreviewState } from "../src/diff-preview";
import type { DiffSelection, GitDiffResult } from "../src/git/diff";

test("selection bursts keep one active read and coalesce to the latest pending selection", async () => {
  const reads: { selection: DiffSelection; signal: AbortSignal; result: ReturnType<typeof Promise.withResolvers<GitDiffResult>> }[] = [];
  const states: DiffPreviewState[] = [];
  const loader = createDiffPreview((selection, signal) => {
    const result = Promise.withResolvers<GitDiffResult>(); reads.push({ selection, signal, result }); return result.promise;
  }, (state) => states.push(state), (error) => { throw error; });
  loader.select({ path: "a", comparison: "staged" });
  loader.select({ path: "b", comparison: "unstaged" });
  loader.select({ path: "c", comparison: "untracked" });
  expect(reads.map((read) => read.selection.path)).toEqual(["a"]);
  expect(reads[0]?.signal.aborted).toBe(true);
  reads[0]?.result.resolve({ ok: true, text: "stale A" }); await Bun.sleep(0);
  expect(reads.map((read) => read.selection.path)).toEqual(["a", "c"]);
  reads[1]?.result.resolve({ ok: true, text: "latest C" }); await Bun.sleep(0);
  expect(states.filter((state) => state.kind === "ready")).toEqual([
    { kind: "ready", selection: { path: "c", comparison: "untracked" }, text: "latest C" },
  ]);
  await loader.stop();
});

test("close cancels loading, ignores late results, and disposal prevents new reads", async () => {
  const result = Promise.withResolvers<GitDiffResult>();
  const states: DiffPreviewState[] = []; let signal: AbortSignal | undefined;
  const loader = createDiffPreview((_selection, current) => { signal = current; return result.promise; },
    (state) => states.push(state), (error) => { throw error; });
  loader.select({ path: "file", comparison: "unstaged" }); loader.select(null);
  expect(signal?.aborted).toBe(true); expect(states.at(-1)).toEqual({ kind: "closed" });
  result.resolve({ ok: true, text: "late" }); await loader.stop();
  const count = states.length; loader.select({ path: "again", comparison: "staged" });
  expect(states).toHaveLength(count); expect(states.some((state) => state.kind === "ready")).toBe(false);
});

test("operational errors are shown and a later selection can recover", async () => {
  const states: DiffPreviewState[] = []; let attempt = 0;
  const loader = createDiffPreview(async () => ++attempt === 1 ? { ok: false, error: "unavailable" } : { ok: true, text: "recovered" },
    (state) => states.push(state), (error) => { throw error; });
  loader.select({ path: "file", comparison: "staged" }); await Bun.sleep(0);
  expect(states.at(-1)?.kind).toBe("error");
  loader.select({ path: "file", comparison: "unstaged" }); await Bun.sleep(0);
  expect(states.at(-1)).toEqual({ kind: "ready", selection: { path: "file", comparison: "unstaged" }, text: "recovered" });
  await loader.stop();
});

test("disposal waits for its aborted in-flight read and never publishes its completion", async () => {
  const result = Promise.withResolvers<GitDiffResult>();
  const states: DiffPreviewState[] = [];
  let signal: AbortSignal | undefined;
  const loader = createDiffPreview((_selection, current) => { signal = current; return result.promise; },
    (state) => states.push(state), (error) => { throw error; });
  loader.select({ path: "file", comparison: "unstaged" });
  let settled = false;
  const stop = loader.stop().then(() => { settled = true; });
  await Bun.sleep(0);
  expect(signal?.aborted).toBe(true); expect(settled).toBe(false);
  result.resolve({ ok: false, error: "cancelled" }); await stop;
  expect(settled).toBe(true); expect(states).toHaveLength(1);
});
