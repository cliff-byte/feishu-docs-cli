/**
 * authorize command: Request additional OAuth scopes on-demand.
 *
 * Reads currently stored scopes, merges with the requested ones, and
 * re-runs the OAuth flow so the user grants only what is needed.
 */

import { oauthLogin, loadTokens } from "../auth.js";
import { CliError } from "../utils/errors.js";
import {
  FEATURE_SCOPE_GROUPS,
  FEATURE_NAMES,
  BASE_SCOPES,
  ALL_KNOWN_SCOPES,
  mergeScopes,
} from "../scopes.js";
import type { FeatureName } from "../scopes.js";
import { CommandMeta, CommandArgs, GlobalOpts } from "../types/index.js";

/** Feishu scope tokens follow the pattern: word:word or word:word:word */
const SCOPE_TOKEN_RE = /^\w[\w-]*:[\w.:/-]+$/;

export const meta: CommandMeta = {
  options: {
    scope: { type: "string" },
    feature: { type: "string" },
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

  if (!args.scope && !args.feature) {
    const featureList = FEATURE_NAMES.map((name) => {
      const g = FEATURE_SCOPE_GROUPS[name];
      const cmds = g.commands.join(", ");
      return `  ${name.padEnd(12)} ${g.scopes.join(", ")}\n               ${g.description}（用于: ${cmds}）`;
    }).join("\n");
    throw new CliError(
      "INVALID_ARGS",
      `请指定 --scope 或 --feature。\n\n可用功能权限:\n${featureList}\n\n示例:\n  feishu-docs authorize --feature drive\n  feishu-docs authorize --feature drive,contact\n  feishu-docs authorize --scope "drive:drive"`,
    );
  }

  // Collect scopes to add
  const extraScopes: string[] = [];

  if (args.feature) {
    const featureNames = (args.feature as string)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    for (const name of featureNames) {
      if (!FEATURE_NAMES.includes(name as FeatureName)) {
        throw new CliError(
          "INVALID_ARGS",
          `未知功能: ${name}。可用值: ${FEATURE_NAMES.join(", ")}`,
        );
      }
      extraScopes.push(...FEATURE_SCOPE_GROUPS[name as FeatureName].scopes);
    }
  }

  if (args.scope) {
    const rawScopes = (args.scope as string).split(/\s+/).filter(Boolean);

    for (const s of rawScopes) {
      if (!SCOPE_TOKEN_RE.test(s)) {
        throw new CliError(
          "INVALID_ARGS",
          `无效的 scope 格式: "${s}"。scope 应为 "namespace:resource" 或 "namespace:resource:action" 格式`,
        );
      }
      if (!ALL_KNOWN_SCOPES.has(s)) {
        process.stderr.write(
          `feishu-docs: warning: 未知的 scope "${s}"，将原样传给飞书，请确认拼写正确。\n`,
        );
      }
    }

    extraScopes.push(...rawScopes);
  }

  if (extraScopes.length === 0) {
    throw new CliError("INVALID_ARGS", "未指定任何有效的 scope，操作已取消");
  }

  // Merge with currently stored scopes (so we don't lose existing grants).
  // loadTokens() is called after createClient() would have finished any pending
  // refresh, so the stored scope reflects the latest saved token.
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
