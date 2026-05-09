import { existsSync } from "node:fs";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { CliError } from "../utils/errors.js";

const LOCAL_IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".svg",
]);

export interface LocalMarkdownImage {
  alt: string;
  placeholder: string;
  originalPath: string;
  resolvedPath: string;
  lineNumber: number;
}

export interface PreparedMarkdownImages {
  markdown: string;
  images: LocalMarkdownImage[];
}

function parseImageTarget(rawTarget: string): string {
  const trimmed = rawTarget.trim();
  if (trimmed.startsWith("<") && trimmed.endsWith(">")) {
    return trimmed.slice(1, -1).trim();
  }

  const titleMatch = trimmed.match(/^(.*?)(?:\s+(['"]).*\2)?$/);
  return (titleMatch?.[1] || trimmed).trim();
}

function isRemoteTarget(target: string): boolean {
  return /^(?:https?:|data:|ftp:|mailto:)/i.test(target);
}

function validateLocalImagePath(
  target: string,
  sourceDir: string | undefined,
  sourcePath: string | undefined,
): string {
  if (!sourceDir || !sourcePath) {
    throw new CliError(
      "INVALID_ARGS",
      "从 stdin 读取 Markdown 时不支持本地图片写入",
      {
        recovery: "请将 Markdown 保存为文件后，再通过 --body <file> 传入",
      },
    );
  }

  if (isAbsolute(target)) {
    throw new CliError("INVALID_ARGS", `不支持绝对路径图片: ${target}`, {
      recovery: `请使用相对于 ${sourcePath} 所在目录的图片路径`,
    });
  }

  const resolvedPath = resolve(sourceDir, target);
  const relativePath = relative(sourceDir, resolvedPath);
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${"/"}`) ||
    relativePath.startsWith(`..${"\\"}`) ||
    isAbsolute(relativePath)
  ) {
    throw new CliError("INVALID_ARGS", `图片路径越界: ${target}`, {
      recovery: "本地图片路径必须位于 Markdown 文件所在目录及其子目录内",
    });
  }

  const extension = extname(resolvedPath).toLowerCase();
  if (!LOCAL_IMAGE_EXTENSIONS.has(extension)) {
    throw new CliError("INVALID_ARGS", `不支持的本地图片格式: ${target}`, {
      recovery: `当前仅支持: ${Array.from(LOCAL_IMAGE_EXTENSIONS).join(", ")}`,
    });
  }

  if (!existsSync(resolvedPath)) {
    throw new CliError("FILE_NOT_FOUND", `图片文件不存在: ${resolvedPath}`);
  }

  return resolvedPath;
}

/**
 * Replace standalone local Markdown images with unique placeholders.
 * Remote images are left untouched and continue through the Convert API.
 */
export async function prepareMarkdownLocalImages(
  markdown: string,
  options: {
    sourceDir?: string;
    sourcePath?: string;
  } = {},
): Promise<PreparedMarkdownImages> {
  const lines = markdown.split("\n");
  const images: LocalMarkdownImage[] = [];

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const trimmed = line.trim();
    const anyImageMatch = line.match(/!\[([^\]]*)\]\((.+)\)/);
    if (anyImageMatch) {
      const target = parseImageTarget(anyImageMatch[2]);
      if (!target || isRemoteTarget(target)) continue;

      const standaloneMatch = trimmed.match(/^!\[([^\]]*)\]\((.+)\)$/);
      if (!standaloneMatch) {
        throw new CliError(
          "INVALID_ARGS",
          `暂不支持该位置的本地图片写入: line ${index + 1}`,
          {
            recovery: "请将本地图片单独放在一行，格式为 ![alt](./path/image.png)",
          },
        );
      }
    }

    const match = trimmed.match(/^!\[([^\]]*)\]\((.+)\)$/);
    if (!match) continue;

    const target = parseImageTarget(match[2]);
    if (!target || isRemoteTarget(target)) continue;

    const resolvedPath = validateLocalImagePath(
      target,
      options.sourceDir,
      options.sourcePath,
    );
    const placeholder = `FEISHU_DOCS_IMAGE_${randomUUID()}`;

    images.push({
      alt: match[1],
      placeholder,
      originalPath: target,
      resolvedPath,
      lineNumber: index + 1,
    });
    lines[index] = placeholder;
  }

  return {
    markdown: lines.join("\n"),
    images,
  };
}
