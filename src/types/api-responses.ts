/**
 * Typed API response data interfaces for Feishu Open API endpoints.
 *
 * Each interface describes the shape of the `data` field in ApiResponse<T>.
 * Used with fetchWithAuth<T>() for compile-time type safety.
 */

import type { Block, WikiNode } from "./index.js";

// -- Document Blocks API --

/** GET /open-apis/docx/v1/documents/{document_id}/blocks */
export interface DocxBlocksResponse {
  items?: Block[];
  has_more?: boolean;
  page_token?: string;
}

// -- Wiki API --

/** GET /open-apis/wiki/v2/spaces/{space_id}/nodes */
export interface WikiChildrenResponse {
  items?: WikiNode[];
  has_more?: boolean;
  page_token?: string;
}

/** GET /open-apis/wiki/v2/spaces/get_node */
export interface WikiGetNodeResponse {
  node?: {
    obj_token: string;
    obj_type: string;
    title: string;
    node_token: string;
    space_id: string;
    has_child: boolean;
    parent_node_token?: string;
    node_type?: string;
    origin_node_token?: string;
    origin_space_id?: string;
  };
}

// -- Drive API --

/** GET /open-apis/drive/v1/files */
export interface DriveFileListResponse {
  files?: Array<{
    token: string;
    name: string;
    type: string;
    parent_token?: string;
    url?: string;
    created_time?: string;
    modified_time?: string;
    owner_id?: string;
  }>;
  has_more?: boolean;
  next_page_token?: string;
}

// -- Document Create/Delete API --

/** POST /open-apis/docx/v1/documents */
export interface DocCreateResponse {
  document?: {
    document_id: string;
    revision_id: number;
    title: string;
  };
}

/** DELETE /open-apis/drive/v1/files/{file_token} */
export interface DocDeleteResponse {
  id?: string;
  result?: boolean;
}
