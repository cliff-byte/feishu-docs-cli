/**
 * Convert Feishu document blocks to Markdown.
 *
 * Input: Block[] (flat array with parent_id + children)
 * Output: Markdown string
 */

import {
  BlockType,
  isHeading,
  headingLevel,
  CODE_LANGUAGES,
} from "./block-types.js";
import { elementsToMarkdown } from "./text-elements.js";
import { Block, TextElement } from "../types/index.js";

/**
 * Emoji ID to Unicode mapping for common callout emojis.
 */
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

interface BlocksRenderCtx {
  imageUrlMap: Map<string, string>;
  userNameMap: Map<string, string>;
  bitableDataMap: Map<string, { fields: string[]; records: unknown[][] }>;
  boardImageMap: Map<string, string>;
  sheetDataMap: Map<
    string,
    { fields: string[]; records: unknown[][]; title?: string }
  >;
  warnings: string[];
}

interface RenderState {
  orderedIndex?: number;
}

interface BlocksToMarkdownOptions {
  imageUrlMap?: Map<string, string>;
  userNameMap?: Map<string, string>;
  bitableDataMap?: Map<string, { fields: string[]; records: unknown[][] }>;
  boardImageMap?: Map<string, string>;
  sheetDataMap?: Map<
    string,
    { fields: string[]; records: unknown[][]; title?: string }
  >;
}

function emojiIdToUnicode(emojiId: string): string {
  return EMOJI_MAP[emojiId] || `:${emojiId}:`;
}

/**
 * Build a tree from flat block array.
 * Each block gains a `_children` array of child block objects.
 */
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

  // Sort children according to `children` order if available
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

/**
 * Main entry: convert blocks to markdown string.
 */
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

  // Extract document title from root PAGE block
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

  // Emit warnings to stderr
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

/**
 * Render children with ordered list index tracking.
 */
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

/**
 * Render a single node and its children.
 */
