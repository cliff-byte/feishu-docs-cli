/**
 * Tests for share command helper functions.
 * Imports actual production functions from share.js.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mapRole, mapPublicMode } from "../src/commands/share.js";
import { detectMemberType } from "../src/utils/member.js";

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
