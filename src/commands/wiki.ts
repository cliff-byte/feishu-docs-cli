/**
 * wiki command: Wiki space and node management.
 * Subcommands: create-space, add-member, remove-member, rename, move, copy.
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
import { validateMemberId, detectMemberType } from "../utils/member.js";
import { validateToken } from "../utils/validate.js";
import {
  SubcommandMeta,
  CommandArgs,
  GlobalOpts,
  AuthInfo,
} from "../types/index.js";

/**
 * Resolve a wiki node URL/token to { spaceId, nodeToken }.
 */
async function resolveWikiNode(
  authInfo: AuthInfo,
  input: string,
): Promise<Awaited<ReturnType<typeof resolveDocument>>> {
  const doc = await resolveDocument(authInfo, input);
  if (!doc.spaceId || !doc.nodeToken) {
    throw new CliError(
      "INVALID_ARGS",
      "该输入不是知识库节点，请使用知识库文档的 URL 或 wiki token",
    );
  }
  return doc;
}

/**
 * Pre-flight scope check for wiki management commands.
 */
async function checkWikiScope(
  authInfo: AuthInfo,
  feature: "wiki-space" | "wiki-node" | "wiki-member",
): Promise<void> {
  if (authInfo.mode === "user") {
    const stored = await loadTokens();
    if (stored) {
      const required = [...FEATURE_SCOPE_GROUPS[feature].scopes];
      const missing = getMissingScopes(stored.tokens.scope, required);
      if (missing.length > 0) {
        throw new CliError("AUTH_REQUIRED", buildScopeHint(missing));
      }
    }
  }
}

// --- Subcommand: create-space ---

async function createSpace(
  args: CommandArgs,
  globalOpts: GlobalOpts,
): Promise<void> {
  const name = args.positionals![0];
  if (!name) {
    throw new CliError(
      "INVALID_ARGS",
      "缺少知识库名称。用法: feishu-docs wiki create-space <name> [--desc <description>]",
    );
  }

  const { authInfo } = await createClient(globalOpts);
  await checkWikiScope(authInfo, "wiki-space");

  const descStr = args.desc as string | undefined;
  const body: Record<string, string> = {
    name,
    ...(descStr && { description: descStr }),
  };

  const res = await fetchWithAuth(authInfo, "/open-apis/wiki/v2/spaces", {
    method: "POST",
    body,
  });

  const resData = res?.data as Record<string, unknown> | undefined;
  const space = resData?.space as Record<string, string> | undefined;
  if (!space) {
    throw new CliError("API_ERROR", "创建知识库成功但未返回 space 信息");
  }

  if (globalOpts.json) {
    process.stdout.write(
      JSON.stringify({ success: true, ...space }, null, 2) + "\n",
    );
  } else {
    process.stdout.write(`已创建知识库: ${space.name}\n`);
    process.stdout.write(`space_id: ${space.space_id}\n`);
  }
}

// --- Subcommand: add-member ---

async function addMember(
  args: CommandArgs,
  globalOpts: GlobalOpts,
): Promise<void> {
  const spaceId = args.positionals![0];
  const memberId = args.positionals![1];
  if (!spaceId || !memberId) {
    throw new CliError(
      "INVALID_ARGS",
      "用法: feishu-docs wiki add-member <space_id> <member> [--role admin|member]",
    );
  }

  validateToken(spaceId, "space_id");
  validateMemberId(memberId);
  const memberType = detectMemberType(memberId);
  const memberRole = (args.role as string | undefined) || "member";

  if (memberRole !== "admin" && memberRole !== "member") {
    throw new CliError(
      "INVALID_ARGS",
      `无效的角色: ${memberRole}。可选值: admin, member`,
    );
  }

  const { authInfo } = await createClient(globalOpts);
  await checkWikiScope(authInfo, "wiki-member");

  let alreadyExist = false;
  try {
    await fetchWithAuth(
      authInfo,
      `/open-apis/wiki/v2/spaces/${encodeURIComponent(spaceId)}/members`,
      {
        method: "POST",
        body: {
          member_type: memberType,
          member_id: memberId,
          member_role: memberRole,
        },
      },
    );
  } catch (err) {
    if ((err as Record<string, unknown>).apiCode === 131008) {
      alreadyExist = true;
    } else {
      throw err;
    }
  }

  if (globalOpts.json) {
    process.stdout.write(
      JSON.stringify({
        success: true,
        space_id: spaceId,
        member_id: memberId,
        member_type: memberType,
        member_role: memberRole,
        already_exist: alreadyExist,
      }) + "\n",
    );
  } else {
    if (alreadyExist) {
      process.stdout.write(`${memberId} 已是知识库 ${spaceId} 的成员\n`);
    } else {
      process.stdout.write(
        `已添加 ${memberId} 为知识库 ${spaceId} 的${memberRole === "admin" ? "管理员" : "成员"}\n`,
      );
    }
  }
}

