import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  writeFile,
  mkdir,
  rm,
  readdir,
  mkdtemp,
  utimes,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  resolveExtension,
  findCachedImage,
  downloadImages,
  CONTENT_TYPE_EXT,
  cleanExpiredImages,
  IMAGE_TTL_MS,
} from "../src/services/image-download.js";

const TEST_DIR = join(tmpdir(), `feishu-docs-test-${process.pid}`);

describe("resolveExtension", () => {
  it("resolves image/png to .png", () => {
    assert.equal(resolveExtension("image/png"), ".png");
  });

  it("resolves image/jpeg to .jpg", () => {
    assert.equal(resolveExtension("image/jpeg"), ".jpg");
  });

  it("resolves image/gif to .gif", () => {
    assert.equal(resolveExtension("image/gif"), ".gif");
  });

  it("resolves image/webp to .webp", () => {
    assert.equal(resolveExtension("image/webp"), ".webp");
  });

  it("resolves image/svg+xml to .svg", () => {
    assert.equal(resolveExtension("image/svg+xml"), ".svg");
  });

  it("strips charset suffix before lookup", () => {
    assert.equal(resolveExtension("image/png; charset=utf-8"), ".png");
  });

  it("defaults to .png for unknown content-type", () => {
    assert.equal(resolveExtension("application/octet-stream"), ".png");
  });

  it("defaults to .png for empty string", () => {
    assert.equal(resolveExtension(""), ".png");
  });
});

describe("CONTENT_TYPE_EXT", () => {
  it("covers all common image types", () => {
    assert.equal(Object.keys(CONTENT_TYPE_EXT).length, 5);
    assert.ok("image/png" in CONTENT_TYPE_EXT);
    assert.ok("image/jpeg" in CONTENT_TYPE_EXT);
    assert.ok("image/gif" in CONTENT_TYPE_EXT);
    assert.ok("image/webp" in CONTENT_TYPE_EXT);
    assert.ok("image/svg+xml" in CONTENT_TYPE_EXT);
  });
});

describe("findCachedImage", () => {
  before(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });

  after(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it("returns null when no cached file exists", async () => {
    const result = await findCachedImage("nonexistent_token", TEST_DIR);
    assert.equal(result, null);
  });

  it("finds a cached .png file", async () => {
    const token = "test_png_token";
    const filePath = join(TEST_DIR, `${token}.png`);
    await writeFile(filePath, "fake png");
    const result = await findCachedImage(token, TEST_DIR);
    assert.equal(result, filePath);
  });

  it("finds a cached .jpg file", async () => {
    const token = "test_jpg_token";
    const filePath = join(TEST_DIR, `${token}.jpg`);
    await writeFile(filePath, "fake jpg");
    const result = await findCachedImage(token, TEST_DIR);
    assert.equal(result, filePath);
  });

  it("finds a cached .gif file", async () => {
    const token = "test_gif_token";
    const filePath = join(TEST_DIR, `${token}.gif`);
    await writeFile(filePath, "fake gif");
    const result = await findCachedImage(token, TEST_DIR);
    assert.equal(result, filePath);
  });

  it("finds a cached .webp file", async () => {
    const token = "test_webp_token";
    const filePath = join(TEST_DIR, `${token}.webp`);
    await writeFile(filePath, "fake webp");
    const result = await findCachedImage(token, TEST_DIR);
    assert.equal(result, filePath);
  });

  it("finds a cached .svg file", async () => {
    const token = "test_svg_token";
    const filePath = join(TEST_DIR, `${token}.svg`);
    await writeFile(filePath, "fake svg");
    const result = await findCachedImage(token, TEST_DIR);
    assert.equal(result, filePath);
  });
});

