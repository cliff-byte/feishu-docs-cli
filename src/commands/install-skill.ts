/**
 * install-skill command: Install the feishu-docs skill to Claude Code's commands directory.
 */

import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { CommandMeta } from "../types/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function handler(): Promise<void> {
  // Resolve SKILL.md from the package's skill/ directory
  const skillSrc = resolve(__dirname, "../../skill/SKILL.md");
  if (!existsSync(skillSrc)) {
    process.stderr.write("feishu-docs: error: SKILL.md not found in package\n");
    process.exit(1);
  }

  const targetDir = resolve(homedir(), ".claude", "commands");
  mkdirSync(targetDir, { recursive: true });

  const targetPath = resolve(targetDir, "feishu-docs.md");
  const content = readFileSync(skillSrc, "utf-8");
  writeFileSync(targetPath, content, "utf-8");

  process.stdout.write(`Skill installed to ${targetPath}\n`);
  process.stdout.write(
    "You can now use /feishu-docs in Claude Code to access Feishu document operations.\n",
  );
}

export const meta: CommandMeta = {
  handler,
  options: {},
};