// --- Subcommand: remove-member ---

async function removeMember(
  args: CommandArgs,
  globalOpts: GlobalOpts,
): Promise<void> {
  const spaceId = args.positionals![0];
  const memberId = args.positionals![1];
  if (!spaceId || !memberId) {
    throw new CliError(
      "INVALID_ARGS",
      "用法: feishu-docs wiki remove-member <space_id> <member> [--role admin|member]",
    );
  }

  validateToken(spaceId, "space_id");
  validateMemberId(memberId);
  const memberType = detectMemberType(memberId);
  const memberRole = (args.role as string | undefined) || "member";

  const { authInfo } = await createClient(globalOpts);
  await checkWikiScope(authInfo, "wiki-member");

  await fetchWithAuth(
    authInfo,
    `/open-apis/wiki/v2/spaces/${encodeURIComponent(spaceId)}/members/${encodeURIComponent(memberId)}`,
    {
      method: "DELETE",
      body: {
        member_type: memberType,
        member_role: memberRole,
      },
    },
  );

  if (globalOpts.json) {
    process.stdout.write(
      JSON.stringify({
        success: true,
        space_id: spaceId,
        removed: memberId,
      }) + "\n",
    );
  } else {
    process.stdout.write(`已移除 ${memberId} 从知识库 ${spaceId}\n`);
  }
}

// --- Subcommand: rename ---

async function rename(
  args: CommandArgs,
  globalOpts: GlobalOpts,
): Promise<void> {
  const input = args.positionals![0];
  if (!input || !args.title) {
    throw new CliError(
      "INVALID_ARGS",
      "用法: feishu-docs wiki rename <url|token> --title <new_title>",
    );
  }

  const { authInfo } = await createClient(globalOpts);
  await checkWikiScope(authInfo, "wiki-node");
  const doc = await resolveWikiNode(authInfo, input);

  await fetchWithAuth(
    authInfo,
    `/open-apis/wiki/v2/spaces/${encodeURIComponent(doc.spaceId!)}/nodes/${encodeURIComponent(doc.nodeToken!)}/update_title`,
    {
      method: "POST",
      body: { title: args.title },
    },
  );

  if (globalOpts.json) {
    process.stdout.write(
      JSON.stringify({
        success: true,
        space_id: doc.spaceId,
        node_token: doc.nodeToken,
        title: args.title,
      }) + "\n",
    );
  } else {
    process.stdout.write(`已重命名为: ${args.title}\n`);
  }
}

// --- Subcommand: move ---

