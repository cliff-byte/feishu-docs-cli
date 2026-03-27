/**
 * Environment variable isolation helpers for testing.
 *
 * Provides functions to temporarily set or clear env vars during test
 * execution, with guaranteed restoration in a finally block.
 * All tests touching process.env should use { concurrency: 1 } on
 * their describe blocks to prevent parallel pollution.
 */

const AUTH_ENV_KEYS = [
  "FEISHU_USER_TOKEN",
  "FEISHU_APP_ID",
  "FEISHU_APP_SECRET",
  "FEISHU_REDIRECT_URI",
  "FEISHU_OAUTH_PORT",
] as const;

type EnvKey = (typeof AUTH_ENV_KEYS)[number];

/**
 * Run a function with specific env vars set, restoring originals after.
 * Pass `undefined` as a value to delete a var for the duration.
 *
 * @param vars - Map of env var names to values (or undefined to delete).
 * @param fn - The function to execute with modified environment.
 */
export async function withCleanEnv(
  vars: Partial<Record<EnvKey | string, string | undefined>>,
  fn: () => Promise<void> | void,
): Promise<void> {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    saved[key] = process.env[key];
    const val = vars[key];
    if (val === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = val;
    }
  }
  try {
    await fn();
  } finally {
    for (const [key, val] of Object.entries(saved)) {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
  }
}

/**
 * Clear all FEISHU_* auth env vars for the duration of a function.
 *
 * @param fn - The function to execute with cleared auth environment.
 */
export async function withNoAuthEnv(
  fn: () => Promise<void> | void,
): Promise<void> {
  const vars: Record<string, undefined> = {};
  for (const key of AUTH_ENV_KEYS) {
    vars[key] = undefined;
  }
  return withCleanEnv(vars, fn);
}
