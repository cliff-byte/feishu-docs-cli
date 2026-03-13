/**
 * delete command: Move document to recycle bin.
 */

import { createClient, fetchWithAuth } from "../client.js";
import { loadTokens } from "../auth.js";
import { CliError } from "../utils/errors.js";
import {
  FEATURE_SCOPE_GROUPS,
  getMissingScopes,
  buildScopeHint,
} from "../scopes.js";
import { resolveDocument } from "../utils/document-resolver.js";
import { mapToDriveType } from "../utils/drive-types.js";
import {
  CommandMeta,
  CommandArgs,
  GlobalOpts,
  AuthInfo,
} from "../types/index.js";

/**
 * Check if a node has children in the knowledge base.
 */
async function checkChildren(
  authInfo: AuthInfo,
  spaceId: string,
  nodeToken: string,
): Promise<boolean> {
  try {
    const res = await fetchWithAuth(
      authInfo,
      `/open-apis/wiki/v2/spaces/${encodeURIComponent(spaceId)}/nodes`,
      { params: { parent_node_token: nodeToken, page_size: 1 } },
    );
    const data = res?.data as Record<string, unknown> | undefined;
    return ((data?.items as unknown[] | undefined)?.length || 0) > 0;
  } catch {
    return false;
  }
}

export const meta: CommandMeta = {
  options: {
    confirm: { type: "boolean", default: false },
    recursive: { type: "boolean", default: false },
  },
  positionals: true,
  handler: del,
};

export async function del(
  args: CommandArgs,
  globalOpts: GlobalOpts,
): Promise<void> {
  const input = args.positionals![0];
  if (!input) {
    throw new CliError(
      "INVALID_ARGS",
      "缺少文档 URL 或 token。用法: feishu-docs delete <url|token>",
    );
  }

  const { authInfo } = await createClient(globalOpts);

  // Pre-flight scope check for drive delete
  if (authInfo.mode === "user") {
    const stored = await loadTokens();
    if (stored) {
      const required = [...FEATURE_SCOPE_GROUPS.drive.scopes];
      const missing = getMissingScopes(stored.tokens.scope, required);
      if (missing.length > 0) {
        throw new CliError("AUTH_REQUIRED", buildScopeHint(missing));
      }
    }
  }

  const doc = await resolveDocument(authInfo, input);

  if (doc.objType === "doc") {
    throw new CliError(
      "NOT_SUPPORTED",
      "旧版 doc 类型不支持此操作，请在飞书客户端中将文档升级为 docx 格式",
    );
  }

  // Check for children — refuse unless --recursive
  if (doc.hasChild && doc.spaceId && doc.nodeToken) {
    const hasChildren = await checkChildren(
      authInfo,
      doc.spaceId,
      doc.nodeToken,
    );
    if (hasChildren && !args.recursive) {
      throw new CliError(
        "INVALID_ARGS",
        "该节点下有子文档，删除将同时删除所有子节点。如需继续，请添加 --recursive 参数",
      );
    }
  }

  // Confirmation prompt (unless --confirm)
  if (!args.confirm) {
    const titleStr = doc.title || doc.objToken;
    process.stderr.write(`\n即将删除文档:\n`);
    process.stderr.write(`  标题: ${titleStr}\n`);
    process.stderr.write(`  类型: ${doc.objType}\n`);
    process.stderr.write(`  token: ${doc.objToken}\n`);
    if (doc.spaceId) {
      process.stderr.write(`  知识库: ${doc.spaceId}\n`);
    }
    process.stderr.write(`\n  文档将移入回收站，30 天后永久删除。\n`);
    process.stderr.write(`  如需跳过此确认，请添加 --confirm 参数。\n\n`);

    // In non-interactive mode (Agent), just output the prompt and exit
    // Agent should use --confirm
    throw new CliError(
      "INVALID_ARGS",
      "操作已取消。Agent 调用请添加 --confirm 参数",
    );
  }

  // Wiki documents cannot be deleted via Open API — the drive/v1/files DELETE
  // endpoint only works for files in the user's personal Space, not wiki nodes.
  if (doc.spaceId) {
    throw new CliError(
      "NOT_SUPPORTED",
      `知识库文档不支持通过 API 删除。飞书开放平台未提供删除知识库节点的 API。\n` +
        `  请在飞书客户端中手动删除: ${doc.title || doc.objToken}\n` +
        `  知识库: ${doc.spaceId}, 节点: ${doc.nodeToken}`,
    );
  }

  // Map doc type to drive file type (personal space files only)
  const driveType = mapToDriveType(doc.objType);

  // Execute delete (use fetchWithAuth to avoid SDK token override)
  await fetchWithAuth(
    authInfo,
    `/open-apis/drive/v1/files/${encodeURIComponent(doc.objToken)}`,
    {
      method: "DELETE",
      params: { type: driveType },
    },
  );

  if (globalOpts.json) {
    process.stdout.write(
      JSON.stringify({
        success: true,
        deleted: doc.objToken,
        title: doc.title,
        type: doc.objType,
      }) + "\n",
    );
  } else {
    const titleStr = doc.title || doc.objToken;
    process.stdout.write(`已将 "${titleStr}" 移入回收站\n`);
  }
}
