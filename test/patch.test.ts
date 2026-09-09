import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { patch } from "../src/commands/patch.js";
import { CliError } from "../src/utils/errors.js";
import { makeGlobalOpts } from "./helpers/factory.js";
import { withCleanEnv } from "./helpers/env-guard.js";
import { captureOutput } from "./helpers/capture-output.js";
import { setupMockFetch, jsonResponse } from "./helpers/mock-fetch.js";

const plan = { document_revision_id: 1, edits: [{ block_id: "block1", old_text: "原文", new_text: "新文" }] };
const docUrl = "https://example.feishu.cn/docx/doc1";
const ok = (data: unknown) => jsonResponse({ code: 0, data });

describe("patch command", { concurrency: 1 }, () => {
  for (const args of [{}, { positionals: [docUrl] }, { positionals: [docUrl, docUrl], body: "file" }]) {
    it("rejects missing or extra arguments", async () => {
      await assert.rejects(() => patch(args, makeGlobalOpts()), (err: unknown) => {
        assert.ok(err instanceof CliError);
        assert.equal(err.errorType, "INVALID_ARGS");
        assert.ok(err.recovery);
        return true;
      });
    });
  }
  for (const json of [true, false]) {
    it(`reads a patch file and previews a wiki document (json=${json})`, async () => {
      const dir = await mkdtemp(join(tmpdir(), "feishu-patch-test-"));
      const file = join(dir, "patch.json");
      await writeFile(file, JSON.stringify(plan));
      try {
        await withCleanEnv({ FEISHU_USER_TOKEN: "test-token" }, async () => {
          const mock = setupMockFetch({ responses: [
            ok({ node: { obj_token: "doc1", obj_type: "docx" } }),
            ok({ document: { revision_id: 1 } }),
            ok({ items: [{ block_id: "block1", block_type: 2, text: { elements: [{ text_run: { content: "原文" } }] } }], has_more: false }),
            ok({ document: { revision_id: 1 } }),
          ] });
          const output = captureOutput();
          try {
            await patch({ positionals: ["https://example.feishu.cn/wiki/wiki1"], body: file, dryRun: true }, makeGlobalOpts({ auth: "user", json }));
            if (json) assert.deepEqual(JSON.parse(output.stdout()).changes, plan.edits);
            else assert.ok(output.stdout().includes('"原文" → "新文"'));
            assert.ok(mock.calls.every((call) => call.init?.method === "GET"));
          } finally { output.restore(); mock.restore(); }
        });
      } finally { await rm(dir, { recursive: true, force: true }); }
    });
  }
  it("rejects a non-docx document before reading its blocks", async () => {
    const dir = await mkdtemp(join(tmpdir(), "feishu-patch-test-"));
    const file = join(dir, "patch.json");
    await writeFile(file, JSON.stringify(plan));
    try {
      await withCleanEnv({ FEISHU_USER_TOKEN: "test-token" }, async () => {
        const mock = setupMockFetch({ responses: [] });
        try {
          await assert.rejects(() => patch({ positionals: ["https://example.feishu.cn/sheets/sheet1"], body: file }, makeGlobalOpts({ auth: "user" })),
            (err: unknown) => err instanceof CliError && err.errorType === "NOT_SUPPORTED");
          assert.equal(mock.calls.length, 0);
        } finally { mock.restore(); }
      });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("reports a missing patch file with recovery", async () => {
    await assert.rejects(() => patch({ positionals: [docUrl], body: "/nonexistent-feishu-patch/file.json" }, makeGlobalOpts()),
      (err: unknown) => err instanceof CliError && err.errorType === "FILE_NOT_FOUND" && !!err.recovery);
  });
  it("normalizes wiki-resolution transport failures", async () => {
    const dir = await mkdtemp(join(tmpdir(), "feishu-patch-test-"));
    const file = join(dir, "patch.json");
    await writeFile(file, JSON.stringify(plan));
    try {
      await withCleanEnv({ FEISHU_USER_TOKEN: "test-token" }, async () => {
        const mock = setupMockFetch({ responses: [() => { throw new TypeError("connection reset"); }] });
        try {
          await assert.rejects(() => patch({ positionals: ["https://example.feishu.cn/wiki/wiki1"], body: file }, makeGlobalOpts({ auth: "user" })),
            (err: unknown) => err instanceof CliError && err.errorType === "API_ERROR" && !!err.recovery);
        } finally { mock.restore(); }
      });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

// Exercise actual argument routing, stdin, exit status and JSON error output
// in a child process, without accessing user credentials or any remote API.
describe("patch CLI process", () => {
  async function invoke(args: string[], stdin = "") {
    const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
      'globalThis.fetch = async () => { throw new Error("network disabled in CLI parsing test"); }; const { run } = await import("./src/cli.ts"); await run(process.argv.slice(1));',
      ...args], { env: { ...process.env, FEISHU_DOCS_NO_SKILL_SYNC: "1" }, stdio: "pipe" });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (data: Buffer) => stdout.push(data));
    child.stderr.on("data", (data: Buffer) => stderr.push(data));
    child.stdin.end(stdin);
    const code = await new Promise<number | null>((resolve, reject) => { child.on("close", resolve); child.on("error", reject); });
    return { code, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() };
  }
  it("routes patch and reads invalid JSON from stdin", async () => {
    const result = await invoke(["patch", docUrl, "--body", "-", "--json"], "{");
    assert.equal(result.code, 1);
    assert.equal(JSON.parse(result.stderr.trim()).error.type, "INVALID_ARGS");
    assert.equal(result.stdout, "");
  });
  it("rejects misspelled --dry-run instead of performing a write", async () => {
    const result = await invoke(["patch", docUrl, "--body", "-", "--dryrun", "--json"]);
    assert.equal(result.code, 1);
    assert.equal(JSON.parse(result.stderr.trim()).error.type, "INVALID_ARGS");
    assert.ok(result.stderr.includes("dryrun"));
  });
});
