import { expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { mountPreview } from "../../src/terminal/preview";
import { sidebarTheme } from "../../src/terminal/theme";

type Setup = Awaited<ReturnType<typeof createTestRenderer>>;
async function frame(setup: Setup, ready: () => boolean) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    await setup.renderOnce();
    if (ready()) return;
    await Bun.sleep(10);
  }
  throw new Error(`Preview did not settle:\n${setup.captureCharFrame()}`);
}
function tokenColor(setup: Setup, token: string) {
  return setup.captureSpans().lines.slice(3, -1).flatMap((line) => line.spans)
    .find((span) => span.text.includes(token))?.fg.toInts();
}

test("file previews number lines and highlight local JS, TS, JSX, TSX and Python grammars", async () => {
  const setup = await createTestRenderer({ width: 90, height: 16 });
  const preview = mountPreview(setup.renderer, sidebarTheme("dark"), () => {});
  try {
    for (const [path, language, text, keyword, literal] of [
      ["sample.js", "JavaScript", 'const greeting = "hello";', "const", '"hello"'],
      ["sample.ts", "TypeScript", 'const greeting: string = "hello";', "const", '"hello"'],
      ["sample.jsx", "JavaScript", 'const greeting = <div title="hello" />;', "const", '"hello"'],
      ["sample.tsx", "TypeScript", 'const greeting = <div title="hello" />;', "const", '"hello"'],
      ["sample.py", "Python", 'return "hello"', "return", '"hello"'],
    ]) {
      if (!path || !language || !text || !keyword || !literal) throw new Error("Invalid fixture");
      preview.setState({ kind: "ready", selection: { path, comparison: "file" }, text: text + "\n" });
      await frame(setup, () => {
        const a = tokenColor(setup, keyword), b = tokenColor(setup, literal);
        return Boolean(a && b && JSON.stringify(a) !== JSON.stringify(b));
      });
      expect(setup.captureCharFrame()).toContain(language);
      expect(setup.captureCharFrame().split("\n")[3]).toMatch(/^\s*1\s+\S/);
      expect(tokenColor(setup, keyword)).not.toEqual([229, 229, 229, 255]);
    }
  } finally { await preview.dispose(); await setup.dispose(); }
});

test("unified diffs retain syntax colors with numbered additions and deletions in both themes", async () => {
  const setup = await createTestRenderer({ width: 90, height: 16 });
  const preview = mountPreview(setup.renderer, sidebarTheme("dark"), () => {});
  try {
    preview.setState({ kind: "ready", selection: { path: "greeting.ts", comparison: "staged" }, text:
      'diff --git a/greeting.ts b/greeting.ts\n--- a/greeting.ts\n+++ b/greeting.ts\n@@ -41,2 +41,2 @@\n-const greeting = "before";\n+const greeting = "after";\n console.log(greeting);\n' });
    for (const mode of ["dark", "light"] as const) {
      preview.setTheme(sidebarTheme(mode));
      await frame(setup, () => {
        const a = tokenColor(setup, "const"), b = tokenColor(setup, '"before"');
        return Boolean(a && b && JSON.stringify(a) !== JSON.stringify(b));
      });
      const rows = setup.captureCharFrame().split("\n");
      expect(rows.find((row) => row.includes('"before"'))).toMatch(/41\s+-\s+const/);
      expect(rows.find((row) => row.includes('"after"'))).toMatch(/41\s+\+\s+const/);
      expect(rows.find((row) => row.includes("console.log"))).toMatch(/42\s+console/);
      expect(setup.captureCharFrame()).toContain("Staged · index vs HEAD");
      const spans = setup.captureSpans().lines.flatMap((line) => line.spans);
      expect(spans.find((span) => span.text.includes('"before"'))?.bg.toInts())
        .not.toEqual(spans.find((span) => span.text.includes('"after"'))?.bg.toInts());
    }
  } finally { await preview.dispose(); await setup.dispose(); }
});

