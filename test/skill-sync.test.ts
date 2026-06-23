import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncSkill } from "../src/utils/skill-sync.js";

const SOURCE_CONTENT = "# Feishu Docs CLI\n\nsource skill body\n";

describe("syncSkill", { concurrency: 1 }, () => {
  let testDir: string | undefined;

  afterEach(async () => {
    if (testDir) {
      await rm(testDir, { recursive: true, force: true }).catch(() => {});
      testDir = undefined;
    }
    delete process.env.FEISHU_DOCS_NO_SKILL_SYNC;
  });

  async function setup(): Promise<{ home: string; sourcePath: string }> {
    testDir = await mkdtemp(join(tmpdir(), "feishu-skill-sync-"));
    const home = join(testDir, "home");
    const sourcePath = join(testDir, "SKILL.md");
    await mkdir(home, { recursive: true });
    await writeFile(sourcePath, SOURCE_CONTENT, "utf-8");
    return { home, sourcePath };
  }

  const claudeTarget = (home: string): string =>
    join(home, ".claude", "skills", "feishu-docs", "SKILL.md");
  const agentsTarget = (home: string): string =>
    join(home, ".agents", "skills", "feishu-docs", "SKILL.md");

  it("writes the target when the framework skills dir exists", async () => {
    const { home, sourcePath } = await setup();
    await mkdir(join(home, ".claude", "skills"), { recursive: true });

    const result = await syncSkill({ home, sourcePath });

    assert.deepEqual(result.synced, [claudeTarget(home)]);
    assert.deepEqual(result.absent, [agentsTarget(home)]);
    assert.equal(await readFile(claudeTarget(home), "utf-8"), SOURCE_CONTENT);
  });

  it("skips (absent) and does NOT create the dir when skills dir is missing", async () => {
    const { home, sourcePath } = await setup();

    const result = await syncSkill({ home, sourcePath });

    assert.deepEqual(result.synced, []);
    assert.deepEqual(result.absent, [claudeTarget(home), agentsTarget(home)]);
    // Nothing should have been created.
    await assert.rejects(() => readFile(claudeTarget(home), "utf-8"));
  });

  it("reports unchanged when content is already identical", async () => {
    const { home, sourcePath } = await setup();
    const target = claudeTarget(home);
    await mkdir(join(home, ".claude", "skills", "feishu-docs"), {
      recursive: true,
    });
    await writeFile(target, SOURCE_CONTENT, "utf-8");

    const result = await syncSkill({ home, sourcePath });

    assert.deepEqual(result.unchanged, [target]);
    assert.deepEqual(result.synced, []);
  });

  it("overwrites an out-of-date target", async () => {
    const { home, sourcePath } = await setup();
    const target = claudeTarget(home);
    await mkdir(join(home, ".claude", "skills", "feishu-docs"), {
      recursive: true,
    });
    await writeFile(target, "# old stale content\n", "utf-8");

    const result = await syncSkill({ home, sourcePath });

    assert.deepEqual(result.synced, [target]);
    assert.equal(await readFile(target, "utf-8"), SOURCE_CONTENT);
  });

  it("force creates the canonical dir even when absent", async () => {
    const { home, sourcePath } = await setup();

    const result = await syncSkill({ home, sourcePath, force: true });

    assert.deepEqual(result.synced, [claudeTarget(home)]);
    // .agents is opportunistic — still absent because its parent does not exist.
    assert.deepEqual(result.absent, [agentsTarget(home)]);
    assert.equal(await readFile(claudeTarget(home), "utf-8"), SOURCE_CONTENT);
  });

  it("is a no-op when FEISHU_DOCS_NO_SKILL_SYNC=1", async () => {
    const { home, sourcePath } = await setup();
    await mkdir(join(home, ".claude", "skills"), { recursive: true });
    process.env.FEISHU_DOCS_NO_SKILL_SYNC = "1";

    const result = await syncSkill({ home, sourcePath });

    assert.deepEqual(result, {
      synced: [],
      unchanged: [],
      absent: [],
      failed: [],
    });
    await assert.rejects(() => readFile(claudeTarget(home), "utf-8"));
  });

  it("returns an empty result (never throws) when the source is missing", async () => {
    const { home } = await setup();
    await mkdir(join(home, ".claude", "skills"), { recursive: true });

    const result = await syncSkill({
      home,
      sourcePath: join(home, "does-not-exist.md"),
    });

    assert.deepEqual(result, {
      synced: [],
      unchanged: [],
      absent: [],
      failed: [],
    });
  });
});
