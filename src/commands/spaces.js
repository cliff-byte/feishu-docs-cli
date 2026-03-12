/**
 * spaces command: List all knowledge bases.
 */

import { createClient, fetchWithAuth } from "../client.js";

export const meta = {
  options: {},
  positionals: false,
  handler: spaces,
};

export async function spaces(_args, globalOpts) {
  const { authInfo } = await createClient(globalOpts);

  const allSpaces = [];
  let pageToken;

  do {
    const params = { page_size: 50 };
    if (pageToken) params.page_token = pageToken;

    const res = await fetchWithAuth(authInfo, "/open-apis/wiki/v2/spaces", {
      params,
    });

    if (res?.data?.items) {
      allSpaces.push(...res.data.items);
    }
    pageToken = res?.data?.has_more ? res.data.page_token : undefined;
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

  for (const space of allSpaces) {
    const name = space.name || "(未命名)";
    const desc = space.description ? ` — ${space.description}` : "";
    process.stdout.write(`${space.space_id}  ${name}${desc}\n`);
  }
}
