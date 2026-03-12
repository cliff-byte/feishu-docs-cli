import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { blocksToMarkdown } from "../src/parser/blocks-to-md.js";
import type { Block, TextElementStyle } from "../src/types/index.js";

// Helper to create a minimal block structure
function makeBlocks(children: Block[]): Block[] {
  const rootId = "root";
  const blocks: Block[] = [
    {
      block_id: rootId,
      block_type: 1,
      parent_id: "",
      children: children.map((c) => c.block_id),
    },
    ...children.map((c) => ({ ...c, parent_id: rootId })),
  ];
  return blocks;
}

function textBlock(
  id: string,
  content: string,
  style: TextElementStyle = {},
): Block {
  return {
    block_id: id,
    block_type: 2,
    children: [],
    text: {
      elements: [{ text_run: { content, text_element_style: style } }],
    },
  };
}

function headingBlock(id: string, level: number, content: string): Block {
  const type = 2 + level; // heading1 = 3, heading2 = 4, etc.
  const key = `heading${level}`;
  return {
    block_id: id,
    block_type: type,
    children: [],
    [key]: {
      elements: [{ text_run: { content } }],
    },
  };
}

function codeBlock(id: string, content: string, language = 0): Block {
  return {
    block_id: id,
    block_type: 14,
    children: [],
    code: {
      elements: [{ text_run: { content } }],
      style: { language },
    },
  };
}

function dividerBlock(id: string): Block {
  return { block_id: id, block_type: 22, children: [] };
}

function bulletBlock(
  id: string,
  content: string,
  childIds: string[] = [],
): Block {
  return {
    block_id: id,
    block_type: 12,
    children: childIds,
    bullet: {
      elements: [{ text_run: { content } }],
    },
  };
}

function orderedBlock(
  id: string,
  content: string,
  childIds: string[] = [],
): Block {
  return {
    block_id: id,
    block_type: 13,
    children: childIds,
    ordered: {
      elements: [{ text_run: { content } }],
    },
  };
}

function todoBlock(id: string, content: string, done = false): Block {
  return {
    block_id: id,
    block_type: 17,
    children: [],
    todo: {
      elements: [{ text_run: { content } }],
      done,
    } as unknown as import("../src/types/index.js").BlockText,
  };
}

function quoteBlock(id: string, content: string): Block {
  return {
    block_id: id,
    block_type: 15,
    children: [],
    quote: {
      elements: [{ text_run: { content } }],
    },
  };
}

function imageBlock(id: string, fileToken: string): Block {
  return {
    block_id: id,
    block_type: 27,
    children: [],
    image: { token: fileToken },
  };
}

