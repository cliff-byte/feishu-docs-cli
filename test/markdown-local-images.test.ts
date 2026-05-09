import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareMarkdownLocalImages } from "../src/services/markdown-local-images.js";
import { CliError } from "../src/utils/errors.js";

describe("prepareMarkdownLocalImages", { concurrency: 1 }, () => {
  let testDir: string | undefined;

  afterEach(async () => {
    if (testDir) {
      await rm(testDir, { recursive: true, force: true }).catch(() => {});
      testDir = undefined;
    }
  });

  it("replaces standalone local images and preserves remote images", async () => {
    testDir = await mkdtemp(join(tmpdir(), "feishu-local-images-"));
    const imagesDir = join(testDir, "images");
    const markdownPath = join(testDir, "doc.md");
    await mkdir(imagesDir, { recursive: true });
    await writeFile(join(imagesDir, "demo.png"), Buffer.from([1, 2, 3]));

    const prepared = await prepareMarkdownLocalImages(
      [
        "Intro",
        "",
        "![Demo](./images/demo.png)",
        "",
        "![Remote](https://example.com/demo.png)",
      ].join("\n"),
      {
        sourceDir: testDir,
        sourcePath: markdownPath,
      },
    );

    assert.equal(prepared.images.length, 1);
    assert.ok(prepared.images[0].placeholder.startsWith("FEISHU_DOCS_IMAGE_"));
    assert.ok(prepared.markdown.includes(prepared.images[0].placeholder));
    assert.ok(prepared.markdown.includes("https://example.com/demo.png"));
  });

  it("rejects local images from stdin markdown", async () => {
    await assert.rejects(
      () => prepareMarkdownLocalImages("![Demo](./images/demo.png)\n"),
      (err: unknown) => {
        assert.ok(err instanceof CliError);
        assert.equal(err.errorType, "INVALID_ARGS");
        assert.ok(err.message.includes("stdin"));
        return true;
      },
    );
  });

  it("rejects local image paths outside markdown directory", async () => {
    testDir = await mkdtemp(join(tmpdir(), "feishu-local-images-"));
    const markdownPath = join(testDir, "doc.md");

    await assert.rejects(
      () =>
        prepareMarkdownLocalImages("![Demo](../demo.png)\n", {
          sourceDir: testDir,
          sourcePath: markdownPath,
        }),
      (err: unknown) => {
        assert.ok(err instanceof CliError);
        assert.equal(err.errorType, "INVALID_ARGS");
        assert.ok(err.message.includes("越界"));
        return true;
      },
    );
  });

  it("rejects inline local images that are not standalone blocks", async () => {
    testDir = await mkdtemp(join(tmpdir(), "feishu-local-images-"));
    const imagesDir = join(testDir, "images");
    const markdownPath = join(testDir, "doc.md");
    await mkdir(imagesDir, { recursive: true });
    await writeFile(join(imagesDir, "demo.png"), Buffer.from([1, 2, 3]));

    await assert.rejects(
      () =>
        prepareMarkdownLocalImages("prefix ![Demo](./images/demo.png) suffix", {
          sourceDir: testDir,
          sourcePath: markdownPath,
        }),
      (err: unknown) => {
        assert.ok(err instanceof CliError);
        assert.equal(err.errorType, "INVALID_ARGS");
        assert.ok(err.message.includes("暂不支持"));
        return true;
      },
    );
  });
});
