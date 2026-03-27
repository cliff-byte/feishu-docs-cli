/**
 * Tests for share command helper functions and integration tests.
 * Imports actual production functions from share.js.
 *
 * Integration tests cover: list (JSON + human), add (success + fallback + missing args),
 * remove, update, set (success + missing --public).
 *
 * Mock strategy: globalThis.fetch level (D-01). Each fetchWithAuth call
 * on tenant mode consumes 2 responses (getTenantToken + API call).
 * All describe blocks use { concurrency: 1 } (D-07).
 */

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mapRole, mapPublicMode, meta } from "../src/commands/share.js";
import { detectMemberType } from "../src/utils/member.js";
import { CliError } from "../src/utils/errors.js";
import {
  setupMockFetch,
  jsonResponse,
  tenantTokenResponse,
} from "./helpers/mock-fetch.js";
import { makeGlobalOpts } from "./helpers/factory.js";
import { withCleanEnv } from "./helpers/env-guard.js";
import { captureOutput } from "./helpers/capture-output.js";

describe("detectMemberType", () => {
  it("should detect email", () => {
    assert.equal(detectMemberType("user@example.com"), "email");
  });

  it("should detect openid", () => {
    assert.equal(detectMemberType("ou_abc123"), "openid");
  });

  it("should detect unionid", () => {
    assert.equal(detectMemberType("on_abc123"), "unionid");
  });

  it("should detect openchat", () => {
    assert.equal(detectMemberType("oc_abc123"), "openchat");
  });

  it("should default to userid", () => {
    assert.equal(detectMemberType("user123"), "userid");
  });
});

describe("mapRole", () => {
  it("should map view", () => {
    assert.equal(mapRole("view"), "view");
  });

  it("should map edit", () => {
    assert.equal(mapRole("edit"), "edit");
  });

  it("should map manage to full_access", () => {
    assert.equal(mapRole("manage"), "full_access");
  });

  it("should throw for unknown role", () => {
    assert.throws(() => mapRole("admin"), /INVALID_ARGS|无效的角色/);
  });
});

describe("mapPublicMode", () => {
  it("should map closed", () => {
    assert.equal(mapPublicMode("closed"), "closed");
  });

  it("should map tenant view", () => {
    assert.equal(mapPublicMode("tenant", "view"), "tenant_readable");
  });

  it("should map tenant edit", () => {
    assert.equal(mapPublicMode("tenant", "edit"), "tenant_editable");
  });

  it("should map open view", () => {
    assert.equal(mapPublicMode("open", "view"), "anyone_readable");
  });

  it("should map open edit", () => {
    assert.equal(mapPublicMode("open", "edit"), "anyone_editable");
  });

  it("should default tenant to readable", () => {
    assert.equal(mapPublicMode("tenant"), "tenant_readable");
  });

  it("should throw for unknown mode", () => {
    assert.throws(
      () => mapPublicMode("private"),
      /INVALID_ARGS|无效的公开模式/,
    );
  });
});

// ── Integration tests for share subcommands ──

describe("share list", { concurrency: 1 }, () => {
  let output: ReturnType<typeof captureOutput>;
  let mockRestore: () => void;

  afterEach(() => {
    output?.restore();
    mockRestore?.();
  });

  it("share list --json returns members", async () => {
    await withCleanEnv(
      {
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        const { restore } = setupMockFetch({
          responses: [
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: {
                members: [
                  {
                    member_type: "email",
                    member_id: "user@test.com",
                    perm: "view",
                  },
                ],
              },
            }),
          ],
        });
        mockRestore = restore;

        output = captureOutput();
        await meta.subcommands.list.handler(
          { positionals: ["https://example.feishu.cn/docx/abc123"] },
          makeGlobalOpts({ json: true }),
        );

        const json = output.stdoutJson() as Record<string, unknown>;
        assert.equal(json.success, true);
        assert.ok(Array.isArray(json.members));
        assert.equal(
          (json.members as Array<Record<string, string>>)[0].member_id,
          "user@test.com",
        );
      },
    );
  });

  it("share list human-readable shows member info", async () => {
    await withCleanEnv(
      {
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        const { restore } = setupMockFetch({
          responses: [
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: {
                members: [
                  {
                    member_type: "email",
                    member_id: "user@test.com",
                    member_name: "Test User",
                    perm: "view",
                  },
                ],
              },
            }),
          ],
        });
        mockRestore = restore;

        output = captureOutput();
        await meta.subcommands.list.handler(
          { positionals: ["https://example.feishu.cn/docx/abc123"] },
          makeGlobalOpts({ json: false }),
        );

        const out = output.stdout();
        assert.ok(out.includes("Test User"), `Expected "Test User" in: ${out}`);
        assert.ok(out.includes("view"), `Expected "view" in: ${out}`);
      },
    );
  });
});