describe("downloadImages", () => {
  before(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });

  after(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it("returns empty map for empty input", async () => {
    const result = await downloadImages(new Map(), TEST_DIR);
    assert.equal(result.size, 0);
  });

  it("skips tokens that fail validation (path traversal)", async () => {
    const malicious = new Map([
      ["../../etc/passwd", "http://example.com/img.png"],
    ]);
    const result = await downloadImages(malicious, TEST_DIR);
    assert.equal(result.size, 0);
  });

  it("skips tokens with invalid characters", async () => {
    const bad = new Map([["token/with/slashes", "http://example.com/img.png"]]);
    const result = await downloadImages(bad, TEST_DIR);
    assert.equal(result.size, 0);
  });

  it("returns cached path when file already exists", async () => {
    const token = "cached_download_token";
    const filePath = join(TEST_DIR, `${token}.png`);
    await writeFile(filePath, "cached image data");

    const input = new Map([[token, "http://example.com/will-not-be-called"]]);
    const result = await downloadImages(input, TEST_DIR);
    assert.equal(result.size, 1);
    assert.equal(result.get(token), filePath);
  });

  it("handles fetch failure gracefully (returns partial map)", async () => {
    const input = new Map([
      ["valid_but_unreachable", "http://0.0.0.0:1/never"],
    ]);
    const result = await downloadImages(input, TEST_DIR);
    // Should not throw, just skip the failed download
    assert.equal(result.size, 0);
  });
});

describe("IMAGE_TTL_MS", () => {
  it("equals 30 days in milliseconds", () => {
    assert.equal(IMAGE_TTL_MS, 2_592_000_000);
  });
});

describe("cleanExpiredImages", () => {
  it("deletes files older than 30 days", async () => {
    const dir = await mkdtemp(join(tmpdir(), "feishu-cache-ttl-"));
    try {
      const filePath = join(dir, "old_token.png");
      await writeFile(filePath, "old image data");
      // Set mtime to 31 days ago
      const thirtyOneDaysAgo = new Date(Date.now() - IMAGE_TTL_MS - 86_400_000);
      await utimes(filePath, new Date(), thirtyOneDaysAgo);

      await cleanExpiredImages(dir);

      const remaining = await readdir(dir);
      assert.equal(remaining.length, 0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps files within 30 days", async () => {
    const dir = await mkdtemp(join(tmpdir(), "feishu-cache-ttl-"));
    try {
      const filePath = join(dir, "fresh_token.png");
      await writeFile(filePath, "fresh image data");
      // mtime is now (fresh) -- should be kept

      await cleanExpiredImages(dir);

      const remaining = await readdir(dir);
      assert.equal(remaining.length, 1);
      assert.equal(remaining[0], "fresh_token.png");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("handles empty directory without error", async () => {
    const dir = await mkdtemp(join(tmpdir(), "feishu-cache-ttl-"));
    try {
      // Should not throw on empty dir
      await cleanExpiredImages(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("handles non-existent directory without throwing", async () => {
    // Should not throw -- outer catch handles ENOENT
    await cleanExpiredImages(`/tmp/nonexistent-feishu-${Date.now()}`);
  });

  it("logs cleaned count to stderr when files cleaned", async () => {
    const dir = await mkdtemp(join(tmpdir(), "feishu-cache-ttl-"));
    const original = process.stderr.write;
    const stderrCalls: string[] = [];
    try {
      // Create 2 expired files
      for (const name of ["expired1.png", "expired2.jpg"]) {
        const fp = join(dir, name);
        await writeFile(fp, "data");
        const old = new Date(Date.now() - IMAGE_TTL_MS - 86_400_000);
        await utimes(fp, new Date(), old);
      }

      // Intercept stderr
      process.stderr.write = (chunk: string | Uint8Array) => {
        stderrCalls.push(String(chunk));
        return true;
      };

      await cleanExpiredImages(dir);

      assert.ok(
        stderrCalls.some((s) => s.includes("已清理 2 个过期图片缓存")),
        `Expected stderr to contain cleanup message, got: ${stderrCalls.join("")}`,
      );
    } finally {
      process.stderr.write = original;
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not log when nothing cleaned", async () => {
    const dir = await mkdtemp(join(tmpdir(), "feishu-cache-ttl-"));
    const original = process.stderr.write;
    const stderrCalls: string[] = [];
    try {
      // Create 1 fresh file
      await writeFile(join(dir, "fresh.png"), "data");

      // Intercept stderr
      process.stderr.write = (chunk: string | Uint8Array) => {
        stderrCalls.push(String(chunk));
        return true;
      };

      await cleanExpiredImages(dir);

      assert.ok(
        !stderrCalls.some((s) => s.includes("已清理")),
        `Expected no cleanup log, got: ${stderrCalls.join("")}`,
      );
    } finally {
      process.stderr.write = original;
      await rm(dir, { recursive: true, force: true });
    }
  });
});
