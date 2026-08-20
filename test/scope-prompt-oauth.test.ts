import { it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promptScopeAuth } from "../src/utils/scope-prompt.js";

it(
  "auto authorization opens OAuth and denial returns immediately",
  { timeout: 3_000 },
  async () => {
    const port = await getFreePort();
    const testHome = await mkdtemp(join(tmpdir(), "feishu-oauth-denial-"));
    const originalEnv = { ...process.env };
    const originalIsTTY = process.stdin.isTTY;
    const originalWrite = process.stderr.write;
    let stderr = "";
    let callbackSent = false;

    try {
      process.env.HOME = testHome;
      process.env.FEISHU_APP_ID = "cli_test";
      process.env.FEISHU_APP_SECRET = "secret";
      process.env.FEISHU_REDIRECT_URI = `http://127.0.0.1:${port}/callback`;
      delete process.env.FEISHU_USER_TOKEN;
      process.env.PATH = "/nonexistent";
      Object.defineProperty(process.stdin, "isTTY", {
        value: true,
        configurable: true,
      });
      process.stderr.write = ((chunk: string | Uint8Array) => {
        stderr += String(chunk);
        const match = stderr.match(/https:\/\/open\.feishu\.cn\/open-apis\/authen\/v1\/authorize\?\S+/);
        if (match && !callbackSent) {
          callbackSent = true;
          const authUrl = new URL(match[0]);
          const redirectUri = authUrl.searchParams.get("redirect_uri")!;
          const state = authUrl.searchParams.get("state")!;
          void fetch(
            `${redirectUri}?error=access_denied&state=${encodeURIComponent(state)}`,
          );
        }
        return true;
      }) as typeof process.stderr.write;

      const startedAt = Date.now();
      const authorized = await promptScopeAuth(
        ["task:task:read"],
        { auth: "auto", json: false, lark: false },
        true,
      );

      assert.equal(callbackSent, true);
      assert.equal(authorized, false);
      assert.ok(Date.now() - startedAt < 2_000, "denial should not wait for timeout");
    } finally {
      process.stderr.write = originalWrite;
      Object.defineProperty(process.stdin, "isTTY", {
        value: originalIsTTY,
        configurable: true,
      });
      process.env = originalEnv;
      await rm(testHome, { recursive: true, force: true });
    }
  },
);

async function getFreePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}