function renderNode(
  node: TreeNode,
  lines: string[],
  ctx: BlocksRenderCtx,
  depth: number,
  state: RenderState,
): void {
  const type = node.block_type;
  const indent = "  ".repeat(depth);

  if (type === BlockType.PAGE) {
    renderChildren(node._children, lines, ctx, depth);
    return;
  }

  if (type === BlockType.TEXT) {
    const text = getElements(node, "text", ctx);
    lines.push(indent + text);
    lines.push("");
    return;
  }

  if (isHeading(type)) {
    const level = headingLevel(type);
    const key = `heading${level}`;
    const text = getElements(node, key, ctx);
    const hashes = "#".repeat(Math.min(level, 6));
    lines.push(`${hashes} ${text}`);
    lines.push("");
    // Headings in Feishu can have children (folded/collapsible content)
    renderChildren(node._children, lines, ctx, depth);
    return;
  }

  if (type === BlockType.BULLET) {
    const text = getElements(node, "bullet", ctx);
    lines.push(`${indent}- ${text}`);
    renderChildren(node._children, lines, ctx, depth + 1);
    if (depth === 0) lines.push("");
    return;
  }

  if (type === BlockType.ORDERED) {
    const idx = (state.orderedIndex || 0) + 1;
    const text = getElements(node, "ordered", ctx);
    lines.push(`${indent}${idx}. ${text}`);
    renderChildren(node._children, lines, ctx, depth + 1);
    if (depth === 0) lines.push("");
    return;
  }

  if (type === BlockType.TODO) {
    const todo = (node.todo || {}) as { done?: boolean };
    const text = getElements(node, "todo", ctx);
    const check = todo.done ? "x" : " ";
    lines.push(`${indent}- [${check}] ${text}`);
    renderChildren(node._children, lines, ctx, depth + 1);
    if (depth === 0) lines.push("");
    return;
  }

  if (type === BlockType.CODE) {
    const codeData = (node.code || {}) as { style?: { language?: number } };
    const langNum = codeData.style?.language;
    const lang =
      langNum !== undefined
        ? (CODE_LANGUAGES as Record<number, string>)[langNum] || ""
        : "";
    const text = getElements(node, "code", ctx);
    lines.push(`\`\`\`${lang}`);
    lines.push(text);
    lines.push("```");
    lines.push("");
    return;
  }

  if (type === BlockType.QUOTE) {
    const text = getElements(node, "quote", ctx);
    const quotedLines = text.split("\n").map((l) => `> ${l}`);
    lines.push(...quotedLines);
    for (const child of node._children) {
      const childLines: string[] = [];
      renderNode(child, childLines, ctx, 0, {});
      lines.push(...childLines.map((l) => (l ? `> ${l}` : ">")));
    }
    lines.push("");
    return;
  }

  if (type === BlockType.QUOTE_CONTAINER) {
    for (const child of node._children) {
      const childLines: string[] = [];
      renderNode(child, childLines, ctx, 0, {});
      lines.push(...childLines.map((l) => (l ? `> ${l}` : ">")));
    }
    lines.push("");
    return;
  }

  if (type === BlockType.EQUATION) {
    const eq = (node.equation || {}) as { content?: string };
    const content = (eq.content || "").trim();
    lines.push(`$$`);
    lines.push(content);
    lines.push(`$$`);
    lines.push("");
    return;
  }

  if (type === BlockType.DIVIDER) {
    lines.push("---");
    lines.push("");
    return;
  }

  if (type === BlockType.IMAGE) {
    const imageData = (node.image || {}) as { token?: string; alt?: string };
    const fileToken = imageData.token;
    const url = fileToken ? ctx.imageUrlMap.get(fileToken) || "" : "";
    const alt = imageData.alt || "";
    if (url) {
      lines.push(`![${alt}](${url})`);
    } else {
      lines.push(`![${alt}](${fileToken || ""})`);
    }
    lines.push("");
    return;
  }

  if (type === BlockType.TABLE) {
    renderTable(node, lines, ctx);
    lines.push("");
    return;
  }

  if (type === BlockType.CALLOUT) {
    const callout = (node.callout || {}) as { emoji_id?: string };
    const emoji = callout.emoji_id
      ? emojiIdToUnicode(callout.emoji_id) + " "
      : "";
    let isFirst = true;
    for (const child of node._children) {
      const childLines: string[] = [];
      renderNode(child, childLines, ctx, 0, {});
      const first = childLines.shift() || "";
      // Emoji only on the very first line of the callout
      const prefix = isFirst ? emoji : "";
      isFirst = false;
      lines.push(`> ${prefix}${first}`);
      for (const cl of childLines) {
        lines.push(cl ? `> ${cl}` : ">");
      }
    }
    lines.push("");
    return;
  }

  if (type === BlockType.DIAGRAM) {
    const text = getElements(node, "diagram", ctx);
    lines.push("```mermaid");
    lines.push(sanitizeMermaid(text));
    lines.push("```");
    lines.push("");
    return;
  }

  if (type === BlockType.IFRAME) {
    const iframe = (node.iframe || {}) as { component?: { url?: string } };
    const url = iframe.component?.url || "";
    lines.push(`[嵌入](${url})`);
    lines.push("");
    return;
  }

  if (type === BlockType.GRID) {
    for (const child of node._children) {
      for (const grandchild of child._children) {
        renderNode(grandchild, lines, ctx, depth, {});
      }
    }
    return;
  }

  if (type === BlockType.GRID_COLUMN) {
    for (const child of node._children) {
      renderNode(child, lines, ctx, depth, {});
    }
    return;
  }

  if (type === BlockType.TABLE_CELL) {
    // Handled by renderTable
    return;
  }

  if (type === BlockType.FILE) {
    const fileData = (node.file || {}) as { name?: string; token?: string };
    const name = fileData.name || "文件";
    const token = fileData.token || "";
    const url = ctx.imageUrlMap.get(token) || "";
    lines.push(`[${name}](${url || token})`);
    lines.push("");
    return;
  }

  if (type === BlockType.ADDONS) {
    const addOns =
      ((node as Record<string, unknown>)["add_ons"] as { record?: string }) ||
      {};
    // Try to extract Mermaid diagram from record
    try {
      const record = JSON.parse(addOns.record || "{}") as { data?: string };
      if (
        (record.data &&
          typeof record.data === "string" &&
          record.data.includes("graph")) ||
        record.data?.includes("flowchart") ||
        record.data?.includes("sequenceDiagram") ||
        record.data?.includes("classDiagram") ||
        record.data?.includes("gantt") ||
        record.data?.includes("pie") ||
        record.data?.includes("erDiagram")
      ) {
        lines.push("```mermaid");
        lines.push(sanitizeMermaid(record.data.trim()));
        lines.push("```");
        lines.push("");
        return;
      }
    } catch {
      // not parseable, skip
    }
    // TOC, Jira, OKR etc. — skip gracefully
    return;
  }

  // Bitable — render as Markdown table if data available
  if (type === BlockType.BITABLE) {
    const token = (node.bitable as { token?: string })?.token || "";
    const data = ctx.bitableDataMap.get(token);
    if (data && data.fields.length > 0) {
      lines.push(
        "| " +
          data.fields.map((f) => f.replace(/\|/g, "\\|")).join(" | ") +
          " |",
      );
      lines.push("| " + data.fields.map(() => "---").join(" | ") + " |");
      for (const row of data.records) {
        lines.push(
          "| " +
            (row as unknown[])
              .map((c) => String(c).replace(/\|/g, "\\|").replace(/\n/g, " "))
              .join(" | ") +
            " |",
        );
      }
    } else {
      lines.push(`[多维表格: ${token}]`);
    }
    lines.push("");
    return;
  }

  // Board — whiteboard/flowchart, rendered as image if available
  if (type === BlockType.BOARD) {
    const token =
      (node as Record<string, unknown> & { board?: { token?: string } }).board
        ?.token || "";
    const imagePath = ctx.boardImageMap.get(token);
    if (imagePath) {
      lines.push(`![画板](${imagePath})`);
    } else {
      lines.push(`[画板: ${token}]`);
    }
    lines.push("");
    return;
  }

  // Sheet — render as Markdown table if data available
  if (type === BlockType.SHEET) {
    const token = (node.sheet as { token?: string })?.token || "";
    const data = ctx.sheetDataMap.get(token);
    if (data && data.fields.length > 0) {
      if (data.title) {
        lines.push(`**${data.title}**`);
        lines.push("");
      }
      lines.push(
        "| " +
          data.fields.map((f) => f.replace(/\|/g, "\\|")).join(" | ") +
          " |",
      );
      lines.push("| " + data.fields.map(() => "---").join(" | ") + " |");
      for (const row of data.records) {
        lines.push(
          "| " +
            (row as unknown[])
              .map((c) => String(c).replace(/\|/g, "\\|").replace(/\n/g, " "))
              .join(" | ") +
            " |",
        );
      }
    } else {
      lines.push(`[电子表格: ${token}]`);
    }
    lines.push("");
    return;
  }

  // Task — render as TODO with metadata
  if (type === BlockType.TASK) {
    const task = (node.task || {}) as {
      task_id?: string;
      summary?: string;
      assignees?: Array<{ name?: string; id?: string }>;
      due?: string;
      completed?: boolean;
    };
    const taskId = task.task_id || "";
    const text = getElements(node, "task", ctx);
    const summary = text || task.summary || taskId || "未命名任务";
    const parts: string[] = [];
    if (task.assignees && task.assignees.length > 0) {
      const names = task.assignees.map((a) => `@${a.name || a.id || "?"}`);
      parts.push(names.join(", "));
    }
    if (task.due) {
      parts.push(`截止: ${task.due}`);
    }
    const meta = parts.length > 0 ? ` (${parts.join(", ")})` : "";
    const check = task.completed ? "x" : " ";
    lines.push(`${indent}- [${check}] ${summary}${meta}`);
    if (depth === 0) lines.push("");
    return;
  }

  // LinkPreview — degrade to hyperlink
  if (type === BlockType.LINK_PREVIEW) {
    const preview =
      ((node as Record<string, unknown>)["link_preview"] as {
        url?: string;
        title?: string;
      }) || {};
    const url = preview.url || "";
    const title = preview.title || url || "链接";
    lines.push(`[${title}](${url})`);
    lines.push("");
    return;
  }

  // JiraIssue — render as JIRA link
  if (type === BlockType.JIRA_ISSUE) {
    const jira =
      ((node as Record<string, unknown>)["jira_issue"] as {
        key?: string;
        url?: string;
        summary?: string;
      }) || {};
    const key = jira.key || "";
    const url = jira.url || "";
    const summary = jira.summary || key || "JIRA Issue";
    if (url) {
      lines.push(`[JIRA: ${key || summary}](${url})`);
    } else {
      lines.push(`[JIRA: ${key || summary}]`);
    }
    lines.push("");
    return;
  }

  // WikiCatalog — render children or placeholder
  if (type === BlockType.WIKI_CATALOG) {
    if (node._children.length > 0) {
      renderChildren(node._children, lines, ctx, depth);
    } else {
      lines.push("[知识库目录]");
      lines.push("");
    }
    return;
  }

  // SubPageList — render children or placeholder
  if (type === BlockType.SUB_PAGE_LIST) {
    if (node._children.length > 0) {
      renderChildren(node._children, lines, ctx, depth);
    } else {
      lines.push("[子页面列表]");
      lines.push("");
    }
    return;
  }

  // Agenda blocks — meeting agenda rendering
  if (type === BlockType.AGENDA || type === BlockType.AGENDA_ITEM) {
    renderChildren(node._children, lines, ctx, depth);
    return;
  }

  if (type === BlockType.AGENDA_ITEM_TITLE) {
    const text = getElements(node, "agenda_item_title", ctx);
    lines.push(`${indent}**${text}**`);
    lines.push("");
    return;
  }

  if (type === BlockType.AGENDA_ITEM_CONTENT) {
    renderChildren(node._children, lines, ctx, depth);
    return;
  }

  // OKR blocks — complex business data, skip silently
  if (
    type === BlockType.OKR ||
    type === BlockType.OKR_OBJECTIVE ||
    type === BlockType.OKR_KEY_RESULT ||
    type === BlockType.OKR_PROGRESS
  ) {
    return;
  }

  // Synced blocks and AI template — no extractable content, skip silently
  if (
    type === BlockType.SOURCE_SYNCED ||
    type === BlockType.REFERENCE_SYNCED ||
    type === BlockType.AI_TEMPLATE
  ) {
    return;
  }

  // Reference types — show as label with token
  const refTypes: Record<number, string> = {
    [BlockType.MINDNOTE]: "思维笔记",
    [BlockType.VIEW]: "视图",
    [BlockType.CHAT_CARD]: "群消息卡片",
    [BlockType.ISV]: "三方块",
  };

  if (refTypes[type]) {
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
    const token = data.token || "";
    lines.push(`[${refTypes[type]}: ${token}]`);
    lines.push("");
    return;
  }

  // Unknown type
  ctx.warnings.push(`不支持的内容类型: ${type}`);
  lines.push(`[不支持的内容类型: ${type}]`);
  lines.push("");
}

