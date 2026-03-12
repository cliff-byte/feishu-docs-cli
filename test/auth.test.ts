import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildAuthorizationUrl,
  resolveOAuthCallbackConfig,
} from "../src/auth.js";

describe("resolveOAuthCallbackConfig", () => {
  it("uses the default localhost callback", () => {
    const config = resolveOAuthCallbackConfig();

    assert.deepEqual(config, {
      redirectUri: "http://127.0.0.1:3456/callback",
      callbackHost: "127.0.0.1",
      callbackPath: "/callback",
      callbackPort: 3456,
    });
  });

  it("accepts a custom local redirect uri", () => {
    const config = resolveOAuthCallbackConfig({
      redirectUri: "http://127.0.0.1:4567/feishu/callback",
    });

    assert.deepEqual(config, {
      redirectUri: "http://127.0.0.1:4567/feishu/callback",
      callbackHost: "127.0.0.1",
      callbackPath: "/feishu/callback",
      callbackPort: 4567,
    });
  });

  it("rejects non-local redirect uris", () => {
    assert.throws(
      () =>
        resolveOAuthCallbackConfig({
          redirectUri: "https://example.com/callback",
        }),
      /redirect_uri 必须使用本机回调地址/,
    );
  });

  it("rejects redirect uris with query or hash", () => {
    assert.throws(
      () =>
        resolveOAuthCallbackConfig({
          redirectUri: "http://localhost:3456/callback?foo=bar",
        }),
      /redirect_uri 不能包含 query 或 hash/,
    );
  });
});

describe("buildAuthorizationUrl", () => {
  it("includes redirect_uri, state, and scope", () => {
    const url = new URL(
      buildAuthorizationUrl({
        appId: "cli_test",
        redirectUri: "http://localhost:3456/callback",
        scope: "wiki:wiki docx:document drive:drive",
        state: "state-123",
      }),
    );

    assert.equal(
      `${url.origin}${url.pathname}`,
      "https://open.feishu.cn/open-apis/authen/v1/authorize",
    );
    assert.equal(url.searchParams.get("app_id"), "cli_test");
    assert.equal(
      url.searchParams.get("redirect_uri"),
      "http://localhost:3456/callback",
    );
    assert.equal(
      url.searchParams.get("scope"),
      "wiki:wiki docx:document drive:drive",
    );
    assert.equal(url.searchParams.get("state"), "state-123");
  });
});