async function move(args: CommandArgs, globalOpts: GlobalOpts): Promise<void> {
  const input = args.positionals![0];
  if (!input) {
    throw new CliError(
      "INVALID_ARGS",
      "用法: feishu-docs wiki move <url|token> --to <space_id> [--parent <node_token>]",
    );
  }

  if (!args.to && !args.parent) {
    throw new CliError(
      "INVALID_ARGS",
      "至少需要 --to <space_id> 或 --parent <node_token>",
    );
  }

  const { authInfo } = await createClient(globalOpts);
  await checkWikiScope(authInfo, "wiki-node");
  const doc = await resolveWikiNode(authInfo, input);

  const toStr = args.to as string | undefined;
  const parentStr = args.parent as string | undefined;
  const body: Record<string, string> = {
    ...(toStr && { target_space_id: toStr }),
    ...(parentStr && { target_parent_token: parentStr }),
  };

  await fetchWithAuth(
    authInfo,
    `/open-apis/wiki/v2/spaces/${encodeURIComponent(doc.spaceId!)}/nodes/${encodeURIComponent(doc.nodeToken!)}/move`,
    {
      method: "POST",
      body,
    },
  );

  if (globalOpts.json) {
    process.stdout.write(
      JSON.stringify({
        success: true,
        node_token: doc.nodeToken,
        from_space: doc.spaceId,
        ...(toStr && { to_space: toStr }),
        ...(parentStr && { to_parent: parentStr }),
      }) + "\n",
    );
  } else {
    const dest = args.to ? `知识库 ${args.to}` : `节点 ${args.parent} 下`;
    process.stdout.write(`已移动节点 ${doc.nodeToken} 到${dest}\n`);
  }
}

// --- Subcommand: copy ---

async function copy(args: CommandArgs, globalOpts: GlobalOpts): Promise<void> {
  const input = args.positionals![0];
  if (!input) {
    throw new CliError(
      "INVALID_ARGS",
      "用法: feishu-docs wiki copy <url|token> --to <space_id> [--parent <node_token>] [--title <new_title>]",
    );
  }

  if (!args.to && !args.parent) {
    throw new CliError(
      "INVALID_ARGS",
      "至少需要 --to <space_id> 或 --parent <node_token>",
    );
  }

  const { authInfo } = await createClient(globalOpts);
  await checkWikiScope(authInfo, "wiki-node");
  const doc = await resolveWikiNode(authInfo, input);

  const copyToStr = args.to as string | undefined;
  const copyParentStr = args.parent as string | undefined;
  const copyTitleStr = args.title as string | undefined;
  const body: Record<string, string> = {
    ...(copyToStr && { target_space_id: copyToStr }),
    ...(copyParentStr && { target_parent_token: copyParentStr }),
    ...(copyTitleStr && { title: copyTitleStr }),
  };

  const res = await fetchWithAuth(
    authInfo,
    `/open-apis/wiki/v2/spaces/${encodeURIComponent(doc.spaceId!)}/nodes/${encodeURIComponent(doc.nodeToken!)}/copy`,
    {
      method: "POST",
      body,
    },
  );

  const copyResData = res?.data as Record<string, unknown> | undefined;
  const newNode = copyResData?.node as Record<string, string> | undefined;

  if (globalOpts.json) {
    process.stdout.write(
      JSON.stringify({
        success: true,
        source_node: doc.nodeToken,
        ...(newNode && {
          new_node_token: newNode.node_token,
          new_space_id: newNode.space_id,
        }),
      }) + "\n",
    );
  } else {
    const dest = args.to ? `知识库 ${args.to}` : `节点 ${args.parent} 下`;
    process.stdout.write(`已复制节点到${dest}\n`);
    if (newNode?.node_token) {
      process.stdout.write(`新节点: ${newNode.node_token}\n`);
    }
  }
}

// --- Meta: subcommand registry ---

export const meta: SubcommandMeta = {
  subcommands: {
    "create-space": {
      options: {
        desc: { type: "string" },
      },
      positionals: true,
      handler: createSpace,
    },
    "add-member": {
      options: {
        role: { type: "string", default: "member" },
      },
      positionals: true,
      handler: addMember,
    },
    "remove-member": {
      options: {
        role: { type: "string", default: "member" },
      },
      positionals: true,
      handler: removeMember,
    },
    rename: {
      options: {
        title: { type: "string" },
      },
      positionals: true,
      handler: rename,
    },
    move: {
      options: {
        to: { type: "string" },
        parent: { type: "string" },
      },
      positionals: true,
      handler: move,
    },
    copy: {
      options: {
        to: { type: "string" },
        parent: { type: "string" },
        title: { type: "string" },
      },
      positionals: true,
      handler: copy,
    },
  },
};
