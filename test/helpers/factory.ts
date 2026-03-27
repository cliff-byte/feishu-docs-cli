/**
 * Test data factories for creating valid default instances.
 *
 * Provides factory functions for AuthInfo, GlobalOpts, and ApiResponse,
 * reducing boilerplate across test files. Each factory returns a new
 * object (immutable pattern) with sensible defaults that can be overridden.
 */

import type { AuthInfo, GlobalOpts, ApiResponse } from "../../src/types/index.js";

/**
 * Create a default tenant-mode AuthInfo for testing.
 *
 * @param overrides - Partial AuthInfo to merge into defaults.
 * @returns A new AuthInfo object.
 */
export function makeAuthInfo(overrides: Partial<AuthInfo> = {}): AuthInfo {
  return {
    mode: "tenant",
    appId: "cli_test_id",
    appSecret: "cli_test_secret",
    useLark: false,
    ...overrides,
  };
}

/**
 * Create a default user-mode AuthInfo with token and refresh token.
 *
 * @param overrides - Partial AuthInfo to merge into defaults.
 * @returns A new AuthInfo object configured for user mode.
 */
export function makeUserAuthInfo(overrides: Partial<AuthInfo> = {}): AuthInfo {
  return makeAuthInfo({
    mode: "user",
    userToken: "u-mock-user-token",
    expiresAt: Date.now() + 3600_000,
    refreshToken: "rt-mock-refresh-token",
    ...overrides,
  });
}

/**
 * Create default GlobalOpts for testing.
 *
 * @param overrides - Partial GlobalOpts to merge into defaults.
 * @returns A new GlobalOpts object.
 */
export function makeGlobalOpts(overrides: Partial<GlobalOpts> = {}): GlobalOpts {
  return { auth: "auto", json: false, lark: false, ...overrides };
}

/**
 * Create a default successful ApiResponse for testing.
 *
 * @param overrides - Partial ApiResponse to merge into defaults.
 * @returns A new ApiResponse object.
 */
export function makeApiResponse(
  overrides: Partial<ApiResponse> = {},
): ApiResponse {
  return { code: 0, msg: "success", data: {}, ...overrides };
}
