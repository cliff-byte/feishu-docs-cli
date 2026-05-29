/**
 * Time formatting helpers for Feishu API timestamps.
 *
 * Feishu returns document/node timestamps as seconds-since-epoch encoded in a
 * string (e.g. "1700000000"). Machine output keeps the raw value; human output
 * uses these helpers. Zero dependencies — Node built-in Date only.
 */

/**
 * Format a seconds-since-epoch string as an ISO-8601 timestamp.
 *
 * @param value - Seconds since epoch as a string (Feishu API shape).
 * @returns ISO-8601 string, or undefined when input is missing/non-numeric.
 */
export function formatEpochSeconds(value?: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return undefined;
  return new Date(seconds * 1000).toISOString();
}
