/**
 * Fetch mock helper with call sequencing for testing API-calling code.
 *
 * Replaces globalThis.fetch with a mock that returns responses in order.
 * All tests touching globalThis.fetch should use { concurrency: 1 } on
 * their describe blocks to prevent parallel pollution.
 */

interface MockCall {
  url: string;
  init?: RequestInit;
}

interface MockFetchOptions {
  /** Ordered responses. Each fetch call consumes the next response. */
  responses: Array<Response | (() => Response)>;
  /** If true, throw after all responses consumed. Default: true. */
  strictCount?: boolean;
}

interface MockFetchResult {
  calls: readonly MockCall[];
  restore: () => void;
}

/**
 * Replace globalThis.fetch with a mock that returns responses in sequence.
 *
 * @param opts - Configuration with ordered responses and optional strict mode.
 * @returns Object with `calls` array (read-only) and `restore` function.
 */
export function setupMockFetch(opts: MockFetchOptions): MockFetchResult {
  const originalFetch = globalThis.fetch;
  const calls: MockCall[] = [];
  let callIndex = 0;

  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    calls.push({ url, init });
    if (callIndex >= opts.responses.length) {
      if (opts.strictCount !== false) {
        throw new Error(
          `Unexpected fetch call #${callIndex + 1}: ${url}. Only ${opts.responses.length} responses configured.`,
        );
      }
      return new Response(JSON.stringify({ code: 0 }), {
        headers: { "content-type": "application/json" },
      });
    }
    const resp = opts.responses[callIndex++];
    return typeof resp === "function" ? resp() : resp;
  }) as typeof fetch;

  return {
    calls,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

/**
 * Build a JSON Response for API mocking.
 *
 * @param body - The response body (will be JSON-serialized).
 * @param status - HTTP status code (default 200).
 * @returns A Response object with JSON content-type header.
 */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: { "content-type": "application/json" },
  });
}

/**
 * Convenience: tenant token response that most fetchWithAuth tests need first.
 *
 * @param token - The mock tenant access token (default "t-mock-token").
 * @returns A JSON Response with a valid tenant token body.
 */
export function tenantTokenResponse(token = "t-mock-token"): Response {
  return jsonResponse({ code: 0, tenant_access_token: token });
}
