/** Version-checked text replacements that keep existing inline elements intact. */
import { randomUUID } from "node:crypto";
import { fetchWithAuth } from "../client.js";
import { CliError } from "../utils/errors.js";
import { validateToken } from "../utils/validate.js";
import { getDocumentInfo } from "./block-writer.js";
import { fetchAllBlocks } from "./doc-blocks.js";
import type { AuthInfo, Block, BlockText, TextElement } from "../types/index.js";

export interface TextEdit {
  block_id: string;
  old_text: string;
  new_text: string;
}

export interface PatchInput {
  document_revision_id: number;
  edits: TextEdit[];
}

const recovery = "重新运行 info --json 和 read --blocks 获取版本及原文，更新补丁后先用 patch --dry-run 预览";

function invalid(message: string): never {
  throw new CliError("INVALID_ARGS", message, { recovery });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parsePatchInput(content: string): PatchInput {
  const value: unknown = (() => {
    try { return JSON.parse(content); }
    catch { return invalid("补丁必须是有效 JSON"); }
  })();
  if (!isRecord(value) || Object.keys(value).some((key) => !["document_revision_id", "edits"].includes(key))) {
    return invalid("补丁仅接受 document_revision_id 和 edits 字段");
  }
  const revision = value.document_revision_id;
  if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0) {
    return invalid("document_revision_id 必须为非负安全整数，不接受 -1（最新版本）");
  }
  if (!Array.isArray(value.edits) || value.edits.length < 1 || value.edits.length > 200) {
    return invalid("edits 必须包含 1–200 个不同块的替换操作");
  }
  const edits = value.edits.map((edit: unknown): TextEdit => {
    if (!isRecord(edit) || Object.keys(edit).some((key) => !["block_id", "old_text", "new_text"].includes(key)) ||
        typeof edit.block_id !== "string" || typeof edit.old_text !== "string" ||
        !edit.old_text.length || typeof edit.new_text !== "string") {
      return invalid("每项 edits 仅接受字符串 block_id、非空 old_text 和字符串 new_text");
    }
    try { validateToken(edit.block_id, "block_id"); }
    catch { return invalid("补丁包含无效的 block_id"); }
    if (edit.old_text === edit.new_text) return invalid("old_text 与 new_text 相同，无需更新");
    return { block_id: edit.block_id, old_text: edit.old_text, new_text: edit.new_text };
  });
  if (new Set(edits.map((edit) => edit.block_id)).size !== edits.length) {
    return invalid("同一补丁中的 block_id 不能重复，请合并或分次执行");
  }
  return { document_revision_id: revision, edits };
}

// Only text-bearing block types supported by update_text_elements. The page
// title and structural blocks deliberately remain outside the patch contract.
const TEXT_FIELDS: Readonly<Record<number, keyof Block>> = {
  2: "text", 3: "heading1", 4: "heading2", 5: "heading3", 6: "heading4",
  7: "heading5", 8: "heading6", 9: "heading7", 10: "heading8", 11: "heading9",
  12: "bullet", 13: "ordered", 14: "code", 15: "quote", 17: "todo",
};

export function replaceBlockText(block: Block, edit: TextEdit): TextElement[] {
  const field = TEXT_FIELDS[block.block_type];
  const elements = field ? (block[field] as BlockText | undefined)?.elements : undefined;
  if (!Array.isArray(elements)) {
    throw new CliError("NOT_SUPPORTED", `块 ${edit.block_id} 不支持文本局部编辑`, { recovery });
  }
  // Unknown inline data cannot be promised to survive a round trip.
  const supported = ["text_run", "mention_user", "mention_doc", "equation", "reminder", "file", "inline_block", "link_preview"];
  if (elements.some((element) => !isRecord(element) || Object.keys(element).length !== 1 ||
      !supported.includes(Object.keys(element)[0]) ||
      !isRecord(Object.values(element)[0]) ||
      (element.text_run !== undefined && (!isRecord(element.text_run) || typeof element.text_run.content !== "string")))) {
    throw new CliError("NOT_SUPPORTED", `块 ${edit.block_id} 含无法安全保留的文本元素`, { recovery });
  }
  // Do not concatenate across formatting or mention boundaries: replacement
  // text inherits precisely the original run's style and comment anchors.
  const matches = elements.flatMap((element, index) => {
    const text = element.text_run?.content;
    if (text === undefined) return [];
    const start = text.indexOf(edit.old_text);
    if (start < 0) return [];
    if (text.indexOf(edit.old_text, start + 1) >= 0) return [index, index];
    return [index];
  });
  if (matches.length !== 1) {
    return invalid(`块 ${edit.block_id} 的 old_text 必须在单个 text_run 内唯一匹配（不支持跨格式或跨提及替换）`);
  }
  return elements.map((element, index) => {
    if (index !== matches[0]) return element;
    const run = element.text_run!;
    const start = run.content.indexOf(edit.old_text);
    return { ...element, text_run: { ...run,
      content: run.content.slice(0, start) + edit.new_text + run.content.slice(start + edit.old_text.length),
    } };
  });
}

