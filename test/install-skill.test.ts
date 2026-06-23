/**
 * Integration tests for the install-skill command.
 *
 * Tests cover: syncing SKILL.md to the canonical Claude skill dir
 * (~/.claude/skills/feishu-docs/), auto-creating it when missing, and output.
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

const claudeSkill = (home: string): string =>
  join(home, ".claude", "skills", "feishu-docs", "SKILL.md");

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

  it("syncs SKILL.md to ~/.claude/skills/feishu-docs/", async () => {
    testDir = await mkdtemp(join(tmpdir(), "feishu-skill-"));

    await withCleanEnv({ HOME: testDir }, async () => {
      const cap = captureOutput();
      outputRestore = cap.restore;

      await meta.handler({ positionals: [] }, {
        auth: "auto",
        json: false,
        lark: false,
      });

      const targetPath = claudeSkill(testDir);
      assert.ok(existsSync(targetPath), "SKILL.md should be created");

      const content = await readFile(targetPath, "utf-8");
      assert.ok(content.length > 0, "SKILL.md should have content");

      assert.ok(cap.stdout().includes("Skill installed/updated"));
    });
  });

  it("force-creates the canonical skill directory if missing", async () => {
    testDir = await mkdtemp(join(tmpdir(), "feishu-skill-"));

    await withCleanEnv({ HOME: testDir }, async () => {
      const cap = captureOutput();
      outputRestore = cap.restore;

      // No .claude dir exists in testDir yet
      const skillDir = join(testDir, ".claude", "skills", "feishu-docs");
      assert.ok(!existsSync(skillDir), "skill dir should not exist yet");

      await meta.handler({ positionals: [] }, {
        auth: "auto",
        json: false,
        lark: false,
      });

      assert.ok(existsSync(skillDir), "skill dir should be created");
      assert.ok(existsSync(claudeSkill(testDir)), "SKILL.md should be created");
    });
  });
});
