import { it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { oauthLogin } from "../src/auth.js";
import { promptScopeAuth } from "../src/utils/scope-prompt.js";
import { withCleanEnv } from "./helpers/env-guard.js";
import { makeGlobalOpts } from "./helpers/factory.js";

it("cancels OAuth and releases its callback port", { timeout: 3000 }, async () => {
  const probe = createServer();
  await new Promise<void>(resolve => probe.listen(0, "127.0.0.1", resolve));
  const address = probe.address();
  assert.ok(address && typeof address === "object");
  await new Promise<void>(resolve => probe.close(() => resolve()));
  const controller = new AbortController();
  const write = process.stderr.write;
  let started = false;
  try {
    process.stderr.write = ((chunk: string | Uint8Array) => {
      if (String(chunk).includes("等待回调中")) {
        started = true;
        queueMicrotask(() => controller.abort());
      }
      return true;
    }) as typeof process.stderr.write;
    await withCleanEnv({ PATH: "/nonexistent", FEISHU_REDIRECT_URI: undefined }, async () => {
      await assert.rejects(() => oauthLogin("cli_test", {
        appSecret: "test-secret", redirectUri: `http://127.0.0.1:${address.port}/callback`, signal: controller.signal,
      }), { errorType: "AUTH_REQUIRED" });
    });
    assert.equal(started, true);
    const reuse = createServer();
    await new Promise<void>((resolve, reject) => {
      reuse.once("error", reject);
      reuse.listen(address.port, "127.0.0.1", resolve);
    });
    await new Promise<void>(resolve => reuse.close(() => resolve()));
  } finally { process.stderr.write = write; }
});

it("cancels the scope confirmation without opening OAuth or retaining readline listeners", { timeout: 3000 }, async () => {
  const originalTTY = process.stdin.isTTY;
  const write = process.stderr.write;
  const listeners = process.stdin.listenerCount("data");
  const controller = new AbortController();
  try {
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    process.stderr.write = ((chunk: string | Uint8Array) => {
      if (String(chunk).includes("是否现在")) queueMicrotask(() => controller.abort());
      return true;
    }) as typeof process.stderr.write;
    await withCleanEnv({ FEISHU_APP_ID: "cli_test", FEISHU_APP_SECRET: "test-secret", FEISHU_USER_TOKEN: undefined }, async () => {
      assert.equal(await promptScopeAuth(["drive:test"], makeGlobalOpts(), false, controller.signal), false);
    });
    assert.equal(controller.signal.aborted, true);
    assert.equal(process.stdin.listenerCount("data"), listeners);
  } finally {
    process.stderr.write = write;
    Object.defineProperty(process.stdin, "isTTY", { value: originalTTY, configurable: true });
  }
});
