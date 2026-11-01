import { parseCommand } from "./args";

async function main(): Promise<number> {
  const command = parseCommand(process.argv.slice(2));
  if (!command) {
    console.error("Usage: bun run src/cli.ts -- <command> [args...]\nExample: bun run src/cli.ts -- codex");
    return 2;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error("PorclainTree needs an interactive terminal for stdin and stdout.");
    return 2;
  }
  const { runTerminal } = await import("./terminal");
  return runTerminal(command, process.cwd());
}

if (import.meta.main) {
  void main().then(
    (code) => { process.exitCode = code; },
    (error: unknown) => {
      console.error(`PorclainTree: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    },
  );
}
