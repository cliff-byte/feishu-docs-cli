/**
 * share command: Manage document permissions (list/add/set).
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
import { mapToDriveType } from "../utils/drive-types.js";
import {
  SubcommandMeta,
  CommandArgs,
  GlobalOpts,
  AuthInfo,
} from "../types/index.js";

export const meta: SubcommandMeta = {
  subcommands: {
    list: {
      options: {},
      positionals: true,
      handler: list,
    },
    add: {
      options: {
        role: { type: "string", default: "view" },
      },
      positionals: true,
      handler: add,
    },
    set: {
      options: {
        public: { type: "string" },
      },
      positionals: true,
      handler: set,
    },
  },
};

/**
 * Map user-friendly role name to API perm value.
 */
export function mapRole(role: string): string {
  const map: Record<string, string> = {
    view: "view",
    edit: "edit",
    manage: "full_access",
  };
  const mapped = map[role];
  if (!mapped) {
    throw new CliError(
      "INVALID_ARGS",
      `无效的角色: ${role}。可选值: view, edit, manage`,
    );
  }
  return mapped;
}

/**
 * Map public mode string to link_share_entity value.
 */
export function mapPublicMode(mode: string, role: string = "view"): string {
  if (mode === "closed") return "closed";
  if (mode === "tenant" && role === "view") return "tenant_readable";
  if (mode === "tenant" && role === "edit") return "tenant_editable";
  if (mode === "open" && role === "view") return "anyone_readable";
  if (mode === "open" && role === "edit") return "anyone_editable";
  // Default: treat as tenant_readable for "tenant", anyone_readable for "open"
  if (mode === "tenant") return "tenant_readable";
  if (mode === "open") return "anyone_readable";
  throw new CliError(
    "INVALID_ARGS",
    `无效的公开模式: ${mode}。可选值: closed, tenant, open`,
  );
}

/**
 * Pre-flight scope check for share commands (drive:drive required).
 */
async function checkDriveScope(authInfo: AuthInfo): Promise<void> {
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
}

async function resolveDocForShare(
  authInfo: AuthInfo,
  input: string,
): Promise<{
  token: string;
  type: string;
  doc: Awaited<ReturnType<typeof resolveDocument>>;
}> {
  const doc = await resolveDocument(authInfo, input);
  // For wiki nodes, use the node_token with type "wiki" for permission APIs
  const token = doc.spaceId ? doc.parsed.token : doc.objToken;
  const type = doc.spaceId ? "wiki" : mapToDriveType(doc.objType);
  return { token, type, doc };
}

async function list(args: CommandArgs, globalOpts: GlobalOpts): Promise<void> {
  const input = args.positionals![0];
  if (!input) {
    throw new CliError(
      "INVALID_ARGS",
      "缺少文档 URL 或 token。用法: feishu-docs share list <url>",
    );
  }

  const { authInfo } = await createClient(globalOpts);
  await checkDriveScope(authInfo);

  const { token, type } = await resolveDocForShare(authInfo, input);

  const res = await fetchWithAuth(
    authInfo,
    `/open-apis/drive/v1/permissions/${encodeURIComponent(token)}/members`,
    { params: { type } },
  );

  const shareResData = res?.data as Record<string, unknown> | undefined;
  const members = (shareResData?.members || []) as Array<
    Record<string, string>
  >;

  if (globalOpts.json) {
    process.stdout.write(
      JSON.stringify({ success: true, members }, null, 2) + "\n",
    );
    return;
  }

  if (members.length === 0) {
    process.stdout.write("没有协作者\n");
    return;
  }

  for (const m of members as Array<Record<string, string>>) {
    const name = m.member_name || m.member_id || "(未知)";
    const perm = m.perm || "unknown";
    const memberType = m.member_type || "";
    process.stdout.write(
      `  ${name}  [${perm}]  (${memberType}: ${m.member_id})\n`,
    );
  }
}

async function add(args: CommandArgs, globalOpts: GlobalOpts): Promise<void> {
  const input = args.positionals![0];
  const memberId = args.positionals![1];
  if (!input || !memberId) {
    throw new CliError(
      "INVALID_ARGS",
      "用法: feishu-docs share add <url> <member> --role <role>",
    );
  }

  validateMemberId(memberId);

  const { authInfo } = await createClient(globalOpts);
  await checkDriveScope(authInfo);

  const { token, type } = await resolveDocForShare(authInfo, input);
  const memberType = detectMemberType(memberId);
  const perm = mapRole((args.role as string | undefined) || "view");

  try {
    await fetchWithAuth(
      authInfo,
      `/open-apis/drive/v1/permissions/${encodeURIComponent(token)}/members`,
      {
        method: "POST",
        params: { type },
        body: { member_type: memberType, member_id: memberId, perm },
      },
    );
  } catch (err) {
    // Error 1201003: member already exists → fallback to update
    const code =
      (err as Record<string, unknown>)?.apiCode ||
      (err as Record<string, unknown>)?.code;
    if (code === 1201003) {
      await fetchWithAuth(
        authInfo,
        `/open-apis/drive/v1/permissions/${encodeURIComponent(token)}/members/${encodeURIComponent(memberId)}`,
        {
          method: "PUT",
          params: { type },
          body: { member_type: memberType, perm },
        },
      );
    } else {
      throw err;
    }
  }

  if (globalOpts.json) {
    process.stdout.write(
      JSON.stringify({
        success: true,
        member_id: memberId,
        member_type: memberType,
        perm,
      }) + "\n",
    );
  } else {
    process.stdout.write(`已添加协作者 ${memberId} (${perm})\n`);
  }
}

async function set(args: CommandArgs, globalOpts: GlobalOpts): Promise<void> {
  const input = args.positionals![0];
  if (!input) {
    throw new CliError(
      "INVALID_ARGS",
      "用法: feishu-docs share set <url> --public <closed|tenant|open>",
    );
  }

  if (!args.public) {
    throw new CliError(
      "INVALID_ARGS",
      "缺少 --public 参数。可选值: closed, tenant, open",
    );
  }

  const { authInfo } = await createClient(globalOpts);
  await checkDriveScope(authInfo);

  const { token, type } = await resolveDocForShare(authInfo, input);

  // Extract optional role from --public value like "tenant:edit"
  let mode = args.public as string;
  let shareRole = "view";
  if (mode.includes(":")) {
    const parts = mode.split(":");
    mode = parts[0];
    shareRole = parts[1] || "view";
  }

  if (shareRole !== "view" && shareRole !== "edit") {
    throw new CliError(
      "INVALID_ARGS",
      `无效的分享角色: ${shareRole}。可选值: view, edit（如 tenant:edit）`,
    );
  }

  const linkShareEntity = mapPublicMode(mode, shareRole);

  await fetchWithAuth(
    authInfo,
    `/open-apis/drive/v1/permissions/${encodeURIComponent(token)}/public`,
    {
      method: "PATCH",
      params: { type },
      body: { link_share_entity: linkShareEntity },
    },
  );

  if (globalOpts.json) {
    process.stdout.write(
      JSON.stringify({
        success: true,
        link_share_entity: linkShareEntity,
      }) + "\n",
    );
  } else {
    process.stdout.write(`已修改分享设置为 ${linkShareEntity}\n`);
  }
}
