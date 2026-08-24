---
name: feishu-docs
description: Feishu/Lark cloud documents (飞书云文档), knowledge bases, and Bitable records via the feishu-docs CLI. Use as the primary interface for every document, wiki, or Bitable read task involving a supported URL (*.feishu.cn, *.larksuite.com, or *.larkoffice.com with /wiki/, /docx/, /doc/, /sheets/, /base/, or /record/) or a raw document token—even when the user only pastes the link or asks to open, read, inspect, summarize, translate, extract, or edit it. Also use for creating, updating, appending, deleting, searching, sharing, moving, copying, organizing, or browsing Feishu/Lark documents, folders, and wiki spaces, and whenever feishu-docs or feishu-docs-cli is mentioned.
---

# Feishu Docs CLI

`feishu-docs` is a CLI tool that lets you read and write Feishu (Lark) cloud documents directly from the terminal. All output goes to stdout as plain text or JSON — designed for agent consumption.

> **This skill is just instructions — every operation it describes runs through the separate `feishu-docs` CLI binary.** If you installed this skill on its own (e.g. from skills.sh), the CLI is almost certainly NOT on this machine yet. Nothing below will work until it is installed.

## Prerequisites

### Step 0: Ensure the CLI is installed (DO THIS FIRST — BLOCKING)

**Before running any `feishu-docs` command — the very first action when this skill is invoked — verify the CLI exists.** Do not skip this and do not assume it is present.

```bash
command -v feishu-docs >/dev/null 2>&1 && feishu-docs --version || echo "NOT_INSTALLED"
```

- If it prints a version number → installed, continue to Step 1.
- If it prints `NOT_INSTALLED` → install it now, before doing anything else.

**To install:** the CLI is an npm package and needs Node.js ≥ 18. Check the toolchain first:

```bash
command -v npm >/dev/null 2>&1 && node --version || echo "NODE_MISSING"
```

