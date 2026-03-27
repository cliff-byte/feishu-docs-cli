/** Zero-dependency retry utilities for transient error handling. */

/** Configuration options for retry behavior. */
export interface RetryOptions {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
}

/** Default retry configuration: 2 retries, 1s initial, 10s max. */
export const DEFAULT_RETRY: RetryOptions = {
  maxRetries: 2,
  initialDelay: 1000,
  maxDelay: 10_000,
};

/** Retryable HTTP status codes. */
const RETRYABLE_STATUSES = new Set([429, 502, 503]);

/** Maximum Retry-After value in milliseconds (30 seconds). */
const MAX_RETRY_AFTER_MS = 30_000;

/**
 * Calculate delay for a retry attempt using exponential backoff with jitter.
 *
 * Computes base = min(initialDelay * 2^attempt, maxDelay), then applies
 * +/-25% random jitter. Result is clamped to >= 0.
 *
 * @param attempt - Zero-based retry attempt number
 * @param initialDelay - Base delay in milliseconds
 * @param maxDelay - Maximum delay cap in milliseconds
 * @returns Delay in milliseconds with jitter applied
 */
export function calculateDelay(
  attempt: number,
  initialDelay: number,
  maxDelay: number,
): number {
  const base = Math.min(initialDelay * Math.pow(2, attempt), maxDelay);
  const jitter = base * 0.25 * (2 * Math.random() - 1);
  return Math.max(0, base + jitter);
}

/**
 * Parse the Retry-After HTTP header value (seconds format only).
 *
 * Returns the value in milliseconds, capped at 30 seconds.
 * Returns null for null, empty, non-numeric, or non-positive values.
 * Does NOT handle HTTP date format.
 *
 * @param headerValue - The Retry-After header value (string of seconds)
 * @returns Delay in milliseconds, or null if unparseable
 */
export function parseRetryAfter(headerValue: string | null): number | null {
  if (headerValue === null || headerValue === "") return null;
  const seconds = Number(headerValue);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
}

/**
 * Check whether a status code or error name indicates a retryable condition.
 *
 * Retryable statuses: 429 (rate limit), 502 (bad gateway), 503 (service unavailable).
 * Retryable errors: AbortError (timeout).
 *
 * @param statusOrErrorName - HTTP status code or error name string
 * @returns true if the condition is retryable
 */
export function isRetryable(statusOrErrorName: number | string): boolean {
  if (typeof statusOrErrorName === "number") {
    return RETRYABLE_STATUSES.has(statusOrErrorName);
  }
  return statusOrErrorName === "AbortError";
}

/**
 * Sleep for the specified number of milliseconds.
 *
 * @param ms - Duration to sleep in milliseconds
 * @returns Promise that resolves after the delay
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
