/**
 * Integration tests for the search command.
 *
 * Tests cover: user auth mode JSON results, missing query validation,
 * invalid limit validation, type filter, and human-readable output.
 *
 * Search requires user auth mode — test with FEISHU_USER_TOKEN env var.
 * In user mode, fetchWithAuth uses the user token directly without
 * calling getTenantToken (only 1 fetch per API call).
 *
 * Mock strategy: globalThis.fetch level (D-01).
 * All describe blocks use { concurrency: 1 } (D-07).
 */

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  setupMockFetch,
  jsonResponse,
} from "./helpers/mock-fetch.js";
import { makeGlobalOpts } from "./helpers/factory.js";
import { withCleanEnv } from "./helpers/env-guard.js";
import { captureOutput } from "./helpers/capture-output.js";
import { search } from "../src/commands/search.js";
import { CliError } from "../src/utils/errors.js";

describe("search command", { concurrency: 1 }, () => {
  let output: ReturnType<typeof captureOutput>;
  let mockRestore: () => void;

  afterEach(() => {
    output?.restore();
    mockRestore?.();
  });

  it("search --json returns results in user mode", async () => {
    await withCleanEnv(
      {
        FEISHU_USER_TOKEN: "u-test-token",
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret",
      },
      async () => {
        // In user mode, fetchWithAuth uses user token directly — no tenantTokenResponse needed.
        // But resolveBearer checks userToken first, so only 1 fetch call for the API.
        const { restore } = setupMockFetch({
          responses: [
            jsonResponse({
              code: 0,
              data: {
                docs_entities: [
                  {
                    docs_token: "doc1",
                    docs_type: "docx",
                    title: "Found Doc",
                    owner_id: "ou_user1",
                  },
                ],
                has_more: false,
              },
            }),
          ],
        });
        mockRestore = restore;

        output = captureOutput();
        await search(
          { positionals: ["test query"] },
          makeGlobalOpts({ json: true }),
        );

        const json = output.stdoutJson() as Record<string, unknown>;
        assert.equal(json.success, true);
        assert.equal(json.query, "test query");
        assert.equal(json.count, 1);
        assert.ok(Array.isArray(json.items));
        const items = json.items as Array<Record<string, string>>;
        assert.equal(items[0].title, "Found Doc");
        assert.equal(items[0].token, "doc1");
      },
    );
  });

  it("search missing query throws INVALID_ARGS", async () => {
    await assert.rejects(
      () => search({ positionals: [] }, makeGlobalOpts()),
      (err: unknown) => {
        assert.ok(err instanceof CliError);
        assert.equal(err.errorType, "INVALID_ARGS");
        return true;
      },
    );
  });

  it("search invalid --limit throws INVALID_ARGS", async () => {
    await assert.rejects(
      () =>
        search(
          { positionals: ["query"], limit: "0" },
          makeGlobalOpts(),
        ),
      (err: unknown) => {
        assert.ok(err instanceof CliError);
        assert.equal(err.errorType, "INVALID_ARGS");
        return true;
      },
    );
  });

  it("search --type filters results", async () => {
    await withCleanEnv(
      {
        FEISHU_USER_TOKEN: "u-test-token",
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret",
      },
      async () => {
        const { calls, restore } = setupMockFetch({
          responses: [
            jsonResponse({
              code: 0,
              data: {
                docs_entities: [
                  {
                    docs_token: "doc2",
                    docs_type: "docx",
                    title: "Typed Doc",
                    owner_id: "ou_user2",
                  },
                ],
                has_more: false,
              },
            }),
          ],
        });
        mockRestore = restore;

        output = captureOutput();
        await search(
          { positionals: ["query"], type: "docx" },
          makeGlobalOpts({ json: true }),
        );

        // Verify the request body included docs_types
        const apiCall = calls[0];
        assert.ok(apiCall.init?.body, "Expected request body");
        const body = JSON.parse(apiCall.init!.body as string);
        assert.deepEqual(body.docs_types, ["docx"]);

        const json = output.stdoutJson() as Record<string, unknown>;
        assert.equal(json.success, true);
      },
    );
  });

  it("search human-readable mode shows document titles", async () => {
    await withCleanEnv(
      {
        FEISHU_USER_TOKEN: "u-test-token",
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret",
      },
      async () => {
        const { restore } = setupMockFetch({
          responses: [
            jsonResponse({
              code: 0,
              data: {
                docs_entities: [
                  {
                    docs_token: "doc3",
                    docs_type: "docx",
                    title: "My Search Result",
                    owner_id: "ou_user3",
                  },
                ],
                has_more: false,
              },
            }),
          ],
        });
        mockRestore = restore;

        output = captureOutput();
        await search(
          { positionals: ["my query"] },
          makeGlobalOpts({ json: false }),
        );

        const out = output.stdout();
        assert.ok(
          out.includes("My Search Result"),
          `Expected "My Search Result" in: ${out}`,
        );
      },
    );
  });

  it("search in tenant mode throws AUTH_REQUIRED", async () => {
    await withCleanEnv(
      {
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        // No fetch mock needed — createClient resolves to tenant mode,
        // and search throws before any API call.
        await assert.rejects(
          () =>
            search(
              { positionals: ["query"] },
              makeGlobalOpts({ json: true }),
            ),
          (err: unknown) => {
            assert.ok(err instanceof CliError);
            assert.equal(err.errorType, "AUTH_REQUIRED");
            return true;
          },
        );
      },
    );
  });
});
