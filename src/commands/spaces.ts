/**
 * spaces command: List all knowledge bases.
 */

import { createClient, fetchWithAuth } from "../client.js";
import { CommandMeta, CommandArgs, GlobalOpts } from "../types/index.js";

export const meta: CommandMeta = {
  options: {},
  positionals: false,
  handler: spaces,
};

export async function spaces(
  _args: CommandArgs,
  globalOpts: GlobalOpts,
): Promise<void> {
  const { authInfo } = await createClient(globalOpts);

  const allSpaces: unknown[] = [];
  let pageToken: string | undefined;

  do {
    const params: Record<string, string | number | undefined> = {
      page_size: 50,
    };
    if (pageToken) params.page_token = pageToken;

    const res = await fetchWithAuth(authInfo, "/open-apis/wiki/v2/spaces", {
      params,
    });

    const data = res?.data as Record<string, unknown> | undefined;
    if (data?.items) {
      allSpaces.push(...(data.items as unknown[]));
    }
    pageToken = data?.has_more ? (data.page_token as string) : undefined;
  } while (pageToken);

  if (globalOpts.json) {
    process.stdout.write(
      JSON.stringify({ success: true, spaces: allSpaces }, null, 2) + "\n",
    );
    return;
  }

  if (allSpaces.length === 0) {
    process.stdout.write("没有找到知识库\n");
    return;
  }

  for (const space of allSpaces as Array<Record<string, string>>) {
    const name = space.name || "(未命名)";
    const desc = space.description ? ` — ${space.description}` : "";
    process.stdout.write(`${space.space_id}  ${name}${desc}\n`);
  }
}
