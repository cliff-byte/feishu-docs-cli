/**
 * Opt-in real Feishu E2E: npm run build && node scripts/comment-live-e2e.mjs --run
 * Uses the existing user login (plus app credentials for the tenant section),
 * creates one disposable doc and recycles it. The only @mention is the caller.
 * Needs docs:document.comment:create and docs:document.comment:update.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, fetchWithAuth } from "../dist/client.js";
import { listComments } from "../dist/services/comments.js";

if (process.argv[2] !== "--run") {
  process.stdout.write("Run with --run to create, comment on and recycle a test doc using your user login.\n");
  process.exit(0);
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
async function cli(args, { auth = "user", json = true } = {}) {
  const child = spawn(process.execPath, [join(root, "bin/feishu-docs.js"), ...args, "--auth", auth, ...(json ? ["--json"] : [])], {
    cwd: root, env: { ...process.env, FEISHU_DOCS_NO_SKILL_SYNC: "1" }, stdio: "pipe",
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (data) => stdout.push(data));
  child.stderr.on("data", (data) => stderr.push(data));
  child.stdin.end();
  const code = await new Promise((resolve, reject) => { child.on("close", resolve); child.on("error", reject); });
  const text = Buffer.concat(stdout).toString();
  const stderrText = Buffer.concat(stderr).toString();
  const errors = stderrText.split("\n").filter((line) => line.startsWith('{"success":false'));
  return {
    code, text, stderr: stderrText,
    data: json && text ? JSON.parse(text) : undefined,
    error: errors.length ? JSON.parse(errors.at(-1)).error : undefined,
  };
}
async function success(args, opts) {
  const result = await cli(args, opts);
  assert.equal(result.code, 0, `CLI ${args.slice(0, 2).join(" ")} failed (exit ${result.code}):\n${result.stderr}`);
  return result.data ?? result.text;
}
async function failure(args, code, type, opts) {
  const result = await cli(args, opts);
  assert.equal(result.code, code, `CLI ${args.slice(0, 2).join(" ")} should exit ${code}, got ${result.code}:\n${result.stderr}`);
  assert.equal(result.error?.type, type);
  return result.error;
}
const pass = (msg) => process.stdout.write(`PASS: ${msg}\n`);
const list = async (url, ...flags) => (await success(["comment", "list", url, ...flags])).comments;
const byId = (comments, id) => comments.find((c) => c.comment_id === id);

const { authInfo } = await createClient({ auth: "user" });
const identity = await fetchWithAuth(authInfo, "/open-apis/authen/v1/user_info");
const selfId = identity.data?.open_id;
assert.equal(typeof selfId, "string", "Current user's open_id is required for the self-only mention");

const dir = await mkdtemp(join(tmpdir(), "feishu-comment-live-"));
const bodyFile = join(dir, "body.md");
await writeFile(bodyFile, "## 评论测试\n\n第一段：局部评论。\n\n第二段：将被删除。\n\n第三段：长度上限。\n", { mode: 0o600 });
const created = await success(["create", `CLI comment E2E ${new Date().toISOString()}`, "--body", bodyFile]);
const url = created.url;
const docId = created.document_id;
try {
  const blocks = await success(["read", url, "--blocks"]);
  const blockOf = (needle) => blocks.find((b) => b.text?.elements?.some((e) => e.text_run?.content.includes(needle)))?.block_id;
  const [b1, b2, b3] = ["第一段", "第二段", "第三段"].map(blockOf);
  assert.ok(b1 && b2 && b3, "fixture blocks exist");
  assert.equal((await list(url)).length, 0);
  pass("list on a fresh doc is empty");

  // ── add ──
  const whole = await success(["comment", "add", url, "--text", "全文评论"]);
  assert.deepEqual(whole.anchor, { status: "whole" });
  const rich = JSON.stringify([
    { type: "text", text: "局部 a<b>c & " },
    { type: "mention_user", mention_user: selfId },
    { type: "text", text: " 见 " },
    { type: "link", link: url },
  ]);
  const local = await success(["comment", "add", url, "--block", b1, "--elements", rich]);
  const orphan = await success(["comment", "add", url, "--block", b2, "--text", "原文将被删除"]);
  assert.ok(whole.comment_id && local.comment_id && orphan.comment_id && local.reply_id);
  pass("add posts whole and block comments (rich elements included)");

  // ── list: anchors, round-trip, names ──
  let comments = await list(url);
  assert.equal(comments.length, 3);
  assert.deepEqual(byId(comments, whole.comment_id).anchor, { status: "whole" });
  assert.deepEqual(byId(comments, local.comment_id).anchor, { status: "exact", block_id: b1 });
  assert.deepEqual(byId(comments, orphan.comment_id).anchor, { status: "exact", block_id: b2 });
  const rootReply = byId(comments, local.comment_id).replies[0];
  assert.deepEqual(rootReply.elements, [
    { type: "text_run", text_run: { text: "局部 a<b>c & " } },
    { type: "person", person: { user_id: selfId } },
    { type: "text_run", text_run: { text: " 见 " } },
    { type: "docs_link", docs_link: { url } },
  ]);
  assert.equal(byId(comments, local.comment_id).quote, "第一段：局部评论。");
  assert.equal(rootReply.user_name, identity.data.name);
  assert.equal(rootReply.text, `局部 a<b>c & @${identity.data.name} 见 ${url}`);
  pass("list anchors match read --blocks; text, mention and link round-trip; names resolve");

  const human = await success(["comment", "list", url], { json: false });
  assert.match(human, /共 3 条评论/);
  assert.match(human, new RegExp(`${local.comment_id}  \\[未解决\\]  块 ${b1}`));
  pass("human-readable list output");

  // ── reply ──
  const reply = await success(["comment", "reply", url, local.comment_id, "--text", "回复 <x>"]);
  assert.ok(reply.reply_id);
  const wholeReply = await failure(["comment", "reply", url, whole.comment_id, "--text", "x"], 3, "NOT_SUPPORTED");
  assert.match(wholeReply.recovery, /comment add/);
  assert.equal(byId(await list(url), local.comment_id).replies.at(-1).text, "回复 <x>");
  pass("reply to a block comment works; whole-document comments report NOT_SUPPORTED");

  // ── resolve / reopen and status filters ──
  await success(["comment", "resolve", url, local.comment_id]);
  assert.equal(byId(await list(url), local.comment_id), undefined);
  const solved = await list(url, "--status", "solved");
  assert.deepEqual(solved.map((c) => [c.comment_id, c.is_solved]), [[local.comment_id, true]]);
  assert.equal(solved[0].solver_user_id, selfId);
  await success(["comment", "reply", url, local.comment_id, "--text", "已解决后回复"]);
  await success(["comment", "reopen", url, local.comment_id]);
  assert.equal(byId(await list(url), local.comment_id).is_solved, false);
  await success(["comment", "resolve", url, whole.comment_id]);
  await success(["comment", "reopen", url, whole.comment_id]);
  pass("resolve/reopen toggle status (whole too); resolved comments still accept replies");

  // Feishu returned 105 inline replies untruncated in testing, so force the
  // reply-completion fallback: mark the card truncated in the list response
  // only; the real replies endpoint must restore every reply.
  const target = { fileToken: docId, fileType: "docx" };
  const expected = byId(await listComments(authInfo, target), local.comment_id).replies;
  assert.equal(expected.length, 3);
  const originalFetch = globalThis.fetch;
  let injected = false;
  globalThis.fetch = async (request, options) => {
    const res = await originalFetch(request, options);
    const path = new URL(String(request)).pathname;
    if (!path.endsWith(`/files/${docId}/comments`)) return res;
    const body = await res.json();
    const items = body.data.items.map((item) => item.comment_id !== local.comment_id ? item : (injected = true, {
      ...item, has_more: true, reply_list: { replies: item.reply_list.replies.slice(0, 1) },
    }));
    return new Response(JSON.stringify({ ...body, data: { ...body.data, items } }), {
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const completed = byId(await listComments(authInfo, target), local.comment_id);
    assert.equal(injected, true);
    assert.equal(completed.replies_truncated, undefined);
    assert.deepEqual(completed.replies, expected);
  } finally { globalThis.fetch = originalFetch; }
  pass("truncated reply lists are completed from the real replies endpoint (fault-injected list response)");

  const wholeOnly = await list(url, "--scope", "whole");
  assert.deepEqual(wholeOnly.map((c) => c.comment_id), [whole.comment_id]);
  const partial = await list(url, "--scope", "partial");
  assert.ok(partial.every((c) => !c.is_whole) && partial.length === 2);
  pass("--scope whole/partial filter");

  // ── orphaned comments ──
  const children = await fetchWithAuth(authInfo, `/open-apis/docx/v1/documents/${docId}/blocks/${docId}/children`);
  const index = children.data.items.findIndex((b) => b.block_id === b2);
  await fetchWithAuth(authInfo, `/open-apis/docx/v1/documents/${docId}/blocks/${docId}/children/batch_delete`, {
    method: "DELETE", params: { document_revision_id: -1 }, body: { start_index: index, end_index: index + 1 },
  });
  assert.equal(byId(await list(url), orphan.comment_id), undefined);
  assert.deepEqual(byId(await list(url, "--status", "all"), orphan.comment_id).anchor, { status: "deleted" });
  pass("comments on deleted text are hidden by default and reported as deleted with --status all");

  // ── error paths ──
  for (const block of ["doxcnNotExistE2E0000000000", b2]) {
    const err = await failure(["comment", "add", url, "--block", block, "--text", "x"], 1, "INVALID_ARGS");
    assert.match(err.recovery, /read <url> --blocks/);
  }
  for (const sub of ["resolve", "reopen"]) {
    const err = await failure(["comment", sub, url, "1234567890123456789"], 3, "NOT_FOUND");
    assert.equal(err.retryable, false);
  }
  await failure(["comment", "reply", url, "1234567890123456789", "--text", "x"], 3, "NOT_FOUND");
  pass("missing/deleted blocks and missing comments give non-retryable typed errors");

  // ── length limit (server counts the escaped form) ──
  await success(["comment", "add", url, "--block", b3, "--text", "a".repeat(10000)]);
  await success(["comment", "add", url, "--block", b3, "--text", "<".repeat(2500)]);
  await failure(["comment", "add", url, "--block", b3, "--text", "<".repeat(2501)], 1, "INVALID_ARGS");
  await failure(["comment", "add", url, "--text", "中".repeat(10001)], 1, "INVALID_ARGS");
  pass("10000-character limit matches the server, measured after escaping");

  // ── app identity ──
  if (process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET) {
    const tenant = { auth: "tenant" };
    const appLocal = await success(["comment", "add", url, "--block", b1, "--text", "应用身份评论"], tenant);
    await success(["comment", "reply", url, appLocal.comment_id, "--text", "应用身份回复"], tenant);
    await success(["comment", "resolve", url, appLocal.comment_id], tenant);
    await success(["comment", "reopen", url, appLocal.comment_id], tenant);
    assert.equal(byId(await list(url), appLocal.comment_id).replies.length, 2);
    pass("tenant identity can add, reply, resolve and reopen");
  } else {
    process.stdout.write("SKIP: tenant identity (FEISHU_APP_ID / FEISHU_APP_SECRET not set)\n");
  }
} finally {
  await rm(dir, { recursive: true, force: true });
  const cleanup = await cli(["delete", url, "--confirm"]);
  if (cleanup.error?.api_code === 1061007) {
    // "file has been deleted": seen once when delete's retry followed a DELETE that had already succeeded.
    pass("test document already in recycle bin (delete reported 1061007)");
  } else if (cleanup.code !== 0) {
    process.stderr.write(`Test document cleanup failed (${cleanup.error?.type ?? cleanup.code}); recycle manually: ${url}\n${cleanup.stderr}`);
    process.exitCode = 1;
  } else {
    pass("test document moved to recycle bin");
  }
}
