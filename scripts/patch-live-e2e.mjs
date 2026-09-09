/**
 * Opt-in real Feishu E2E: npm run build && node scripts/patch-live-e2e.mjs --run
 * Uses the existing user login, creates one disposable doc and recycles it.
 * Both mention fixtures reference ONLY the calling user. No other recipients.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, fetchWithAuth } from "../dist/client.js";
import { convertMarkdown, writeDescendant } from "../dist/services/markdown-convert.js";
import { getDocumentInfo } from "../dist/services/block-writer.js";
import { patchDocument } from "../dist/services/doc-patch.js";

if (process.argv[2] !== "--run") {
  process.stdout.write("Run with --run to create, edit and recycle a test doc using your user login.\n");
  process.exit(0);
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
async function cli(args, stdin) {
  const child = spawn(process.execPath, [join(root, "bin/feishu-docs.js"), ...args, "--auth", "user", "--json"], {
    cwd: root, env: { ...process.env, FEISHU_DOCS_NO_SKILL_SYNC: "1" }, stdio: "pipe",
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (data) => stdout.push(data));
  child.stderr.on("data", (data) => stderr.push(data));
  child.stdin.end(stdin);
  const code = await new Promise((resolve, reject) => { child.on("close", resolve); child.on("error", reject); });
  const text = Buffer.concat(stdout).toString();
  const errors = Buffer.concat(stderr).toString().split("\n").filter((line) => line.startsWith('{"success":false'));
  return { code, data: text ? JSON.parse(text) : undefined, error: errors.length ? JSON.parse(errors.at(-1)).error : undefined };
}
async function success(args, stdin) {
  const result = await cli(args, stdin);
  assert.equal(result.code, 0, `CLI ${args[0]} failed: ${result.error?.type ?? result.code}`);
  return result.data;
}
const { authInfo } = await createClient({ auth: "user" });
const identity = await fetchWithAuth(authInfo, "/open-apis/authen/v1/user_info");
const selfId = identity.data?.open_id;
assert.equal(typeof selfId, "string", "Current user's open_id is required for self-only mentions");
const created = await success(["create", `CLI patch E2E ${new Date().toISOString()}`]);
const url = created.url;
const dir = await mkdtemp(join(tmpdir(), "feishu-patch-live-"));
try {
  const converted = await convertMarkdown(authInfo, "## 测试章节\n\n示例文本待定，请确认。\n\n其他段落保持不变。\n\n| 项目 | 状态 |\n| --- | --- |\n| 示例条目 | 待确认 |\n");
  const fixture = {
    ...converted,
    blocks: converted.blocks.map((block) => block.text?.elements?.some((element) => element.text_run?.content.includes("示例文本待定"))
      ? { ...block, text: { ...block.text, elements: [
        { text_run: { content: "示例文本待定，请确认。", text_element_style: { bold: true } } },
        { mention_user: { user_id: selfId } },
        { text_run: { content: " 与 " } },
        { mention_user: { user_id: selfId } },
      ] } } : block),
  };
  const initial = await getDocumentInfo(authInfo, created.document_id);
  await writeDescendant(authInfo, created.document_id, created.document_id, fixture, initial.revisionId);
  const meta = await success(["info", url]);
  const before = await success(["read", url, "--blocks"]);
  const target = before.find((block) => block.text?.elements?.some((element) => element.mention_user));
  assert.ok(target, "Mention fixture was created");
  assert.equal(target.text.elements.filter((element) => element.mention_user).length, 2);
  const plan = { document_revision_id: meta.revision, edits: [{ block_id: target.block_id, old_text: "待定", new_text: "已更新" }] };
  const file = join(dir, "edits.json");
  await writeFile(file, JSON.stringify(plan), { mode: 0o600 });
  const preview = await success(["patch", url, "--body", file, "--dry-run"]);
  assert.equal(preview.updated_blocks, 0);
  assert.deepEqual(preview.changes, plan.edits);
  assert.deepEqual(await success(["read", url, "--blocks"]), before);
  assert.equal((await success(["info", url])).revision, meta.revision);
  process.stdout.write("PASS: dry-run preserves content and revision\n");

  const applied = await success(["patch", url, "--body", "-"], JSON.stringify(plan));
  assert.equal(applied.updated_blocks, 1);
  const after = await success(["read", url, "--blocks"]);
  const changed = after.find((block) => block.block_id === target.block_id);
  const expectedElements = target.text.elements.map((element) => element.text_run?.content.includes("待定")
    ? { ...element, text_run: { ...element.text_run, content: element.text_run.content.replace("待定", "已更新") } } : element);
  assert.deepEqual(changed, { ...target, text: { ...target.text, elements: expectedElements } });
  assert.deepEqual(after.filter((block) => block.block_id !== target.block_id), before.filter((block) => block.block_id !== target.block_id));
  process.stdout.write("PASS: CLI stdin patch preserves block IDs, two self-mentions, styles and all other blocks (including table)\n");

  const stale = await cli(["patch", url, "--body", file]);
  assert.equal(stale.code, 3);
  assert.equal(stale.error.type, "API_ERROR");
  assert.deepEqual(await success(["read", url, "--blocks"]), after);
  process.stdout.write("PASS: stale revision is rejected without modifying the document\n");

  const badPlan = { document_revision_id: applied.document_revision_id, edits: [
    { ...plan.edits[0], old_text: "已更新", new_text: "不应写入" },
    { block_id: "missingBlockForE2E", old_text: "不存在", new_text: "不应写入" },
  ] };
  const invalid = await cli(["patch", url, "--body", "-"], JSON.stringify(badPlan));
  assert.equal(invalid.code, 3);
  assert.equal(invalid.error.type, "NOT_FOUND");
  assert.deepEqual(await success(["read", url, "--blocks"]), after);
  process.stdout.write("PASS: invalid batch makes no partial edits\n");

  // Inject a real concurrent CLI edit after patchDocument's last revision
  // check but before its PATCH reaches Feishu. Feishu accepts stale revisions;
  // the command must report the response revision jump as a possible write.
  const racePlan = { document_revision_id: applied.document_revision_id, edits: [
    { ...plan.edits[0], old_text: "已更新", new_text: "竞态写入（需核验）" },
  ] };
  const originalFetch = globalThis.fetch;
  let injected = false;
  globalThis.fetch = async (request, options) => {
    if (!injected && options?.method === "PATCH" && String(request).includes("/blocks/batch_update")) {
      injected = true;
      await success(["patch", url, "--body", "-"], JSON.stringify({ ...racePlan,
        edits: [{ ...racePlan.edits[0], new_text: "并发编辑已保存" }],
      }));
    }
    return originalFetch(request, options);
  };
  try {
    await assert.rejects(() => patchDocument(authInfo, created.document_id, racePlan, false),
      (err) => err.details?.write_may_have_applied === true && err.details?.document_revision_id === racePlan.document_revision_id + 2);
    assert.equal(injected, true);
  } finally { globalThis.fetch = originalFetch; }
  const raced = await success(["read", url, "--blocks"]);
  assert.ok(raced.find((block) => block.block_id === target.block_id).text.elements[0].text_run.content.includes("竞态写入（需核验）"));
  process.stdout.write("PASS: final-window race reports a possibly applied write instead of false success (Feishu has no CAS guard)\n");
} finally {
  await rm(dir, { recursive: true, force: true });
  const cleanup = await cli(["delete", url, "--confirm"]);
  if (cleanup.code !== 0) {
    process.stderr.write(`Test document cleanup failed (${cleanup.error?.type ?? cleanup.code}); recycle manually: ${url}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write("PASS: test document moved to recycle bin\n");
  }
}