describe("share add", { concurrency: 1 }, () => {
  let output: ReturnType<typeof captureOutput>;
  let mockRestore: () => void;

  afterEach(() => {
    output?.restore();
    mockRestore?.();
  });

  it("share add --json success", async () => {
    await withCleanEnv(
      {
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        const { restore } = setupMockFetch({
          responses: [
            // fetchWithAuth: getTenantToken + POST add member
            tenantTokenResponse(),
            jsonResponse({ code: 0, data: {} }),
          ],
        });
        mockRestore = restore;

        output = captureOutput();
        await meta.subcommands.add.handler(
          {
            positionals: [
              "https://example.feishu.cn/docx/abc123",
              "user@test.com",
            ],
            role: "view",
          },
          makeGlobalOpts({ json: true }),
        );

        const json = output.stdoutJson() as Record<string, unknown>;
        assert.equal(json.success, true);
        assert.equal(json.member_id, "user@test.com");
        assert.equal(json.perm, "view");
      },
    );
  });

  it("share add fallback to update on error 1201003", async () => {
    await withCleanEnv(
      {
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        const { restore } = setupMockFetch({
          responses: [
            // First fetchWithAuth: getTenantToken + POST add member returns 1201003
            tenantTokenResponse(),
            jsonResponse({
              code: 1201003,
              msg: "member already exists",
            }),
            // Fallback fetchWithAuth: getTenantToken + PUT update member
            tenantTokenResponse(),
            jsonResponse({ code: 0, data: {} }),
          ],
        });
        mockRestore = restore;

        output = captureOutput();
        await meta.subcommands.add.handler(
          {
            positionals: [
              "https://example.feishu.cn/docx/abc123",
              "user@test.com",
            ],
            role: "edit",
          },
          makeGlobalOpts({ json: true }),
        );

        const json = output.stdoutJson() as Record<string, unknown>;
        assert.equal(json.success, true);
        assert.equal(json.member_id, "user@test.com");
      },
    );
  });

  it("share add missing member throws INVALID_ARGS", async () => {
    await assert.rejects(
      () =>
        meta.subcommands.add.handler(
          {
            positionals: ["https://example.feishu.cn/docx/abc123"],
          },
          makeGlobalOpts(),
        ),
      (err: unknown) => {
        assert.ok(err instanceof CliError);
        assert.equal(err.errorType, "INVALID_ARGS");
        return true;
      },
    );
  });
});

describe("share remove", { concurrency: 1 }, () => {
  let output: ReturnType<typeof captureOutput>;
  let mockRestore: () => void;

  afterEach(() => {
    output?.restore();
    mockRestore?.();
  });

  it("share remove --json success", async () => {
    await withCleanEnv(
      {
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        const { restore } = setupMockFetch({
          responses: [
            tenantTokenResponse(),
            jsonResponse({ code: 0, data: {} }),
          ],
        });
        mockRestore = restore;

        output = captureOutput();
        await meta.subcommands.remove.handler(
          {
            positionals: [
              "https://example.feishu.cn/docx/abc123",
              "user@test.com",
            ],
          },
          makeGlobalOpts({ json: true }),
        );

        const json = output.stdoutJson() as Record<string, unknown>;
        assert.equal(json.success, true);
        assert.equal(json.member_id, "user@test.com");
        assert.equal(json.action, "removed");
      },
    );
  });
});

describe("share update", { concurrency: 1 }, () => {
  let output: ReturnType<typeof captureOutput>;
  let mockRestore: () => void;

  afterEach(() => {
    output?.restore();
    mockRestore?.();
  });

  it("share update --json success", async () => {
    await withCleanEnv(
      {
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        const { restore } = setupMockFetch({
          responses: [
            tenantTokenResponse(),
            jsonResponse({ code: 0, data: {} }),
          ],
        });
        mockRestore = restore;

        output = captureOutput();
        await meta.subcommands.update.handler(
          {
            positionals: [
              "https://example.feishu.cn/docx/abc123",
              "user@test.com",
            ],
            role: "edit",
          },
          makeGlobalOpts({ json: true }),
        );

        const json = output.stdoutJson() as Record<string, unknown>;
        assert.equal(json.success, true);
        assert.equal(json.member_id, "user@test.com");
        assert.equal(json.perm, "edit");
      },
    );
  });
});

describe("share set", { concurrency: 1 }, () => {
  let output: ReturnType<typeof captureOutput>;
  let mockRestore: () => void;

  afterEach(() => {
    output?.restore();
    mockRestore?.();
  });

  it("share set --json success", async () => {
    await withCleanEnv(
      {
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        const { restore } = setupMockFetch({
          responses: [
            tenantTokenResponse(),
            jsonResponse({ code: 0, data: {} }),
          ],
        });
        mockRestore = restore;

        output = captureOutput();
        await meta.subcommands.set.handler(
          {
            positionals: ["https://example.feishu.cn/docx/abc123"],
            public: "tenant",
          },
          makeGlobalOpts({ json: true }),
        );

        const json = output.stdoutJson() as Record<string, unknown>;
        assert.equal(json.success, true);
        assert.equal(json.link_share_entity, "tenant_readable");
      },
    );
  });

  it("share set missing --public throws INVALID_ARGS", async () => {
    await assert.rejects(
      () =>
        meta.subcommands.set.handler(
          { positionals: ["https://example.feishu.cn/docx/abc123"] },
          makeGlobalOpts(),
        ),
      (err: unknown) => {
        assert.ok(err instanceof CliError);
        assert.equal(err.errorType, "INVALID_ARGS");
        return true;
      },
    );
  });
});
