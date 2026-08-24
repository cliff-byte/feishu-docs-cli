/**
 * read command: Read a Feishu document and output as Markdown.
 */

import { createClient, fetchWithAuth } from "../client.js";
import { blocksToMarkdown } from "../parser/blocks-to-md.js";
import { CliError } from "../utils/errors.js";
import { fetchAllBlocks } from "../services/doc-blocks.js";
import { fetchDocumentMarkdown } from "../services/doc-markdown.js";
import { enrichTaskTags } from "../services/task-enrichment.js";
import { getDocumentInfo } from "../services/block-writer.js";
import { resolveDocument } from "../utils/document-resolver.js";
import { enrichBlocks } from "../services/doc-enrichment.js";
import { getDriveMeta, DRIVE_META_SCOPE } from "../services/drive-meta.js";
import { resolveUserNames } from "../services/doc-enrichment.js";
import { withScopeRecovery } from "../utils/scope-prompt.js";
import { formatEpochSeconds } from "../utils/format-time.js";
import { parseDocUrl } from "../utils/url-parser.js";
import {
  fetchBitableRecord,
  fetchBitableTable,
} from "../services/bitable.js";
import type {
  CommandMeta,
  CommandArgs,
  GlobalOpts,
  AuthInfo,
  Block,
} from "../types/index.js";
import type {
  BitableField,
  BitableRecord,
} from "../types/api-responses.js";

/**
 * Fetch raw text content of a document.
 */
async function fetchRawContent(
  authInfo: AuthInfo,
  documentId: string,
): Promise<string> {
  const res = await fetchWithAuth(
    authInfo,
    `/open-apis/docx/v1/documents/${encodeURIComponent(documentId)}/raw_content`,
  );
  return ((res?.data as Record<string, unknown>)?.content as string) || "";
}

export const meta: CommandMeta = {
  options: {
    raw: { type: "boolean", default: false },
    blocks: { type: "boolean", default: false },
    "with-meta": { type: "boolean", default: false },
  },
  positionals: true,
  handler: read,
};

