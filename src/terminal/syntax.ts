import { TreeSitterClient } from "@opentui/core";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

type PreviewLanguage = Readonly<{ name: string; filetype: string }>;
type HighlightResult = Awaited<ReturnType<TreeSitterClient["highlightOnce"]>>;
type HighlightRead = (content: string, filetype: string) => Promise<HighlightResult>;

export function latestHighlighter(read: HighlightRead): Readonly<{ highlight: HighlightRead; clearPending: () => void }> {
  type Request = Readonly<{ content: string; filetype: string; resolve: (value: HighlightResult) => void; reject: (error: unknown) => void }>;
  let active = false;
  let pending: Request | undefined;
  async function run(request: Request): Promise<void> {
    active = true;
    try { request.resolve(await read(request.content, request.filetype)); }
    catch (error: unknown) { request.reject(error); }
    finally {
      active = false;
      const next = pending; pending = undefined;
      if (next) void run(next);
    }
  }
  return {
    highlight: (content, filetype) => new Promise<HighlightResult>((resolve, reject) => {
      const request = { content, filetype, resolve, reject };
      if (!active) void run(request);
      else { pending?.resolve({ highlights: [] }); pending = request; }
    }),
    clearPending() { pending?.resolve({ highlights: [] }); pending = undefined; },
  };
}

// OpenTUI requires a TreeSitterClient instance. Keep backpressure at this adapter
// so both the native file renderer and our complete diff view share one queue.
class PreviewSyntaxClient extends TreeSitterClient {
  private readonly queue = latestHighlighter((content, filetype) => super.highlightOnce(content, filetype));
  override highlightOnce(content: string, filetype: string): Promise<HighlightResult> { return this.queue.highlight(content, filetype); }
  clearPending(): void { this.queue.clearPending(); }
}

export function previewLanguage(path: string): PreviewLanguage | undefined {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  if (dot < 1) return undefined;
  const extension = name.slice(dot + 1).toLowerCase();
  switch (extension) {
    case "js": case "mjs": case "cjs": return { name: "JavaScript", filetype: "javascript" };
    case "jsx": return { name: "JavaScript (JSX)", filetype: "javascriptreact" };
    case "ts": case "mts": case "cts": return { name: "TypeScript", filetype: "typescript" };
    case "tsx": return { name: "TypeScript (TSX)", filetype: "typescriptreact" };
    case "py": case "pyi": case "pyw": return { name: "Python", filetype: "python" };
    default: return undefined;
  }
}

export function createPreviewSyntax(): Readonly<{
  client: TreeSitterClient;
  initialize: () => Promise<void>;
  clearPending: () => void;
}> {
  // The worker caches parser assets only; source text is never written here.
  const client = new PreviewSyntaxClient({ dataPath: join(tmpdir(), "porclaintree-parsers"), initTimeout: 2000 }, { autoStartWorker: false });
  let initialization: Promise<void> | undefined;
  return {
    client,
    clearPending: () => client.clearPending(),
    initialize: () => initialization ??= client.initialize().then(() => {
      const asset = (name: string) => fileURLToPath(new URL(`./parsers/python/${name}`, import.meta.url));
      client.addFiletypeParser({ filetype: "python", wasm: asset("tree-sitter-python.wasm"), queries: { highlights: [asset("highlights.scm")] } });
    }),
  };
}
