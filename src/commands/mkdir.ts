/**
 * mkdir command: Create a folder in cloud drive.
 */

import { createClient, fetchWithAuth } from "../client.js";
import { CliError } from "../utils/errors.js";
import { withScopeRecovery } from "../utils/scope-prompt.js";
import { validateToken } from "../utils/validate.js";
import { CommandMeta, CommandArgs, GlobalOpts } from "../types/index.js";

export const meta: CommandMeta = {
  options: {
    parent: { type: "string" },
  },
  positionals: true,
  handler: mkdir,
};

export async function mkdir(
  args: CommandArgs,
  globalOpts: GlobalOpts,
): Promise<void> {
  const name = args.positionals![0];
  if (!name) {
    throw new CliError(
      "INVALID_ARGS",
      "用法: feishu-docs mkdir <name> [--parent <folder_token>]",
    );
  }

  const parentToken = args.parent as string | undefined;
  if (parentToken) {
    validateToken(parentToken, "parent_folder_token");
  }

  return withScopeRecovery(async () => {
    const { authInfo } = await createClient(globalOpts);

    const res = await fetchWithAuth(
      authInfo,
      "/open-apis/drive/v1/files/create_folder",
      {
        method: "POST",
        body: {
          name,
          folder_token: parentToken || "",
        },
      },
    );

    const resData = res?.data as Record<string, unknown> | undefined;
    const token = (resData?.token as string) || "";
    const url = (resData?.url as string) || "";

    if (globalOpts.json) {
      process.stdout.write(
        JSON.stringify({
          success: true,
          token,
          name,
          url,
        }) + "\n",
      );
    } else {
      process.stdout.write(`已创建文件夹 "${name}" (${token})\n`);
    }
  }, globalOpts);
}