async function checkRevision(authInfo: AuthInfo, documentId: string, expected: number): Promise<void> {
  const { revisionId } = await getDocumentInfo(authInfo, documentId);
  if (!Number.isSafeInteger(revisionId) || revisionId !== expected) {
    throw new CliError("API_ERROR", "文档版本与补丁不一致，已停止局部编辑", { recovery });
  }
}

export async function patchDocument(
  authInfo: AuthInfo,
  documentId: string,
  input: PatchInput,
  dryRun: boolean,
) {
  try { validateToken(documentId, "document_id"); }
  catch { return invalid("无效的 document_id"); }
  // Validate even for direct callers, before any request.
  const validated = parsePatchInput(JSON.stringify(input));
  const revision = validated.document_revision_id;
  let writeAttempted = false;
  try {
    await checkRevision(authInfo, documentId, revision);
    const blocks = await fetchAllBlocks(authInfo, documentId, revision);
    const requests = validated.edits.map((edit) => {
      const block = blocks.find((item) => item.block_id === edit.block_id);
      if (!block) throw new CliError("NOT_FOUND", `文档中不存在块 ${edit.block_id}`, { recovery });
      return { block_id: edit.block_id, update_text_elements: { elements: replaceBlockText(block, edit) } };
    });
    await checkRevision(authInfo, documentId, revision);
    const preview = {
      success: true,
      document_id: documentId,
      mode: "patch",
      dry_run: dryRun,
      base_revision_id: revision,
      changes: validated.edits,
    };
    if (dryRun) return { ...preview, document_revision_id: revision, updated_blocks: 0 };

    // Feishu accepts stale revisions: this is NOT compare-and-swap. Preflight
    // checks narrow the race window; a response revision jump reports a race
    // after submission, without pretending that the write was prevented.
    writeAttempted = true;
    const response = await fetchWithAuth<{ document_revision_id?: number }>(
      authInfo,
      `/open-apis/docx/v1/documents/${encodeURIComponent(documentId)}/blocks/batch_update`,
      {
        method: "PATCH",
        params: { document_revision_id: revision, user_id_type: "open_id", client_token: randomUUID() },
        body: { requests },
        retry: false,
      },
    );
    const newRevision = response.data?.document_revision_id;
    if (typeof newRevision !== "number" || !Number.isSafeInteger(newRevision) || newRevision <= revision) {
      throw new CliError("API_ERROR", "写入响应缺少有效的新版本号，写入结果需核验", { recovery });
    }
    if (newRevision !== revision + 1) {
      throw new CliError("API_ERROR", "返回的文档版本发生跳变，可能存在并发修改；写入可能已生效，请立即核验", {
        recovery: "读取目标块并结合飞书版本历史核验；不要直接重试或自动回滚，确认需要的内容后重新生成补丁",
        details: { write_may_have_applied: true, base_revision_id: revision, document_revision_id: newRevision },
      });
    }
    return { ...preview, document_revision_id: newRevision, updated_blocks: requests.length };
  } catch (err) {
    if (err instanceof CliError) {
      throw new CliError(err.errorType, err.apiCode === 1770064
        ? "文档发生并发修改，已停止局部编辑"
        : err.message, {
        apiCode: err.apiCode,
        missingScopes: err.missingScopes,
        recovery: err.recovery ?? (writeAttempted ? `写入未确认，请先读取目标块核验结果，勿直接重试。${recovery}` : recovery),
        details: err.details ?? { write_may_have_applied: writeAttempted },
      });
    }
    throw new CliError("API_ERROR", writeAttempted ? "局部编辑请求失败，写入结果需核验" : "局部编辑预检失败，未提交写入", {
      recovery: writeAttempted ? `先读取目标块核验写入结果，勿直接重试。${recovery}` : recovery,
      details: { write_may_have_applied: writeAttempted },
    });
  }
}