/**
 * Get inline text from a block's elements.
 */
function getElements(
  node: TreeNode,
  key: string,
  ctx: BlocksRenderCtx,
): string {
  const data =
    ((node as Record<string, unknown>)[key] as { elements?: unknown[] }) || {};
  return elementsToMarkdown(data.elements as TextElement[] | undefined, ctx);
}

/**
 * Render a table block as Markdown table.
 */
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

  // Build 2D grid from table_cell children
  const cells = node._children;
  const grid: string[][] = [];
  for (let r = 0; r < rowSize; r++) {
    const row: string[] = [];
    for (let c = 0; c < colSize; c++) {
      const cellIndex = r * colSize + c;
      const cell = cells[cellIndex];
      if (cell) {
        const text = cellToText(cell, ctx);
        row.push(text);
      } else {
        row.push("");
      }
    }
    grid.push(row);
  }

  if (grid.length === 0) return;

  // Header row
  lines.push(
    "| " + grid[0].map((c) => c.replace(/\|/g, "\\|")).join(" | ") + " |",
  );
  // Separator
  lines.push("| " + grid[0].map(() => "---").join(" | ") + " |");
  // Data rows
  for (let r = 1; r < grid.length; r++) {
    lines.push(
      "| " + grid[r].map((c) => c.replace(/\|/g, "\\|")).join(" | ") + " |",
    );
  }
}

