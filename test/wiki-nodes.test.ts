/**
 * Tests for wiki-nodes service: metadata field mapping in resolveWikiToken
 * and fetchChildren. Verifies the creator/timestamp/owner fields the wiki API
 * returns are carried through instead of dropped.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveWikiToken, fetchChildren } from "../src/services/wiki-nodes.js";
import { setupMockFetch, jsonResponse } from "./helpers/mock-fetch.js";
import { makeUserAuthInfo } from "./helpers/factory.js";

describe("resolveWikiToken metadata mapping", { concurrency: 1 }, () => {
  it("maps obj/node times, creator, owner, node_creator", async () => {
    const auth = makeUserAuthInfo();
    const { restore } = setupMockFetch({
      responses: [
        jsonResponse({
          code: 0,
          data: {
            node: {
              obj_token: "doc1",
              obj_type: "docx",
              title: "Doc",
              node_token: "nd1",
              space_id: "sp1",
              has_child: false,
              obj_create_time: "1700000000",
              obj_edit_time: "1700009999",
              node_create_time: "1699990000",
              creator: "ou_creator",
              owner: "ou_owner",
              node_creator: "ou_node_creator",
            },
          },
        }),
      ],
    });

    try {
      const node = await resolveWikiToken(auth, "wiki-token-abc");
      assert.equal(node.objCreateTime, "1700000000");
      assert.equal(node.objEditTime, "1700009999");
      assert.equal(node.nodeCreateTime, "1699990000");
      assert.equal(node.creator, "ou_creator");
      assert.equal(node.owner, "ou_owner");
      assert.equal(node.nodeCreator, "ou_node_creator");
    } finally {
      restore();
    }
  });

  it("leaves metadata fields undefined when the API omits them", async () => {
    const auth = makeUserAuthInfo();
    const { restore } = setupMockFetch({
      responses: [
        jsonResponse({
          code: 0,
          data: {
            node: {
              obj_token: "doc1",
              obj_type: "docx",
              title: "Doc",
              node_token: "nd1",
              space_id: "sp1",
              has_child: false,
            },
          },
        }),
      ],
    });

    try {
      const node = await resolveWikiToken(auth, "wiki-token-abc");
      assert.equal(node.objCreateTime, undefined);
      assert.equal(node.creator, undefined);
      assert.equal(node.owner, undefined);
    } finally {
      restore();
    }
  });
});

describe("fetchChildren preserves raw metadata fields", { concurrency: 1 }, () => {
  it("returns node items including obj_create_time/creator/owner", async () => {
    const auth = makeUserAuthInfo();
    const { restore } = setupMockFetch({
      responses: [
        jsonResponse({
          code: 0,
          data: {
            items: [
              {
                title: "Doc1",
                node_token: "nd1",
                obj_type: "docx",
                obj_token: "doc1",
                has_child: false,
                obj_create_time: "1700000000",
                obj_edit_time: "1700009999",
                creator: "ou_creator",
                owner: "ou_owner",
              },
            ],
            has_more: false,
          },
        }),
      ],
    });

    try {
      const nodes = await fetchChildren(auth, "sp1");
      assert.equal(nodes.length, 1);
      assert.equal(nodes[0].obj_create_time, "1700000000");
      assert.equal(nodes[0].obj_edit_time, "1700009999");
      assert.equal(nodes[0].creator, "ou_creator");
      assert.equal(nodes[0].owner, "ou_owner");
    } finally {
      restore();
    }
  });
});
