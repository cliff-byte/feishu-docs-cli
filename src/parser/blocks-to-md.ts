/** Convert Feishu document blocks (flat array with parent_id + children) to Markdown string. */
import {
  BlockType,
  isHeading,
  headingLevel,
  CODE_LANGUAGES,
} from "./block-types.js";
import { elementsToMarkdown } from "./text-elements.js";
import { Block, TextElement } from "../types/index.js";

const EMOJI_MAP: Record<string, string> = {
  round_pushpin: "\u{1F4CD}",
  bulb: "\u{1F4A1}",
  warning: "\u26A0\uFE0F",
  star: "\u2B50",
  fire: "\u{1F525}",
  check_mark: "\u2705",
  cross_mark: "\u274C",
  info: "\u2139\uFE0F",
  question: "\u2753",
  exclamation: "\u2757",
  memo: "\u{1F4DD}",
  pencil2: "\u270F\uFE0F",
  rocket: "\u{1F680}",
  tada: "\u{1F389}",
  thumbsup: "\u{1F44D}",
  eyes: "\u{1F440}",
  heart: "\u2764\uFE0F",
  zap: "\u26A1",
  bookmark: "\u{1F516}",
  link: "\u{1F517}",
  umbrella_on_ground: "\u26F1\uFE0F",
  umbrella: "\u2602\uFE0F",
  sunny: "\u2600\uFE0F",
  cloud: "\u2601\uFE0F",
  snowflake: "\u2744\uFE0F",
  rainbow: "\u{1F308}",
  bell: "\u{1F514}",
  key: "\u{1F511}",
  lock: "\u{1F512}",
  unlock: "\u{1F513}",
  gear: "\u2699\uFE0F",
  wrench: "\u{1F527}",
  hammer: "\u{1F528}",
  shield: "\u{1F6E1}\uFE0F",
  trophy: "\u{1F3C6}",
  clipboard: "\u{1F4CB}",
  chart_with_upwards_trend: "\u{1F4C8}",
  light_bulb: "\u{1F4A1}",
  magnifying_glass: "\u{1F50D}",
  alarm_clock: "\u23F0",
  hourglass: "\u231B",
  calendar: "\u{1F4C5}",
  inbox_tray: "\u{1F4E5}",
  outbox_tray: "\u{1F4E4}",
  package: "\u{1F4E6}",
  loudspeaker: "\u{1F4E2}",
  thought_balloon: "\u{1F4AD}",
  speech_balloon: "\u{1F4AC}",
  construction: "\u{1F6A7}",
  white_check_mark: "\u2705",
  x: "\u274C",
  bangbang: "\u203C\uFE0F",
  interrobang: "\u2049\uFE0F",
  pushpin: "\u{1F4CC}",
  triangular_flag_on_post: "\u{1F6A9}",
  bomb: "\u{1F4A3}",
  seedling: "\u{1F331}",
  four_leaf_clover: "\u{1F340}",
  dart: "\u{1F3AF}",
  100: "\u{1F4AF}",
  muscle: "\u{1F4AA}",
  clap: "\u{1F44F}",
  wave: "\u{1F44B}",
  point_right: "\u{1F449}",
  point_up: "\u261D\uFE0F",
  pray: "\u{1F64F}",
};

type TreeNode = Block & { _children: TreeNode[] };
type TableData = { fields: string[]; records: unknown[][] };
type SheetData = TableData & { title?: string };

interface BlocksRenderCtx {
  imageUrlMap: Map<string, string>;
  userNameMap: Map<string, string>;
  bitableDataMap: Map<string, TableData>;
  boardImageMap: Map<string, string>;
  sheetDataMap: Map<string, SheetData>;
  warnings: string[];
}

interface RenderContext {
  lines: string[];
  ctx: BlocksRenderCtx;
  depth: number;
  state: RenderState;
}
interface RenderState {
  orderedIndex?: number;
}
type BlockRenderer = (node: TreeNode, rctx: RenderContext) => void;

interface BlocksToMarkdownOptions {
  imageUrlMap?: Map<string, string>;
  userNameMap?: Map<string, string>;
  bitableDataMap?: Map<string, TableData>;
  boardImageMap?: Map<string, string>;
  sheetDataMap?: Map<string, SheetData>;
}

function emojiIdToUnicode(emojiId: string): string {
  return EMOJI_MAP[emojiId] || `:${emojiId}:`;
}

