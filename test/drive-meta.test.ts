/**
 * Tests for the Drive metadata service (PHASE 2).
 * Verifies the batch_query POST shape and field mapping for standalone docs.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getDriveMeta } from "../src/services/drive-meta.js";
import { setupMockFetch, jsonResponse } from "./helpers/mock-fetch.js";
import { makeUserAuthInfo } from "./helpers/factory.js";

describe("getDriveMeta", { concurrency: 1 }, () => {
  it("POSTs request_docs and maps owner/create/modify fields", async () => {
    const auth = makeUserAuthInfo();
    const { calls, restore } = setupMockFetch({
      responses: [
        jsonResponse({
          code: 0,
          data: {
            metas: [
              {
                doc_token: "d1",
                doc_type: "docx",
                title: "Standalone Doc",
                owner_id: "ou_owner",
                create_time: "1700000000",
                latest_modify_time: "1700009999",
                latest_modify_user: "ou_modifier",
              },
            ],
          },
        }),
      ],
    });

    try {
      const m = await getDriveMeta(auth, "d1", "docx");
      assert.equal(m.owner, "ou_owner");
      assert.equal(m.createTime, "1700000000");
      assert.equal(m.modifyTime, "1700009999");
      assert.equal(m.latestModifyUser, "ou_modifier");

      assert.ok(calls[0].url.includes("/open-apis/drive/v1/metas/batch_query"));
      assert.equal(calls[0].init?.method, "POST");
      const body = JSON.parse(calls[0].init?.body as string);
      assert.equal(body.request_docs[0].doc_token, "d1");
      assert.equal(body.request_docs[0].doc_type, "docx");
    } finally {
      restore();
    }
  });

  it("returns undefined fields when metas is empty", async () => {
    const auth = makeUserAuthInfo();
    const { restore } = setupMockFetch({
      responses: [jsonResponse({ code: 0, data: { metas: [] } })],
    });

    try {
      const m = await getDriveMeta(auth, "d1", "docx");
      assert.equal(m.owner, undefined);
      assert.equal(m.createTime, undefined);
      assert.equal(m.modifyTime, undefined);
    } finally {
      restore();
    }
  });
});
