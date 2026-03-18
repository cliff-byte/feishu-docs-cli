/**
 * Interactive scope authorization prompt and recovery utilities.
 *
 * When a command discovers missing OAuth scopes, these helpers guide
 * the user through authorizing them — or gracefully skipping if the
 * user declines (or the session is non-interactive).
 */

import * as readline from "node:readline";
import { oauthLogin, loadTokens } from "../auth.js";
import { createClient } from "../client.js";
import { CliError } from "./errors.js";
import {
  BASE_SCOPES,
  mergeScopes,
  getMissingScopes,
  buildScopeHint,
} from "../scopes.js";
import type { AuthInfo, GlobalOpts } from "../types/index.js";

/**
 * Check whether an error is a permission / scope error.
 */
export function isPermissionError(err: unknown): boolean {
  if (err instanceof CliError) {
    return (
      err.errorType === "PERMISSION_DENIED" || err.errorType === "AUTH_REQUIRED"
    );
  }
  return false;
}

/**
 * Ask a yes/no question on stderr, read from stdin.
 * Returns true only if user answers "y" or "yes".
 */
function askYesNo(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stderr,
    });
    rl.question(`${question} (y/N) `, (answer) => {
      rl.close();
      resolve(["y", "yes"].includes(answer.trim().toLowerCase()));
    });
  });
}

/**
 * Prompt the user to authorize missing scopes interactively.
 *
 * 1. Tells the user which scopes are missing.
 * 2. Reminds them to enable the scopes in the Feishu developer console.
 * 3. Asks whether to run the OAuth flow now.
 *
 * Returns `true` if authorization succeeded, `false` otherwise.
 * Always returns `false` in non-interactive contexts (JSON mode, non-TTY).
 *
 * @param storedScopeStr  Pre-loaded stored scope string (avoids duplicate
 *                        loadTokens call when called from ensureScopes).
 */
export async function promptScopeAuth(
  missingScopes: string[],
  globalOpts: GlobalOpts,
  storedScopeStr?: string,
): Promise<boolean> {
  // Non-interactive: skip prompt
  if (globalOpts.json || !process.stdin.isTTY) {
    return false;
  }

  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;
  if (!appId || !appSecret) return false;

  const scopeList = missingScopes.join(", ");
  const scopeStr = missingScopes.join(" ");
  process.stderr.write(
    `\nfeishu-docs: 缺少以下权限: ${scopeList}\n` +
      `请先确认已在飞书开发者后台 (https://open.feishu.cn/app) 为应用开通了对应的 API 权限。\n` +
      `开通后，需要通过 OAuth 授权将权限授予当前用户（用户已授予的权限会累积保留）。\n` +
      `手动授权命令: feishu-docs authorize --scope "${scopeStr}"\n\n`,
  );

  const yes = await askYesNo("是否现在申请授予权限?");
  if (!yes) return false;

  // Merge missing scopes with current grants and re-run OAuth
  let currentScopes: string[];
  if (storedScopeStr) {
    currentScopes = storedScopeStr.split(/\s+/).filter(Boolean);
  } else {
    const stored = await loadTokens();
    currentScopes = stored?.tokens?.scope
      ? stored.tokens.scope.split(/\s+/).filter(Boolean)
      : [...BASE_SCOPES];
  }
  const merged = mergeScopes(currentScopes, missingScopes);

  try {
    await oauthLogin(appId, {
      scope: merged.join(" "),
      appSecret,
      useLark: globalOpts.lark,
    });
    process.stderr.write("feishu-docs: 授权成功！\n\n");
    return true;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    process.stderr.write(`feishu-docs: 授权失败: ${detail}\n\n`);
    return false;
  }
}

/**
 * Pre-flight scope check with interactive recovery.
 *
 * If scopes are missing and the user authorizes them, returns a fresh
 * `AuthInfo` with the new token. If no recovery is needed, returns the
 * original `authInfo` unchanged. If the user declines, throws.
 */
export async function ensureScopes(
  authInfo: AuthInfo,
  requiredScopes: readonly string[],
  globalOpts: GlobalOpts,
): Promise<AuthInfo> {
  if (authInfo.mode !== "user") return authInfo;

  // No stored file → env-var token or tenant mode; scope info unavailable,
  // skip pre-flight check (downstream API call will surface permission errors).
  const stored = await loadTokens();
  if (!stored) return authInfo;

  const missing = getMissingScopes(stored.tokens.scope, [...requiredScopes]);
  if (missing.length === 0) return authInfo;

  // Pass stored scope string to avoid a second loadTokens() call
  const authorized = await promptScopeAuth(
    missing,
    globalOpts,
    stored.tokens.scope,
  );
  if (!authorized) {
    throw new CliError("AUTH_REQUIRED", buildScopeHint(missing));
  }

  // Re-create client to pick up the fresh token
  const { authInfo: refreshed } = await createClient(globalOpts);
  return refreshed;
}