/** Build a tree from flat block array. */
function buildTree(blocks: Block[]): TreeNode | null {
  const map = new Map<string, TreeNode>();
  for (const block of blocks) {
    map.set(block.block_id, { ...block, _children: [] });
  }

  let root: TreeNode | null = null;
  for (const block of blocks) {
    const node = map.get(block.block_id)!;
    if (block.parent_id && map.has(block.parent_id)) {
      map.get(block.parent_id)!._children.push(node);
    } else {
      root = node;
    }
  }

  for (const node of map.values()) {
    if (node.children && node.children.length > 0) {
      const order = new Map(
        node.children.map((id: string, i: number) => [id, i]),
      );
      node._children.sort((a: TreeNode, b: TreeNode) => {
        const ai = order.get(a.block_id) ?? Infinity;
        const bi = order.get(b.block_id) ?? Infinity;
        return ai - bi;
      });
    }
  }

  return root;
}

/** Main entry: convert blocks to markdown string. */
export function blocksToMarkdown(
  blocks: Block[],
  options: BlocksToMarkdownOptions = {},
): string {
  if (!blocks || blocks.length === 0) return "";

  const root = buildTree(blocks);
  if (!root) return "";

  const lines: string[] = [];
  const ctx: BlocksRenderCtx = {
    imageUrlMap: options.imageUrlMap || new Map(),
    userNameMap: options.userNameMap || new Map(),
    bitableDataMap: options.bitableDataMap || new Map(),
    boardImageMap: options.boardImageMap || new Map(),
    sheetDataMap: options.sheetDataMap || new Map(),
    warnings: [],
  };

  if (root.block_type === BlockType.PAGE) {
    const titleText = getElements(root as TreeNode, "page", ctx);
    if (titleText) {
      lines.push(`# ${titleText}`);
      lines.push("");
    }
  }

  const state: RenderState = { orderedIndex: 0 };
  for (const child of root._children) {
    if (child.block_type === BlockType.ORDERED) {
      renderNode(child, lines, ctx, 0, state);
      state.orderedIndex = (state.orderedIndex ?? 0) + 1;
    } else {
      state.orderedIndex = 0;
      renderNode(child, lines, ctx, 0, {});
    }
  }

  for (const w of ctx.warnings) {
    process.stderr.write(`feishu-docs: warning: ${w}\n`);
  }

  return (
    lines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim() + "\n"
  );
}

/** Render children with ordered list index tracking. */
function renderChildren(
  children: TreeNode[],
  lines: string[],
  ctx: BlocksRenderCtx,
  depth: number,
): void {
  const childState: RenderState = { orderedIndex: 0 };
  for (const child of children) {
    if (child.block_type === BlockType.ORDERED) {
      renderNode(child, lines, ctx, depth, childState);
      childState.orderedIndex = (childState.orderedIndex ?? 0) + 1;
    } else {
      childState.orderedIndex = 0;
      renderNode(child, lines, ctx, depth, {});
    }
  }
}

/** Render a single node via dispatch table lookup. */
function renderNode(
  node: TreeNode,
  lines: string[],
  ctx: BlocksRenderCtx,
  depth: number,
  state: RenderState,
): void {
  const renderer = RENDERERS.get(node.block_type);
  if (renderer) {
    renderer(node, { lines, ctx, depth, state });
  } else {
    ctx.warnings.push(
      `\u4E0D\u652F\u6301\u7684\u5185\u5BB9\u7C7B\u578B: ${node.block_type}`,
    );
    lines.push(
      `[\u4E0D\u652F\u6301\u7684\u5185\u5BB9\u7C7B\u578B: ${node.block_type}]`,
    );
    lines.push("");
  }
}

function renderPage(node: TreeNode, rctx: RenderContext): void {
  renderChildren(node._children, rctx.lines, rctx.ctx, rctx.depth);
}

function renderText(node: TreeNode, rctx: RenderContext): void {
  const text = getElements(node, "text", rctx.ctx);
  rctx.lines.push("  ".repeat(rctx.depth) + text);
  rctx.lines.push("");
}

function renderHeading(node: TreeNode, rctx: RenderContext): void {
  const level = headingLevel(node.block_type);
  const text = getElements(node, `heading${level}`, rctx.ctx);
  rctx.lines.push(`${"#".repeat(Math.min(level, 6))} ${text}`);
  rctx.lines.push("");
  renderChildren(node._children, rctx.lines, rctx.ctx, rctx.depth);
}

