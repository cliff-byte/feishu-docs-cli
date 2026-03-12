/**
 * Parse Feishu/Lark URL or raw token into { type, token }.
 */

import { ParsedDoc, DocType } from "../types/index.js";
import { CliError } from "./errors.js";

const FEISHU_DOMAINS = /(?:^|\.)(feishu\.cn|larksuite\.com|larkoffice\.com)$/;

const PATH_PATTERNS: Array<{ pattern: RegExp; type: DocType }> = [
  { pattern: /^\/wiki\/([A-Za-z0-9]+)/, type: "wiki" },
  { pattern: /^\/docx\/([A-Za-z0-9]+)/, type: "docx" },
  { pattern: /^\/doc\/([A-Za-z0-9]+)/, type: "doc" },
  { pattern: /^\/sheets\/([A-Za-z0-9]+)/, type: "sheet" },
  { pattern: /^\/base\/([A-Za-z0-9]+)/, type: "bitable" },
];

const RAW_TOKEN_RE = /^[A-Za-z][A-Za-z0-9]{19,}$/;

export function parseDocUrl(input: unknown): ParsedDoc {
  if (!input) {
    throw new CliError("INVALID_ARGS", "缺少文档 URL 或 token", {
      recovery: "请提供飞书文档 URL 或 token",
    });
  }

  const trimmed = (input as string).trim();

  // Try as URL
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      throw new CliError("INVALID_ARGS", `无效的 URL: ${trimmed}`, {
        recovery: "请提供有效的飞书文档 URL",
      });
    }

    if (!FEISHU_DOMAINS.test(url.hostname)) {
      throw new CliError("INVALID_ARGS", "不支持的域名，请使用飞书/Lark URL", {
        recovery: "支持的域名: feishu.cn, larksuite.com, larkoffice.com",
      });
    }

    for (const { pattern, type } of PATH_PATTERNS) {
      const match = url.pathname.match(pattern);
      if (match) {
        const token = match[1];
        if (!token) {
          throw new CliError("INVALID_ARGS", "URL 中缺少文档 token");
        }
        return { type, token };
      }
    }

    throw new CliError(
      "INVALID_ARGS",
      `无法识别的 URL 路径: ${url.pathname}`,
      { recovery: "支持的路径: /wiki/, /docx/, /doc/, /sheets/, /base/" },
    );
  }

  // Try as raw token
  if (RAW_TOKEN_RE.test(trimmed)) {
    return { type: "unknown", token: trimmed };
  }

  throw new CliError(
    "INVALID_ARGS",
    `无法识别的输入: ${trimmed}。请输入飞书 URL 或文档 token`,
    { recovery: "请提供飞书文档 URL 或至少 20 位的文档 token" },
  );
}