export async function read(
  args: CommandArgs,
  globalOpts: GlobalOpts,
): Promise<void> {
  const input = args.positionals![0];
  if (!input) {
    throw new CliError(
      "INVALID_ARGS",
      "缺少文档 URL 或 token。用法: feishu-docs read <url|token>",
    );
  }

  const parsedInput = parseDocUrl(input);
  const { authInfo } = await createClient(globalOpts);
  if (parsedInput.type === "bitable_record") {
    rejectUnsupportedBitableFlags(args);
    const data = await fetchBitableRecord(authInfo, parsedInput.token);
    outputBitableRecord(data, globalOpts.json);
    return;
  }

  const doc = await resolveDocument(authInfo, input);
  const documentId = doc.objToken;
  const docType = doc.objType;
  const docTitle = doc.title;

  if (docType === "bitable") {
    rejectUnsupportedBitableFlags(args);
    const tableId = doc.parsed.tableId;
    if (!tableId) {
      throw new CliError(
        "INVALID_ARGS",
        "多维表格 URL 缺少 table 参数，无法确定要读取的数据表",
        {
          recovery:
            "请在飞书中打开目标数据表，并复制包含 ?table=<table_id> 的完整 URL",
        },
      );
    }
    const data = await fetchBitableTable(authInfo, {
      baseToken: documentId,
      tableId,
      ...(doc.parsed.viewId && { viewId: doc.parsed.viewId }),
    });
    outputBitableTable(data, docTitle, globalOpts.json);
    return;
  }

  if (
    (doc.parsed.type === "wiki" || doc.parsed.type === "unknown") &&
    docType !== "docx" &&
    doc.title !== undefined
  ) {
    const msg = docTitle
      ? `[${docType}: ${docTitle} (${documentId})]`
      : `[${docType}: ${documentId}]`;
    process.stdout.write(msg + "\n");
    return;
  }

  if (docType === "doc") {
    throw new CliError(
      "INVALID_ARGS",
      "不支持旧版 doc 格式，请在飞书中升级为 docx",
    );
  }

  // Non-docx types (sheet, bitable, board, etc.) -- output placeholder
  if (docType !== "docx") {
    process.stdout.write(`[${docType}: ${documentId}]\n`);
    return;
  }

  // --raw mode: fetch raw text only
  if (args.raw) {
    const content = await fetchRawContent(authInfo, documentId);
    process.stdout.write(content + "\n");
    return;
  }

  // --blocks mode: output raw JSON
  if (args.blocks) {
    const blocks = await fetchBlocks(authInfo, documentId);
    process.stdout.write(JSON.stringify(blocks, null, 2) + "\n");
    return;
  }

  // Default: use Feishu's server-rendered Markdown. Keep the block renderer as
  // a compatibility fallback because docs_ai is not yet in the public API docs.
  let markdown: string;
  try {
    markdown = await fetchDocumentMarkdown(authInfo, documentId);
    try {
      markdown = await enrichTaskTags(markdown, globalOpts);
    } catch (err) {
      process.stderr.write(
        `feishu-docs: warning: 待办详情读取失败，保留 docs_ai task 标签: ${(err as Error).message}\n`,
      );
    }
  } catch (err) {
    process.stderr.write(
      `feishu-docs: warning: docs_ai 读取失败，回退到文档块解析: ${(err as Error).message}\n`,
    );
    const blocks = await fetchBlocks(authInfo, documentId);
    const enrichment = await enrichBlocks(authInfo, blocks, globalOpts);
    markdown = blocksToMarkdown(blocks, {
      imageUrlMap: enrichment.imageUrlMap,
      userNameMap: enrichment.userNameMap,
      bitableDataMap: enrichment.bitableDataMap,
      boardImageMap: enrichment.boardImageMap,
      sheetDataMap: enrichment.sheetDataMap,
    });
  }

  // Add metadata header if requested
  let output = "";
  if (args.withMeta) {
    let meta: Record<string, unknown> = {};
    try {
      meta = await getDocumentInfo(authInfo, documentId);
    } catch {
      // ignore metadata fetch errors
    }

    // Wiki docs carry node metadata; standalone docx needs a Drive meta lookup.
    let creator = doc.creator;
    let owner = doc.owner;
    let createTime = doc.objCreateTime;
    let editTime = doc.objEditTime;
    if (!doc.spaceId) {
      try {
        const dm = await withScopeRecovery(
          () => getDriveMeta(authInfo, documentId, "docx"),
          globalOpts,
          [DRIVE_META_SCOPE],
        );
        owner = owner ?? dm.owner;
        createTime = createTime ?? dm.createTime;
        editTime = editTime ?? dm.modifyTime;
      } catch {
        // best-effort: missing Drive scope must not fail the read
      }
    }

    // Resolve creator/owner open-ids to names (best-effort; keeps ids too).
    let creatorName: string | undefined;
    let ownerName: string | undefined;
    const userIds = [...new Set([creator, owner].filter((x): x is string => !!x))];
    if (userIds.length > 0) {
      const names = await resolveUserNames(authInfo, userIds);
      creatorName = creator ? names.get(creator) : undefined;
      ownerName = owner ? names.get(owner) : undefined;
    }

    output += "---\n";
    if (docTitle || meta.title) output += `title: ${docTitle || meta.title}\n`;
    if (meta.revisionId) output += `revision: ${meta.revisionId}\n`;
    output += `token: ${documentId}\n`;
    if (creator) output += `creator: ${creator}\n`;
    if (creatorName) output += `creator_name: ${creatorName}\n`;
    if (owner) output += `owner: ${owner}\n`;
    if (ownerName) output += `owner_name: ${ownerName}\n`;
    const createdAt = formatEpochSeconds(createTime);
    if (createdAt) output += `created: ${createdAt}\n`;
    const editedAt = formatEpochSeconds(editTime);
    if (editedAt) output += `modified: ${editedAt}\n`;
    output += "---\n\n";
  }

  output += markdown;
  process.stdout.write(output);
}

