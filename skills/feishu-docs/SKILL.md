---
name: feishu-docs
description: Read, write, search, and manage Feishu (Lark) cloud documents and knowledge bases via the feishu-docs CLI. Use this skill whenever the user mentions Feishu docs, Lark docs, knowledge bases (wiki spaces), or wants to interact with Feishu cloud documents in any way — reading, creating, updating, deleting, searching, sharing, or browsing wiki structure. Also trigger when the user pastes a Feishu or Lark URL, or mentions feishu-docs-cli. This skill covers both Chinese (飞书) and international (Lark) platforms.
---

# Feishu Docs CLI

`feishu-docs` is a CLI tool that lets you read and write Feishu (Lark) cloud documents directly from the terminal. All output goes to stdout as plain text or JSON — designed for agent consumption.

## Prerequisites

Before using any command, check that the CLI is installed and authenticated. Run these two checks in order:

### Step 1: Check installation

```bash
command -v feishu-docs >/dev/null 2>&1 && feishu-docs --version || echo "NOT_INSTALLED"
```

If the output is `NOT_INSTALLED`, install the CLI first:

```bash
npm install -g feishu-docs-cli
```

This installs the `feishu-docs` command globally. Requires Node.js 18+. After installation, verify with `feishu-docs --version`.

### Step 2: Check authentication

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
feishu-docs read <url> --with-meta     # Prepend title/URL/revision metadata
```

Accepts full Feishu/Lark URLs or raw tokens (e.g., `wikcnXXX`, `doxcnXXX`). The URL format is automatically detected — wiki pages, docx, sheets, and bitable links all work.

Markdown conversion is lossy (colors, merged cells, complex layouts are dropped). When fidelity matters, use `--blocks` to get the raw Block JSON.

## Browsing Knowledge Bases

Discover what's available before reading:

```bash
feishu-docs spaces                         # List all accessible wiki spaces
feishu-docs tree <space_id> --depth 3      # Show document tree structure
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

Returns title, document type, URL, owner, creation time, and revision number.

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

- Only `docx` (new document format) is fully supported for read/write
- Legacy `doc` format is not supported
- Embedded `sheet` and `bitable` are rendered as tables (lossy)
- Embedded `board`/`whiteboard` are exported as local PNG images (temporary file paths)
- `mindnote` renders as a link only
- Images cannot be written; read returns temporary URLs valid ~24 hours
- Markdown conversion is lossy — use `--blocks` for lossless JSON when precision matters
- Search requires user-level auth (run `feishu-docs login` first)
