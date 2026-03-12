/**
 * info command: Display document metadata.
 */

import { createClient } from "../client.js";
import { CliError } from "../utils/errors.js";
import { resolveDocument } from "../utils/document-resolver.js";
import { getDocumentInfo } from "../services/block-writer.js";

export const meta = {
  options: {},
  positionals: true,
  handler: info,
};

export async function info(args, globalOpts) {
  const input = args.positionals[0];
  if (!input) {
    throw new CliError(
      "INVALID_ARGS",
      "缺少文档 URL 或 token。用法: feishu-docs info <url|token>",
    );
  }

  const { client, authInfo } = await createClient(globalOpts);
  const doc = await resolveDocument(client, authInfo, input);

  if (doc.objType === "doc") {
    throw new CliError(
      "NOT_SUPPORTED",
      "旧版 doc 类型不支持此操作，请在飞书客户端中将文档升级为 docx 格式",
    );
  }

  // Fetch additional document info for docx type
  let revisionId;
  let docTitle = doc.title;
  if (doc.objType === "docx") {
    try {
      const docInfo = await getDocumentInfo(client, authInfo, doc.objToken);
      docTitle = docTitle || docInfo.title;
      revisionId = docInfo.revisionId;
    } catch (err) {
      process.stderr.write(
        `feishu-docs: warning: 获取文档详情失败: ${err.message}\n`,
      );
    }
  }

  const domain = globalOpts.lark ? "larksuite.com" : "feishu.cn";
  const url = doc.spaceId
    ? `https://${domain}/wiki/${doc.parsed.token}`
    : `https://${domain}/${doc.objType}/${doc.objToken}`;

  const output = {
    title: docTitle,
    type: doc.objType,
    token: doc.objToken,
    url,
    ...(doc.nodeToken && { node_token: doc.nodeToken }),
    ...(doc.spaceId && { space_id: doc.spaceId }),
    ...(revisionId !== undefined && { revision: revisionId }),
  };

  if (globalOpts.json) {
    process.stdout.write(
      JSON.stringify({ success: true, ...output }, null, 2) + "\n",
    );
  } else {
    if (docTitle) process.stdout.write(`标题: ${docTitle}\n`);
    process.stdout.write(`类型: ${doc.objType}\n`);
    process.stdout.write(`URL:  ${url}\n`);
    process.stdout.write(`token: ${doc.objToken}\n`);
    if (doc.spaceId) {
      process.stdout.write(`知识库: ${doc.spaceId}\n`);
    }
    if (doc.nodeToken) {
      process.stdout.write(`node_token: ${doc.nodeToken}\n`);
    }
    if (revisionId !== undefined) {
      process.stdout.write(`版本: ${revisionId}\n`);
    }
  }
}
