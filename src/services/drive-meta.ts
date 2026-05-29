/**
 * Drive file metadata service.
 *
 * Standalone (non-wiki) documents do not expose creator/timestamps through the
 * docx GET endpoint. The Drive meta endpoint does:
 *   POST /open-apis/drive/v1/metas/batch_query
 * returning owner_id, create_time, and latest_modify_time per document.
 *
 * Requires a Drive scope (drive:drive or drive:drive.metadata:readonly) — the
 * caller wraps this in withScopeRecovery so a missing scope prompts the user.
 */

import { fetchWithAuth } from "../client.js";
import type { AuthInfo } from "../types/index.js";

/** Scope used as the recovery fallback when the API omits permission_violations. */
export const DRIVE_META_SCOPE = "drive:drive.metadata:readonly";

export interface DriveMeta {
  /** Owner user id. */
  owner?: string;
  /** Creation time (seconds since epoch, as string). */
  createTime?: string;
  /** Latest modification time (seconds since epoch, as string). */
  modifyTime?: string;
  /** User id of the latest modifier. */
  latestModifyUser?: string;
}

/**
 * Fetch Drive metadata for a single document.
 *
 * @param authInfo - Auth credentials.
 * @param docToken - The document token (obj_token).
 * @param docType - Drive doc type (e.g. "docx", "sheet", "bitable").
 * @returns Owner/create/modify metadata (fields undefined when absent).
 */
export async function getDriveMeta(
  authInfo: AuthInfo,
  docToken: string,
  docType: string,
): Promise<DriveMeta> {
  const res = await fetchWithAuth(
    authInfo,
    "/open-apis/drive/v1/metas/batch_query",
    {
      method: "POST",
      body: { request_docs: [{ doc_token: docToken, doc_type: docType }] },
    },
  );

  const data = res?.data as Record<string, unknown> | undefined;
  const metas = (data?.metas as Array<Record<string, unknown>> | undefined) ?? [];
  const meta = metas[0] ?? {};

  return {
    owner: meta.owner_id as string | undefined,
    createTime: meta.create_time as string | undefined,
    modifyTime: meta.latest_modify_time as string | undefined,
    latestModifyUser: meta.latest_modify_user as string | undefined,
  };
}
