---
quick_id: 260623-jv6
slug: skill-md-postinstall
date: 2026-06-23
status: complete
---

# Quick Task 260623-jv6 — Summary

## 完成内容
让 feishu-docs-cli 在「安装/升级」与「日常运行」两个时机，自动把包内最新的
`skills/feishu-docs/SKILL.md` 同步到 Claude 运行时 skill 目录。

## 改动文件
- **新增 `src/utils/skill-sync.ts`** — 共享同步工具 `syncSkill(options?)`。零依赖、永不抛出，
  返回 `{ synced, unchanged, absent, failed }` 分项结果。目标：
  - `~/.claude/skills/feishu-docs/SKILL.md`（canonical，`force` 模式下按需创建）
  - `~/.agents/skills/feishu-docs/SKILL.md`（opportunistic，仅当其父级 skills 目录已存在）
  - 自动模式只在父级 skills 目录存在时写入；内容相同则跳过；`FEISHU_DOCS_NO_SKILL_SYNC=1` 时 no-op。
- **新增 `scripts/postinstall.mjs`** — npm postinstall 瘦启动器，动态 import `dist/utils/skill-sync.js`，
  dist 未构建（dev）或任何失败都 catch、始终 exit 0，绝不阻塞 `npm install`。
- **`package.json`** — 加 `scripts.postinstall`；`files` 增加 `"scripts/"`（发布该启动器）。
- **`src/cli.ts`** — 仿 `checkForUpdates()`，在 `run()` 顶部启动后台 `syncSkill()`，在 finally 与
  早返回路径 await，非阻塞。
- **重写 `src/commands/install-skill.ts`** — 复用 `syncSkill({ force: true })`，目标统一到两个
  skill 目录（不再写旧的 `~/.claude/commands/`）。命令名/参数不变。
- **新增 `test/skill-sync.test.ts`**（7 例）+ **改写 `test/install-skill.test.ts`**（2 例）匹配新行为。

## 验证
- `npm run build`：成功。
- `npm test`：**497 passed / 0 failed**（clean HOME 隔离）。
- `knip`：exit 0（新导出均被引用；2 个 unused 报告为既有、与本次无关）。
- 手动隔离 HOME 跑 `postinstall.mjs`：`.claude/skills` 存在→同步 SKILL.md；`.agents` 不存在→不创建；
  dist 缺失→exit 0 不报错。

## 设计取舍（用户已拍板）
- 需求2「运行时检查云端」采用**跟随本地包的兜底同步**（不联网）。真正的版本升级仍由现有
  `checkForUpdates()` npm 提示 + postinstall 负责。
- 同步目标统一为两个 skill 目录，弃用旧的 commands 目录。

## 后续（非本任务范围）
- 本次仅改代码，未发布 npm。要让终端用户经 `npm i -g` 拿到该机制，需 bump 版本 + `npm publish`。
