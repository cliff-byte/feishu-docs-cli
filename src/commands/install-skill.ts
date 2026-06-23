/**
 * install-skill command: Install/update the feishu-docs skill in Claude's
 * skill directories (`~/.claude/skills/` and, if present, `~/.agents/skills/`).
 */

import { syncSkill } from "../utils/skill-sync.js";
import { CommandMeta } from "../types/index.js";

async function handler(): Promise<void> {
  // force: ensure the canonical Claude skill dir even if it does not exist yet.
  const result = await syncSkill({ force: true });

  const touched =
    result.synced.length + result.unchanged.length + result.failed.length;
  if (touched === 0) {
    // Nothing was written and nothing already existed — the packaged SKILL.md
    // could not be read.
    process.stderr.write("feishu-docs: error: SKILL.md not found in package\n");
    process.exit(1);
  }

  for (const path of result.synced) {
    process.stdout.write(`Skill installed/updated: ${path}\n`);
  }
  for (const path of result.unchanged) {
    process.stdout.write(`Skill already up to date: ${path}\n`);
  }
  for (const path of result.failed) {
    process.stderr.write(`feishu-docs: warning: 无法写入 ${path}\n`);
  }

  process.stdout.write(
    "You can now use the feishu-docs skill in Claude Code to access Feishu document operations.\n",
  );
}

export const meta: CommandMeta = {
  handler,
  options: {},
};