- If this prints `NODE_MISSING` (or a Node version below 18): Node.js is not available. You cannot install the CLI without it — ask the user to install Node.js ≥ 18 (e.g. via [nvm](https://github.com/nvm-sh/nvm), Homebrew, or nodejs.org), then re-run the check above. Do not attempt a system-level Node install on the user's behalf.
- Otherwise, install the CLI globally:

```bash
npm install -g feishu-docs-cli
```

If this fails with a permissions/`EACCES` error, the global npm prefix is not user-writable. Do **not** silently run `sudo`. Tell the user to either use a Node version manager (nvm/fnm, which makes `-g` user-writable) or run the install themselves with elevated permissions. After a successful install, confirm with:

```bash
feishu-docs --version
```

Only proceed to Step 1 once `feishu-docs --version` prints a version.

### Step 1: Check authentication

```bash
feishu-docs whoami
```

If this fails with an auth error:
- Ensure `FEISHU_APP_ID` and `FEISHU_APP_SECRET` environment variables are set
- For user-level features (search, personal docs), the user needs to run `feishu-docs login` interactively in their terminal — you cannot do this for them
- Tenant (app) mode works without login but only accesses docs the app has been granted permission to

## Reading Documents

Read a document by URL or token. Output is Markdown by default.

```bash
feishu-docs read <url|token>
feishu-docs read <url> --blocks        # Lossless Block JSON
feishu-docs read <url> --raw           # Plain text
feishu-docs read <url> --with-meta     # Prepend front-matter: title/URL/revision + creator, create/edit time, owner
feishu-docs read <bitable-url> --json  # Complete table/view records with raw field values
feishu-docs read <record-url> --json   # Resolve a record-share URL and read one record
```

Accepts full Feishu/Lark URLs or raw tokens (e.g., `wikcnXXX`, `doxcnXXX`). The URL format is automatically detected — wiki pages, docx, sheets, bitable table/view links, and `/record/` share links all work.

Document reads use Feishu's server-rendered Lark-flavored Markdown. Task tags are enriched through Task v2; in interactive mode, missing `task:task:read` authorization opens automatically. If authorization is denied, fails, or the command is non-interactive, the original task tags are kept and reading continues. When docx fidelity matters, use `--blocks` to get the raw Block JSON.

Standalone bitable reads use the Bitable API, not `docs_ai`. A table/view URL renders all matching records as a Markdown table; a record-share URL renders one record as a field/value table. Prefer `--json` for agent use because it preserves raw arrays and objects. `--raw`, `--blocks`, and `--with-meta` do not apply to standalone bitable reads.

## Browsing Knowledge Bases

Discover what's available before reading:

```bash
feishu-docs spaces                         # List all accessible wiki spaces
feishu-docs tree <space_id> --depth 3      # Show document tree structure
feishu-docs tree <space_id> --names        # Resolve creator/owner open-ids to display names
feishu-docs tree <space_id> --json         # Per-node metadata (creator, create/edit time, owner)
feishu-docs cat <space_id> --max-docs 20   # Read all docs recursively
feishu-docs cat <space_id> --title-only    # Just list titles
feishu-docs cat <space_id> --node <token>  # Start from a specific node
```

`spaces` returns space IDs and names. Use a space_id with `tree` to understand the structure, then `read` individual documents or `cat` to batch-read.

## Searching

```bash
feishu-docs search "keyword" --type docx --limit 10
```

Search requires a user access token (`feishu-docs login`). It will not work with tenant-only auth.

## Creating Documents

```bash
# Create in a wiki space
feishu-docs create "Title" --wiki <space_id> --body ./content.md

# Create in a cloud folder
feishu-docs create "Title" --folder <folder_token> --body ./content.md

# Create empty document (returns URL)
feishu-docs create "Title"

# Pipe content from stdin
echo "# Hello" | feishu-docs create "Title" --wiki <space_id> --body -
```

The `--body` flag accepts a file path or `-` for stdin. Content is Markdown — the API converts it to Feishu blocks server-side.

Markdown tables are written with their first row set as a header row (the "设置为标题行" style in the Feishu UI) by default, since a Markdown table's first row is its header. Pass `--no-table-header` to write plain tables with no header row instead.

Column widths are also auto-fit to each column's content by default (like the "列宽自适应" UI action): short columns (e.g. an id column) stay narrow, text-heavy columns get more room, a single very-long column is capped so it can't dominate, content-heavy tables are scaled to fill the page width, and small tables stay compact instead of being stretched. Pass `--no-table-column-width` to keep the API's even split. The fit targets the docx **default page width** (~815px); for the "较宽/全宽" page-width modes pass `--table-width <px>` (200–2000) to set the total. Note this is a one-time pixel estimate at write time (not exact, and absolute pixels don't track window resizes), matching how the UI action behaves.

All three table options (`--no-table-header`, `--no-table-column-width`, `--table-width`) apply to `create` and `update` (overwrite and `--append`).

Local images referenced in the markdown are uploaded to Feishu and embedded automatically — both relative paths (`![alt](./images/demo.png)`) and `file://` URIs work, alongside remote `http(s)` image URLs. Only standalone block-level images whose path lives inside the markdown file's directory tree are uploaded (see Limitations). When piping via stdin (`--body -`), relative image paths resolve against the current working directory.

When creating under a wiki node, use `--wiki <space_id> --parent <node_token>` to place it under a specific parent.

## Updating Documents

```bash
# Overwrite entire document (auto-backs up first)
feishu-docs update <url> --body ./updated.md

# Append to end of document
feishu-docs update <url> --body ./extra.md --append

# Pipe from stdin
echo "## New Section" | feishu-docs update <url> --body - --append
```

Both overwrite and `--append` modes upload local markdown images the same way `create` does (see the Creating Documents note and Limitations).

Overwrite mode automatically backs up the current document to `~/.feishu-docs/backups/` before writing. If the write fails, it auto-recovers from the backup. Backups are kept for undo; old backups are rotated automatically (max 10 per document).

To restore a previous version:
```bash
feishu-docs update <url> --restore ~/.feishu-docs/backups/<backup-file>.json
```

## Deleting Documents

```bash
feishu-docs delete <url> --confirm
```

Moves to recycle bin (recoverable for 30 days). The `--confirm` flag is required.

## Document Info

```bash
feishu-docs info <url|token>          # Human-readable metadata
feishu-docs info <url> --json         # Structured JSON output
```

Returns title, document type, URL, creator, owner, creation time, last-edit time, and revision number. Creator/owner open-ids are resolved to display names where the app's contact permission allows (the open-id is always kept too). For standalone (non-wiki) docs, owner and timestamps come from the Drive API — if that scope is not granted the command still succeeds and prints an `authorize` hint instead of failing.

## Listing Cloud Files

```bash
feishu-docs ls                             # Root folder
feishu-docs ls <folder_token>              # Specific folder
feishu-docs ls --type docx --limit 20      # Filter by type
```

## File Operations

```bash
feishu-docs mv <url|token> <target_folder_token>       # Move file
feishu-docs cp <url|token> <target_folder_token>       # Copy file (auto-named)
feishu-docs cp <url|token> <target_folder> --name "My Copy"
feishu-docs mkdir "Folder Name" --parent <folder_token> # Create folder
```

`mv` is asynchronous — it polls the task until complete (max 30s). `cp` without `--name` automatically appends " - 副本" to the original title.

## Sharing & Permissions

```bash
feishu-docs share list <url>                          # View collaborators
feishu-docs share add <url> user@example.com --role view
feishu-docs share add <url> ou_xxx --role edit
feishu-docs share remove <url> user@example.com       # Remove collaborator
feishu-docs share update <url> ou_xxx --role manage    # Change role
feishu-docs share set <url> --public tenant            # Org-wide readable
feishu-docs share set <url> --public tenant:edit        # Org-wide editable
feishu-docs share set <url> --public open               # Internet-accessible
feishu-docs share set <url> --public closed             # Disable link sharing
```

Roles: `view`, `edit`, `manage`. Member types (email, openid, unionid, userid) are auto-detected.

## Wiki Management

```bash
feishu-docs wiki create-space <name>
feishu-docs wiki add-member <space_id> <member>
feishu-docs wiki remove-member <space_id> <member>
feishu-docs wiki rename <url> --title <new_title>
feishu-docs wiki move <url> --to <space_id>
feishu-docs wiki copy <url> --to <space_id>
```

## Global Options

Every command accepts these flags:

| Flag | Effect |
|------|--------|
| `--auth user` | Force user token (personal docs, search) |
| `--auth tenant` | Force app token (CI/CD, shared docs) |
| `--json` | Output structured JSON instead of text |
| `--lark` | Use Lark (international) domain |
| `-v, --version` | Show version number |

Default auth mode is `auto` — tries user token first, falls back to tenant.

## Common Workflows

**Research a wiki space**: `spaces` → pick a space_id → `tree <space_id>` → `read` specific docs

**Write a report to wiki**: Write markdown locally → `create "Title" --wiki <space_id> --body ./report.md`

**Update existing doc**: `read <url>` to see current content → edit locally → `update <url> --body ./updated.md`

**Batch extract**: `cat <space_id> --max-docs 50` to dump all docs as markdown for analysis

**Organize files**: `mkdir "Reports" --parent <folder>` → `mv <doc> <new_folder>` to organize documents into folders

## Limitations

- `docx` is fully supported for read/write; standalone bitable table/view and record-share URLs are read-only
- Legacy `doc` format is not supported
- Embedded `sheet` and `bitable` are rendered as tables (lossy)
- Embedded `board`/`whiteboard` are exported as local PNG images
- `mindnote` renders as a link only
- On read, `docs_ai` returns Feishu-hosted image references; if it is unavailable, the fallback renderer downloads images to `~/.feishu-docs/images/` with a 30-day cache. On write, local markdown images are uploaded to Feishu and embedded — but only standalone block-level images (e.g. `![alt](./images/demo.png)`) with relative paths or `file://` URIs, where the path is inside the markdown file's directory tree, and each file is under 20MB. Inline images, images inside lists/tables, and paths outside that directory tree are skipped (remote `http(s)` image URLs always work).
- Mermaid code blocks are preserved as-is (code block, not visual diagram) — the Open API does not support creating visual "text diagram" blocks
- `docs_ai` returns Lark-flavored Markdown and may preserve special blocks as XML-like tags — use `--blocks` for lossless JSON when precision matters
- Standalone bitable views apply record filtering and sorting but still output the table's complete field schema
- Search requires user-level auth (run `feishu-docs login` first)
