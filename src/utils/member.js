/**
 * Shared member ID utilities for wiki and share commands.
 */

import { CliError } from "./errors.js";

const MEMBER_ID_RE = /^[A-Za-z0-9@._\-+]{1,200}$/;

/**
 * Validate member_id format to prevent path injection.
 */
export function validateMemberId(memberId) {
  if (!MEMBER_ID_RE.test(memberId)) {
    throw new CliError("INVALID_ARGS", `无效的 member_id 格式: ${memberId}`);
  }
}

/**
 * Auto-detect member_type from member identifier.
 */
export function detectMemberType(memberId) {
  if (memberId.includes("@")) return "email";
  if (memberId.startsWith("ou_")) return "openid";
  if (memberId.startsWith("on_")) return "unionid";
  if (memberId.startsWith("oc_")) return "openchat";
  if (memberId.startsWith("od_")) return "opendepartmentid";
  return "userid";
}
