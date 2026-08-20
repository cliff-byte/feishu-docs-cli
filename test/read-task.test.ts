import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { read } from "../src/commands/read.js";
import { captureOutput } from "./helpers/capture-output.js";
import { withCleanEnv } from "./helpers/env-guard.js";
import { makeGlobalOpts } from "./helpers/factory.js";
import {
  jsonResponse,
  setupMockFetch,
  tenantTokenResponse,
} from "./helpers/mock-fetch.js";

describe("read task enrichment", { concurrency: 1 }, () => {
  let restoreFetch: (() => void) | undefined;
  let restoreOutput: (() => void) | undefined;
  let testDir: string | undefined;

  afterEach(async () => {
    restoreOutput?.();
    restoreFetch?.();
    if (testDir) await rm(testDir, { recursive: true, force: true });
  });

  it("renders docs_ai task tags as Markdown tasks", async () => {
    testDir = await mkdtemp(join(tmpdir(), "feishu-read-task-"));
    await withCleanEnv(
      {
        HOME: testDir,
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        const mock = setupMockFetch({
          responses: [
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: {
                document: {
                  content:
                    '<task status="success" task-id="0466ef10-d726-467e-9ddd-3dcbdb548b62"></task>',
                },
              },
            }),
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: {
                task: {
                  guid: "0466ef10-d726-467e-9ddd-3dcbdb548b62",
                  summary: "最终确认触发规则和提醒内容",
                  status: "done",
                  completed_at: "1787045742000",
                  members: [
                    { role: "assignee", name: "刘昊", id: "ou_liu" },
                    { role: "follower", name: "旁观者", id: "ou_watch" },
                  ],
                },
              },
            }),
          ],
        });
        restoreFetch = mock.restore;
        const captured = captureOutput();
        restoreOutput = captured.restore;

        await read(
          {
            positionals: ["https://example.feishu.cn/docx/docxTk123456789"],
          },
          makeGlobalOpts(),
        );

        assert.equal(
          captured.stdout(),
          "- [x] 最终确认触发规则和提醒内容 @刘昊",
        );
      },
    );
  });

  it("keeps the task tag and requests only read scope when OAuth is stale", async () => {
    testDir = await mkdtemp(join(tmpdir(), "feishu-read-task-"));
    await withCleanEnv(
      {
        HOME: testDir,
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret",
        FEISHU_USER_TOKEN: undefined,
      },
      async () => {
        const taskTag =
          '<task status="success" task-id="0466ef10-d726-467e-9ddd-3dcbdb548b62"></task>';
        const mock = setupMockFetch({
          responses: [
            tenantTokenResponse(),
            jsonResponse({
              code: 0,
              data: { document: { content: taskTag } },
            }),
            tenantTokenResponse(),
            jsonResponse({
              code: 99991679,
              msg: "missing scope",
              error: {
                permission_violations: [
                  { subject: "task:task:read" },
                  { subject: "task:task:write" },
                ],
              },
            }),
          ],
        });
        restoreFetch = mock.restore;
        const captured = captureOutput();
        restoreOutput = captured.restore;

        await read(
          {
            positionals: ["https://example.feishu.cn/docx/docxTk123456789"],
          },
          makeGlobalOpts({ json: true }),
        );

        assert.equal(captured.stdout(), taskTag);
        assert.match(captured.stderr(), /task:task:read/);
        assert.doesNotMatch(captured.stderr(), /task:task:write/);
      },
    );
  });
});
