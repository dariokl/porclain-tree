import { describe, expect, test } from "bun:test";
import { parseCommand } from "../src/args";

describe("parseCommand", () => {
  test.each([{ argv: [] }, { argv: ["--"] }, { argv: [""] }])("requires a child executable: %j", ({ argv }) => {
    expect(parseCommand(argv)).toBeUndefined();
  });

  test("passes child options through after the separator", () => {
    expect(parseCommand(["--", "codex", "--help"])).toEqual({
      executable: "codex",
      args: ["--help"],
    });
  });

  test("accepts an executable without a separator", () => {
    expect(parseCommand(["bash", "--noprofile"])).toEqual({
      executable: "bash",
      args: ["--noprofile"],
    });
  });

  test("preserves spaces, empty args, Unicode, and shell metacharacters literally", () => {
    const argv = Object.freeze(["--", "/tmp/a program", "a b", "", "č", "$(touch nope)", "; exit 9", "--"]);
    expect(parseCommand(argv)).toEqual({
      executable: "/tmp/a program",
      args: ["a b", "", "č", "$(touch nope)", "; exit 9", "--"],
    });
    expect(argv[0]).toBe("--");
  });
});
