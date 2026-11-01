export type Change = Readonly<{
  path: string;
  previousPath?: string;
  indexStatus: string;
  worktreeStatus: string;
}>;

export type GitStatusResult =
  | Readonly<{ ok: true; changes: readonly Change[] }>
  | Readonly<{ ok: false; error: string }>;

export type ChangesState = Readonly<{
  changes: readonly Change[];
  initialPaths: ReadonlySet<string>;
  error: string | null;
}>;

function validPath(path: string): boolean {
  return path.length > 0 && !path.startsWith("/")
    && !path.split("/").some((part) => part === ".." || part === ".");
}

export function parseStatus(bytes: Uint8Array): GitStatusResult {
  const invalid = { ok: false, error: "Invalid or incomplete Git status output" } as const;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, error: "Git status contains a filename that is not valid UTF-8" };
  }
  if (!text) return { ok: true, changes: [] };
  if (!text.endsWith("\0")) return invalid;
  const records = text.slice(0, -1).split("\0");
  const changes: Change[] = [];
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (!record || record.length < 4 || record[2] !== " ") return invalid;
    const indexStatus = record.slice(0, 1);
    const worktreeStatus = record.slice(1, 2);
    const pair = indexStatus + worktreeStatus;
    if (!" MADRCUT?!".includes(indexStatus) || !" MADRCUT?!".includes(worktreeStatus)
      || pair === "  " || (/[?!]/.test(pair) && pair !== "??" && pair !== "!!")) return invalid;
    const path = record.slice(3);
    if (!validPath(path)) return invalid;
    if (/[RC]/.test(pair)) {
      const previousPath = records[++i];
      if (!previousPath || !validPath(previousPath)) return invalid;
      changes.push({ path, previousPath, indexStatus, worktreeStatus });
    } else {
      changes.push({ path, indexStatus, worktreeStatus });
    }
  }
  return { ok: true, changes };
}

export function createChangesState(changes: readonly Change[]): ChangesState {
  return { changes, initialPaths: new Set(changes.map((change) => change.path)), error: null };
}

export function applyStatus(state: ChangesState, result: GitStatusResult): ChangesState {
  return result.ok
    ? { ...state, changes: result.changes, error: null }
    : { ...state, error: result.error };
}
