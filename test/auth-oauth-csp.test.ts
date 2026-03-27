/**
 * Tests verifying Content-Security-Policy headers on OAuth callback responses.
 *
 * Since the OAuth flow spawns an HTTP server + browser (untestable in CI),
 * these tests verify CSP headers by analyzing the auth.ts source code.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const authSource = await readFile(join(__dirname, "../src/auth.ts"), "utf8");

describe("OAuth CSP headers", () => {
  it("defines CSP_HEADER constant with strict policy", () => {
    assert.ok(
      authSource.includes("default-src 'none'; style-src 'unsafe-inline'; script-src 'none'"),
      "CSP_HEADER must contain strict policy",
    );
  });

  it("success response (200) includes Content-Security-Policy header", () => {
    const successBlock = authSource.match(/writeHead\(200,\s*\{[^}]+\}/s);
    assert.ok(successBlock, "Must have writeHead(200) call");
    assert.ok(
      successBlock[0].includes("Content-Security-Policy"),
      "200 response must include Content-Security-Policy header",
    );
  });

  it("error response (500) includes Content-Security-Policy header", () => {
    const errorBlock = authSource.match(/writeHead\(500,\s*\{[^}]+\}/s);
    assert.ok(errorBlock, "Must have writeHead(500) call");
    assert.ok(
      errorBlock[0].includes("Content-Security-Policy"),
      "500 response must include Content-Security-Policy header",
    );
  });
});
