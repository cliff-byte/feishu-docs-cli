/**
 * OAuth scope catalog.
 *
 * BASE_SCOPES  — all no-review (免审) scopes needed for core functionality.
 *                Requested during `feishu-docs login`.
 *
 * Feature-specific scopes are NOT maintained locally. Instead, the Feishu API
 * is the source of truth: when an API call requires a scope the user hasn't
 * authorized, `fetchWithAuth` detects the error (99991672 / 99991679) and
 * extracts the required scope names from the API response.
 */

export const BASE_SCOPES = [
  // Token refresh — required to get refresh_token from OAuth
  "offline_access",
  // Wiki & documents
  "wiki:wiki",
  "docx:document",
  "docx:document.block:convert",
  // Embedded spreadsheets (read command, sheets/v2 API)
  "sheets:spreadsheet:readonly",
  // Embedded whiteboards (read command, board/v1 API)
  "board:whiteboard:node:read",
  // Embedded bitable / multi-dimensional tables (read command, bitable/v1 API)
  "bitable:app:readonly",
  // Document media download (images/attachments temp URLs, drive/v1/medias API)
  "docs:document.media:download",
];

/**
 * Merge `extra` scopes into `current`, deduplicating across both arrays,
 * preserving order. Returns a new array; inputs are not mutated.
 */
export function mergeScopes(current: string[], extra: string[]): string[] {
  const seen = new Set(current);
  const added: string[] = [];
  for (const s of extra) {
    if (!seen.has(s)) {
      seen.add(s);
      added.push(s);
    }
  }
  return [...current, ...added];
}

/**
 * Build a human-readable hint for requesting missing scopes.
 */
export function buildScopeHint(missingScopes: string[]): string {
  const scopeStr = missingScopes.join(" ");
  return (
    `缺少以下 OAuth 权限: ${scopeStr}\n` +
    `请运行以下命令申请（可能需要飞书管理员审核后生效）:\n` +
    `  feishu-docs authorize --scope "${scopeStr}"`
  );
}
