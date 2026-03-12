/**
 * Document infrastructure: backup/restore, clearing, helpers.
 *
 * Note: The old block-level write functions (writeBlocks, writeTableBlock,
 * writeNestedBlocks, writeAllBlocks) have been replaced by the Convert +
 * Descendant API pipeline in markdown-convert.js.
 */

import { readFile, mkdir, writeFile, readdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve, normalize } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { fetchWithAuth } from "../client.js";
import { CliError } from "../utils/errors.js";
import { fetchAllBlocks } from "./doc-blocks.js";
import { AuthInfo, Block } from "../types/index.js";

export const BACKUPS_DIR: string = join(homedir(), ".feishu-docs", "backups");
export const BATCH_SIZE: number = 50;
export const QPS_DELAY: number = 400;

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Read body content from file path or stdin ("-").
 */
export async function readBody(bodyArg: string): Promise<string> {
  if (bodyArg === "-") {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString("utf8");
  }

  const resolvedPath = resolve(normalize(bodyArg));
  if (!existsSync(resolvedPath)) {
    throw new CliError("FILE_NOT_FOUND", `文件不存在: ${resolvedPath}`);
  }

  return readFile(resolvedPath, "utf8");
}

// --- Document info helpers ---

export async function getDocumentInfo(
  authInfo: AuthInfo,
  documentId: string,
): Promise<{ title: string; revisionId: number }> {
  const res = await fetchWithAuth(
    authInfo,
    `/open-apis/docx/v1/documents/${encodeURIComponent(documentId)}`,
  );
  const data = res?.data as Record<string, unknown> | undefined;
  const doc = (data?.document || {}) as Record<string, unknown>;
  return {
    title: doc.title as string,
    revisionId: doc.revision_id as number,
  };
}

export async function getRootChildrenCount(
  authInfo: AuthInfo,
  documentId: string,
): Promise<number> {
  const res = await fetchWithAuth(
    authInfo,
    `/open-apis/docx/v1/documents/${encodeURIComponent(documentId)}/blocks/${encodeURIComponent(documentId)}`,
    { params: { document_revision_id: -1 } },
  );
  return (
    (res?.data as Record<string, unknown>)?.block as Record<string, unknown>
  )?.children
    ? ((res?.data as Record<string, unknown>).block as { children: unknown[] })
        .children.length
    : 0;
}

/**
 * Clear all top-level children of a document (batch delete from end).
 */
export async function clearDocument(
  authInfo: AuthInfo,
  documentId: string,
  revisionId: number,
): Promise<number> {
  let rev = revisionId;
  let remaining = await getRootChildrenCount(authInfo, documentId);
  let conflictRetries = 0;
  const MAX_CONFLICT_RETRIES = 5;

  while (remaining > 0) {
    const end = remaining;
    const start = Math.max(0, remaining - BATCH_SIZE);

    try {
      const res = await fetchWithAuth(
        authInfo,
        `/open-apis/docx/v1/documents/${encodeURIComponent(documentId)}/blocks/${encodeURIComponent(documentId)}/children/batch_delete`,
        {
          method: "DELETE",
          body: { start_index: start, end_index: end },
          params: {
            document_revision_id: rev,
            client_token: randomUUID(),
          },
        },
      );

      rev =
        ((res?.data as Record<string, unknown>)
          ?.document_revision_id as number) ?? rev;
      remaining = start;
      conflictRetries = 0;
      if (remaining > 0) await sleep(QPS_DELAY);
    } catch (err: unknown) {
      const code =
        (err as { apiCode?: number; code?: number })?.apiCode ||
        (err as { apiCode?: number; code?: number })?.code;
      if (code === 1770064) {
        if (++conflictRetries > MAX_CONFLICT_RETRIES) {
          throw new CliError(
            "API_ERROR",
            "文档正在被并发编辑，清空操作失败，请稍后重试",
          );
        }
        const doc = await getDocumentInfo(authInfo, documentId);
        rev = doc.revisionId;
        remaining = await getRootChildrenCount(authInfo, documentId);
      } else {
        throw err;
      }
    }
  }

  return rev;
}

// --- Backup helpers ---

export async function backupDocument(
  authInfo: AuthInfo,
  documentId: string,
): Promise<{ filepath: string; blocks: Block[] }> {
  const blocks = await fetchAllBlocks(authInfo, documentId);

  await mkdir(BACKUPS_DIR, { recursive: true, mode: 0o700 });

  const filename = `${documentId}-${Date.now()}.json`;
  const filepath = join(BACKUPS_DIR, filename);
  await writeFile(filepath, JSON.stringify(blocks, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  process.stderr.write(`feishu-docs: info: 备份已保存到 ${filepath}\n`);

  await rotateBackups();

  return { filepath, blocks };
}

async function rotateBackups(): Promise<void> {
  try {
    const files = await readdir(BACKUPS_DIR);
    const jsonFiles = files.filter((f) => f.endsWith(".json")).sort();
    if (jsonFiles.length > 10) {
      const toDelete = jsonFiles.slice(0, jsonFiles.length - 10);
      for (const f of toDelete) {
        await unlink(join(BACKUPS_DIR, f));
      }
    }
  } catch (err: unknown) {
    process.stderr.write(
      `feishu-docs: warning: 备份轮转失败: ${(err as Error).message}\n`,
    );
  }
}
