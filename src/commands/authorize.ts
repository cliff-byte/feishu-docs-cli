/**
 * authorize command: Request additional OAuth scopes on-demand.
 *
 * Reads currently stored scopes, merges with the requested ones, and
 * re-runs the OAuth flow so the user grants only what is needed.
 *
 * Scopes to request typically come from API error messages — when a command
 * fails with SCOPE_MISSING, the error includes the exact scope names needed.
 */

import { oauthLogin, loadTokens } from "../auth.js";
import { CliError } from "../utils/errors.js";
import { BASE_SCOPES, mergeScopes } from "../scopes.js";
import { CommandMeta, CommandArgs, GlobalOpts } from "../types/index.js";

/** Feishu scope tokens follow the pattern: word:word or word:word:word */
const SCOPE_TOKEN_RE = /^\w[\w-]*:[\w.:/-]+$/;

export const meta: CommandMeta = {
  options: {
    scope: { type: "string" },
    port: { type: "string" },
    "redirect-uri": { type: "string" },
  },
  positionals: false,
  handler: authorize,
};

export async function authorize(
  args: CommandArgs,
  globalOpts: GlobalOpts,
): Promise<void> {
  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;

  if (!appId || !appSecret) {
    throw new CliError(
      "AUTH_REQUIRED",
      "请先设置 FEISHU_APP_ID 和 FEISHU_APP_SECRET 环境变量",
    );
  }

  if (!args.scope) {
    throw new CliError(
      "INVALID_ARGS",
      `请指定 --scope 参数。\n\n` +
        `示例:\n` +
        `  feishu-docs authorize --scope "drive:drive"\n` +
        `  feishu-docs authorize --scope "drive:drive contact:contact.base:readonly"\n\n` +
        `提示: 当命令因权限不足失败时，错误信息中会包含所需的 scope 名称。`,
    );
  }

  // Parse and validate scopes
  const rawScopes = (args.scope as string).split(/\s+/).filter(Boolean);
  const extraScopes: string[] = [];

  for (const s of rawScopes) {
    if (!SCOPE_TOKEN_RE.test(s)) {
      throw new CliError(
        "INVALID_ARGS",
        `无效的 scope 格式: "${s}"。scope 应为 "namespace:resource" 或 "namespace:resource:action" 格式`,
      );
    }
    extraScopes.push(s);
  }

  if (extraScopes.length === 0) {
    throw new CliError("INVALID_ARGS", "未指定任何有效的 scope，操作已取消");
  }

  // Merge with currently stored scopes (so we don't lose existing grants).
  const stored = await loadTokens();
  const currentScopes = stored?.tokens?.scope
    ? stored.tokens.scope.split(/\s+/).filter(Boolean)
    : BASE_SCOPES;

  const merged = mergeScopes(currentScopes, extraScopes);
  const scopeStr = merged.join(" ");

  process.stderr.write(
    `\n即将申请以下权限（包含已有权限）:\n  ${scopeStr}\n\n`,
  );

  const tokens = await oauthLogin(appId, {
    scope: scopeStr,
    appSecret,
    port: args.port as string | undefined,
    redirectUri: args.redirectUri as string | undefined,
    useLark: globalOpts.lark,
  });

  process.stderr.write("feishu-docs: 授权成功！token 已更新。\n");
  if (globalOpts.json) {
    process.stdout.write(
      JSON.stringify({
        success: true,
        scope: scopeStr,
        expires_at: tokens.expires_at,
      }) + "\n",
    );
  }
}