test("numbered syntax previews preserve multiline Unicode tokens, scrolling, resize and theme changes", async () => {
  const setup = await createTestRenderer({ width: 90, height: 16 });
  const preview = mountPreview(setup.renderer, sidebarTheme("dark"), () => {});
  setup.renderer.keyInput.on("keypress", preview.handleKey);
  try {
    const lines = ['const value = `first', 'continued č😀', '`;', ...Array.from({ length: 50 }, (_, i) => `// line-${i}`), "// " + " ".repeat(100) + "right-edge"];
    preview.setState({ kind: "ready", selection: { path: "unicode.ts", comparison: "file" }, text: lines.join("\n") });
    await frame(setup, () => Boolean(tokenColor(setup, "continued") && JSON.stringify(tokenColor(setup, "continued")) !== JSON.stringify(tokenColor(setup, "const"))));
    expect(tokenColor(setup, "continued")).toEqual(tokenColor(setup, "first"));
    expect(setup.captureCharFrame()).toContain("č😀");
    setup.mockInput.pressKey("END");
    await frame(setup, () => setup.captureCharFrame().includes("54"));
    for (let i = 0; i < 5; i++) setup.mockInput.pressArrow("right");
    await frame(setup, () => setup.captureCharFrame().includes("right-edge"));
    for (let i = 0; i < 5; i++) setup.mockInput.pressArrow("left");
    setup.mockInput.pressKey("HOME");
    await frame(setup, () => setup.captureCharFrame().includes("continued č😀"));
    const dark = tokenColor(setup, "const");
    preview.setTheme(sidebarTheme("light"));
    await frame(setup, () => Boolean(tokenColor(setup, "const") && JSON.stringify(tokenColor(setup, "const")) !== JSON.stringify(dark)));
    setup.resize(60, 12); preview.resize(0, 60, 12);
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("continued č😀");
    setup.mockInput.pressKey("\x1b[6~");
    await frame(setup, () => setup.captureCharFrame().includes("9–16/54"));
    expect(setup.captureCharFrame()).toContain("line-5");
  } finally { await preview.dispose(); await setup.dispose(); }
});

test("unified diff keyboard navigation reaches the final numbered line", async () => {
  const setup = await createTestRenderer({ width: 90, height: 16 });
  const preview = mountPreview(setup.renderer, sidebarTheme("dark"), () => {});
  setup.renderer.keyInput.on("keypress", preview.handleKey);
  try {
    preview.setState({ kind: "ready", selection: { path: "many.ts", comparison: "untracked" }, text:
      '--- /dev/null\n+++ b/many.ts\n@@ -0,0 +1,60 @@\n' + Array.from({ length: 60 }, (_, i) => `+const row${i + 1} = ${i + 1};\n`).join("") });
    await frame(setup, () => setup.captureCharFrame().includes("row1"));
    setup.mockInput.pressKey("END");
    await frame(setup, () => setup.captureCharFrame().includes("row60"));
    expect(setup.captureCharFrame()).toMatch(/60\s+\+\s+const row60/);
    setup.mockInput.pressKey("HOME");
    await frame(setup, () => setup.captureCharFrame().includes("1–12/63"));
    expect(setup.captureCharFrame()).toMatch(/1\s+\+\s+const row1/);
    setup.mockInput.pressKey("\x1b[6~");
    await frame(setup, () => setup.captureCharFrame().includes("13–24/63"));
    await setup.mockMouse.scroll(15, 5, "down");
    await setup.renderOnce();
    const first = Number(/^\s*(\d+)/.exec(setup.captureCharFrame().split("\n")[3] ?? "")?.[1]);
    expect(first).toBeGreaterThan(10);
    expect(setup.captureCharFrame()).toContain(`${first + 3}–${first + 14}/63`);
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain(`${first + 4}–${first + 15}/63`);
  } finally { await preview.dispose(); await setup.dispose(); }
});

test("unknown languages stay numbered and literal; combined and metadata-only diffs keep their raw content", async () => {
  const setup = await createTestRenderer({ width: 90, height: 16 });
  const preview = mountPreview(setup.renderer, sidebarTheme("dark"), () => {});
  try {
    preview.setState({ kind: "ready", selection: { path: "unknown.xyz", comparison: "file" }, text: "hello\tworld\x1b[2J\n" });
    await frame(setup, () => setup.captureCharFrame().includes("hello    world\\u001b[2J"));
    expect(setup.captureCharFrame().split("\n")[3]).toMatch(/^\s*1\s+hello/);
    for (const text of ["Binary files a/image and b/image differ", "old mode 100644\nnew mode 100755", "@@@ -1,1 -1,1 +1,1 @@@\n++combined", "--- a/x\n+++ b/x\n@@ -1 +1 @@\nmalformed"]) {
      preview.setState({ kind: "ready", selection: { path: "sample.ts", comparison: text.includes("@@@") ? "conflict" : "unstaged" }, text });
      await frame(setup, () => setup.captureCharFrame().includes(text.split("\n").at(-1) ?? ""));
      expect(setup.captureCharFrame()).toContain(text.split("\n")[0] ?? "");
    }
  } finally { await preview.dispose(); await setup.dispose(); }
});

