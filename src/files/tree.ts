export type FileListState = Readonly<{ paths: readonly string[]; error: string | null }>;
export type TreeEntry = Readonly<{ path: string; name: string; kind: "directory" | "file"; depth: number }>;

type Node = { entry: TreeEntry; children: Map<string, Node> };

export function fileTree(paths: readonly string[], expanded: ReadonlySet<string>): readonly TreeEntry[] {
  const root = new Map<string, Node>();
  for (const path of paths) {
    let children = root;
    let prefix = "";
    const parts = path.split("/");
    for (const [depth, name] of parts.entries()) {
      prefix += (prefix ? "/" : "") + name;
      let node = children.get(name);
      if (!node) {
        node = { entry: { path: prefix, name, kind: depth < parts.length - 1 ? "directory" : "file", depth }, children: new Map() };
        children.set(name, node);
      }
      children = node.children;
    }
  }
  const sorted = (nodes: Map<string, Node>) => [...nodes.values()].sort((a, b) =>
    a.entry.kind !== b.entry.kind ? (a.entry.kind === "directory" ? -1 : 1)
      : a.entry.name < b.entry.name ? -1 : a.entry.name > b.entry.name ? 1 : 0);
  const pending = sorted(root).reverse();
  const result: TreeEntry[] = [];
  while (pending.length) {
    const node = pending.pop();
    if (!node) break;
    result.push(node.entry);
    if (expanded.has(node.entry.path)) pending.push(...sorted(node.children).reverse());
  }
  return result;
}