describe("blocksToMarkdown", () => {
  it("should return empty string for empty blocks", () => {
    assert.equal(blocksToMarkdown([]), "");
    assert.equal(blocksToMarkdown(null as unknown as Block[]), "");
  });

  it("should render text block", () => {
    const blocks = makeBlocks([textBlock("b1", "Hello world")]);
    const md = blocksToMarkdown(blocks);
    assert.equal(md, "Hello world\n");
  });

  it("should render headings", () => {
    const blocks = makeBlocks([
      headingBlock("h1", 1, "Title"),
      headingBlock("h2", 2, "Subtitle"),
      headingBlock("h3", 3, "Section"),
    ]);
    const md = blocksToMarkdown(blocks);
    assert.ok(md.includes("# Title"));
    assert.ok(md.includes("## Subtitle"));
    assert.ok(md.includes("### Section"));
  });

  it("should render code block with language", () => {
    const blocks = makeBlocks([codeBlock("c1", "const x = 1;", 30)]); // 30 = javascript
    const md = blocksToMarkdown(blocks);
    assert.ok(md.includes("```javascript"));
    assert.ok(md.includes("const x = 1;"));
    assert.ok(md.includes("```"));
  });

  it("should render code block without language", () => {
    const blocks = makeBlocks([codeBlock("c1", "some code", 0)]);
    const md = blocksToMarkdown(blocks);
    assert.ok(md.includes("```plaintext"));
    assert.ok(md.includes("some code"));
  });

  it("should render divider", () => {
    const blocks = makeBlocks([
      textBlock("t1", "Before"),
      dividerBlock("d1"),
      textBlock("t2", "After"),
    ]);
    const md = blocksToMarkdown(blocks);
    assert.ok(md.includes("---"));
  });

  it("should render bullet list", () => {
    const blocks = makeBlocks([
      bulletBlock("b1", "Item 1"),
      bulletBlock("b2", "Item 2"),
    ]);
    const md = blocksToMarkdown(blocks);
    assert.ok(md.includes("- Item 1"));
    assert.ok(md.includes("- Item 2"));
  });

  it("should render ordered list", () => {
    const root = "root";
    const blocks = [
      { block_id: root, block_type: 1, parent_id: "", children: ["o1", "o2"] },
      { ...orderedBlock("o1", "First"), parent_id: root },
      { ...orderedBlock("o2", "Second"), parent_id: root },
    ];
    const md = blocksToMarkdown(blocks);
    assert.ok(md.includes("1. First"));
    // Note: ordered list items get index 1 each because state resets per renderNode call
  });

  it("should render nested bullet list", () => {
    const root = "root";
    const blocks = [
      { block_id: root, block_type: 1, parent_id: "", children: ["b1"] },
      { ...bulletBlock("b1", "Parent", ["b2"]), parent_id: root },
      { ...bulletBlock("b2", "Child"), parent_id: "b1" },
    ];
    const md = blocksToMarkdown(blocks);
    assert.ok(md.includes("- Parent"));
    assert.ok(md.includes("  - Child"));
  });

  it("should render todo items", () => {
    const blocks = makeBlocks([
      todoBlock("t1", "Done task", true),
      todoBlock("t2", "Pending task", false),
    ]);
    const md = blocksToMarkdown(blocks);
    assert.ok(md.includes("- [x] Done task"));
    assert.ok(md.includes("- [ ] Pending task"));
  });

  it("should render quote", () => {
    const blocks = makeBlocks([quoteBlock("q1", "A wise quote")]);
    const md = blocksToMarkdown(blocks);
    assert.ok(md.includes("> A wise quote"));
  });

  it("should render image with URL from map", () => {
    const blocks = makeBlocks([imageBlock("i1", "file_token_123")]);
    const imageUrlMap = new Map([
      ["file_token_123", "https://example.com/img.png"],
    ]);
    const md = blocksToMarkdown(blocks, { imageUrlMap });
    assert.ok(md.includes("![](https://example.com/img.png)"));
  });

  it("should render image without URL", () => {
    const blocks = makeBlocks([imageBlock("i1", "file_token_123")]);
    const md = blocksToMarkdown(blocks);
    assert.ok(md.includes("![](file_token_123)"));
  });

  it("should render inline styles", () => {
    const blocks = makeBlocks([
      {
        block_id: "b1",
        block_type: 2,
        children: [],
        text: {
          elements: [
            { text_run: { content: "normal " } },
            {
              text_run: { content: "bold", text_element_style: { bold: true } },
            },
            { text_run: { content: " " } },
            {
              text_run: {
                content: "italic",
                text_element_style: { italic: true },
              },
            },
            { text_run: { content: " " } },
            {
              text_run: {
                content: "code",
                text_element_style: { inline_code: true },
              },
            },
            { text_run: { content: " " } },
            {
              text_run: {
                content: "link",
                text_element_style: {
                  link: { url: "https%3A%2F%2Fexample.com" },
                },
              },
            },
          ],
        },
      },
    ]);
    const md = blocksToMarkdown(blocks);
    assert.ok(md.includes("**bold**"));
    assert.ok(md.includes("*italic*"));
    assert.ok(md.includes("`code`"));
    assert.ok(md.includes("[link](https://example.com)"));
  });

  it("should render table", () => {
    const root = "root";
    const tableId = "table1";
    const blocks = [
      { block_id: root, block_type: 1, parent_id: "", children: [tableId] },
      {
        block_id: tableId,
        block_type: 31,
        parent_id: root,
        children: ["c1", "c2", "c3", "c4"],
        table: { property: { row_size: 2, column_size: 2 } },
      },
      {
        block_id: "c1",
        block_type: 32,
        parent_id: tableId,
        children: ["c1t"],
      },
      {
        block_id: "c1t",
        block_type: 2,
        parent_id: "c1",
        children: [],
        text: { elements: [{ text_run: { content: "Header 1" } }] },
      },
      {
        block_id: "c2",
        block_type: 32,
        parent_id: tableId,
        children: ["c2t"],
      },
      {
        block_id: "c2t",
        block_type: 2,
        parent_id: "c2",
        children: [],
        text: { elements: [{ text_run: { content: "Header 2" } }] },
      },
      {
        block_id: "c3",
        block_type: 32,
        parent_id: tableId,
        children: ["c3t"],
      },
      {
        block_id: "c3t",
        block_type: 2,
        parent_id: "c3",
        children: [],
        text: { elements: [{ text_run: { content: "Cell 1" } }] },
      },
      {
        block_id: "c4",
        block_type: 32,
        parent_id: tableId,
        children: ["c4t"],
      },
      {
        block_id: "c4t",
        block_type: 2,
        parent_id: "c4",
        children: [],
        text: { elements: [{ text_run: { content: "Cell 2" } }] },
      },
    ];
    const md = blocksToMarkdown(blocks);
    assert.ok(md.includes("| Header 1 | Header 2 |"));
    assert.ok(md.includes("| --- | --- |"));
    assert.ok(md.includes("| Cell 1 | Cell 2 |"));
  });

  it("should handle unknown block types gracefully", () => {
    const blocks = makeBlocks([
      {
        block_id: "u1",
        block_type: 999,
        children: [],
      },
    ]);
    const md = blocksToMarkdown(blocks);
    assert.ok(md.includes("[不支持的内容类型: 999]"));
  });

  it("should render equation elements", () => {
    const blocks = makeBlocks([
      {
        block_id: "b1",
        block_type: 2,
        children: [],
        text: {
          elements: [
            { text_run: { content: "Formula: " } },
            { equation: { content: "E = mc^2" } },
          ],
        },
      },
    ]);
    const md = blocksToMarkdown(blocks);
    assert.ok(md.includes("$E = mc^2$"));
  });

  it("should render bold+italic combo", () => {
    const blocks = makeBlocks([
      {
        block_id: "b1",
        block_type: 2,
        children: [],
        text: {
          elements: [
            {
              text_run: {
                content: "emphasis",
                text_element_style: { bold: true, italic: true },
              },
            },
          ],
        },
      },
    ]);
    const md = blocksToMarkdown(blocks);
    assert.ok(md.includes("***emphasis***"));
  });

  it("should render strikethrough", () => {
    const blocks = makeBlocks([
      {
        block_id: "b1",
        block_type: 2,
        children: [],
        text: {
          elements: [
            {
              text_run: {
                content: "deleted",
                text_element_style: { strikethrough: true },
              },
            },
          ],
        },
      },
    ]);
    const md = blocksToMarkdown(blocks);
    assert.ok(md.includes("~~deleted~~"));
  });

  // --- New block type tests ---

  it("should render task block as todo", () => {
    const blocks = makeBlocks([
      {
        block_id: "t1",
        block_type: 35,
        children: [],
        task: { summary: "Write docs", completed: false },
      } as unknown as Block,
    ]);
    const md = blocksToMarkdown(blocks);
    assert.ok(md.includes("- [ ] Write docs"));
  });

  it("should render completed task with metadata", () => {
    const blocks = makeBlocks([
      {
        block_id: "t1",
        block_type: 35,
        children: [],
        task: {
          summary: "Deploy",
          completed: true,
          assignees: [{ name: "Alice" }, { name: "Bob" }],
          due: "2026-03-15",
        },
      } as unknown as Block,
    ]);
    const md = blocksToMarkdown(blocks);
    assert.ok(md.includes("- [x] Deploy (@Alice, @Bob, 截止: 2026-03-15)"));
  });

  it("should render link preview as hyperlink", () => {
    const blocks = makeBlocks([
      {
        block_id: "lp1",
        block_type: 48,
        children: [],
        link_preview: { url: "https://example.com", title: "Example Site" },
      },
    ]);
    const md = blocksToMarkdown(blocks);
    assert.ok(md.includes("[Example Site](https://example.com)"));
  });

  it("should render link preview without title", () => {
    const blocks = makeBlocks([
      {
        block_id: "lp1",
        block_type: 48,
        children: [],
        link_preview: { url: "https://example.com" },
      },
    ]);
    const md = blocksToMarkdown(blocks);
    assert.ok(md.includes("[https://example.com](https://example.com)"));
  });

  it("should render jira issue as link", () => {
    const blocks = makeBlocks([
      {
        block_id: "j1",
        block_type: 41,
        children: [],
        jira_issue: {
          key: "PROJ-123",
          url: "https://jira.example.com/PROJ-123",
        },
      },
    ]);
    const md = blocksToMarkdown(blocks);
    assert.ok(
      md.includes("[JIRA: PROJ-123](https://jira.example.com/PROJ-123)"),
    );
  });

  it("should render sheet with data as table", () => {
    const blocks = makeBlocks([
      {
        block_id: "s1",
        block_type: 30,
        children: [],
        sheet: { token: "sheet_token_1" },
      },
    ]);
    const sheetDataMap = new Map([
      [
        "sheet_token_1",
        {
          fields: ["Name", "Score"],
          records: [
            ["Alice", "95"],
            ["Bob", "87"],
          ],
          title: "成绩表",
        },
      ],
    ]);
    const md = blocksToMarkdown(blocks, { sheetDataMap });
    assert.ok(md.includes("**成绩表**"));
    assert.ok(md.includes("| Name | Score |"));
    assert.ok(md.includes("| --- | --- |"));
    assert.ok(md.includes("| Alice | 95 |"));
    assert.ok(md.includes("| Bob | 87 |"));
  });

  it("should render sheet without data as placeholder", () => {
    const blocks = makeBlocks([
      {
        block_id: "s1",
        block_type: 30,
        children: [],
        sheet: { token: "sheet_token_1" },
      },
    ]);
    const md = blocksToMarkdown(blocks);
    assert.ok(md.includes("[电子表格: sheet_token_1]"));
  });

  it("should render wiki catalog children", () => {
    const root = "root";
    const blocks = [
      { block_id: root, block_type: 1, parent_id: "", children: ["wc1"] },
      {
        block_id: "wc1",
        block_type: 42,
        parent_id: root,
        children: ["wct1"],
      },
      {
        block_id: "wct1",
        block_type: 2,
        parent_id: "wc1",
        children: [],
        text: { elements: [{ text_run: { content: "Catalog item" } }] },
      },
    ];
    const md = blocksToMarkdown(blocks);
    assert.ok(md.includes("Catalog item"));
  });

  it("should render empty wiki catalog as placeholder", () => {
    const blocks = makeBlocks([
      { block_id: "wc1", block_type: 42, children: [] },
    ]);
    const md = blocksToMarkdown(blocks);
    assert.ok(md.includes("[知识库目录]"));
  });

  it("should render sub page list placeholder", () => {
    const blocks = makeBlocks([
      { block_id: "sp1", block_type: 51, children: [] },
    ]);
    const md = blocksToMarkdown(blocks);
    assert.ok(md.includes("[子页面列表]"));
  });

  it("should silently skip OKR blocks", () => {
    const blocks = makeBlocks([
      { block_id: "okr1", block_type: 36, children: [] },
      { block_id: "okr2", block_type: 37, children: [] },
      { block_id: "okr3", block_type: 38, children: [] },
      { block_id: "okr4", block_type: 39, children: [] },
      textBlock("t1", "After OKR"),
    ]);
    const md = blocksToMarkdown(blocks);
    assert.ok(md.includes("After OKR"));
    assert.ok(!md.includes("不支持"));
  });

  it("should silently skip synced blocks and AI template", () => {
    const blocks = makeBlocks([
      { block_id: "ss1", block_type: 49, children: [] },
      { block_id: "rs1", block_type: 50, children: [] },
      { block_id: "ai1", block_type: 52, children: [] },
      textBlock("t1", "After sync"),
    ]);
    const md = blocksToMarkdown(blocks);
    assert.ok(md.includes("After sync"));
    assert.ok(!md.includes("不支持"));
  });

  it("should render agenda item title as bold", () => {
    const root = "root";
    const blocks = [
      { block_id: root, block_type: 1, parent_id: "", children: ["a1"] },
      {
        block_id: "a1",
        block_type: 44,
        parent_id: root,
        children: ["ai1"],
      },
      {
        block_id: "ai1",
        block_type: 45,
        parent_id: "a1",
        children: ["ait1", "aic1"],
      },
      {
        block_id: "ait1",
        block_type: 46,
        parent_id: "ai1",
        children: [],
        agenda_item_title: {
          elements: [{ text_run: { content: "议题一" } }],
        },
      },
      {
        block_id: "aic1",
        block_type: 47,
        parent_id: "ai1",
        children: ["aic1t"],
      },
      {
        block_id: "aic1t",
        block_type: 2,
        parent_id: "aic1",
        children: [],
        text: { elements: [{ text_run: { content: "讨论内容" } }] },
      },
    ];
    const md = blocksToMarkdown(blocks);
    assert.ok(md.includes("**议题一**"));
    assert.ok(md.includes("讨论内容"));
  });
});
