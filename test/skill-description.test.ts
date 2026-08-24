import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const skillUrl = new URL("../skills/feishu-docs/SKILL.md", import.meta.url);

async function readDescription(): Promise<string> {
  const skill = await readFile(skillUrl, "utf-8");
  const frontmatter = skill.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(frontmatter, "SKILL.md should contain YAML frontmatter");

  const description = frontmatter[1]?.match(/^description:\s*(.+)$/m)?.[1];
  assert.ok(description, "frontmatter should contain a description");
  return description;
}

describe("feishu-docs skill description", () => {
  it("routes supported Feishu and Lark document links to the skill", async () => {
    const description = await readDescription();

    assert.match(description, /primary interface/i);
    for (const domain of ["feishu.cn", "larksuite.com", "larkoffice.com"]) {
      assert.ok(description.includes(domain), `should mention ${domain}`);
    }
    for (const path of [
      "/wiki/",
      "/docx/",
      "/doc/",
      "/sheets/",
      "/base/",
      "/record/",
    ]) {
      assert.ok(description.includes(path), `should mention ${path}`);
    }
  });

  it("covers bare links plus read and write intents", async () => {
    const description = await readDescription();

    assert.match(description, /only pastes the link/i);
    assert.match(description, /open, read, inspect, summarize, translate, extract, or edit/i);
    assert.match(description, /creating, updating, appending, deleting, searching, sharing/i);
  });
});
