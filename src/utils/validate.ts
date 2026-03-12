/**
 * Input validation utilities for API path parameters.
 */

import { CliError } from "./errors.js";

const TOKEN_RE = /^[A-Za-z0-9_\-]{1,100}$/;

/**
 * Validate a space_id or token before interpolating into URL paths.
 * Prevents path traversal via malformed IDs.
 */
export function validateToken(value: unknown, label: string = "token"): void {
  if (!value || !TOKEN_RE.test(value as string)) {
    throw new CliError("INVALID_ARGS", `无效的 ${label} 格式: ${value}`);
  }
}
