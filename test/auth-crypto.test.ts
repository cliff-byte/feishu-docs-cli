/**
 * Tests for token encryption/decryption round-trip.
 *
 * Covers CORE-04: saveTokens encrypts via AES-256-GCM and loadTokens
 * decrypts back to the original token fields. clearTokens removes the
 * auth file. All tests use temp directories via HOME env var override
 * (os.homedir() respects HOME), never touching ~/.feishu-docs/.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { saveTokens, loadTokens, clearTokens } from "../src/auth.js";
import { withCleanEnv } from "./helpers/env-guard.js";

describe("token encryption/decryption", { concurrency: 1 }, () => {
  it("round-trips save and load preserving all token fields", async () => {
    const testDir = await mkdtemp(join(tmpdir(), "feishu-crypto-rt-"));
    try {
      await withCleanEnv({ HOME: testDir }, async () => {
        const tokenData = {
          user_access_token: "u-roundtrip-access-token-123",
          refresh_token: "rt-roundtrip-refresh-456",
          expires_at: Date.now() + 7200_000,
          token_type: "Bearer",
        };

        await saveTokens("app-roundtrip-id", tokenData);
        const loaded = await loadTokens();

        assert.ok(loaded !== null, "loadTokens should return non-null");
        assert.equal(loaded.appId, "app-roundtrip-id");
        assert.equal(
          loaded.tokens.user_access_token,
          "u-roundtrip-access-token-123",
        );
        assert.equal(loaded.tokens.refresh_token, "rt-roundtrip-refresh-456");
        assert.equal(loaded.tokens.expires_at, tokenData.expires_at);
        assert.equal(loaded.tokens.token_type, "Bearer");
      });
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it("returns null when auth file does not exist", async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), "feishu-crypto-empty-"));
    try {
      await withCleanEnv({ HOME: emptyDir }, async () => {
        const result = await loadTokens();
        assert.equal(result, null);
      });
    } finally {
      await rm(emptyDir, { recursive: true, force: true });
    }
  });

  it("returns null when auth file contains corrupted data", async () => {
    const testDir = await mkdtemp(join(tmpdir(), "feishu-crypto-corrupt-"));
    try {
      await withCleanEnv({ HOME: testDir }, async () => {
        const configDir = join(testDir, ".feishu-docs");
        await mkdir(configDir, { recursive: true });
        await writeFile(
          join(configDir, "auth.json"),
          "not-valid-json-data!!!",
        );

        const result = await loadTokens();
        assert.equal(result, null);
      });
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it("clearTokens removes the auth file", async () => {
    const testDir = await mkdtemp(join(tmpdir(), "feishu-crypto-clear-"));
    try {
      await withCleanEnv({ HOME: testDir }, async () => {
        const tokenData = {
          user_access_token: "u-to-be-cleared",
          refresh_token: "rt-to-be-cleared",
          expires_at: Date.now() + 3600_000,
        };

        await saveTokens("app-clear-id", tokenData);
        const authFilePath = join(testDir, ".feishu-docs", "auth.json");
        assert.ok(
          existsSync(authFilePath),
          "auth file should exist after save",
        );

        await clearTokens();
        assert.ok(
          !existsSync(authFilePath),
          "auth file should not exist after clear",
        );
      });
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it("saveTokens creates config directory if missing", async () => {
    const testDir = await mkdtemp(join(tmpdir(), "feishu-crypto-mkdir-"));
    try {
      await withCleanEnv({ HOME: testDir }, async () => {
        const configDir = join(testDir, ".feishu-docs");
        assert.ok(
          !existsSync(configDir),
          "config dir should not exist before save",
        );

        const tokenData = {
          user_access_token: "u-mkdir-test",
          refresh_token: "rt-mkdir-test",
          expires_at: Date.now() + 3600_000,
        };

        await saveTokens("app-mkdir-id", tokenData);
        assert.ok(
          existsSync(configDir),
          "config dir should exist after save",
        );
        assert.ok(
          existsSync(join(configDir, "auth.json")),
          "auth file should exist after save",
        );
      });
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });
});
