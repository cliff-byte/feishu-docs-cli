/**
 * Tests for extractMarkdownTitle.
 *
 * Covers:
 *   - H1 heading extraction and stripping
 *   - H2+ headings are NOT extracted
 *   - Leading blank lines before heading
 *   - No heading in markdown
 *   - Heading-only markdown (no body)
 *   - Heading with trailing content
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractMarkdownTitle,
  normalizeMermaidLineBreaks,
} from "../src/services/markdown-convert.js";

describe("extractMarkdownTitle", () => {
  it("extracts H1 heading and returns body without it", () => {
    const md = "# My Title\n\nSome body content\n\nMore content";
    const result = extractMarkdownTitle(md);
    assert.equal(result.title, "My Title");
    assert.equal(result.body, "Some body content\n\nMore content");
  });

  it("handles leading blank lines before heading", () => {
    const md = "\n\n# My Title\n\nBody here";
    const result = extractMarkdownTitle(md);
    assert.equal(result.title, "My Title");
    assert.equal(result.body, "Body here");
  });

  it("does NOT extract H2 headings", () => {
    const md = "## Not a title\n\nBody content";
    const result = extractMarkdownTitle(md);
    assert.equal(result.title, null);
    assert.equal(result.body, md);
  });

  it("does NOT extract H3 headings", () => {
    const md = "### Not a title\n\nBody content";
    const result = extractMarkdownTitle(md);
    assert.equal(result.title, null);
    assert.equal(result.body, md);
  });

  it("returns null title when no heading found", () => {
    const md = "Just plain text\n\nMore text";
    const result = extractMarkdownTitle(md);
    assert.equal(result.title, null);
    assert.equal(result.body, md);
  });

  it("returns null title for empty string", () => {
    const result = extractMarkdownTitle("");
    assert.equal(result.title, null);
    assert.equal(result.body, "");
  });

  it("handles heading-only markdown (no body)", () => {
    const md = "# Just a Title";
    const result = extractMarkdownTitle(md);
    assert.equal(result.title, "Just a Title");
    assert.equal(result.body, "");
  });

  it("handles heading with single blank line after", () => {
    const md = "# Title\n";
    const result = extractMarkdownTitle(md);
    assert.equal(result.title, "Title");
    assert.equal(result.body, "");
  });

  it("preserves body content structure after title removal", () => {
    const md =
      "# Title\n\n## Section 1\n\nParagraph\n\n## Section 2\n\nMore text";
    const result = extractMarkdownTitle(md);
    assert.equal(result.title, "Title");
    assert.equal(
      result.body,
      "## Section 1\n\nParagraph\n\n## Section 2\n\nMore text",
    );
  });

  it("only checks the first non-empty line", () => {
    const md = "Not a heading\n\n# This is not extracted\n\nBody";
    const result = extractMarkdownTitle(md);
    assert.equal(result.title, null);
    assert.equal(result.body, md);
  });

  it("handles heading with extra spaces", () => {
    const md = "#   Spaced Title  \n\nBody";
    const result = extractMarkdownTitle(md);
    assert.equal(result.title, "Spaced Title");
    assert.equal(result.body, "Body");
  });
});

describe("normalizeMermaidLineBreaks", () => {
  it("replaces \\n with <br> in mermaid node labels", () => {
    const md =
      "# Title\n\n```mermaid\nflowchart TD\n    A[用户选择套餐\\n点击支付] --> B[下单]\n```\n";
    const result = normalizeMermaidLineBreaks(md);
    assert.ok(result.includes("A[用户选择套餐<br>点击支付]"));
    assert.ok(!result.includes("\\n"));
  });

  it("does not touch \\n outside mermaid blocks", () => {
    const md = "Some text with \\n in it\n\n```js\nconsole.log('\\n')\n```\n";
    const result = normalizeMermaidLineBreaks(md);
    assert.ok(result.includes("Some text with \\n"));
    assert.ok(result.includes("console.log('\\n')"));
  });

  it("handles multiple mermaid blocks", () => {
    const md =
      "```mermaid\nA[a\\nb]\n```\n\nText\n\n```mermaid\nC[c\\nd]\n```\n";
    const result = normalizeMermaidLineBreaks(md);
    assert.ok(result.includes("A[a<br>b]"));
    assert.ok(result.includes("C[c<br>d]"));
  });

  it("preserves markdown without mermaid blocks", () => {
    const md = "# Hello\n\nNo mermaid here.";
    assert.equal(normalizeMermaidLineBreaks(md), md);
  });
});
