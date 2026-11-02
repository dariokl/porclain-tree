import { expect, test } from "bun:test";
import { createPreviewSyntax, latestHighlighter } from "../../src/terminal/syntax";

test("highlighting runs one parse and keeps only the latest pending source", async () => {
  const reads: string[] = [];
  const completions: (() => void)[] = [];
  const queue = latestHighlighter(async (content) => {
    reads.push(content);
    await new Promise<void>((resolve) => completions.push(resolve));
    return { highlights: [] };
  });
  const first = queue.highlight("active", "typescript");
  const skipped = queue.highlight("obsolete", "python");
  const last = queue.highlight("latest", "typescript");
  expect(reads).toEqual(["active"]);
  await skipped;
  completions.shift()?.();
  await first;
  expect(reads).toEqual(["active", "latest"]);
  completions.shift()?.();
  await last;
  const active = queue.highlight("last-active", "python");
  const cancelled = queue.highlight("closed-preview", "typescript");
  queue.clearPending();
  await cancelled;
  completions.shift()?.();
  await active;
  expect(reads).toEqual(["active", "latest", "last-active"]);
});

test("the real parser coalesces source bursts and drops queued work on close", async () => {
  const syntax = createPreviewSyntax();
  try {
    await syntax.initialize();
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => syntax.client.highlightOnce(`const snapshot${i} = "value";`, "typescript")));
    expect(results.filter((result) => result.highlights?.length)).toHaveLength(2);
    expect(results[0]?.highlights?.length).toBeGreaterThan(0);
    expect(results.at(-1)?.highlights?.length).toBeGreaterThan(0);
    const active = syntax.client.highlightOnce('const active = "value";', "typescript");
    const cancelled = syntax.client.highlightOnce('const discarded = "value";', "typescript");
    syntax.clearPending();
    expect((await cancelled).highlights).toEqual([]);
    expect((await active).highlights?.length).toBeGreaterThan(0);
  } finally { syntax.clearPending(); await syntax.client.destroy(); }
});
