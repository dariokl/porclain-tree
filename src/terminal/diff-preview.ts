export type DiffPreviewRow = Readonly<{
  text: string;
  kind: "added" | "deleted" | "context" | "meta";
  number: number | null;
  sourceLine: number | null;
}>;
export type DiffPreview = Readonly<{ rows: readonly DiffPreviewRow[]; oldText: string; newText: string }>;

// Retain every patch row, including metadata and hunk labels. Reconstruct each
// side separately so removed code cannot change the syntax of added code.
export function diffPreview(lines: readonly string[]): DiffPreview | undefined {
  const rows: DiffPreviewRow[] = [];
  const oldLines: string[] = [], newLines: string[] = [];
  let old = 0, next = 0, oldNumber = 0, newNumber = 0, hunks = 0, files = 0;
  for (const text of lines) {
    if (text.startsWith("diff --git ") && ++files > 1) return undefined;
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(text);
    if (hunk) {
      if (old || next) return undefined;
      oldNumber = Number(hunk[1]); newNumber = Number(hunk[3]);
      old = Number(hunk[2] ?? 1); next = Number(hunk[4] ?? 1); hunks++;
      // Keep partial hunks from joining adjacent tokens at omitted ranges.
      if (hunks > 1) { oldLines.push(""); newLines.push(""); }
    } else if (hunks && text !== "\\ No newline at end of file") {
      const content = text.slice(1);
      if (text.startsWith("-")) {
        old--; rows.push({ text: content, kind: "deleted", number: oldNumber++, sourceLine: oldLines.length }); oldLines.push(content);
      } else if (text.startsWith("+")) {
        next--; rows.push({ text: content, kind: "added", number: newNumber++, sourceLine: newLines.length }); newLines.push(content);
      } else if (text.startsWith(" ")) {
        old--; next--; oldNumber++;
        rows.push({ text: content, kind: "context", number: newNumber++, sourceLine: newLines.length });
        oldLines.push(content); newLines.push(content);
      } else return undefined;
      if (old < 0 || next < 0) return undefined;
      continue;
    }
    rows.push({ text, kind: "meta", number: null, sourceLine: null });
  }
  return hunks && old === 0 && next === 0 ? { rows, oldText: oldLines.join("\n"), newText: newLines.join("\n") } : undefined;
}
