/**
 * Integration tests for the create command.
 *
 * Tests cover: missing title validation, drive create --json, wiki create --json,
 * create with --body content, and human-readable mode.
 *
 * Mock strategy: globalThis.fetch level (D-01). Each fetchWithAuth call
 * on tenant mode consumes 2 responses (getTenantToken + API call).
 * All describe blocks use { concurrency: 1 } (D-07).
 */

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  setupMockFetch,
  jsonResponse,
  tenantTokenResponse,
} from "./helpers/mock-fetch.js";
import { makeGlobalOpts } from "./helpers/factory.js";
import { withCleanEnv } from "./helpers/env-guard.js";
import { captureOutput } from "./helpers/capture-output.js";
import { CliError } from "../src/utils/errors.js";
import { create } from "../src/commands/create.js";

describe("create command", { concurrency: 1 }, () => {
  let mockRestore: (() => void) | undefined;
  let outputRestore: (() => void) | undefined;
  let testDir: string | undefined;

  afterEach(async () => {
    if (outputRestore) outputRestore();
    if (mockRestore) mockRestore();
    mockRestore = undefined;
    outputRestore = undefined;
    if (testDir) {
      await rm(testDir, { recursive: true, force: true }).catch(() => {});
      testDir = undefined;
    }
  });

  it("create missing title throws INVALID_ARGS", async () => {
    testDir = await mkdtemp(join(tmpdir(), "feishu-create-"));
    await withCleanEnv(
      {
        HOME: testDir,
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        await assert.rejects(
          () => create({ positionals: [] }, makeGlobalOpts()),
          (err: unknown) => {
            assert.ok(err instanceof CliError);
            assert.equal(err.errorType, "INVALID_ARGS");
            return true;
          },
        );
      },
    );
  });

  it("create doc in drive --json mode", async () => {
    testDir = await mkdtemp(join(tmpdir(), "feishu-create-"));
    await withCleanEnv(
      {
        HOME: testDir,
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        // createDoc: fetchWithAuth POST (2 responses)
        const { restore: r } = setupMockFetch({
          responses: [
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: {
                document: {
                  document_id: "newdoc1",
                  title: "Test Doc",
                },
              },
            }),
          ],
        });
        mockRestore = r;

        const cap = captureOutput();
        outputRestore = cap.restore;

        await create(
          { positionals: ["Test Doc"] },
          makeGlobalOpts({ json: true }),
        );

        const result = cap.stdoutJson() as Record<string, unknown>;
        assert.equal(result.success, true);
        assert.equal(result.document_id, "newdoc1");
      },
    );
  });

  it("create doc in wiki --json mode", async () => {
    testDir = await mkdtemp(join(tmpdir(), "feishu-create-"));
    await withCleanEnv(
      {
        HOME: testDir,
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        // createInWiki: fetchWithAuth POST (2 responses)
        const { restore: r } = setupMockFetch({
          responses: [
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: {
                node: {
                  obj_token: "wikiobj1",
                  node_token: "nd1",
                },
              },
            }),
          ],
        });
        mockRestore = r;

        const cap = captureOutput();
        outputRestore = cap.restore;

        await create(
          { positionals: ["Wiki Doc"], wiki: "sp_test" },
          makeGlobalOpts({ json: true }),
        );

        const result = cap.stdoutJson() as Record<string, unknown>;
        assert.equal(result.success, true);
        assert.equal(result.document_id, "wikiobj1");
      },
    );
  });

  it("create doc with --body content", async () => {
    testDir = await mkdtemp(join(tmpdir(), "feishu-create-"));
    const bodyFile = join(testDir, "content.md");
    await writeFile(bodyFile, "Some paragraph content\n");

    await withCleanEnv(
      {
        HOME: testDir,
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        // createDoc (2) + getDocumentInfo (2) + convertAndWrite: convert (2) + writeDescendant (2) = 8 responses
        const { restore: r } = setupMockFetch({
          responses: [
            // createDoc
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: {
                document: {
                  document_id: "newdoc2",
                  title: "Body Doc",
                },
              },
            }),
            // getDocumentInfo
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: {
                document: {
                  document_id: "newdoc2",
                  revision_id: 1,
                  title: "Body Doc",
                },
              },
            }),
            // convert API
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: {
                blocks: [
                  {
                    block_id: "cvt1",
                    block_type: 2,
                    children: [],
                    text: { elements: [] },
                  },
                ],
                first_level_block_ids: ["cvt1"],
                block_id_to_image_urls: {},
              },
            }),
            // writeDescendant API
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: {
                document_revision_id: 2,
              },
            }),
          ],
        });
        mockRestore = r;

        const cap = captureOutput();
        outputRestore = cap.restore;

        await create(
          { positionals: ["Body Doc"], body: bodyFile },
          makeGlobalOpts({ json: true }),
        );

        const result = cap.stdoutJson() as Record<string, unknown>;
        assert.equal(result.success, true);
        assert.equal(result.document_id, "newdoc2");
      },
    );
  });

  it("create doc uploads local markdown images before write", async () => {
    testDir = await mkdtemp(join(tmpdir(), "feishu-create-"));
    const imagesDir = join(testDir, "images");
    const bodyFile = join(testDir, "content-with-image.md");
    const imageFile = join(imagesDir, "demo.png");
    await mkdir(imagesDir, { recursive: true });
    await writeFile(imageFile, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await writeFile(
      bodyFile,
      "Intro paragraph\n\n![Demo](./images/demo.png)\n",
    );

    await withCleanEnv(
      {
        HOME: testDir,
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        let callsRef: ReadonlyArray<{
          url: string;
          init?: RequestInit;
        }> = [];
        const mock = setupMockFetch({
          responses: [
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: {
                document: {
                  document_id: "newdoc-img",
                  title: "Body Doc",
                },
              },
            }),
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: {
                document: {
                  document_id: "newdoc-img",
                  revision_id: 1,
                  title: "Body Doc",
                },
              },
            }),
            tenantTokenResponse(),
            () => {
              const convertCall = callsRef[callsRef.length - 1];
              const body = JSON.parse(convertCall.init?.body as string) as {
                content: string;
              };
              const placeholder = body.content
                .split("\n")
                .find((line) => line.startsWith("FEISHU_DOCS_IMAGE_"));
              assert.ok(placeholder);
              return jsonResponse({
                code: 0,
                data: {
                  blocks: [
                    {
                      block_id: "cvt1",
                      block_type: 2,
                      children: [],
                      text: {
                        elements: [
                          { text_run: { content: "Intro paragraph" } },
                        ],
                      },
                    },
                    {
                      block_id: "cvt2",
                      block_type: 2,
                      children: [],
                      text: {
                        elements: [{ text_run: { content: placeholder } }],
                      },
                    },
                  ],
                  first_level_block_ids: ["cvt1", "cvt2"],
                  block_id_to_image_urls: {},
                },
              });
            },
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: {
                document_revision_id: 2,
                block_id_relations: [
                  {
                    temporary_block_id: "cvt1",
                    block_id: "real-text-1",
                  },
                  {
                    temporary_block_id: "cvt2",
                    block_id: "real-image-1",
                  },
                ],
              },
            }),
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: {
                file_token: "file-token-1",
              },
            }),
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: {
                document_revision_id: 3,
              },
            }),
          ],
        });
        mockRestore = mock.restore;
        callsRef = mock.calls;

        const cap = captureOutput();
        outputRestore = cap.restore;

        await create(
          { positionals: ["Body Doc"], body: bodyFile },
          makeGlobalOpts({ json: true }),
        );

        const uploadCall = callsRef.find((call) =>
          call.url.includes("/open-apis/drive/v1/medias/upload_all"),
        );
        assert.ok(uploadCall);
        assert.ok(uploadCall.init?.body instanceof FormData);
        const uploadForm = uploadCall.init?.body as FormData;
        assert.equal(uploadForm.get("parent_type"), "docx_image");
        assert.equal(uploadForm.get("parent_node"), "real-image-1");
        assert.equal(uploadForm.get("file_name"), "demo.png");

        const descendantCall = callsRef.find((call) =>
          call.url.includes("/descendant"),
        );
        assert.ok(descendantCall);
        const descendantBody = JSON.parse(
          descendantCall.init?.body as string,
        ) as {
          descendants: Array<{
            block_type: number;
            image?: { token: string };
          }>;
        };
        assert.equal(
          descendantBody.descendants.some(
            (block) => block.block_type === 27,
          ),
          true,
        );
        assert.equal(
          descendantBody.descendants.some(
            (block) => block.block_type === 27 && block.image?.token,
          ),
          false,
        );

        const batchUpdateCall = callsRef.find((call) =>
          call.url.includes("/blocks/batch_update"),
        );
        assert.ok(batchUpdateCall);
        const batchUpdateBody = JSON.parse(
          batchUpdateCall.init?.body as string,
        ) as {
          requests: Array<{
            block_id: string;
            replace_image: { token: string };
          }>;
        };
        assert.deepEqual(batchUpdateBody.requests, [
          {
            block_id: "real-image-1",
            replace_image: { token: "file-token-1" },
          },
        ]);

        const result = cap.stdoutJson() as Record<string, unknown>;
        assert.equal(result.success, true);
        assert.equal(result.document_id, "newdoc-img");
      },
    );
  });

  it("create human-readable mode", async () => {
    testDir = await mkdtemp(join(tmpdir(), "feishu-create-"));
    await withCleanEnv(
      {
        HOME: testDir,
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        const { restore: r } = setupMockFetch({
          responses: [
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: {
                document: {
                  document_id: "newdoc3",
                  title: "Human Doc",
                },
              },
            }),
          ],
        });
        mockRestore = r;

        const cap = captureOutput();
        outputRestore = cap.restore;

        await create(
          { positionals: ["Human Doc"] },
          makeGlobalOpts({ json: false }),
        );

        assert.ok(cap.stdout().includes("文档已创建"));
      },
    );
  });
});
