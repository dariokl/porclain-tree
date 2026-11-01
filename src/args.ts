export type CommandSpec = Readonly<{
  executable: string;
  args: readonly string[];
}>;

export function parseCommand(argv: readonly string[]): CommandSpec | undefined {
  const command = argv[0] === "--" ? argv.slice(1) : argv;
  const executable = command[0];
  if (!executable) return undefined;
  return { executable, args: command.slice(1) };
}
