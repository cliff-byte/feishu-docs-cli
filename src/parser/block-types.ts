/**
 * BlockType constants and code language mapping.
 *
 * IDs from Feishu DocX API:
 * https://open.feishu.cn/document/client-docs/docs-add-on/block-type-overview
 */

export const BlockType = {
  PAGE: 1,
  TEXT: 2,
  HEADING1: 3,
  HEADING2: 4,
  HEADING3: 5,
  HEADING4: 6,
  HEADING5: 7,
  HEADING6: 8,
  HEADING7: 9,
  HEADING8: 10,
  HEADING9: 11,
  BULLET: 12,
  ORDERED: 13,
  CODE: 14,
  QUOTE: 15,
  EQUATION: 16,
  TODO: 17,
  BITABLE: 18,
  CALLOUT: 19,
  CHAT_CARD: 20,
  DIAGRAM: 21,
  DIVIDER: 22,
  FILE: 23,
  GRID: 24,
  GRID_COLUMN: 25,
  IFRAME: 26,
  IMAGE: 27,
  ISV: 28,
  MINDNOTE: 29,
  SHEET: 30,
  TABLE: 31,
  TABLE_CELL: 32,
  VIEW: 33,
  QUOTE_CONTAINER: 34,
  TASK: 35,
  OKR: 36,
  OKR_OBJECTIVE: 37,
  OKR_KEY_RESULT: 38,
  OKR_PROGRESS: 39,
  ADDONS: 40,
  JIRA_ISSUE: 41,
  WIKI_CATALOG: 42,
  BOARD: 43,
  AGENDA: 44,
  AGENDA_ITEM: 45,
  AGENDA_ITEM_TITLE: 46,
  AGENDA_ITEM_CONTENT: 47,
  LINK_PREVIEW: 48,
  SOURCE_SYNCED: 49,
  REFERENCE_SYNCED: 50,
  SUB_PAGE_LIST: 51,
  AI_TEMPLATE: 52,
} as const;

export function isHeading(type: number): boolean {
  return type >= BlockType.HEADING1 && type <= BlockType.HEADING9;
}

export function headingLevel(type: number): number {
  return type - BlockType.HEADING1 + 1;
}

/**
 * Feishu code language enum → display name.
 * Values from SDK: 0 = PlainText, 1 = ABAP, etc.
 */
export const CODE_LANGUAGES = {
  0: "plaintext",
  2: "abap",
  3: "ada",
  4: "apache",
  5: "apex",
  6: "assembly",
  7: "bash",
  8: "c#",
  9: "c++",
  10: "c",
  11: "cobol",
  12: "css",
  13: "coffeescript",
  14: "d",
  15: "dart",
  16: "delphi",
  17: "django",
  18: "dockerfile",
  19: "erlang",
  20: "fortran",
  21: "foxpro",
  22: "go",
  23: "groovy",
  24: "html",
  25: "elixir",
  26: "http",
  27: "haskell",
  28: "json",
  29: "java",
  30: "javascript",
  31: "julia",
  32: "kotlin",
  33: "latex",
  34: "lisp",
  35: "logo",
  36: "lua",
  37: "matlab",
  38: "makefile",
  39: "markdown",
  40: "nginx",
  41: "objective-c",
  42: "openedgeabl",
  43: "php",
  44: "perl",
  45: "postscript",
  46: "powershell",
  47: "prolog",
  48: "protobuf",
  49: "python",
  50: "r",
  51: "rpg",
  52: "ruby",
  53: "rust",
  54: "sas",
  55: "plsql",
  56: "sql",
  57: "scala",
  58: "scheme",
  59: "scratch",
  60: "shell",
  61: "swift",
  62: "thrift",
  63: "typescript",
  64: "vbscript",
  65: "visual basic",
  66: "xml",
  67: "yaml",
  68: "cmake",
  69: "ansi",
  70: "graphql",
  71: "solidity",
  72: "toml",
} as const;

/**
 * Markdown language name → Feishu code language enum value.
 */
const baseLangMap: Record<string, number> = Object.fromEntries(
  Object.entries(CODE_LANGUAGES).map(([k, v]) => [v.toLowerCase(), Number(k)]),
);

export const LANGUAGE_TO_ENUM: Readonly<Record<string, number | undefined>> = Object.freeze({
  ...baseLangMap,
  // Common aliases
  js: baseLangMap["javascript"],
  ts: baseLangMap["typescript"],
  py: baseLangMap["python"],
  rb: baseLangMap["ruby"],
  sh: baseLangMap["shell"],
  yml: baseLangMap["yaml"],
  md: baseLangMap["markdown"],
  rs: baseLangMap["rust"],
  cs: baseLangMap["c#"],
  cpp: baseLangMap["c++"],
  objc: baseLangMap["objective-c"],
  ps1: baseLangMap["powershell"],
  vb: baseLangMap["visual basic"],
  mermaid: baseLangMap["plaintext"],
});
