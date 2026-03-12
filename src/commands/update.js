/**
 * update command: Update existing documents (append, overwrite, restore).
 *
 * Uses Convert + Descendant API for writing new content.
 * Restore uses the old children API (backup data is raw blocks, not markdown).
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, normalize, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { createClient, fetchWithAuth } from "../client.js";
import { CliError } from "../utils/errors.js";
import { convertAndWrite } from "../services/markdown-convert.js";
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

export const meta = {
  options: {
    body: { type: "string" },
    append: { type: "boolean", default: false },
    restore: { type: "string" },
  },
  positionals: true,
  handler: update,
};

export async function update(args, globalOpts) {
  const input = args.positionals[0];
  if (!input) {
    throw new CliError(
      "INVALID_ARGS",
      "缺少文档 URL 或 token。用法: feishu-docs update <url|token> --body <file>",
    );
  }

  const { client, authInfo } = await createClient(globalOpts);
  const doc = await resolveDocument(client, authInfo, input);
  const documentId = doc.objToken;

  if (doc.objType !== "docx") {
    throw new CliError(
      "INVALID_ARGS",
      `该文档类型 (${doc.objType}) 不支持更新`,
    );
  }

  if (args.restore) {
    return restoreFromBackup(
      client,
      authInfo,
      documentId,
      args.restore,
      globalOpts,
    );
  }

  if (!args.body) {
    throw new CliError(
      "INVALID_ARGS",
      "缺少 --body 参数。用法: feishu-docs update <url|token> --body <file>",
    );
  }

  const bodyContent = await readBody(args.body);
  if (!bodyContent.trim()) {
    throw new CliError("INVALID_ARGS", "文档内容为空，至少需要一行内容");
  }

  if (args.append) {
    return appendToDocument(
      client,
      authInfo,
      documentId,
      bodyContent,
      globalOpts,
    );
  }

  return overwriteDocument(
    client,
    authInfo,
    documentId,
    bodyContent,
    globalOpts,
  );
}

async function appendToDocument(
  client,
  authInfo,
  documentId,
  bodyContent,
  globalOpts,
) {
  const docInfo = await getDocumentInfo(client, authInfo, documentId);

  try {
    await convertAndWrite(
      authInfo,
      documentId,
      bodyContent,
      docInfo.revisionId,
      -1,
    );
  } catch (err) {
    process.stderr.write(`feishu-docs: error: 追加内容失败: ${err.message}\n`);
    throw err;
  }

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
  client,
  authInfo,
  documentId,
  bodyContent,
  globalOpts,
) {
  let backupPath;
  try {
    const backup = await backupDocument(client, authInfo, documentId);
    backupPath = backup.filepath;
  } catch (err) {
    throw new CliError("API_ERROR", `备份失败，操作中止: ${err.message}`);
  }

  const docInfo = await getDocumentInfo(client, authInfo, documentId);
  let rev;
  try {
    rev = await clearDocument(client, authInfo, documentId, docInfo.revisionId);
  } catch (err) {
    process.stderr.write(`feishu-docs: error: 清空文档失败: ${err.message}\n`);
    process.stderr.write(`feishu-docs: info: 备份文件: ${backupPath}\n`);
    throw err;
  }

  try {
    await convertAndWrite(authInfo, documentId, bodyContent, rev);
  } catch (err) {
    process.stderr.write(
      `feishu-docs: error: 写入新内容失败，尝试从备份恢复...\n`,
    );
    try {
      await restoreFromBackup(
        client,
        authInfo,
        documentId,
        backupPath,
        globalOpts,
      );
      process.stderr.write("feishu-docs: info: 已从备份自动恢复\n");
    } catch (restoreErr) {
      process.stderr.write(
        `feishu-docs: error: 自动恢复也失败: ${restoreErr.message}\n`,
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

  if (globalOpts.json) {
    process.stdout.write(
      JSON.stringify({
        success: true,
        document_id: documentId,
        mode: "overwrite",
        backup: backupPath,
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
async function restoreChildren(
  authInfo,
  documentId,
  parentBlockId,
  childIds,
  blockMap,
  revisionId,
) {
  let rev = revisionId;
  if (!childIds || childIds.length === 0) return rev;

  for (let i = 0; i < childIds.length; i += BATCH_SIZE) {
    const batchIds = childIds.slice(i, i + BATCH_SIZE);
    const batch = batchIds
      .map((id) => blockMap.get(id))
      .filter(Boolean)
      .map((b) => {
        const { block_id, parent_id, children, ...rest } = b;
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

    rev = res?.data?.document_revision_id ?? rev;
    const createdIds = res?.data?.children?.map((c) => c.block_id) || [];

    for (let j = 0; j < createdIds.length && j < batchIds.length; j++) {
      const original = blockMap.get(batchIds[j]);
      if (original?.children?.length > 0) {
        await sleep(QPS_DELAY);
        rev = await restoreChildren(
          authInfo,
          documentId,
          createdIds[j],
          original.children,
          blockMap,
          rev,
        );
      }
    }
  }

  return rev;
}

async function restoreFromBackup(
  client,
  authInfo,
  documentId,
  backupPath,
  globalOpts,
) {
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
  let blocks;
  try {
    blocks = JSON.parse(raw);
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

  const docInfo = await getDocumentInfo(client, authInfo, documentId);
  let rev = await clearDocument(
    client,
    authInfo,
    documentId,
    docInfo.revisionId,
  );

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
      `feishu-docs: error: 恢复过程中出错: ${restoreErr.message}\n` +
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
