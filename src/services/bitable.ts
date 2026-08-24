/** Read standalone Feishu Bitable tables and record-share links. */

import { fetchWithAuth } from "../client.js";
import type { AuthInfo } from "../types/index.js";
import type {
  BitableField,
  BitableFieldsResponse,
  BitableRecord,
  BitableRecordResponse,
  BitableRecordsResponse,
  BitableRecordShareMetaResponse,
} from "../types/api-responses.js";
import { CliError } from "../utils/errors.js";
import { validateToken } from "../utils/validate.js";

export interface BitableTableTarget {
  baseToken: string;
  tableId: string;
  viewId?: string;
}

export interface BitableTableResult extends BitableTableTarget {
  fields: BitableField[];
  records: BitableRecord[];
  total: number;
}

export interface BitableRecordResult {
  recordShareToken: string;
  baseToken: string;
  tableId: string;
  recordId: string;
  fields: BitableField[];
  record: BitableRecord;
}

function missingPageToken(resource: string): CliError {
  return new CliError(
    "API_ERROR",
    `飞书返回 ${resource} has_more=true，但缺少 page_token`,
    { recovery: "稍后重试；若持续失败，请检查飞书开放平台接口状态" },
  );
}

function invalidRecordShareMeta(): CliError {
  return new CliError("API_ERROR", "记录分享链接未返回完整的记录坐标", {
    recovery: "请在飞书中重新复制该记录的分享链接后重试",
  });
}

async function fetchAllFields(
  authInfo: AuthInfo,
  baseToken: string,
  tableId: string,
): Promise<BitableField[]> {
  let fields: BitableField[] = [];
  let pageToken: string | undefined;

  do {
    const res = await fetchWithAuth<BitableFieldsResponse>(
      authInfo,
      `/open-apis/bitable/v1/apps/${encodeURIComponent(baseToken)}/tables/${encodeURIComponent(tableId)}/fields`,
      {
        params: {
          page_size: 100,
          ...(pageToken && { page_token: pageToken }),
        },
      },
    );
    fields = [...fields, ...(res.data?.items ?? [])];
    if (res.data?.has_more && !res.data.page_token) {
      throw missingPageToken("字段列表");
    }
    pageToken = res.data?.has_more ? res.data.page_token : undefined;
  } while (pageToken);

  return fields;
}

async function fetchAllRecords(
  authInfo: AuthInfo,
  target: BitableTableTarget,
): Promise<{ records: BitableRecord[]; total: number }> {
  let records: BitableRecord[] = [];
  let pageToken: string | undefined;
  let total: number | undefined;

  do {
    const res = await fetchWithAuth<BitableRecordsResponse>(
      authInfo,
      `/open-apis/bitable/v1/apps/${encodeURIComponent(target.baseToken)}/tables/${encodeURIComponent(target.tableId)}/records`,
      {
        params: {
          page_size: 500,
          ...(target.viewId && { view_id: target.viewId }),
          ...(pageToken && { page_token: pageToken }),
        },
      },
    );
    records = [...records, ...(res.data?.items ?? [])];
    total = res.data?.total ?? total;
    if (res.data?.has_more && !res.data.page_token) {
      throw missingPageToken("记录列表");
    }
    pageToken = res.data?.has_more ? res.data.page_token : undefined;
  } while (pageToken);

  return { records, total: total ?? records.length };
}

/** Fetch a complete table schema and all records selected by an optional view. */
export async function fetchBitableTable(
  authInfo: AuthInfo,
  target: BitableTableTarget,
): Promise<BitableTableResult> {
  validateToken(target.baseToken, "base_token");
  validateToken(target.tableId, "table_id");
  if (target.viewId) validateToken(target.viewId, "view_id");

  const [fields, recordData] = await Promise.all([
    fetchAllFields(authInfo, target.baseToken, target.tableId),
    fetchAllRecords(authInfo, target),
  ]);

  return { ...target, fields, ...recordData };
}

/** Resolve a record-share token and fetch its schema and record values. */
export async function fetchBitableRecord(
  authInfo: AuthInfo,
  recordShareToken: string,
): Promise<BitableRecordResult> {
  validateToken(recordShareToken, "record_share_token");
  const metaRes = await fetchWithAuth<BitableRecordShareMetaResponse>(
    authInfo,
    `/open-apis/base/v3/record_share/${encodeURIComponent(recordShareToken)}/meta`,
  );
  const baseToken = metaRes.data?.base_token;
  const tableId = metaRes.data?.table_id;
  const recordId = metaRes.data?.record_id;
  if (!baseToken || !tableId || !recordId) throw invalidRecordShareMeta();

  try {
    validateToken(baseToken, "base_token");
    validateToken(tableId, "table_id");
    validateToken(recordId, "record_id");
  } catch {
    throw invalidRecordShareMeta();
  }

  const [fields, recordRes] = await Promise.all([
    fetchAllFields(authInfo, baseToken, tableId),
    fetchWithAuth<BitableRecordResponse>(
      authInfo,
      `/open-apis/bitable/v1/apps/${encodeURIComponent(baseToken)}/tables/${encodeURIComponent(tableId)}/records/${encodeURIComponent(recordId)}`,
    ),
  ]);
  const record = recordRes.data?.record;
  if (!record) {
    throw new CliError("NOT_FOUND", "记录不存在或已被删除", {
      recovery: "请在飞书中确认该记录仍存在，并重新复制分享链接",
    });
  }

  return {
    recordShareToken:
      metaRes.data?.record_share_token ?? recordShareToken,
    baseToken,
    tableId,
    recordId,
    fields,
    record,
  };
}
