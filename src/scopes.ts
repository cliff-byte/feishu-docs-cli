/**
 * OAuth scope catalog.
 *
 * BASE_SCOPES  — all no-review (免审) scopes needed for core functionality.
 *                Requested during `feishu-docs login`.
 * FEATURE_SCOPE_GROUPS — scopes that require admin review; granted on-demand
 *                        via `feishu-docs authorize --feature <name>`.
 */

export const BASE_SCOPES = [
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
  // Document search (search command, suite/docs-api)
  "search:docs:read",
];

export const FEATURE_SCOPE_GROUPS = {
  drive: {
    scopes: ["drive:drive"],
    description: "云空间文件管理（ls、在云空间文件夹中创建文档等）",
    commands: ["ls", "create --folder"],
  },
  contact: {
    scopes: ["contact:contact.base:readonly"],
    description: "联系人只读（通过邮件/手机号查找用户）",
    commands: ["share add"],
  },
} as const;

export type FeatureName = keyof typeof FEATURE_SCOPE_GROUPS;

export const FEATURE_NAMES = Object.keys(FEATURE_SCOPE_GROUPS) as FeatureName[];

/** All scopes known to this catalog (base + all feature groups). */
export const ALL_KNOWN_SCOPES = new Set<string>([
  ...BASE_SCOPES,
  ...Object.values(FEATURE_SCOPE_GROUPS).flatMap((g) => g.scopes),
]);

/**
 * Return scopes from `required` that are absent in `storedScope`.
 *
 * Returns an empty array when `storedScope` is undefined. This intentionally
 * skips the check for both tenant mode (no OAuth token) and env-var user
 * tokens (FEISHU_USER_TOKEN), where stored scope info is unavailable.
 * In those cases the downstream API call will surface a permission error.
 */
export function getMissingScopes(
  storedScope: string | undefined,
  required: string[],
): string[] {
  if (!storedScope) return [];
  const granted = new Set(storedScope.split(/\s+/).filter(Boolean));
  return required.filter((s) => !granted.has(s));
}

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
