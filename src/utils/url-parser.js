/**
 * Parse Feishu/Lark URL or raw token into { type, token }.
 */

const FEISHU_DOMAINS = /(?:^|\.)(feishu\.cn|larksuite\.com|larkoffice\.com)$/;

const PATH_PATTERNS = [
  { pattern: /^\/wiki\/([A-Za-z0-9]+)/, type: "wiki" },
  { pattern: /^\/docx\/([A-Za-z0-9]+)/, type: "docx" },
  { pattern: /^\/doc\/([A-Za-z0-9]+)/, type: "doc" },
  { pattern: /^\/sheets\/([A-Za-z0-9]+)/, type: "sheet" },
  { pattern: /^\/base\/([A-Za-z0-9]+)/, type: "bitable" },
];

const RAW_TOKEN_RE = /^[A-Za-z][A-Za-z0-9]{19,}$/;

export function parseDocUrl(input) {
  if (!input) {
    throw new Error("缺少文档 URL 或 token");
  }

  const trimmed = input.trim();

  // Try as URL
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    let url;
    try {
      url = new URL(trimmed);
    } catch {
      throw new Error(`无效的 URL: ${trimmed}`);
    }

    if (!FEISHU_DOMAINS.test(url.hostname)) {
      throw new Error("不支持的域名，请使用飞书/Lark URL");
    }

    for (const { pattern, type } of PATH_PATTERNS) {
      const match = url.pathname.match(pattern);
      if (match) {
        const token = match[1];
        if (!token) {
          throw new Error("URL 中缺少文档 token");
        }
        return { type, token };
      }
    }

    throw new Error(`无法识别的 URL 路径: ${url.pathname}`);
  }

  // Try as raw token
  if (RAW_TOKEN_RE.test(trimmed)) {
    return { type: "unknown", token: trimmed };
  }

  throw new Error(`无法识别的输入: ${trimmed}。请输入飞书 URL 或文档 token`);
}
