import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate } from "node:timers/promises";
import { exportSheet } from "../src/services/sheet-export.js";
import { meta as exportMeta } from "../src/commands/export.js";
import { makeUserAuthInfo, makeGlobalOpts } from "./helpers/factory.js";
import { captureOutput } from "./helpers/capture-output.js";
import { withCleanEnv } from "./helpers/env-guard.js";
import { jsonResponse, setupMockFetch } from "./helpers/mock-fetch.js";
import { enableTimerMock } from "./helpers/timer-mock.js";

const token = "spreadsheet123456789012";
const auth = makeUserAuthInfo({ refreshToken: undefined });
const created = () => jsonResponse({ code: 0, data: { ticket: "1234567" } });
const completed = (size: number, extra: Record<string, unknown> = {}) => jsonResponse({ code: 0, data: { result: {
  job_status: 0, file_token: "filetoken1", file_extension: "xlsx", type: "sheet", file_size: size, ...extra,
} } });
const content = Buffer.from("PK\u0003\u0004mock-xlsx-content");

describe("Sheet xlsx export", { concurrency: 1 }, () => {
  let dir: string;
  let path: string;
  let restore: (() => void) | undefined;
  let restoreOutput: (() => void) | undefined;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "feishu-sheet-export-")); path = join(dir, "output.xlsx"); });
  afterEach(async () => { restore?.(); restoreOutput?.(); await rm(dir, { recursive: true, force: true }); });

  it("creates, waits and streams the exact bytes before publishing success", async (t) => {
    enableTimerMock(t);
    let started!: () => void;
    const polling = new Promise<void>(resolve => { started = resolve; });
    const mock = setupMockFetch({ responses: [
      created(), () => { started(); return jsonResponse({ code: 0, data: { result: { job_status: 2 } } }); },
      completed(content.length), new Response(new ReadableStream({ start(controller) {
        controller.enqueue(content.subarray(0, 4)); controller.enqueue(content.subarray(4)); controller.close();
      } })),
    ] });
    restore = mock.restore;
    const promise = exportSheet(auth, { spreadsheetToken: token, outputPath: path });
    // Wait for the query, then let its response schedule the polling delay.
    await polling;
    await setImmediate();
    assert.equal(mock.calls.length, 2);
    t.mock.timers.tick(2000);
    const result = await promise;
    assert.deepEqual(result, { path, format: "xlsx", size: content.length });
    assert.deepEqual(await readFile(path), content);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.deepEqual(await readdir(dir), ["output.xlsx"]);
    assert.equal(mock.calls.filter((call) => call.init?.method === "POST").length, 1);
    assert.equal(new URL(mock.calls[1].url).searchParams.get("token"), token);
    assert.deepEqual(JSON.parse(mock.calls[0].init!.body as string), { token, type: "sheet", file_extension: "xlsx" });
  });

  it("refuses an existing or concurrently created destination without overwriting", async () => {
    await writeFile(path, "user work");
    const noCalls = setupMockFetch({ responses: [] }); restore = noCalls.restore;
    await assert.rejects(() => exportSheet(auth, { spreadsheetToken: token, outputPath: path }), (e: any) => !!e.recovery);
    assert.equal(noCalls.calls.length, 0);
    assert.equal(await readFile(path, "utf8"), "user work");
    restore();
    await rm(path);
    ({ restore } = setupMockFetch({ responses: [created(), completed(content.length), () => new Response(new ReadableStream({ async start(controller) {
      await writeFile(path, "concurrent work"); controller.enqueue(content); controller.close();
    } }))] }));
    await assert.rejects(() => exportSheet(auth, { spreadsheetToken: token, outputPath: path }));
    assert.equal(await readFile(path, "utf8"), "concurrent work");
    assert.deepEqual(await readdir(dir), ["output.xlsx"]);
  });

  it("does not retry an uncertain create or leave temporary files", async () => {
    const mock = setupMockFetch({ responses: [() => { throw new TypeError("connection reset"); }] }); restore = mock.restore;
    await assert.rejects(() => exportSheet(auth, { spreadsheetToken: token, outputPath: path }), { errorType: "API_ERROR" });
    assert.equal(mock.calls.length, 1);
    assert.deepEqual(await readdir(dir), []);
  });

  it("maps terminal and malformed job results without downloading", async () => {
    for (const [status, type] of [[3, "API_ERROR"], [109, "PERMISSION_DENIED"], [110, "PERMISSION_DENIED"], [111, "NOT_FOUND"], [123, "NOT_FOUND"], [999, "API_ERROR"]] as const) {
      const mock = setupMockFetch({ responses: [created(), completed(1, { job_status: status, job_error_msg: "failed" })] }); restore = mock.restore;
      await assert.rejects(() => exportSheet(auth, { spreadsheetToken: token, outputPath: path }), (e: any) =>
        e.errorType === type && e.message.includes(String(status)) && !!e.recovery);
      assert.equal(mock.calls.length, 2);
      assert.deepEqual(await readdir(dir), []);
      restore();
    }
    for (const extra of [{ file_token: "../bad" }, { file_size: -1 }, { file_token: undefined }, { type: "docx" }]) {
      ({ restore } = setupMockFetch({ responses: [created(), completed(1, extra)] }));
      await assert.rejects(() => exportSheet(auth, { spreadsheetToken: token, outputPath: path }));
      assert.deepEqual(await readdir(dir), []);
      restore();
    }
  });

  it("rejects an error response or size mismatch instead of publishing xlsx", async () => {
    for (const response of [jsonResponse({ code: 1069902, msg: "no permission" }), new Response(content.subarray(0, 4))]) {
      ({ restore } = setupMockFetch({ responses: [created(), completed(content.length), response] }));
      await assert.rejects(() => exportSheet(auth, { spreadsheetToken: token, outputPath: path }), (e: any) => !!e.recovery);
      assert.deepEqual(await readdir(dir), []);
      restore();
    }
  });

  it("bounds in-flight job queries by the remaining wait deadline", async (t) => {
    enableTimerMock(t);
    const original = globalThis.fetch;
    let calls = 0;
    let started!: () => void;
    const polling = new Promise<void>(resolve => { started = resolve; });
    globalThis.fetch = async (_input, init) => {
      calls++;
      if (calls === 1) return created();
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
        started();
      });
    };
    restore = () => { globalThis.fetch = original; };
    const promise = exportSheet(auth, { spreadsheetToken: token, outputPath: path, waitTimeoutMs: 50 });
    const assertion = assert.rejects(promise, (e: any) => /1234567/.test(e.message) && /超时/.test(e.message));
    await polling;
    assert.equal(calls, 2);
    t.mock.timers.tick(50);
    await assertion;
    assert.deepEqual(await readdir(dir), []);
  });

  it("validates export arguments and returns a JSON file result from the command", async () => {
    await withCleanEnv({ FEISHU_USER_TOKEN: "test-user", FEISHU_APP_ID: undefined, FEISHU_APP_SECRET: undefined }, async () => {
      for (const args of [{ output: undefined }, { format: "csv", output: path }, { sheet: "s1", output: path }, { range: "A1:B2", output: path }]) {
        await assert.rejects(() => exportMeta.handler({ positionals: [`https://example.feishu.cn/sheets/${token}`], ...args }, makeGlobalOpts({ json: true })), { errorType: "INVALID_ARGS" });
      }
      ({ restore } = setupMockFetch({ responses: [created(), completed(content.length), new Response(content)] }));
      const out = captureOutput(); restoreOutput = out.restore;
      await exportMeta.handler({ positionals: [token], type: "sheet", output: path }, makeGlobalOpts({ json: true }));
      assert.deepEqual(JSON.parse(out.stdout()), { success: true, type: "sheet", format: "xlsx", path, size: content.length });
      assert.deepEqual(await readFile(path), content);
    });
  });
  it("retries queries and restarts an interrupted download without recreating the task", async () => {
    let pulls = 0;
    const mock = setupMockFetch({ responses: [created(), jsonResponse({ code: 1 }, 503), completed(content.length),
      () => new Response(new ReadableStream({ pull(controller) {
        if (pulls++ === 0) controller.enqueue(content.subarray(0, 4));
        else controller.error(new TypeError("connection reset"));
      } })), new Response(content)] }); restore = mock.restore;
    await exportSheet(auth, { spreadsheetToken: token, outputPath: path });
    assert.deepEqual(await readFile(path), content);
    assert.equal(mock.calls.filter(call => call.init?.method === "POST").length, 1);
    assert.equal(mock.calls.filter(call => call.url.endsWith("/download")).length, 2);
    assert.deepEqual(await readdir(dir), ["output.xlsx"]);
  });

  it("recovers only the failed step and verifies that the user has not changed", async () => {
    for (const changed of [false, true]) {
      const identity = (id: string) => jsonResponse({ code: 0, data: { open_id: id, tenant_key: "tenant1" } });
      const mock = setupMockFetch({ responses: [identity("user1"), created(),
        jsonResponse({ code: 99991679, msg: "scope missing" }), identity(changed ? "user2" : "user1"),
        completed(content.length), new Response(content)] }); restore = mock.restore;
      let recovered = 0;
      const promise = exportSheet(auth, { spreadsheetToken: token, outputPath: path }, {
        async recoverAuth() { recovered++; return { ...auth, userToken: "new-token" }; },
      });
      if (changed) {
        await assert.rejects(promise, (e: any) => e.errorType === "AUTH_REQUIRED" && !!e.recovery);
        assert.deepEqual(await readdir(dir), []);
        assert.equal(mock.calls.length, 4);
      } else {
        await promise;
        assert.deepEqual(await readFile(path), content);
        assert.equal(mock.calls[4].init?.headers && (mock.calls[4].init!.headers as Record<string, string>).Authorization, "Bearer new-token");
        await rm(path);
      }
      assert.equal(recovered, 1);
      assert.equal(mock.calls.filter(call => call.init?.method === "POST").length, 1);
      restore();
    }
  });

  it("stops Retry-After at the wait deadline and cleans up on cancellation", async (t) => {
    enableTimerMock(t);
    let started!: () => void;
    const polling = new Promise<void>(resolve => { started = resolve; });
    const mock = setupMockFetch({ responses: [created(), () => {
      started(); return new Response("busy", { status: 429, headers: { "Retry-After": "30" } });
    }] }); restore = mock.restore;
    const promise = exportSheet(auth, { spreadsheetToken: token, outputPath: path, waitTimeoutMs: 50 });
    const assertion = assert.rejects(promise, /超时/);
    await polling;
    await setImmediate();
    t.mock.timers.tick(50);
    await assertion;
    assert.equal(mock.calls.length, 2);
    assert.deepEqual(await readdir(dir), []);
  });

  it("cleans up when authorization is cancelled while retaining the original ticket", async () => {
    const controller = new AbortController();
    const mock = setupMockFetch({ responses: [jsonResponse({ code: 0, data: { open_id: "u1", tenant_key: "t1" } }),
      created(), jsonResponse({ code: 99991679 })] }); restore = mock.restore;
    let started!: () => void;
    const recoveryStarted = new Promise<void>(resolve => { started = resolve; });
    const promise = exportSheet(auth, { spreadsheetToken: token, outputPath: path, signal: controller.signal }, {
      async recoverAuth(_auth, error, signal) {
        assert.ok(signal instanceof AbortSignal);
        started();
        await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
        throw error;
      },
    });
    const assertion = assert.rejects(promise, /取消/);
    await recoveryStarted;
    controller.abort();
    await assertion;
    assert.equal(mock.calls.filter(call => call.init?.method === "POST").length, 1);
    assert.deepEqual(await readdir(dir), []);
  });

  it("exhausts download retries without retaining partial data", async () => {
    const interrupted = () => new Response(new ReadableStream({ start(controller) { controller.error(new TypeError("reset")); } }));
    const mock = setupMockFetch({ responses: [created(), completed(content.length), interrupted, interrupted, interrupted] }); restore = mock.restore;
    await assert.rejects(exportSheet(auth, { spreadsheetToken: token, outputPath: path }), { errorType: "API_ERROR" });
    assert.equal(mock.calls.length, 5);
    assert.deepEqual(await readdir(dir), []);
  });

  it("cancels a stalled response body and removes the partial file", async () => {
    const controller = new AbortController();
    let started!: () => void;
    const downloading = new Promise<void>(resolve => { started = resolve; });
    let cancelled = false;
    const mock = setupMockFetch({ responses: [created(), completed(content.length), () => new Response(new ReadableStream({
      start(stream) { stream.enqueue(content.subarray(0, 4)); started(); }, cancel() { cancelled = true; },
    }))] }); restore = mock.restore;
    const assertion = assert.rejects(exportSheet(auth, { spreadsheetToken: token, outputPath: path, signal: controller.signal }), { errorType: "API_ERROR" });
    await downloading;
    await setImmediate();
    controller.abort();
    await assertion;
    assert.equal(cancelled, true);
    assert.deepEqual(await readdir(dir), []);
  });

  it("allows only an explicit scope rejection to retry creation after same-user recovery", async () => {
    const identity = () => jsonResponse({ code: 0, data: { open_id: "u1", tenant_key: "t1" } });
    const mock = setupMockFetch({ responses: [identity(), jsonResponse({ code: 99991679 }), identity(), created(), completed(content.length), new Response(content)] }); restore = mock.restore;
    await exportSheet(auth, { spreadsheetToken: token, outputPath: path }, {
      async recoverAuth() { return { ...auth, userToken: "renewed-token" }; },
    });
    assert.equal(mock.calls.filter(call => call.init?.method === "POST").length, 2);
    assert.deepEqual(await readFile(path), content);
  });

  it("preserves specific REST errors and does not retry a refused authorization", async () => {
    for (const [code, errorType] of [[1069902, "PERMISSION_DENIED"], [1069906, "NOT_FOUND"]]) {
      const mock = setupMockFetch({ responses: [jsonResponse({ code })] }); restore = mock.restore;
      await assert.rejects(() => exportSheet(auth, { spreadsheetToken: token, outputPath: path }), { errorType, apiCode: code });
      assert.equal(mock.calls.length, 1);
      restore();
    }
    const mock = setupMockFetch({ responses: [jsonResponse({ code: 0, data: { open_id: "u1", tenant_key: "t1" } }), created(), jsonResponse({ code: 99991679 })] }); restore = mock.restore;
    let recoveries = 0;
    await assert.rejects(() => exportSheet(auth, { spreadsheetToken: token, outputPath: path }, {
      async recoverAuth(_auth, error) { recoveries++; throw error; },
    }), { errorType: "SCOPE_MISSING" });
    assert.equal(recoveries, 1);
    assert.equal(mock.calls.filter(call => call.init?.method === "POST").length, 1);
    assert.deepEqual(await readdir(dir), []);
  });

});
