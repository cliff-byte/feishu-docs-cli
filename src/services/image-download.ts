/**
 * Download document images to local persistent storage.
 *
 * Images are saved to ~/.feishu-docs/images/{fileToken}.{ext} and served
 * via local file paths in Markdown output. Already-downloaded images are
 * skipped (disk cache by file_token).
 */

import { writeFile, mkdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { validateToken } from "../utils/validate.js";

export const IMAGES_DIR = join(homedir(), ".feishu-docs", "images");

export const CONTENT_TYPE_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
};

const KNOWN_EXTENSIONS = Object.values(CONTENT_TYPE_EXT);

/**
 * Check if a file already exists.
 */
async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve content-type to file extension. Defaults to ".png".
 */
export function resolveExtension(contentType: string): string {
  return CONTENT_TYPE_EXT[contentType.split(";")[0].trim()] || ".png";
}

/**
 * Find a cached image file for the given token (any known extension).
 * Returns the file path if found, or null.
 */
export async function findCachedImage(
  fileToken: string,
  dir: string = IMAGES_DIR,
): Promise<string | null> {
  for (const ext of KNOWN_EXTENSIONS) {
    const p = join(dir, `${fileToken}${ext}`);
    if (await fileExists(p)) return p;
  }
  return null;
}

/**
 * Download images from temporary URLs and save to local directory.
 * Returns a map of file_token → local file path. Already-downloaded images
 * are skipped (simple disk cache by file_token).
 */
export async function downloadImages(
  tmpUrlMap: Map<string, string>,
  dir: string = IMAGES_DIR,
): Promise<Map<string, string>> {
  if (tmpUrlMap.size === 0) return new Map();

  await mkdir(dir, { recursive: true });

  const localMap = new Map<string, string>();
  for (const [fileToken, tmpUrl] of tmpUrlMap) {
    // Validate token before using as filename to prevent path traversal
    try {
      validateToken(fileToken, "file_token");
    } catch {
      continue;
    }

    // Check disk cache (any known extension)
    const cached = await findCachedImage(fileToken, dir);
    if (cached) {
      localMap.set(fileToken, cached);
      continue;
    }

    try {
      const res = await fetch(tmpUrl);
      if (!res.ok) continue;

      const contentType = res.headers.get("content-type") || "";
      const ext = resolveExtension(contentType);
      const filePath = join(dir, `${fileToken}${ext}`);

      const buf = await res.arrayBuffer();
      if (buf.byteLength === 0) continue;

      await writeFile(filePath, Buffer.from(buf));
      localMap.set(fileToken, filePath);
    } catch {
      // Download failed for this image — skip it
    }
  }
  return localMap;
}
