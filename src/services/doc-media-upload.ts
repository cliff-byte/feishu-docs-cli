import { basename } from "node:path";
import { readFile, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fetchFormDataWithAuth, fetchWithAuth } from "../client.js";
import { AuthInfo } from "../types/index.js";
import { CliError } from "../utils/errors.js";

export async function uploadDocumentImage(
  authInfo: AuthInfo,
  parentNode: string,
  filePath: string,
): Promise<string> {
  const [fileStat, fileBuffer] = await Promise.all([
    stat(filePath),
    readFile(filePath),
  ]);

  if (fileStat.size > 20 * 1024 * 1024) {
    throw new CliError("INVALID_ARGS", `图片文件超过 20MB 限制: ${filePath}`, {
      recovery: "请压缩图片，或后续改用分片上传接口",
    });
  }

  const form = new FormData();
  form.set("file_name", basename(filePath));
  form.set("parent_type", "docx_image");
  form.set("parent_node", parentNode);
  form.set("size", String(fileStat.size));
  form.set("file", new Blob([fileBuffer]), basename(filePath));

  const res = await fetchFormDataWithAuth<{ file_token?: string }>(
    authInfo,
    "/open-apis/drive/v1/medias/upload_all",
    {
      method: "POST",
      form,
    },
  );

  const fileToken = res?.data?.file_token;
  if (!fileToken) {
    throw new CliError("API_ERROR", `上传图片成功但未返回 file_token: ${filePath}`);
  }

  return fileToken;
}

export async function replaceDocumentImages(
  authInfo: AuthInfo,
  documentId: string,
  replacements: Array<{
    blockId: string;
    fileToken: string;
  }>,
  revisionId: number,
): Promise<number> {
  if (replacements.length === 0) {
    return revisionId;
  }

  let rev = revisionId;
  for (let index = 0; index < replacements.length; index += 200) {
    const chunk = replacements.slice(index, index + 200);
    const res = await fetchWithAuth(
      authInfo,
      `/open-apis/docx/v1/documents/${encodeURIComponent(documentId)}/blocks/batch_update`,
      {
        method: "PATCH",
        params: {
          document_revision_id: rev,
          client_token: randomUUID(),
        },
        body: {
          requests: chunk.map((item) => ({
            block_id: item.blockId,
            replace_image: {
              token: item.fileToken,
            },
          })),
        },
      },
    );

    rev =
      ((res?.data as Record<string, unknown>)
        ?.document_revision_id as number) ?? rev;
  }

  return rev;
}