test("replacing or closing a preview while highlighting is pending never restores stale content", async () => {
  const setup = await createTestRenderer({ width: 90, height: 16 });
  const preview = mountPreview(setup.renderer, sidebarTheme("dark"), () => {});
  try {
    preview.setState({ kind: "ready", selection: { path: "old.py", comparison: "file" }, text: 'return "stale-python"\n' });
    await setup.renderOnce();
    preview.setState({ kind: "ready", selection: { path: "current.ts", comparison: "file" }, text: 'const current = "latest";\n' });
    await frame(setup, () => Boolean(tokenColor(setup, "const") && JSON.stringify(tokenColor(setup, "const")) !== JSON.stringify(tokenColor(setup, '"latest"'))));
    expect(setup.captureCharFrame()).not.toContain("stale-python");
    const selection = { path: "current.ts", comparison: "file" } as const;
    for (const [state, marker] of [
      [{ kind: "loading", selection }, "Loading file…"],
      [{ kind: "error", selection, error: "unavailable\x1b[2J" }, "unavailable\\u001b[2J"],
      [{ kind: "ready", selection, text: "" }, "(Empty file.)"],
    ] as const) {
      preview.setState(state);
      await frame(setup, () => setup.captureCharFrame().includes(marker));
      expect(setup.captureCharFrame()).not.toContain('"latest"');
    }
    preview.setState({ kind: "ready", selection, text: 'const closing = "discard";' });
    await setup.renderOnce();
    preview.setState({ kind: "closed" });
    await setup.renderOnce();
    expect(setup.captureCharFrame()).not.toContain("File snapshot");
    await preview.dispose();
  } finally { await preview.dispose(); await setup.dispose(); }
});

test("plain diff text follows the theme", async () => {
  const setup = await createTestRenderer({ width: 90, height: 16 });
  const preview = mountPreview(setup.renderer, sidebarTheme("dark"), () => {});
  try {
    preview.setState({ kind: "ready", selection: { path: "unknown.xyz", comparison: "unstaged" }, text:
      '--- a/unknown.xyz\n+++ b/unknown.xyz\n@@ -1 +1 @@\n-before\n+after\n' });
    await setup.renderOnce();
    preview.setTheme(sidebarTheme("light"));
    await setup.renderOnce();
    const heading = setup.captureSpans().lines[0]?.spans.find((span) => span.text.includes("Diff snapshot"));
    expect(tokenColor(setup, "after")).toEqual(heading?.fg.toInts());
    expect(setup.captureCharFrame()).toContain("after");
  } finally { await preview.dispose(); await setup.dispose(); }
});

test("formatted diffs preserve mode changes, hunk function labels and distant hunk boundaries", async () => {
  const setup = await createTestRenderer({ width: 100, height: 22 });
  const preview = mountPreview(setup.renderer, sidebarTheme("dark"), () => {});
  try {
    preview.setState({ kind: "ready", selection: { path: "script.ts", comparison: "staged" }, text:
      'diff --git a/script.ts b/script.ts\nold mode 100644\nnew mode 100755\n--- a/script.ts\n+++ b/script.ts\n@@ -1 +1 @@ function first()\n-const first = "before";\n+const first = "after";\n@@ -80 +80 @@ function later()\n-const later = "old";\n+const later = "new";\n' });
    await setup.renderOnce();
    const screen = setup.captureCharFrame();
    expect(screen).toContain("old mode 100644");
    expect(screen).toContain("new mode 100755");
    expect(screen).toContain("@@ -1 +1 @@ function first()");
    expect(screen).toContain("@@ -80 +80 @@ function later()");
    expect(screen).toMatch(/80\s+\+\s+const later/);
    await frame(setup, () => Boolean(tokenColor(setup, "const") && JSON.stringify(tokenColor(setup, "const")) !== JSON.stringify(tokenColor(setup, '"after"'))));
  } finally { await preview.dispose(); await setup.dispose(); }
});
