/**
 * Shared type definitions for feishu-docs CLI.
 */

// ── Error types ──

export type ErrorType =
  | "INVALID_ARGS"
  | "FILE_NOT_FOUND"
  | "AUTH_REQUIRED"
  | "TOKEN_EXPIRED"
  | "PERMISSION_DENIED"
  | "NOT_FOUND"
  | "NOT_SUPPORTED"
  | "RATE_LIMITED"
  | "API_ERROR";

export interface CliErrorOptions {
  apiCode?: number;
  retryable?: boolean;
  recovery?: string;
}

// ── Auth types ──

export type AuthMode = "user" | "tenant" | "auto";

export interface AuthInfo {
  mode: AuthMode;
  appId?: string;
  appSecret?: string;
  userToken?: string;
  tenantToken?: string;
  expiresAt?: number;
  refreshToken?: string;
  useLark: boolean;
}

export interface TokenData {
  user_access_token: string;
  refresh_token: string;
  expires_at: number;
  token_type?: string;
}

// ── CLI types ──

export interface GlobalOpts {
  auth: string;
  json: boolean;
  lark: boolean;
}

export interface CommandArgs {
  positionals?: string[];
  [key: string]: unknown;
}

export type CommandHandler = (
  args: CommandArgs,
  globalOpts: GlobalOpts,
) => Promise<void>;

export interface OptionDef {
  type: "string" | "boolean";
  default?: string | boolean;
}

export interface CommandMeta {
  options: Record<string, OptionDef>;
  positionals?: boolean;
  handler: CommandHandler;
}

export interface SubcommandMeta {
  subcommands: Record<string, CommandMeta>;
}

// ── Document types ──

export type DocType = "wiki" | "docx" | "doc" | "sheet" | "bitable" | "unknown";

export interface ParsedDoc {
  type: DocType;
  token: string;
}

export interface DocumentInfo {
  documentId: string;
  objToken: string;
  objType: string;
  title: string;
  url?: string;
  revisionId?: number;
  nodeToken?: string;
  spaceId?: string;
}

// ── API types ──

export interface ApiResponse<T = unknown> {
  code?: number;
  msg?: string;
  data?: T;
}

export interface FetchOptions {
  method?: string;
  params?: Record<string, string | number | string[] | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
}

// ── Block types ──

export interface TextElement {
  text_run?: {
    content: string;
    text_element_style?: TextElementStyle;
  };
  mention_user?: {
    user_id: string;
    text_element_style?: TextElementStyle;
  };
  mention_doc?: {
    token: string;
    obj_type: number;
    url: string;
    title?: string;
    text_element_style?: TextElementStyle;
  };
  equation?: {
    content: string;
    text_element_style?: TextElementStyle;
  };
  file?: {
    file_token: string;
    text_element_style?: TextElementStyle;
  };
  reminder?: {
    timestamp: string;
  };
  undefined?: Record<string, unknown>;
}

export interface TextElementStyle {
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  underline?: boolean;
  inline_code?: boolean;
  link?: { url: string };
  text_color?: number;
  background_color?: number;
}

export interface BlockText {
  elements: TextElement[];
  style?: {
    align?: number;
    done?: boolean;
    language?: number;
    wrap?: boolean;
    folded?: boolean;
  };
}

export interface Block {
  block_id: string;
  block_type: number;
  parent_id?: string;
  children?: string[];
  text?: BlockText;
  heading1?: BlockText;
  heading2?: BlockText;
  heading3?: BlockText;
  heading4?: BlockText;
  heading5?: BlockText;
  heading6?: BlockText;
  heading7?: BlockText;
  heading8?: BlockText;
  heading9?: BlockText;
  bullet?: BlockText;
  ordered?: BlockText;
  code?: BlockText;
  quote?: BlockText;
  equation?: BlockText;
  todo?: BlockText;
  callout?: {
    background_color?: number;
    border_color?: number;
    emoji_id?: string;
    body?: BlockText;
    elements?: TextElement[];
  };
  divider?: Record<string, never>;
  image?: {
    token: string;
    width?: number;
    height?: number;
    align?: number;
  };
  file?: {
    token: string;
    name?: string;
    view_type?: number;
  };
  table?: {
    cells?: string[];
    property?: {
      row_size: number;
      column_size: number;
      column_width?: number[];
      header_row?: boolean;
      merge_info?: unknown[];
    };
  };
  table_cell?: {
    elements?: TextElement[];
  };
  grid?: {
    column_size: number;
  };
  grid_column?: {
    width_ratio?: number;
  };
  iframe?: {
    component?: {
      iframe_type?: number;
      url?: string;
    };
  };
  quote_container?: Record<string, never>;
  view?: {
    view_type?: number;
  };
  bitable?: {
    token?: string;
  };
  sheet?: {
    token?: string;
  };
  chat_card?: {
    chat_id?: string;
  };
  diagram?: {
    diagram_type?: number;
  };
  task?: {
    task_id?: string;
  };
  [key: string]: unknown;
}

// ── Wiki types ──

export interface WikiNode {
  space_id: string;
  node_token: string;
  obj_token: string;
  obj_type: string;
  parent_node_token?: string;
  title: string;
  has_child: boolean;
  node_type?: string;
  origin_node_token?: string;
  origin_space_id?: string;
}

export interface WikiSpace {
  space_id: string;
  name: string;
  description?: string;
  visibility?: string;
}

// ── Convert API types ──

export interface ConvertedBlocks {
  blocks: Block[];
  firstLevelBlockIds: string[];
  blockIdToImageUrls: Record<string, string>;
}
