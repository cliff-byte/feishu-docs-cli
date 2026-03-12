/**
 * Tests for CLI command routing (declarative registration).
 * Tests both the parsing logic and the run() dispatch function.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "node:util";
import { run } from "../src/cli.js";

type OptionDef = { type: "string" | "boolean"; default?: string | boolean };

const GLOBAL_OPTIONS: Record<string, OptionDef> = {
  auth: { type: "string", default: "auto" },
  json: { type: "boolean", default: false },
  lark: { type: "boolean", default: false },
  help: { type: "boolean", default: false },
};

function remapArgs(
  values: Record<string, unknown>,
  optionDefs: Record<string, unknown>,
): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const key of Object.keys(optionDefs)) {
    const camel = key.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    if (values[key] !== undefined) {
      args[camel] = values[key];
    }
  }
  return args;
}

function simulateParse(
  def: { options: Record<string, OptionDef>; positionals?: boolean },
  argv: string[],
) {
  const allOptions = { ...GLOBAL_OPTIONS, ...def.options };
  const { values, positionals } = parseArgs({
    args: argv,
    options: allOptions,
    allowPositionals: def.positionals ?? false,
    strict: false,
  });

  const globalOpts = {
    auth: values.auth,
    json: values.json,
    lark: values.lark,
  };
  const args = remapArgs(values as Record<string, unknown>, def.options);
  if (def.positionals) {
    args.positionals = positionals;
  }

  return { args, globalOpts };
}

describe("CLI arg parsing", () => {
  it("should parse read command with options", () => {
    const def: { options: Record<string, OptionDef>; positionals: boolean } = {
      options: {
        raw: { type: "boolean", default: false },
        blocks: { type: "boolean", default: false },
        "with-meta": { type: "boolean", default: false },
      },
      positionals: true,
    };

    const { args, globalOpts } = simulateParse(def, [
      "some-token",
      "--raw",
      "--json",
    ]);
    assert.equal((args.positionals as string[])[0], "some-token");
    assert.equal(args.raw, true);
    assert.equal(globalOpts.json, true);
  });

  it("should remap hyphenated options to camelCase", () => {
    const def: { options: Record<string, OptionDef>; positionals: boolean } = {
      options: {
        "with-meta": { type: "boolean", default: false },
        "max-docs": { type: "string" },
      },
      positionals: true,
    };

    const { args } = simulateParse(def, [
      "token",
      "--with-meta",
      "--max-docs",
      "10",
    ]);
    assert.equal(args.withMeta, true);
    assert.equal(args.maxDocs, "10");
  });

  it("should handle subcommand parsing", () => {
    const subDef: { options: Record<string, OptionDef>; positionals: boolean } = {
      options: {
        role: { type: "string", default: "view" },
      },
      positionals: true,
    };

    const { args } = simulateParse(subDef, [
      "https://test.feishu.cn/wiki/abc",
      "user@example.com",
      "--role",
      "edit",
    ]);
    assert.equal((args.positionals as string[])[0], "https://test.feishu.cn/wiki/abc");
    assert.equal((args.positionals as string[])[1], "user@example.com");
    assert.equal(args.role, "edit");
  });
});

describe("CLI run() dispatch", () => {
  it("should show help for empty argv", async () => {
    // run([]) should not throw - it writes help text
    await run([]);
  });

  it("should show help for --help flag", async () => {
    await run(["--help"]);
  });

  it("should throw for unknown command", async () => {
    try {
      await run(["nonexistent"]);
      assert.fail("should have thrown");
    } catch (err) {
      const e = err as { message: string; errorType?: string };
      assert.ok(
        e.message.includes("未知命令") || e.errorType === "INVALID_ARGS",
      );
    }
  });

  it("should throw for share with no subcommand", async () => {
    try {
      await run(["share"]);
      assert.fail("should have thrown");
    } catch (err) {
      const e = err as { message: string; errorType?: string };
      assert.ok(
        e.message.includes("list") || e.errorType === "INVALID_ARGS",
      );
    }
  });

  it("should throw for share with invalid subcommand", async () => {
    try {
      await run(["share", "invalid"]);
      assert.fail("should have thrown");
    } catch (err) {
      const e = err as { message: string; errorType?: string };
      assert.ok(
        e.message.includes("list") || e.errorType === "INVALID_ARGS",
      );
    }
  });
});
