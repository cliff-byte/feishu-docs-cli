/**
 * Tests for typed API response migration in doc-blocks and wiki-nodes.
 *
 * Verifies that fetchAllBlocks, fetchChildren, and resolveWikiToken
 * work correctly after migration from `as Record<string, unknown>`
 * to typed interfaces (DocxBlocksResponse, WikiChildrenResponse,
 * WikiGetNodeResponse).
 */

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { setupMockFetch, jsonResponse } from "./helpers/mock-fetch.js";
import { makeUserAuthInfo } from "./helpers/factory.js";
import { fetchAllBlocks } from "../src/services/doc-blocks.js";
import { fetchChildren, resolveWikiToken } from "../src/services/wiki-nodes.js";
import { CliError } from "../src/utils/errors.js";

describe("fetchAllBlocks (typed)", { concurrency: 1 }, () => {
  let restore: () => void;
  afterEach(() => { if (restore) restore(); });

  it("returns blocks from single page", async () => {
    const mockBlocks = [
      { block_id: "b1", block_type: 1 },
      { block_id: "b2", block_type: 2 },
    ];
    ({ restore } = setupMockFetch({
      responses: [
        jsonResponse({ code: 0, data: { items: mockBlocks, has_more: false } }),
      ],
    }));
    const result = await fetchAllBlocks(makeUserAuthInfo(), "doc123");
    assert.equal(result.length, 2);
    assert.equal(result[0].block_id, "b1");
    assert.equal(result[1].block_id, "b2");
  });

  it("returns blocks from paginated response", async () => {
    ({ restore } = setupMockFetch({
      responses: [
        jsonResponse({
          code: 0,
          data: { items: [{ block_id: "b1", block_type: 1 }], has_more: true, page_token: "pt1" },
        }),
        jsonResponse({
          code: 0,
          data: { items: [{ block_id: "b2", block_type: 2 }], has_more: false },
        }),
      ],
    }));
    const result = await fetchAllBlocks(makeUserAuthInfo(), "doc123");
    assert.equal(result.length, 2);
    assert.equal(result[0].block_id, "b1");
    assert.equal(result[1].block_id, "b2");
  });

  it("returns empty array when no items", async () => {
    ({ restore } = setupMockFetch({
      responses: [
        jsonResponse({ code: 0, data: { has_more: false } }),
      ],
    }));
    const result = await fetchAllBlocks(makeUserAuthInfo(), "doc123");
    assert.equal(result.length, 0);
  });
});

describe("fetchChildren (typed)", { concurrency: 1 }, () => {
  let restore: () => void;
  afterEach(() => { if (restore) restore(); });

  it("returns wiki nodes from single page", async () => {
    const mockNodes = [
      { space_id: "s1", node_token: "n1", obj_token: "o1", obj_type: "docx", title: "Doc 1", has_child: false },
    ];
    ({ restore } = setupMockFetch({
      responses: [
        jsonResponse({ code: 0, data: { items: mockNodes, has_more: false } }),
      ],
    }));
    const result = await fetchChildren(makeUserAuthInfo(), "s1");
    assert.equal(result.length, 1);
    assert.equal(result[0].node_token, "n1");
    assert.equal(result[0].title, "Doc 1");
  });

  it("returns wiki nodes from paginated response", async () => {
    ({ restore } = setupMockFetch({
      responses: [
        jsonResponse({
          code: 0,
          data: {
            items: [{ space_id: "s1", node_token: "n1", obj_token: "o1", obj_type: "docx", title: "Doc 1", has_child: false }],
            has_more: true,
            page_token: "pt1",
          },
        }),
        jsonResponse({
          code: 0,
          data: {
            items: [{ space_id: "s1", node_token: "n2", obj_token: "o2", obj_type: "docx", title: "Doc 2", has_child: true }],
            has_more: false,
          },
        }),
      ],
    }));
    const result = await fetchChildren(makeUserAuthInfo(), "s1");
    assert.equal(result.length, 2);
    assert.equal(result[0].node_token, "n1");
    assert.equal(result[1].node_token, "n2");
  });
});

describe("resolveWikiToken (typed)", { concurrency: 1 }, () => {
  let restore: () => void;
  afterEach(() => { if (restore) restore(); });

  it("returns resolved node with correct fields", async () => {
    ({ restore } = setupMockFetch({
      responses: [
        jsonResponse({
          code: 0,
          data: {
            node: {
              obj_token: "doccnABC",
              obj_type: "docx",
              title: "Test Doc",
              node_token: "wikcnXYZ",
              space_id: "sp123",
              has_child: true,
            },
          },
        }),
      ],
    }));
    const result = await resolveWikiToken(makeUserAuthInfo(), "wikcnXYZ");
    assert.equal(result.objToken, "doccnABC");
    assert.equal(result.objType, "docx");
    assert.equal(result.title, "Test Doc");
    assert.equal(result.nodeToken, "wikcnXYZ");
    assert.equal(result.spaceId, "sp123");
    assert.equal(result.hasChild, true);
  });

  it("throws NOT_FOUND when node is missing", async () => {
    ({ restore } = setupMockFetch({
      responses: [
        jsonResponse({ code: 0, data: {} }),
      ],
    }));
    await assert.rejects(
      () => resolveWikiToken(makeUserAuthInfo(), "wikcnMISSING"),
      (err: unknown) => {
        assert.ok(err instanceof CliError);
        assert.equal(err.errorType, "NOT_FOUND");
        return true;
      },
    );
  });
});