function renderBullet(node: TreeNode, rctx: RenderContext): void {
  const text = getElements(node, "bullet", rctx.ctx);
  rctx.lines.push(`${"  ".repeat(rctx.depth)}- ${text}`);
  renderChildren(node._children, rctx.lines, rctx.ctx, rctx.depth + 1);
  if (rctx.depth === 0) rctx.lines.push("");
}

function renderOrdered(node: TreeNode, rctx: RenderContext): void {
  const idx = (rctx.state.orderedIndex || 0) + 1;
  const text = getElements(node, "ordered", rctx.ctx);
  rctx.lines.push(`${"  ".repeat(rctx.depth)}${idx}. ${text}`);
  renderChildren(node._children, rctx.lines, rctx.ctx, rctx.depth + 1);
  if (rctx.depth === 0) rctx.lines.push("");
}

function renderTodo(node: TreeNode, rctx: RenderContext): void {
  const todo = (node.todo || {}) as { done?: boolean };
  const text = getElements(node, "todo", rctx.ctx);
  const check = todo.done ? "x" : " ";
  rctx.lines.push(`${"  ".repeat(rctx.depth)}- [${check}] ${text}`);
  renderChildren(node._children, rctx.lines, rctx.ctx, rctx.depth + 1);
  if (rctx.depth === 0) rctx.lines.push("");
}

function renderCode(node: TreeNode, rctx: RenderContext): void {
  const codeData = (node.code || {}) as { style?: { language?: number } };
  const langNum = codeData.style?.language;
  const lang =
    langNum !== undefined
      ? (CODE_LANGUAGES as Record<number, string>)[langNum] || ""
      : "";
  const text = getElements(node, "code", rctx.ctx);
  rctx.lines.push(`\`\`\`${lang}`, text, "```", "");
}

function renderQuote(node: TreeNode, rctx: RenderContext): void {
  const text = getElements(node, "quote", rctx.ctx);
  rctx.lines.push(...text.split("\n").map((l) => `> ${l}`));
  for (const child of node._children) {
    const childLines: string[] = [];
    renderNode(child, childLines, rctx.ctx, 0, {});
    rctx.lines.push(...childLines.map((l) => (l ? `> ${l}` : ">")));
  }
  rctx.lines.push("");
}

function renderQuoteContainer(node: TreeNode, rctx: RenderContext): void {
  for (const child of node._children) {
    const childLines: string[] = [];
    renderNode(child, childLines, rctx.ctx, 0, {});
    rctx.lines.push(...childLines.map((l) => (l ? `> ${l}` : ">")));
  }
  rctx.lines.push("");
}

function renderEquation(node: TreeNode, rctx: RenderContext): void {
  const eq = (node.equation || {}) as { content?: string };
  rctx.lines.push("$$", (eq.content || "").trim(), "$$", "");
}

function renderDivider(_node: TreeNode, rctx: RenderContext): void {
  rctx.lines.push("---", "");
}

function renderImage(node: TreeNode, rctx: RenderContext): void {
  const imageData = (node.image || {}) as { token?: string; alt?: string };
  const fileToken = imageData.token;
  const url = fileToken ? rctx.ctx.imageUrlMap.get(fileToken) || "" : "";
  const alt = imageData.alt || "";
  rctx.lines.push(url ? `![${alt}](${url})` : `![${alt}](${fileToken || ""})`);
  rctx.lines.push("");
}

function renderTableBlock(node: TreeNode, rctx: RenderContext): void {
  renderTable(node, rctx.lines, rctx.ctx);
  rctx.lines.push("");
}

function renderCallout(node: TreeNode, rctx: RenderContext): void {
  const callout = (node.callout || {}) as { emoji_id?: string };
  const emoji = callout.emoji_id
    ? emojiIdToUnicode(callout.emoji_id) + " "
    : "";
  let isFirst = true;
  for (const child of node._children) {
    const childLines: string[] = [];
    renderNode(child, childLines, rctx.ctx, 0, {});
    const first = childLines.shift() || "";
    const prefix = isFirst ? emoji : "";
    isFirst = false;
    rctx.lines.push(`> ${prefix}${first}`);
    for (const cl of childLines) {
      rctx.lines.push(cl ? `> ${cl}` : ">");
    }
  }
  rctx.lines.push("");
}

function renderDiagram(node: TreeNode, rctx: RenderContext): void {
  const text = getElements(node, "diagram", rctx.ctx);
  rctx.lines.push("```mermaid", sanitizeMermaid(text), "```", "");
}

