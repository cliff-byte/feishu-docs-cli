/**
 * login / logout / whoami commands.
 */

import { oauthLogin, clearTokens, resolveAuth, loadTokens } from "../auth.js";
import { CliError } from "../utils/errors.js";
import { CommandMeta, CommandArgs, GlobalOpts } from "../types/index.js";

export const loginMeta: CommandMeta = {
  options: {
    scope: { type: "string" },
    port: { type: "string" },
    "redirect-uri": { type: "string" },
  },
  positionals: false,
  handler: login,
};

export const logoutMeta: CommandMeta = {
  options: {},
  positionals: false,
  handler: logout,
};

export const whoamiMeta: CommandMeta = {
  options: {},
  positionals: false,
  handler: whoami,
};

export async function login(
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

  const scope =
    (args.scope as string | undefined) ||
    "wiki:wiki docx:document docx:document.block:convert drive:drive contact:contact.base:readonly board:whiteboard:node:read bitable:app:readonly";
  const tokens = await oauthLogin(appId, {
    scope,
    appSecret,
    port: args.port as string | undefined,
    redirectUri: args.redirectUri as string | undefined,
    useLark: globalOpts.lark,
  });

  process.stderr.write("feishu-docs: 登录成功！token 已加密保存。\n");
  if (globalOpts.json) {
    process.stdout.write(
      JSON.stringify({ success: true, expires_at: tokens.expires_at }) + "\n",
    );
  }
}

export async function logout(
  _args: CommandArgs,
  globalOpts: GlobalOpts,
): Promise<void> {
  await clearTokens();
  process.stderr.write("feishu-docs: 已清除保存的凭证。\n");
  if (globalOpts.json) {
    process.stdout.write(JSON.stringify({ success: true }) + "\n");
  }
}

export async function whoami(
  _args: CommandArgs,
  globalOpts: GlobalOpts,
): Promise<void> {
  try {
    const authInfo = await resolveAuth(globalOpts.auth || "auto");

    if (globalOpts.json) {
      process.stdout.write(
        JSON.stringify({
          success: true,
          mode: authInfo.mode,
          app_id: authInfo.appId,
          has_user_token: !!authInfo.userToken,
        }) + "\n",
      );
    } else {
      process.stdout.write(`认证模式: ${authInfo.mode}\n`);
      if (authInfo.appId) {
        process.stdout.write(`App ID: ${authInfo.appId}\n`);
      }
      if (authInfo.userToken) {
        process.stdout.write(
          `User Token: ${authInfo.userToken.slice(0, 10)}...\n`,
        );
        if (authInfo.expiresAt) {
          const expires = new Date(authInfo.expiresAt).toLocaleString();
          const expired = Date.now() >= authInfo.expiresAt;
          process.stdout.write(
            `过期时间: ${expires}${expired ? " (已过期)" : ""}\n`,
          );
        }
      }
    }
  } catch (err) {
    if (globalOpts.json) {
      process.stdout.write(
        JSON.stringify({
          success: false,
          error: (err as Error).message,
        }) + "\n",
      );
    } else {
      process.stdout.write(`未认证: ${(err as Error).message}\n`);
    }
  }
}
