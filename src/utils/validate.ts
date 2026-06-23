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

/** Bounds for the --table-width option (pixels). */
const TABLE_WIDTH_MIN = 200;
const TABLE_WIDTH_MAX = 2000;

/**
 * Parse and validate the --table-width option. Returns undefined when not
 * provided (caller falls back to the default). Throws on non-numeric or
 * out-of-range values.
 */
export function parseTableWidth(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < TABLE_WIDTH_MIN || n > TABLE_WIDTH_MAX) {
    throw new CliError(
      "INVALID_ARGS",
      `无效的 --table-width: ${raw}（需为 ${TABLE_WIDTH_MIN}–${TABLE_WIDTH_MAX} 之间的整数像素）`,
    );
  }
  return n;
}
