import { expect, test } from "bun:test";
import { pollGitStatus } from "../../src/git/polling";
import type { GitStatusResult } from "../../src/git/status";

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Polling test timed out");
    await Bun.sleep(5);
  }
}

test("polls sequentially, reports failure/recovery, and stops updates after disposal", async () => {
  let active = 0;
  let maximumActive = 0;
  let count = 0;
  const results: GitStatusResult[] = [];
  const polling = pollGitStatus("fixture", (result) => results.push(result), async () => {
    active++;
    maximumActive = Math.max(maximumActive, active);
    await Bun.sleep(25);
    active--;
    count++;
    return count === 1 ? { ok: false, error: "temporary error" } : { ok: true, changes: [] };
  }, 5);
  try {
    await waitFor(() => results.length >= 2);
    await polling.stop();
    const stoppedCount = results.length;
    await Bun.sleep(40);
    expect(maximumActive).toBe(1);
    expect(results[0]).toEqual({ ok: false, error: "temporary error" });
    expect(results[1]).toEqual({ ok: true, changes: [] });
    expect(results.length).toBe(stoppedCount);
  } finally {
    await polling.stop();
  }
});

test("stopping polling aborts the active reader and suppresses its late result", async () => {
  const entered = Promise.withResolvers<AbortSignal>();
  const results: GitStatusResult[] = [];
  const polling = pollGitStatus("fixture", (result) => results.push(result), async (_root, signal) => {
    entered.resolve(signal);
    return new Promise<GitStatusResult>((resolve) => {
      signal.addEventListener("abort", () => resolve({ ok: false, error: "cancelled" }), { once: true });
    });
  }, 1);
  const signal = await entered.promise;
  await polling.stop();
  expect(signal.aborted).toBe(true);
  expect(results).toEqual([]);
});