function renderIframe(node: TreeNode, rctx: RenderContext): void {
  const url =
    ((node.iframe || {}) as { component?: { url?: string } }).component?.url ||
    "";
  rctx.lines.push(`[嵌入](${url})`, "");
}

function renderGrid(node: TreeNode, rctx: RenderContext): void {
  for (const child of node._children) {
    for (const grandchild of child._children) {
      renderNode(grandchild, rctx.lines, rctx.ctx, rctx.depth, {});
    }
  }
}

function renderGridColumn(node: TreeNode, rctx: RenderContext): void {
  for (const child of node._children) {
    renderNode(child, rctx.lines, rctx.ctx, rctx.depth, {});
  }
}

function renderTableCell(): void {
  /* Handled by renderTable */
}

function renderFile(node: TreeNode, rctx: RenderContext): void {
  const fileData = (node.file || {}) as { name?: string; token?: string };
  const name = fileData.name || "文件";
  const token = fileData.token || "";
  const url = rctx.ctx.imageUrlMap.get(token) || "";
  rctx.lines.push(`[${name}](${url || token})`, "");
}

const MERMAID_KEYWORDS = [
  "graph",
  "flowchart",
  "sequenceDiagram",
  "classDiagram",
  "gantt",
  "pie",
  "erDiagram",
];

function renderAddons(node: TreeNode, rctx: RenderContext): void {
  const addOns =
    ((node as Record<string, unknown>)["add_ons"] as { record?: string }) || {};
  try {
    const record = JSON.parse(addOns.record || "{}") as { data?: string };
    if (
      record.data &&
      typeof record.data === "string" &&
      MERMAID_KEYWORDS.some((k) => record.data!.includes(k))
    ) {
      rctx.lines.push(
        "```mermaid",
        sanitizeMermaid(record.data.trim()),
        "```",
        "",
      );
      return;
    }
  } catch {
    /* not parseable, skip */
  }
}

function renderMdTable(
  fields: string[],
  records: unknown[][],
  lines: string[],
): void {
  lines.push(
    "| " + fields.map((f) => f.replace(/\|/g, "\\|")).join(" | ") + " |",
  );
  lines.push("| " + fields.map(() => "---").join(" | ") + " |");
  for (const row of records) {
    lines.push(
      "| " +
        (row as unknown[])
          .map((c) => String(c).replace(/\|/g, "\\|").replace(/\n/g, " "))
          .join(" | ") +
        " |",
    );
  }
}

function renderBitable(node: TreeNode, rctx: RenderContext): void {
  const token = (node.bitable as { token?: string })?.token || "";
  const data = rctx.ctx.bitableDataMap.get(token);
  if (data && data.fields.length > 0) {
    renderMdTable(data.fields, data.records, rctx.lines);
  } else {
    rctx.lines.push(`[多维表格: ${token}]`);
  }
  rctx.lines.push("");
}

function renderBoard(node: TreeNode, rctx: RenderContext): void {
  const token =
    (node as Record<string, unknown> & { board?: { token?: string } }).board
      ?.token || "";
  const imagePath = rctx.ctx.boardImageMap.get(token);
  rctx.lines.push(imagePath ? `![画板](${imagePath})` : `[画板: ${token}]`);
  rctx.lines.push("");
}

function renderSheet(node: TreeNode, rctx: RenderContext): void {
  const token = (node.sheet as { token?: string })?.token || "";
  const data = rctx.ctx.sheetDataMap.get(token);
  if (data && data.fields.length > 0) {
    if (data.title) {
      rctx.lines.push(`**${data.title}**`, "");
    }
    renderMdTable(data.fields, data.records, rctx.lines);
  } else {
    rctx.lines.push(`[电子表格: ${token}]`);
  }
  rctx.lines.push("");
}

function renderTask(node: TreeNode, rctx: RenderContext): void {
  const indent = "  ".repeat(rctx.depth);
  const task = (node.task || {}) as {
    task_id?: string;
    summary?: string;
    assignees?: Array<{ name?: string; id?: string }>;
    due?: string;
    completed?: boolean;
  };
  const text = getElements(node, "task", rctx.ctx);
  const summary = text || task.summary || task.task_id || "未命名任务";
  const parts: string[] = [];
  if (task.assignees && task.assignees.length > 0) {
    parts.push(
      task.assignees.map((a) => `@${a.name || a.id || "?"}`).join(", "),
    );
  }
  if (task.due) parts.push(`截止: ${task.due}`);
  const meta = parts.length > 0 ? ` (${parts.join(", ")})` : "";
  rctx.lines.push(
    `${indent}- [${task.completed ? "x" : " "}] ${summary}${meta}`,
  );
  if (rctx.depth === 0) rctx.lines.push("");
}

