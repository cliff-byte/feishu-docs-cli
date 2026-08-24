import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  fetchBitableRecord,
  fetchBitableTable,
} from "../src/services/bitable.js";
import { CliError } from "../src/utils/errors.js";
import { makeUserAuthInfo } from "./helpers/factory.js";
import { jsonResponse, setupMockFetch } from "./helpers/mock-fetch.js";

describe("bitable service", { concurrency: 1 }, () => {
  it("paginates fields and view records without losing raw values", async () => {
    const { calls, restore } = setupMockFetch({
      responses: [
        jsonResponse({
          code: 0,
          data: {
            items: [{ field_id: "fld1", field_name: "Name" }],
            has_more: true,
            page_token: "fields-next",
          },
        }),
        jsonResponse({
          code: 0,
          data: {
            items: [
              {
                record_id: "rec1",
                fields: { Name: "Alice", Meta: { active: true } },
              },
            ],
            total: 2,
            has_more: true,
            page_token: "records-next",
          },
        }),
        jsonResponse({
          code: 0,
          data: {
            items: [{ field_id: "fld2", field_name: "Meta" }],
            has_more: false,
          },
        }),
        jsonResponse({
          code: 0,
          data: {
            items: [
              {
                record_id: "rec2",
                fields: { Name: "Bob", Meta: ["x", "y"] },
              },
            ],
            total: 2,
            has_more: false,
          },
        }),
      ],
    });

    try {
      const result = await fetchBitableTable(makeUserAuthInfo(), {
        baseToken: "baseToken",
        tableId: "tblABC",
        viewId: "vewXYZ",
      });

      assert.deepEqual(
        result.fields.map((field) => field.field_name),
        ["Name", "Meta"],
      );
      assert.equal(result.records.length, 2);
      assert.deepEqual(result.records[0].fields.Meta, { active: true });
      assert.deepEqual(result.records[1].fields.Meta, ["x", "y"]);
      assert.equal(result.total, 2);
      const recordCalls = calls.filter((call) =>
        call.url.includes("/records?"),
      );
      assert.equal(recordCalls.length, 2);
      assert.ok(recordCalls.every((call) => call.url.includes("view_id=vewXYZ")));
      assert.ok(recordCalls[1].url.includes("page_token=records-next"));
      const fieldCalls = calls.filter((call) => call.url.includes("/fields?"));
      assert.ok(fieldCalls[1].url.includes("page_token=fields-next"));
    } finally {
      restore();
    }
  });

  it("resolves a record-share token before fetching the real record", async () => {
    const { calls, restore } = setupMockFetch({
      responses: [
        jsonResponse({
          code: 0,
          data: {
            base_token: "baseToken",
            table_id: "tblABC",
            record_id: "recREAL",
            record_share_token: "shareToken",
          },
        }),
        jsonResponse({
          code: 0,
          data: { items: [{ field_id: "fld1", field_name: "Name" }] },
        }),
        jsonResponse({
          code: 0,
          data: { record: { record_id: "recREAL", fields: { Name: "Alice" } } },
        }),
      ],
    });

    try {
      const result = await fetchBitableRecord(makeUserAuthInfo(), "shareToken");
      assert.equal(result.recordId, "recREAL");
      assert.deepEqual(result.record.fields, { Name: "Alice" });
      assert.ok(calls[0].url.includes("/record_share/shareToken/meta"));
      assert.ok(calls[2].url.endsWith("/records/recREAL"));
      assert.ok(!calls[2].url.includes("shareToken"));
    } finally {
      restore();
    }
  });

  it("fails safely when pagination or record-share metadata is incomplete", async () => {
    const auth = makeUserAuthInfo();
    let mock = setupMockFetch({
      responses: [
        jsonResponse({ code: 0, data: { items: [] } }),
        jsonResponse({ code: 0, data: { items: [], has_more: true } }),
      ],
    });
    try {
      await assert.rejects(
        fetchBitableTable(auth, { baseToken: "baseToken", tableId: "tblABC" }),
        (err: unknown) => {
          assert.ok(err instanceof CliError);
          assert.equal(err.errorType, "API_ERROR");
          assert.match(err.recovery || "", /重试/);
          return true;
        },
      );
    } finally {
      mock.restore();
    }

    mock = setupMockFetch({
      responses: [jsonResponse({ code: 0, data: { base_token: "baseToken" } })],
    });
    try {
      await assert.rejects(
        fetchBitableRecord(auth, "shareToken"),
        (err: unknown) => {
          assert.ok(err instanceof CliError);
          assert.equal(err.errorType, "API_ERROR");
          assert.match(err.recovery || "", /重新复制/);
          return true;
        },
      );
    } finally {
      mock.restore();
    }
  });

  it("rejects unsafe path coordinates before making a request", async () => {
    const { calls, restore } = setupMockFetch({ responses: [], strictCount: true });
    try {
      await assert.rejects(
        fetchBitableTable(makeUserAuthInfo(), {
          baseToken: "../secret",
          tableId: "tblABC",
        }),
        /无效的 base_token 格式/,
      );
      assert.equal(calls.length, 0);
    } finally {
      restore();
    }
  });
});
