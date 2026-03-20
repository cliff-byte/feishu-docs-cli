/**
 * Reactive scope authorization: prompt and recovery utilities.
 *
 * Instead of pre-flight scope checks, this module provides:
 *
 * - `promptScopeAuth()` — Interactive OAuth prompt for missing scopes.
 * - `withScopeRecovery()` — Wrapper that catches SCOPE_MISSING errors,
 *   prompts the user (if interactive), and retries the operation once.
 *
 * The Feishu API is the source of truth for required scopes. When an API
 * call fails with 99991672 (app scope) or 99991679 (user scope), `fetchWithAuth`
 * throws `CliError("SCOPE_MISSING", { missingScopes })`. This module handles
 * the recovery.
 */

import * as readline from "node:readline";
import { oauthLogin, loadTokens } from "../auth.js";
import { CliError } from "./errors.js";
import { BASE_SCOPES, mergeScopes, buildScopeHint } from "../scopes.js";
import type { GlobalOpts } from "../types/index.js";

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
 */
export async function promptScopeAuth(
  missingScopes: string[],
  globalOpts: GlobalOpts,
): Promise<boolean> {
  // Non-interactive: skip prompt
  if (globalOpts.json || !process.stdin.isTTY) {
    return false;
  }

  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;
  if (!appId || !appSecret) return false;

  // Skip interactive OAuth when using env-var token — re-auth would save to file
  // but createClient still prefers the env token, so retry would fail again.
  if (process.env.FEISHU_USER_TOKEN) return false;

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
  const stored = await loadTokens();
  const currentScopes = stored?.tokens?.scope
    ? stored.tokens.scope.split(/\s+/).filter(Boolean)
    : [...BASE_SCOPES];
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
 * Wrap an async operation with reactive scope error recovery.
 *
 * When the operation throws `CliError("SCOPE_MISSING")`:
 * - If interactive (TTY + non-JSON) and scopes are known: prompt → retry once.
 * - Otherwise: re-throw with a clear recovery hint.
 *
 * @param fallbackScopes  Scope names to use when the API doesn't include
 *   `permission_violations` (older APIs like search). When the error has
 *   empty `missingScopes` but `fallbackScopes` is provided, these are used
 *   for the authorization prompt.
 */
export async function withScopeRecovery<T>(
  fn: () => Promise<T>,
  globalOpts: GlobalOpts,
  fallbackScopes?: string[],
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!(err instanceof CliError) || err.errorType !== "SCOPE_MISSING") {
      throw err;
    }

    const apiScopes = err.missingScopes ?? [];
    const scopes = apiScopes.length > 0 ? apiScopes : (fallbackScopes ?? []);

    // No scopes from API or fallback → can't prompt meaningfully, just throw
    if (scopes.length === 0) {
      throw err;
    }

    // Tenant mode: OAuth produces a user token which tenant auth ignores,
    // so interactive recovery would be pointless — just throw with a hint.
    if (globalOpts.auth === "tenant") {
      throw new CliError("AUTH_REQUIRED", buildScopeHint(scopes), {
        apiCode: err.apiCode,
        missingScopes: scopes,
      });
    }

    // Try interactive recovery
    const authorized = await promptScopeAuth(scopes, globalOpts);
    if (!authorized) {
      throw new CliError("AUTH_REQUIRED", buildScopeHint(scopes), {
        apiCode: err.apiCode,
        missingScopes: scopes,
      });
    }

    // Retry once — if it fails again, let the error propagate
    return await fn();
  }
}
