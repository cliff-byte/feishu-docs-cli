/**
 * wiki command: Wiki space and node management.
 * Subcommands: create-space, add-member, remove-member, rename, move, copy.
 */

import { createClient, fetchWithAuth } from "../client.js";
import { CliError } from "../utils/errors.js";
import { resolveDocument } from "../utils/document-resolver.js";
import { validateMemberId, detectMemberType } from "../utils/member.js";
import { validateToken } from "../utils/validate.js";

/**
 * Resolve a wiki node URL/token to { spaceId, nodeToken }.
 */
async function resolveWikiNode(client, authInfo, input) {
  const doc = await resolveDocument(client, authInfo, input);
  if (!doc.spaceId || !doc.nodeToken) {
    throw new CliError(
      "INVALID_ARGS",
      "该输入不是知识库节点，请使用知识库文档的 URL 或 wiki token",
    );
  }
  return doc;
}

// --- Subcommand: create-space ---

async function createSpace(args, globalOpts) {
  const name = args.positionals[0];
  if (!name) {
    throw new CliError(
      "INVALID_ARGS",
      "缺少知识库名称。用法: feishu-docs wiki create-space <name> [--desc <description>]",
    );
  }

  const { authInfo } = await createClient(globalOpts);

  const body = {
    name,
    ...(args.desc && { description: args.desc }),
  };

  const res = await fetchWithAuth(authInfo, "/open-apis/wiki/v2/spaces", {
    method: "POST",
    body,
  });

  const space = res?.data?.space;
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

async function addMember(args, globalOpts) {
  const spaceId = args.positionals[0];
  const memberId = args.positionals[1];
  if (!spaceId || !memberId) {
    throw new CliError(
      "INVALID_ARGS",
      "用法: feishu-docs wiki add-member <space_id> <member> [--role admin|member]",
    );
  }

  validateToken(spaceId, "space_id");
  validateMemberId(memberId);
  const memberType = detectMemberType(memberId);
  const memberRole = args.role || "member";

  if (memberRole !== "admin" && memberRole !== "member") {
    throw new CliError(
      "INVALID_ARGS",
      `无效的角色: ${memberRole}。可选值: admin, member`,
    );
  }

  const { authInfo } = await createClient(globalOpts);

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
    if (err.apiCode === 131008) {
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

async function removeMember(args, globalOpts) {
  const spaceId = args.positionals[0];
  const memberId = args.positionals[1];
  if (!spaceId || !memberId) {
    throw new CliError(
      "INVALID_ARGS",
      "用法: feishu-docs wiki remove-member <space_id> <member> [--role admin|member]",
    );
  }

  validateToken(spaceId, "space_id");
  validateMemberId(memberId);
  const memberType = detectMemberType(memberId);
  const memberRole = args.role || "member";

  const { authInfo } = await createClient(globalOpts);

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

async function rename(args, globalOpts) {
  const input = args.positionals[0];
  if (!input || !args.title) {
    throw new CliError(
      "INVALID_ARGS",
      "用法: feishu-docs wiki rename <url|token> --title <new_title>",
    );
  }

  const { client, authInfo } = await createClient(globalOpts);
  const doc = await resolveWikiNode(client, authInfo, input);

  await fetchWithAuth(
    authInfo,
    `/open-apis/wiki/v2/spaces/${encodeURIComponent(doc.spaceId)}/nodes/${encodeURIComponent(doc.nodeToken)}/update_title`,
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

async function move(args, globalOpts) {
  const input = args.positionals[0];
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

  const { client, authInfo } = await createClient(globalOpts);
  const doc = await resolveWikiNode(client, authInfo, input);

  const body = {
    ...(args.to && { target_space_id: args.to }),
    ...(args.parent && { target_parent_token: args.parent }),
  };

  await fetchWithAuth(
    authInfo,
    `/open-apis/wiki/v2/spaces/${encodeURIComponent(doc.spaceId)}/nodes/${encodeURIComponent(doc.nodeToken)}/move`,
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
        ...(args.to && { to_space: args.to }),
        ...(args.parent && { to_parent: args.parent }),
      }) + "\n",
    );
  } else {
    const dest = args.to ? `知识库 ${args.to}` : `节点 ${args.parent} 下`;
    process.stdout.write(`已移动节点 ${doc.nodeToken} 到${dest}\n`);
  }
}

// --- Subcommand: copy ---

async function copy(args, globalOpts) {
  const input = args.positionals[0];
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

  const { client, authInfo } = await createClient(globalOpts);
  const doc = await resolveWikiNode(client, authInfo, input);

  const body = {
    ...(args.to && { target_space_id: args.to }),
    ...(args.parent && { target_parent_token: args.parent }),
    ...(args.title && { title: args.title }),
  };

  const res = await fetchWithAuth(
    authInfo,
    `/open-apis/wiki/v2/spaces/${encodeURIComponent(doc.spaceId)}/nodes/${encodeURIComponent(doc.nodeToken)}/copy`,
    {
      method: "POST",
      body,
    },
  );

  const newNode = res?.data?.node;

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

export const meta = {
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
