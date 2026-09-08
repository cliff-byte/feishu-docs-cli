import { tryRefreshIfExpired } from "../auth.js";
import { promptScopeAuth } from "../utils/scope-prompt.js";
import { createClient } from "../client.js";
import { exportSheet } from "../services/sheet-export.js";
import { resolveDocument } from "../utils/document-resolver.js";
import { parseDocUrl } from "../utils/url-parser.js";
import { CliError } from "../utils/errors.js";
import type { CommandMeta } from "../types/index.js";

export const meta: CommandMeta = {
  options: { output: { type: "string" }, format: { type: "string", default: "xlsx" },
    type: { type: "string" }, sheet: { type: "string" }, range: { type: "string" } },
  positionals: true,
  async handler(args, globalOpts) {
    const input = args.positionals?.[0];
    if (!input || typeof args.output !== "string" || !args.output.trim() ||
      (args.format !== undefined && args.format !== "xlsx") || args.sheet !== undefined || args.range !== undefined) {
      throw new CliError("INVALID_ARGS", "export 仅支持整本 xlsx，必须指定 --output", {
        recovery: "feishu-docs export <url|token> [--type sheet] --format xlsx --output <path.xlsx>",
      });
    }
    const parsed = parseDocUrl(input);
    if (args.type !== undefined && (args.type !== "sheet" || parsed.type !== "unknown")) {
      throw new CliError("INVALID_ARGS", "--type sheet 仅适用于裸表格 token", { recovery: "完整 URL 请移除 --type" });
    }
    const { authInfo } = await createClient(globalOpts);
    const doc = await resolveDocument(authInfo, input, { type: args.type, allowFallback: false });
    if (doc.objType !== "sheet") throw new CliError("NOT_SUPPORTED", "export 仅支持电子表格", { recovery: "提供表格 URL 或裸 token 加 --type sheet" });
    if (parsed.sheetId !== undefined) process.stderr.write("feishu-docs: info: export 将导出整本工作簿，URL 的 sheet 参数仅用于读取选择\n");
    const controller = new AbortController();
    const abort = () => controller.abort();
    process.once("SIGINT", abort);
    process.once("SIGTERM", abort);
    try {
      const result = await exportSheet(authInfo, { spreadsheetToken: doc.objToken, outputPath: args.output, signal: controller.signal }, {
        ...(authInfo.mode === "user" && !process.env.FEISHU_USER_TOKEN && {
          async recoverAuth(current, error, signal) {
            if (error.errorType === "TOKEN_EXPIRED" && current.refreshToken) {
              const fresh = await tryRefreshIfExpired({ ...current, expiresAt: Date.now() - 1 }, { maxLockRetries: 3, signal });
              if (fresh.refreshed) return fresh.authInfo;
            }
            if (error.errorType === "SCOPE_MISSING" && error.missingScopes?.length &&
                await promptScopeAuth(error.missingScopes, { ...globalOpts, auth: "user" }, false, signal)) {
              return (await createClient({ ...globalOpts, auth: "user" })).authInfo;
            }
            throw error;
          },
        }),
      });
      process.stdout.write(globalOpts.json ? JSON.stringify({ success: true, type: "sheet", ...result }) + "\n" : result.path + "\n");
    } finally {
      process.removeListener("SIGINT", abort);
      process.removeListener("SIGTERM", abort);
    }
  },
};