function rejectUnsupportedBitableFlags(args: CommandArgs): void {
  const flag = args.raw
    ? "--raw"
    : args.blocks
      ? "--blocks"
      : args.withMeta
        ? "--with-meta"
        : undefined;
  if (flag) {
    throw new CliError("NOT_SUPPORTED", `多维表格读取不支持 ${flag}`, {
      recovery: "使用 feishu-docs read <url> --json 获取结构化数据",
    });
  }
}

function formatBitableValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "object") return JSON.stringify(value) ?? "";
  return String(value);
}

function escapeMarkdownCell(value: unknown): string {
  return formatBitableValue(value)
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ");
}

function markdownTable(headers: string[], rows: unknown[][]): string {
  const header = `| ${headers.map(escapeMarkdownCell).join(" | ")} |`;
  const separator = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map(
    (row) => `| ${row.map(escapeMarkdownCell).join(" | ")} |`,
  );
  return [header, separator, ...body].join("\n") + "\n";
}

function outputBitableTable(
  data: Awaited<ReturnType<typeof fetchBitableTable>>,
  title: string | undefined,
  json: boolean,
): void {
  if (json) {
    process.stdout.write(
      JSON.stringify(
        {
          success: true,
          type: "bitable",
          ...(title && { title }),
          base_token: data.baseToken,
          table_id: data.tableId,
          ...(data.viewId && { view_id: data.viewId }),
          total: data.total,
          fields: data.fields,
          records: data.records,
        },
        null,
        2,
      ) + "\n",
    );
    return;
  }

  const fieldNames = data.fields.map((field) => field.field_name);
  if (fieldNames.length === 0) {
    process.stdout.write("多维表格没有可读取的字段\n");
    return;
  }
  const rows = data.records.map((record) =>
    fieldNames.map((name) => record.fields[name]),
  );
  process.stdout.write(markdownTable(fieldNames, rows));
}

function outputBitableRecord(
  data: Awaited<ReturnType<typeof fetchBitableRecord>>,
  json: boolean,
): void {
  if (json) {
    process.stdout.write(
      JSON.stringify(
        {
          success: true,
          type: "bitable_record",
          record_share_token: data.recordShareToken,
          base_token: data.baseToken,
          table_id: data.tableId,
          record_id: data.recordId,
          fields: data.fields,
          record: data.record,
        },
        null,
        2,
      ) + "\n",
    );
    return;
  }

  const names = orderedRecordFieldNames(data.fields, data.record);
  if (names.length === 0) {
    process.stdout.write("记录没有字段值\n");
    return;
  }
  process.stdout.write(
    markdownTable(
      ["字段", "值"],
      names.map((name) => [name, data.record.fields[name]]),
    ),
  );
}

function orderedRecordFieldNames(
  fields: BitableField[],
  record: BitableRecord,
): string[] {
  const schemaNames = fields.map((field) => field.field_name);
  const extraNames = Object.keys(record.fields).filter(
    (name) => !schemaNames.includes(name),
  );
  return [...schemaNames, ...extraNames];
}

async function fetchBlocks(
  authInfo: AuthInfo,
  documentId: string,
): Promise<Block[]> {
  try {
    return await fetchAllBlocks(authInfo, documentId);
  } catch (err) {
    if (
      err instanceof CliError &&
      (err.errorType === "PERMISSION_DENIED" ||
        err.errorType === "SCOPE_MISSING")
    ) {
      throw new CliError(
        "PERMISSION_DENIED",
        "读取文档内容权限不足。可能原因:\n" +
          "  1. 应用未在飞书开发者后台开通 docx:document 权限 → 请前往 https://open.feishu.cn/app 开通\n" +
          "  2. 文档未对当前用户/应用开放访问 → 请联系文档拥有者授权\n" +
          '开通权限后，运行 feishu-docs authorize --scope "docx:document" 重新授权',
      );
    }
    throw err;
  }
}
