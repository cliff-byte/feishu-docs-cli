/**
 * update command: Update existing documents (append, overwrite, restore).
 *
 * Uses Convert + Descendant API for writing new content.
 * Restore uses the old children API (backup data is raw blocks, not markdown).
 */

import { readFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, normalize, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { createClient, fetchWithAuth } from "../client.js";
import { CliError } from "../utils/errors.js";
import {
  convertAndWrite,
  extractMarkdownTitle,
} from "../services/markdown-convert.js";
import { resolveDocument } from "../utils/document-resolver.js";
import {
  readBody,
  getDocumentInfo,
  clearDocument,
  backupDocument,
  sleep,
  BATCH_SIZE,
  QPS_DELAY,
  BACKUPS_DIR,
} from "../services/block-writer.js";
import {
  CommandMeta,
  CommandArgs,
  GlobalOpts,
  AuthInfo,
  Block,
} from "../types/index.js";

export const meta: CommandMeta = {
  options: {
    body: { type: "string" },
    append: { type: "boolean", default: false },
    restore: { type: "string" },
  },
  positionals: true,
  handler: update,
};

export async function update(
  args: CommandArgs,
  globalOpts: GlobalOpts,
): Promise<void> {
  const input = args.positionals![0];
  if (!input) {
    throw new CliError(
      "INVALID_ARGS",
      "缺少文档 URL 或 token。用法: feishu-docs update <url|token> --body <file>",
    );
  }

  const { authInfo } = await createClient(globalOpts);
  const doc = await resolveDocument(authInfo, input);
  const documentId = doc.objToken;

  if (doc.objType !== "docx") {
    throw new CliError(
      "INVALID_ARGS",
      `该文档类型 (${doc.objType}) 不支持更新`,
    );
  }

  if (args.restore) {
    return restoreFromBackup(
      authInfo,
      documentId,
      args.restore as string,
      globalOpts,
    );
  }

  if (!args.body) {
    throw new CliError(
      "INVALID_ARGS",
      "缺少 --body 参数。用法: feishu-docs update <url|token> --body <file>",
    );
  }

  const bodyContent = await readBody(args.body as string);
  if (!bodyContent.trim()) {
    throw new CliError("INVALID_ARGS", "文档内容为空，至少需要一行内容");
  }

  if (args.append) {
    return appendToDocument(authInfo, documentId, bodyContent, globalOpts);
  }

  return overwriteDocument(authInfo, documentId, bodyContent, globalOpts);
}

async function appendToDocument(
  authInfo: AuthInfo,
  documentId: string,
  bodyContent: string,
  globalOpts: GlobalOpts,
): Promise<void> {
  // Strip H1 heading from body — append should not include title in content
  const { body: strippedBody } = extractMarkdownTitle(bodyContent);
  const contentToWrite = strippedBody.trim() ? strippedBody : bodyContent;

  const docInfo = await getDocumentInfo(authInfo, documentId);

  await convertAndWrite(
    authInfo,
    documentId,
    contentToWrite,
    docInfo.revisionId,
    -1,
  );

  if (globalOpts.json) {
    process.stdout.write(
      JSON.stringify({
        success: true,
        document_id: documentId,
        mode: "append",
      }) + "\n",
    );
  } else {
    process.stdout.write(`已追加内容到文档 ${documentId}\n`);
  }
}

async function overwriteDocument(
  authInfo: AuthInfo,
  documentId: string,
  bodyContent: string,
  globalOpts: GlobalOpts,
): Promise<void> {
  // Extract first H1 heading as document title, strip from body
  const { title: extractedTitle, body: strippedBody } =
    extractMarkdownTitle(bodyContent);
  const contentToWrite = strippedBody.trim() ? strippedBody : bodyContent;

  let backupPath: string;
  try {
    const backup = await backupDocument(authInfo, documentId);
    backupPath = backup.filepath;
  } catch (err) {
    throw new CliError(
      "API_ERROR",
      `备份失败，操作中止: ${(err as Error).message}`,
    );
  }

  const docInfo = await getDocumentInfo(authInfo, documentId);
  let rev: number;
  try {
    rev = await clearDocument(authInfo, documentId, docInfo.revisionId);
  } catch (err) {
    process.stderr.write(
      `feishu-docs: error: 清空文档失败: ${(err as Error).message}\n`,
    );
    process.stderr.write(`feishu-docs: info: 备份文件: ${backupPath}\n`);
    throw err;
  }

  // Update document title if extracted from markdown
  if (extractedTitle) {
    try {
      await fetchWithAuth(
        authInfo,
        `/open-apis/docx/v1/documents/${encodeURIComponent(documentId)}`,
        {
          method: "PATCH",
          body: { title: extractedTitle },
        },
      );
    } catch {
      process.stderr.write(
        `feishu-docs: warning: 更新文档标题失败，标题可能未同步\n`,
      );
    }
  }

  try {
    await convertAndWrite(authInfo, documentId, contentToWrite, rev);
  } catch (err) {
    process.stderr.write(
      `feishu-docs: error: 写入新内容失败，尝试从备份恢复...\n`,
    );
    try {
      await restoreFromBackup(authInfo, documentId, backupPath, globalOpts);
      process.stderr.write("feishu-docs: info: 已从备份自动恢复\n");
    } catch (restoreErr) {
      process.stderr.write(
        `feishu-docs: error: 自动恢复也失败: ${(restoreErr as Error).message}\n`,
      );
      process.stderr.write(
        `feishu-docs: info: 请手动恢复，备份文件: ${backupPath}\n`,
      );
      process.stderr.write(
        "feishu-docs: info: 也可在飞书客户端中使用版本历史回退\n",
      );
    }
    throw err;
  }

  // Write succeeded — clean up backup file
  try {
    await unlink(backupPath);
  } catch {
    // Non-critical: backup file cleanup failure is silent
  }

  if (globalOpts.json) {
    process.stdout.write(
      JSON.stringify({
        success: true,
        document_id: documentId,
        mode: "overwrite",
      }) + "\n",
    );
  } else {
    process.stdout.write(`已覆盖更新文档 ${documentId}\n`);
  }
}

/**
 * Recursively restore blocks and their descendants from a backup block map.
 * Uses the old children API (backup data is raw blocks, not markdown).
 */
const MAX_RESTORE_DEPTH = 20;

async function restoreChildren(
  authInfo: AuthInfo,
  documentId: string,
  parentBlockId: string,
  childIds: string[],
  blockMap: Map<string, Block>,
  revisionId: number,
  depth: number = 0,
): Promise<number> {
  let rev = revisionId;
  if (!childIds || childIds.length === 0) return rev;
  if (depth >= MAX_RESTORE_DEPTH) {
    process.stderr.write(
      `feishu-docs: warning: 恢复深度超过 ${MAX_RESTORE_DEPTH} 层，跳过更深层级\n`,
    );
    return rev;
  }

  for (let i = 0; i < childIds.length; i += BATCH_SIZE) {
    const batchIds = childIds.slice(i, i + BATCH_SIZE);
    const batch = batchIds
      .map((id) => blockMap.get(id))
      .filter(Boolean)
      .map((b) => {
        const { block_id, parent_id, children, ...rest } = b as Block;
        return rest;
      });

    if (batch.length === 0) continue;
    if (i > 0) await sleep(QPS_DELAY);

    const res = await fetchWithAuth(
      authInfo,
      `/open-apis/docx/v1/documents/${encodeURIComponent(documentId)}/blocks/${encodeURIComponent(parentBlockId)}/children`,
      {
        method: "POST",
        body: { children: batch, index: i },
        params: { document_revision_id: rev, client_token: randomUUID() },
      },
    );

    const resData = res?.data as Record<string, unknown> | undefined;
    rev = (resData?.document_revision_id as number) ?? rev;
    const createdIds: string[] = (
      (resData?.children as Array<Record<string, string>>) ?? []
    ).map((c) => c.block_id);

    for (let j = 0; j < createdIds.length && j < batchIds.length; j++) {
      const original = blockMap.get(batchIds[j]);
      if (original?.children?.length && original.children.length > 0) {
        await sleep(QPS_DELAY);
        rev = await restoreChildren(
          authInfo,
          documentId,
          createdIds[j],
          original.children,
          blockMap,
          rev,
          depth + 1,
        );
      }
    }
  }

  return rev;
}

async function restoreFromBackup(
  authInfo: AuthInfo,
  documentId: string,
  backupPath: string,
  globalOpts: GlobalOpts,
): Promise<void> {
  const resolvedPath = resolve(normalize(backupPath));
  const resolvedBackups = resolve(BACKUPS_DIR);

  if (!resolvedPath.startsWith(resolvedBackups + sep)) {
    throw new CliError(
      "INVALID_ARGS",
      `备份文件必须位于 ${resolvedBackups} 目录下`,
      { recovery: `请使用 ${resolvedBackups} 下的备份文件路径` },
    );
  }

  if (!existsSync(resolvedPath)) {
    throw new CliError("FILE_NOT_FOUND", `备份文件不存在: ${resolvedPath}`);
  }

  if (!resolvedPath.endsWith(".json")) {
    throw new CliError("INVALID_ARGS", "备份文件必须是 .json 格式");
  }

  const raw = await readFile(resolvedPath, "utf8");
  let blocks: Block[];
  try {
    blocks = JSON.parse(raw) as Block[];
  } catch {
    throw new CliError(
      "INVALID_ARGS",
      `备份文件 JSON 格式无效: ${resolvedPath}`,
    );
  }

  if (!Array.isArray(blocks)) {
    throw new CliError("INVALID_ARGS", "备份文件格式无效：期望 JSON 数组");
  }

  const rootBlock = blocks.find((b) => b.block_type === 1);
  if (!rootBlock) {
    throw new CliError("INVALID_ARGS", "备份文件格式无效：未找到根 block");
  }

  const topLevelIds = rootBlock.children || [];
  if (topLevelIds.length === 0) {
    process.stderr.write("feishu-docs: warning: 备份文件中没有可恢复的内容\n");
    return;
  }

  const blockMap = new Map(blocks.map((b) => [b.block_id, b]));

  const docInfo = await getDocumentInfo(authInfo, documentId);
  let rev = await clearDocument(authInfo, documentId, docInfo.revisionId);

  try {
    rev = await restoreChildren(
      authInfo,
      documentId,
      documentId,
      topLevelIds,
      blockMap,
      rev,
    );
  } catch (restoreErr) {
    process.stderr.write(
      `feishu-docs: error: 恢复过程中出错: ${(restoreErr as Error).message}\n` +
        `  文档可能处于不完整状态。备份文件路径: ${resolvedPath}\n` +
        `  你可以在飞书客户端中使用版本历史恢复文档。\n`,
    );
    throw restoreErr;
  }

  if (globalOpts.json) {
    process.stdout.write(
      JSON.stringify({
        success: true,
        document_id: documentId,
        mode: "restore",
      }) + "\n",
    );
  } else {
    process.stdout.write(`已从备份恢复文档 ${documentId}\n`);
  }
}