/**
 * Render a table_cell block content as inline text.
 */
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

/**
 * Sanitize Feishu mermaid content for standard mermaid compatibility.
 *
 * Feishu's mermaid renderer is more lenient than standard mermaid.
 * This function fixes common incompatibilities:
 * - Block labels (alt, else, loop, opt, rect, par, critical, break, note)
 *   don't support <br/> in standard mermaid — replace with comma-space
 * - Arrow messages missing space after ':' — add the space
 */
function sanitizeMermaid(content: string): string {
  // Block-level keywords whose label text doesn't support <br/> in standard mermaid
  const blockKeywords =
    /^(\s*(?:alt|else|loop|opt|par|critical|break)\s+)(.+)$/;

  return content
    .split("\n")
    .map((line) => {
      // Fix block labels: replace <br/> and <br> with comma-space,
      // and replace parentheses with full-width versions to avoid parser confusion
      const blockMatch = line.match(blockKeywords);
      if (blockMatch) {
        const cleaned = blockMatch[2]
          .replace(/<br\s*\/?>/gi, ", ")
          .replace(/\(/g, "\uFF08")
          .replace(/\)/g, "\uFF09");
        return blockMatch[1] + cleaned;
      }
      // Fix missing space after ':' in arrow messages (e.g., A->>B:text → A->>B: text)
      const arrowMatch = line.match(/^(\s*\S+\s*-[-.)>x]+[+-]?\s*\S+\s*):(\S)/);
      if (arrowMatch) {
        return line.replace(
          /^(\s*\S+\s*-[-.)>x]+[+-]?\s*\S+\s*):(\S)/,
          "$1: $2",
        );
      }
      return line;
    })
    .join("\n");
}
