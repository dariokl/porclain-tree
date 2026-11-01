import { parseCommand } from "./command";
import { safeDisplay } from "./terminal/sidebar";

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
  const cwd = process.cwd();
  const { runApp } = await import("./app");
  const result = await runApp(command, cwd);
  if (!result.ok) console.error(`PorclainTree: ${safeDisplay(result.error)}`);
  return result.exitCode;
}

if (import.meta.main) {
  void main().then(
    (code) => { process.exitCode = code; },
    (error: unknown) => {
      console.error(`PorclainTree: ${safeDisplay(error instanceof Error ? error.message : String(error))}`);
      process.exitCode = 1;
    },
  );
}
