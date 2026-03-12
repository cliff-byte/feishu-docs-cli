/**
 * CLI entry point: declarative command registration + routing.
 * Supports both top-level commands and subcommands (e.g., share list).
 */

import { parseArgs } from "node:util";
import { loginMeta, logoutMeta, whoamiMeta } from "./commands/login.js";
import { meta as readMeta } from "./commands/read.js";
import { meta as spaceMeta } from "./commands/spaces.js";
import { meta as treeMeta } from "./commands/tree.js";
import { meta as catMeta } from "./commands/cat.js";
import { meta as searchMeta } from "./commands/search.js";
import { meta as createMeta } from "./commands/create.js";
import { meta as updateMeta } from "./commands/update.js";
import { meta as deleteMeta } from "./commands/delete.js";
import { meta as shareMeta } from "./commands/share.js";
import { meta as infoMeta } from "./commands/info.js";
import { meta as lsMeta } from "./commands/ls.js";
import { meta as wikiMeta } from "./commands/wiki.js";
import { handleError, CliError } from "./utils/errors.js";

const HELP_TEXT = `feishu-docs - AI Agent 飞书云文档 CLI 工具

用法: feishu-docs <command> [options]

认证:
  login [--scope "..."] [--redirect-uri <url>] [--port <port>]
                                           OAuth 登录获取 user_access_token
  logout                                   清除已保存的凭证
  whoami                                   查看当前认证身份和模式

文档:
  read   <url|token>                       读取文档，输出 Markdown
  create <title> [options]                 创建文档
  update <url|token> [options]             更新文档内容
  delete <url|token>                       删除文档
  info   <url|token>                       查看文档元信息

知识库:
  spaces                                   列出所有知识库
  tree   <space_id|url> [--node <token>]   展示知识库节点树
  cat    <space_id|url> [--node <token>]   递归读取节点下所有文档
  wiki create-space <name>                 创建知识库
  wiki add-member <space_id> <member>      添加知识库成员
  wiki remove-member <space_id> <member>   移除知识库成员
  wiki rename <url> --title <new_title>    重命名节点
  wiki move <url> --to <space_id>          移动节点
  wiki copy <url> --to <space_id>          复制节点

搜索:
  search <query> [options]                 搜索文档

云空间:
  ls     [folder_token]                    列出文件夹内容

权限:
  share list <url>                         查看协作者
  share add <url> <member> --role <role>   添加协作者
  share set <url> --public <mode>          修改分享设置

全局选项:
  --auth <user|tenant|auto>   认证模式（默认 auto）
  --json                      输出 JSON 格式
  --lark                      使用海外 Lark 域名
  --help                      显示帮助信息
`;

const GLOBAL_OPTIONS = {
  auth: { type: "string", default: "auto" },
  json: { type: "boolean", default: false },
  lark: { type: "boolean", default: false },
  help: { type: "boolean", default: false },
};

/**
 * Command registry: name → meta definition.
 * Each meta has: { handler, options, positionals } or { subcommands }.
 */
const COMMANDS = {
  login: loginMeta,
  logout: logoutMeta,
  whoami: whoamiMeta,
  read: readMeta,
  spaces: spaceMeta,
  tree: treeMeta,
  cat: catMeta,
  search: searchMeta,
  create: createMeta,
  update: updateMeta,
  delete: deleteMeta,
  share: shareMeta,
  info: infoMeta,
  ls: lsMeta,
  wiki: wikiMeta,
};

function extractGlobalOpts(values) {
  return {
    auth: values.auth,
    json: values.json,
    lark: values.lark,
  };
}

/**
 * Remap hyphenated option keys to camelCase for args.
 */
function remapArgs(values, optionDefs) {
  const args = {};
  for (const key of Object.keys(optionDefs)) {
    const camel = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (values[key] !== undefined) {
      args[camel] = values[key];
    }
  }
  return args;
}

/**
 * Parse and dispatch a command.
 */
function parseAndRun(def, argv) {
  const allOptions = { ...GLOBAL_OPTIONS, ...def.options };
  const { values, positionals } = parseArgs({
    args: argv,
    options: allOptions,
    allowPositionals: def.positionals ?? false,
    strict: false,
  });

  const globalOpts = extractGlobalOpts(values);
  const args = remapArgs(values, def.options);
  if (def.positionals) {
    args.positionals = positionals;
  }

  return { handler: def.handler, args, globalOpts };
}

export async function run(argv) {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(HELP_TEXT);
    return;
  }

  const command = argv[0];
  const restArgs = argv.slice(1);

  const def = COMMANDS[command];
  if (!def) {
    throw new CliError(
      "INVALID_ARGS",
      `未知命令: ${command}。运行 feishu-docs --help 查看可用命令`,
    );
  }

  let handler, args, globalOpts;

  if (def.subcommands) {
    const subName = restArgs[0];
    if (
      !subName ||
      subName === "--help" ||
      subName === "-h" ||
      !def.subcommands[subName]
    ) {
      const available = Object.keys(def.subcommands).join(", ");
      throw new CliError(
        "INVALID_ARGS",
        `用法: feishu-docs ${command} <${available}> [options]`,
      );
    }
    const subDef = def.subcommands[subName];
    const subArgs = restArgs.slice(1);
    ({ handler, args, globalOpts } = parseAndRun(subDef, subArgs));
  } else {
    ({ handler, args, globalOpts } = parseAndRun(def, restArgs));
  }

  try {
    await handler(args, globalOpts);
  } catch (err) {
    handleError(err, globalOpts.json);
  }
}