function renderLinkPreview(node: TreeNode, rctx: RenderContext): void {
  const preview =
    ((node as Record<string, unknown>)["link_preview"] as {
      url?: string;
      title?: string;
    }) || {};
  const url = preview.url || "";
  rctx.lines.push(`[${preview.title || url || "链接"}](${url})`, "");
}

function renderJiraIssue(node: TreeNode, rctx: RenderContext): void {
  const jira =
    ((node as Record<string, unknown>)["jira_issue"] as {
      key?: string;
      url?: string;
      summary?: string;
    }) || {};
  const key = jira.key || "";
  const url = jira.url || "";
  const label = key || jira.summary || "JIRA Issue";
  rctx.lines.push(url ? `[JIRA: ${label}](${url})` : `[JIRA: ${label}]`);
  rctx.lines.push("");
}

function renderChildrenOrPlaceholder(placeholder: string): BlockRenderer {
  return (node: TreeNode, rctx: RenderContext) => {
    if (node._children.length > 0)
      renderChildren(node._children, rctx.lines, rctx.ctx, rctx.depth);
    else rctx.lines.push(placeholder, "");
  };
}
const renderWikiCatalog = renderChildrenOrPlaceholder("[知识库目录]");
const renderSubPageList = renderChildrenOrPlaceholder("[子页面列表]");

function renderDelegateChildren(node: TreeNode, rctx: RenderContext): void {
  renderChildren(node._children, rctx.lines, rctx.ctx, rctx.depth);
}

function renderAgendaItemTitle(node: TreeNode, rctx: RenderContext): void {
  const text = getElements(node, "agenda_item_title", rctx.ctx);
  rctx.lines.push(`${"  ".repeat(rctx.depth)}**${text}**`, "");
}

function renderNoop(): void {
  /* OKR, synced blocks, AI template -- no content */
}

const REF_TYPE_LABELS: Record<number, string> = {
  [BlockType.MINDNOTE]: "思维笔记",
  [BlockType.VIEW]: "视图",
  [BlockType.CHAT_CARD]: "群消息卡片",
  [BlockType.ISV]: "三方块",
};

function renderRefType(node: TreeNode, rctx: RenderContext): void {
  const label = REF_TYPE_LABELS[node.block_type] || "未知引用";
  const data =
    ((node as Record<string, unknown>)[
      Object.keys(node).find(
        (k) =>
          typeof (node as Record<string, unknown>)[k] === "object" &&
          (node as Record<string, unknown>)[k] !== null &&
          ((node as Record<string, unknown>)[k] as Record<string, unknown>)
            ?.token,
      ) || ""
    ] as { token?: string }) || {};
  rctx.lines.push(`[${label}: ${data.token || ""}]`, "");
}

/** Block type dispatch table. */
const RENDERERS: ReadonlyMap<number, BlockRenderer> = new Map<
  number,
  BlockRenderer
