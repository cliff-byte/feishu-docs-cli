/**
 * create command: Create new documents in wiki or drive.
 */

import { createClient, fetchWithAuth } from "../client.js";
import { CliError } from "../utils/errors.js";
import { convertAndWrite } from "../services/markdown-convert.js";
import { readBody, getDocumentInfo } from "../services/block-writer.js";
import { validateToken } from "../utils/validate.js";

export const meta = {
  options: {
    wiki: { type: "string" },
    folder: { type: "string" },
    parent: { type: "string" },
    body: { type: "string" },
  },
  positionals: true,
  handler: create,
};

export async function create(args, globalOpts) {
  const title = args.positionals[0];
  if (!title) {
    throw new CliError(
      "INVALID_ARGS",
      "缺少文档标题。用法: feishu-docs create <title> [--wiki <space_id>] [--body <file>]",
    );
  }

  const { client, authInfo } = await createClient(globalOpts);

  let bodyContent;
  if (args.body) {
    bodyContent = await readBody(args.body);
    if (!bodyContent.trim()) {
      throw new CliError("INVALID_ARGS", "文档内容为空，至少需要一行内容");
    }
  }

  if (args.wiki) {
    validateToken(args.wiki, "space_id");
    if (args.parent) validateToken(args.parent, "parent_node_token");
    return createInWiki(
      client,
      authInfo,
      title,
      args.wiki,
      args.parent,
      bodyContent,
      globalOpts,
    );
  }

  if (args.folder) {
    validateToken(args.folder, "folder_token");
  }

  return createDoc(
    client,
    authInfo,
    title,
    args.folder,
    bodyContent,
    globalOpts,
  );
}

async function createInWiki(
  client,
  authInfo,
  title,
  spaceId,
  parentNodeToken,
  bodyContent,
  globalOpts,
) {
  const nodeRes = await fetchWithAuth(
    authInfo,
    `/open-apis/wiki/v2/spaces/${encodeURIComponent(spaceId)}/nodes`,
    {
      method: "POST",
      body: {
        obj_type: "docx",
        node_type: "origin",
        title,
        ...(parentNodeToken && { parent_node_token: parentNodeToken }),
      },
    },
  );

  const node = nodeRes?.data?.node || {};
  const objToken = node.obj_token;
  const nodeToken = node.node_token;

  if (!objToken) {
    throw new CliError("API_ERROR", "创建知识库节点成功但未返回 obj_token");
  }

  if (bodyContent) {
    const docInfo = await getDocumentInfo(client, authInfo, objToken);
    await convertAndWrite(authInfo, objToken, bodyContent, docInfo.revisionId);
  }

  const domain = globalOpts.lark ? "larksuite.com" : "feishu.cn";
  const wikiUrl = `https://${domain}/wiki/${nodeToken}`;
  const docUrl = `https://${domain}/docx/${objToken}`;

  const output = {
    document_id: objToken,
    ...(nodeToken && { node_token: nodeToken }),
    space_id: spaceId,
    title,
    wiki_url: wikiUrl,
    doc_url: docUrl,
  };

  if (globalOpts.json) {
    process.stdout.write(
      JSON.stringify({ success: true, ...output }, null, 2) + "\n",
    );
  } else {
    process.stdout.write(`文档已创建\n`);
    process.stdout.write(`  标题: ${title}\n`);
    process.stdout.write(`  document_id: ${objToken}\n`);
    if (nodeToken) {
      process.stdout.write(`  node_token: ${nodeToken}\n`);
    }
    process.stdout.write(`  URL: ${wikiUrl}\n`);
  }
}

async function createDoc(
  client,
  authInfo,
  title,
  folderToken,
  bodyContent,
  globalOpts,
) {
  const body = {
    title,
    ...(folderToken && { folder_token: folderToken }),
  };

  const res = await fetchWithAuth(authInfo, `/open-apis/docx/v1/documents`, {
    method: "POST",
    body,
  });

  const doc = res?.data?.document || {};
  const documentId = doc.document_id;

  if (!documentId) {
    throw new CliError("API_ERROR", "创建文档成功但未返回 document_id");
  }

  if (bodyContent) {
    const docInfo = await getDocumentInfo(client, authInfo, documentId);
    await convertAndWrite(
      authInfo,
      documentId,
      bodyContent,
      docInfo.revisionId,
    );
  }

  const domain = globalOpts.lark ? "larksuite.com" : "feishu.cn";
  const url = `https://${domain}/docx/${documentId}`;

  const output = { document_id: documentId, title: doc.title, url };

  if (globalOpts.json) {
    process.stdout.write(
      JSON.stringify({ success: true, ...output }, null, 2) + "\n",
    );
  } else {
    process.stdout.write(`文档已创建\n`);
    process.stdout.write(`  标题: ${doc.title}\n`);
    process.stdout.write(`  document_id: ${documentId}\n`);
    process.stdout.write(`  URL: ${url}\n`);
  }
}
