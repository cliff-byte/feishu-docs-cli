import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { elementsToMarkdown } from "../src/parser/text-elements.js";

describe("elementsToMarkdown", () => {
  it("should return empty string for empty/null elements", () => {
    assert.equal(elementsToMarkdown([]), "");
    assert.equal(elementsToMarkdown(null), "");
    assert.equal(elementsToMarkdown(undefined), "");
  });

  it("should render plain text", () => {
    const result = elementsToMarkdown([
      { text_run: { content: "Hello world" } },
    ]);
    assert.equal(result, "Hello world");
  });

  it("should render bold text", () => {
    const result = elementsToMarkdown([
      { text_run: { content: "bold", text_element_style: { bold: true } } },
    ]);
    assert.equal(result, "**bold**");
  });

  it("should render italic text", () => {
    const result = elementsToMarkdown([
      { text_run: { content: "italic", text_element_style: { italic: true } } },
    ]);
    assert.equal(result, "*italic*");
  });

  it("should render bold+italic", () => {
    const result = elementsToMarkdown([
      {
        text_run: {
          content: "both",
          text_element_style: { bold: true, italic: true },
        },
      },
    ]);
    assert.equal(result, "***both***");
  });

  it("should render strikethrough", () => {
    const result = elementsToMarkdown([
      {
        text_run: {
          content: "deleted",
          text_element_style: { strikethrough: true },
        },
      },
    ]);
    assert.equal(result, "~~deleted~~");
  });

  it("should render underline", () => {
    const result = elementsToMarkdown([
      {
        text_run: {
          content: "underlined",
          text_element_style: { underline: true },
        },
      },
    ]);
    assert.equal(result, "<u>underlined</u>");
  });

  it("should render inline code", () => {
    const result = elementsToMarkdown([
      {
        text_run: {
          content: "code",
          text_element_style: { inline_code: true },
        },
      },
    ]);
    assert.equal(result, "`code`");
  });

  it("should render link", () => {
    const result = elementsToMarkdown([
      {
        text_run: {
          content: "click",
          text_element_style: { link: { url: "https%3A%2F%2Fexample.com" } },
        },
      },
    ]);
    assert.equal(result, "[click](https://example.com)");
  });

  it("should render equation", () => {
    const result = elementsToMarkdown([
      { equation: { content: "x^2 + y^2 = z^2" } },
    ]);
    assert.equal(result, "$$x^2 + y^2 = z^2$$");
  });

  it("should render mention_user", () => {
    const result = elementsToMarkdown([
      { mention_user: { user_name: "张三" } },
    ]);
    assert.equal(result, "@张三");
  });

  it("should render mention_doc", () => {
    const result = elementsToMarkdown([
      { mention_doc: { title: "设计文档", url: "https://feishu.cn/doc/xxx" } },
    ]);
    assert.equal(result, "[设计文档](https://feishu.cn/doc/xxx)");
  });

  it("should combine multiple elements", () => {
    const result = elementsToMarkdown([
      { text_run: { content: "normal " } },
      { text_run: { content: "bold", text_element_style: { bold: true } } },
      { text_run: { content: " end" } },
    ]);
    assert.equal(result, "normal **bold** end");
  });

  it("inline code should take priority over other styles", () => {
    const result = elementsToMarkdown([
      {
        text_run: {
          content: "code",
          text_element_style: { inline_code: true, bold: true },
        },
      },
    ]);
    // inline_code takes priority, bold should be ignored
    assert.equal(result, "`code`");
  });

  it("should handle bold + strikethrough combo", () => {
    const result = elementsToMarkdown([
      {
        text_run: {
          content: "text",
          text_element_style: { bold: true, strikethrough: true },
        },
      },
    ]);
    assert.equal(result, "~~**text**~~");
  });
});