>([
  [BlockType.PAGE, renderPage],
  [BlockType.TEXT, renderText],
  [BlockType.HEADING1, renderHeading],
  [BlockType.HEADING2, renderHeading],
  [BlockType.HEADING3, renderHeading],
  [BlockType.HEADING4, renderHeading],
  [BlockType.HEADING5, renderHeading],
  [BlockType.HEADING6, renderHeading],
  [BlockType.HEADING7, renderHeading],
  [BlockType.HEADING8, renderHeading],
  [BlockType.HEADING9, renderHeading],
  [BlockType.BULLET, renderBullet],
  [BlockType.ORDERED, renderOrdered],
  [BlockType.CODE, renderCode],
  [BlockType.QUOTE, renderQuote],
  [BlockType.EQUATION, renderEquation],
  [BlockType.TODO, renderTodo],
  [BlockType.BITABLE, renderBitable],
  [BlockType.CALLOUT, renderCallout],
  [BlockType.CHAT_CARD, renderRefType],
  [BlockType.DIAGRAM, renderDiagram],
  [BlockType.DIVIDER, renderDivider],
  [BlockType.FILE, renderFile],
  [BlockType.GRID, renderGrid],
  [BlockType.GRID_COLUMN, renderGridColumn],
  [BlockType.IFRAME, renderIframe],
  [BlockType.IMAGE, renderImage],
  [BlockType.ISV, renderRefType],
  [BlockType.MINDNOTE, renderRefType],
  [BlockType.SHEET, renderSheet],
  [BlockType.TABLE, renderTableBlock],
  [BlockType.TABLE_CELL, renderTableCell],
  [BlockType.VIEW, renderRefType],
  [BlockType.QUOTE_CONTAINER, renderQuoteContainer],
  [BlockType.TASK, renderTask],
  [BlockType.OKR, renderNoop],
  [BlockType.OKR_OBJECTIVE, renderNoop],
  [BlockType.OKR_KEY_RESULT, renderNoop],
  [BlockType.OKR_PROGRESS, renderNoop],
  [BlockType.ADDONS, renderAddons],
  [BlockType.JIRA_ISSUE, renderJiraIssue],
  [BlockType.WIKI_CATALOG, renderWikiCatalog],
  [BlockType.BOARD, renderBoard],
  [BlockType.AGENDA, renderDelegateChildren],
  [BlockType.AGENDA_ITEM, renderDelegateChildren],
  [BlockType.AGENDA_ITEM_TITLE, renderAgendaItemTitle],
  [BlockType.AGENDA_ITEM_CONTENT, renderDelegateChildren],
  [BlockType.LINK_PREVIEW, renderLinkPreview],
  [BlockType.SOURCE_SYNCED, renderNoop],
  [BlockType.REFERENCE_SYNCED, renderNoop],
  [BlockType.SUB_PAGE_LIST, renderSubPageList],
  [BlockType.AI_TEMPLATE, renderNoop],
]);

/** Get inline text from a block's elements. */
function getElements(
  node: TreeNode,
  key: string,
  ctx: BlocksRenderCtx,
): string {
  const data =
    ((node as Record<string, unknown>)[key] as { elements?: unknown[] }) || {};
  return elementsToMarkdown(data.elements as TextElement[] | undefined, ctx);
}

/** Render a table block as Markdown table. */
function renderTable(
  node: TreeNode,
  lines: string[],
  ctx: BlocksRenderCtx,
): void {
  const tableData = (node.table || {}) as {
    property?: { row_size?: number; column_size?: number };
  };
  const property = tableData.property || {};
  const rowSize = property.row_size || 0;
  const colSize = property.column_size || 0;
  if (rowSize === 0 || colSize === 0) return;

  const cells = node._children;
  const grid: string[][] = [];
  for (let r = 0; r < rowSize; r++) {
    const row: string[] = [];
    for (let c = 0; c < colSize; c++) {
      const cell = cells[r * colSize + c];
      row.push(cell ? cellToText(cell, ctx) : "");
    }
    grid.push(row);
  }
  if (grid.length === 0) return;

  const escape = (s: string) => s.replace(/\|/g, "\\|");
  lines.push("| " + grid[0].map(escape).join(" | ") + " |");
  lines.push("| " + grid[0].map(() => "---").join(" | ") + " |");
  for (let r = 1; r < grid.length; r++) {
    lines.push("| " + grid[r].map(escape).join(" | ") + " |");
  }
}

/** Render a table_cell block content as inline text. */
function cellToText(cell: TreeNode, ctx: BlocksRenderCtx): string {
  const parts: string[] = [];
  for (const child of cell._children) {
    const key = Object.keys(child).find(
      (k) =>
        typeof (child as Record<string, unknown>)[k] === "object" &&
        ((child as Record<string, unknown>)[k] as Record<string, unknown>)
          ?.elements,
    );
    if (key) {
      const data = (child as Record<string, unknown>)[key] as {
        elements?: TextElement[];
      };
      parts.push(elementsToMarkdown(data.elements, ctx));
    }
  }
  return parts.join(" ").replace(/\n/g, " ");
}

/** Sanitize Feishu mermaid content for standard mermaid compatibility. */
function sanitizeMermaid(content: string): string {
  const blockKw = /^(\s*(?:alt|else|loop|opt|par|critical|break)\s+)(.+)$/;
  const arrowRe = /^(\s*\S+\s*-[-.)>x]+[+-]?\s*\S+\s*):(\S)/;
  return content
    .split("\n")
    .map((line) => {
      const bm = line.match(blockKw);
      if (bm)
        return (
          bm[1] +
          bm[2]
            .replace(/<br\s*\/?>/gi, ", ")
            .replace(/\(/g, "\uFF08")
            .replace(/\)/g, "\uFF09")
        );
      if (line.match(arrowRe)) return line.replace(arrowRe, "$1: $2");
      return line;
    })
    .join("\n");
}
