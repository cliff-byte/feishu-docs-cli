/**
 * Integration tests for the install-skill command.
 *
 * Tests cover: copying SKILL.md to ~/.claude/commands/, auto-creating
 * target directory, and output messages.
 */

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withCleanEnv } from "./helpers/env-guard.js";
import { captureOutput } from "./helpers/capture-output.js";
import { meta } from "../src/commands/install-skill.js";

describe("install-skill command", { concurrency: 1 }, () => {
  let outputRestore: (() => void) | undefined;
  let testDir: string | undefined;

  afterEach(async () => {
    if (outputRestore) outputRestore();
    outputRestore = undefined;
    if (testDir) {
      await rm(testDir, { recursive: true, force: true }).catch(() => {});
      testDir = undefined;
    }
  });

  it("copies SKILL.md to ~/.claude/commands/", async () => {
    testDir = await mkdtemp(join(tmpdir(), "feishu-skill-"));

    await withCleanEnv({ HOME: testDir }, async () => {
      const cap = captureOutput();
      outputRestore = cap.restore;

      await meta.handler({ positionals: [] }, {
        auth: "auto",
        json: false,
        lark: false,
      });

      const targetPath = join(testDir, ".claude", "commands", "feishu-docs.md");
      assert.ok(existsSync(targetPath), "feishu-docs.md should be created");

      const content = await readFile(targetPath, "utf-8");
      assert.ok(content.length > 0, "feishu-docs.md should have content");

      assert.ok(cap.stdout().includes("Skill installed"));
    });
  });

  it("creates target directory if missing", async () => {
    testDir = await mkdtemp(join(tmpdir(), "feishu-skill-"));

    await withCleanEnv({ HOME: testDir }, async () => {
      const cap = captureOutput();
      outputRestore = cap.restore;

      // No .claude dir exists in testDir yet
      const claudeDir = join(testDir, ".claude", "commands");
      assert.ok(!existsSync(claudeDir), ".claude/commands/ should not exist yet");

      await meta.handler({ positionals: [] }, {
        auth: "auto",
        json: false,
        lark: false,
      });

      assert.ok(existsSync(claudeDir), ".claude/commands/ should be created");
      const targetPath = join(claudeDir, "feishu-docs.md");
      assert.ok(existsSync(targetPath), "feishu-docs.md should be created");
    });
  });
});
