import { createClient } from "../client.js";
import { readBodyInput } from "../services/block-writer.js";
import { parsePatchInput, patchDocument } from "../services/doc-patch.js";
import { resolveDocument } from "../utils/document-resolver.js";
import { CliError } from "../utils/errors.js";
import type { CommandMeta, CommandArgs, GlobalOpts } from "../types/index.js";

export const meta: CommandMeta = {
  options: { body: { type: "string" }, "dry-run": { type: "boolean", default: false } },
  strictOptions: true,
  positionals: true,
  handler: patch,
};

export async function patch(args: CommandArgs, globalOpts: GlobalOpts): Promise<void> {
  try {
    await runPatch(args, globalOpts);
  } catch (err) {
    if (err instanceof CliError) {
      if (err.recovery) throw err;
      throw new CliError(err.errorType, err.message, {
        apiCode: err.apiCode, missingScopes: err.missingScopes, details: err.details,
        recovery: "检查认证状态、文档链接及访问权限后重试 patch --dry-run",
      });
    }
    throw new CliError("API_ERROR", "局部编辑失败，请检查网络和认证状态", {
      recovery: "检查网络并运行 whoami --json，重新读取文档后再用 patch --dry-run 预览",
    });
  }
}

async function runPatch(args: CommandArgs, globalOpts: GlobalOpts): Promise<void> {
  const recovery = "用法: feishu-docs patch <url|token> --body edits.json [--dry-run] --json";
  if (args.positionals?.length !== 1 || typeof args.body !== "string" || !args.body) {
    throw new CliError("INVALID_ARGS", "需要一个文档 URL/token 和 --body 补丁文件（或 - 表示 stdin）", { recovery });
  }
  const content = await readBodyInput(args.body).catch((err: unknown) => {
    throw new CliError(err instanceof CliError ? err.errorType : "INVALID_ARGS", "无法读取补丁文件或 stdin", { recovery });
  });
  const input = parsePatchInput(content.content);
  const { authInfo } = await createClient(globalOpts);
  const doc = await resolveDocument(authInfo, args.positionals[0]);
  if (doc.objType !== "docx") {
    throw new CliError("NOT_SUPPORTED", "patch 仅支持新版 docx 文档", { recovery });
  }
  const result = await patchDocument(authInfo, doc.objToken, input, args.dryRun === true);
  if (globalOpts.json) {
    process.stdout.write(JSON.stringify(result) + "\n");
  } else {
    process.stdout.write(`${result.dry_run ? "预览" : "已完成"}局部编辑：${result.changes.length} 个块，版本 ${result.base_revision_id} → ${result.document_revision_id}\n`);
    for (const change of result.changes) {
      process.stdout.write(`${change.block_id}: ${JSON.stringify(change.old_text)} → ${JSON.stringify(change.new_text)}\n`);
    }
  }
}
