# feishu-docs-cli

CLI tool for AI Agents to read/write Feishu (Lark) docs via shell commands.

让 AI Agent（Claude Code、Codex、Trae 等）通过 shell 命令读写飞书云文档和知识库。

## Features

- **Read** documents as Markdown, raw text, or original Block JSON
- **Create** documents in knowledge bases or cloud folders
- **Update** documents with overwrite or append mode
- **Delete** documents (move to recycle bin)
- **Info** — view document metadata (title, type, URL, revision)
- **Browse** knowledge base structure (spaces, tree, cat)
- **Search** documents by keyword
- **Share** — manage collaborators (list, add, set public mode)
- **List** files in cloud folders
- Zero extra dependencies — only `@larksuiteoapi/node-sdk`
- Agent-friendly output — pure text or JSON, no interactive UI

## Install

```bash
npm install -g github:cliff-byte/feishu-docs-cli
```

Or use directly with npx:

```bash
npx github:cliff-byte/feishu-docs-cli read <url>
```

Requires Node.js >= 18.3.

## Setup

### 1. Create a Feishu App

Go to [Feishu Open Platform](https://open.feishu.cn/app) and create an app. Enable these scopes:

- `wiki:wiki` — Knowledge base access
- `docx:document` — Document read/write
- `docx:document.block:convert` — Markdown to block conversion
- `drive:drive` — File management (includes permission management)
- `contact:contact.base:readonly` — User name resolution (@mentions)
- `board:whiteboard:node:read` — Whiteboard content read
- `bitable:app:readonly` — Bitable read access

### 2. Set Environment Variables

```bash
export FEISHU_APP_ID="cli_xxx"
export FEISHU_APP_SECRET="xxx"
```

### 3. Login (for user-level access)

Before running login, add the callback URL to your Feishu app's redirect allowlist.

- Default callback URL: `http://localhost:3456/callback`
- If your app has a different registered callback URL, pass the exact same value with `--redirect-uri` or `FEISHU_REDIRECT_URI`

```bash
feishu-docs login

# Match the exact redirect URI registered in Feishu Open Platform
feishu-docs login --redirect-uri http://127.0.0.1:3456/callback

# Or change only the port and keep the default localhost path
feishu-docs login --port 4567
```

This starts an OAuth flow and saves an encrypted token to `~/.feishu-docs/auth.json`.

## Usage

### Read

```bash
# Read document as Markdown
feishu-docs read https://xxx.feishu.cn/wiki/wikcnXXX

# Read by token
feishu-docs read wikcnXXX

# Raw Block JSON (lossless)
feishu-docs read <url> --blocks

# Plain text only
feishu-docs read <url> --raw

# With metadata header
feishu-docs read <url> --with-meta
```

### Knowledge Base

```bash
# List all knowledge bases
feishu-docs spaces

# Show node tree
feishu-docs tree <space_id>
feishu-docs tree <space_id> --depth 2

# Recursively read all documents
feishu-docs cat <space_id> --max-docs 20
feishu-docs cat <space_id> --node <token> --title-only
```

### Search

```bash
feishu-docs search "API design" --type docx --limit 10
```

Requires user access token. Use `feishu-docs login` first.

### Create

```bash
# In knowledge base
feishu-docs create "API Docs" --wiki <space_id> --body ./api.md

# In cloud folder
feishu-docs create "API Docs" --folder <folder_token> --body ./api.md

# Empty document
feishu-docs create "API Docs"

# From stdin
cat design.md | feishu-docs create "Design" --wiki <space_id> --body -
```

### Update

```bash
# Overwrite (backs up first)
feishu-docs update <url> --body ./updated.md

# Append
feishu-docs update <url> --body ./extra.md --append

# From stdin
echo "## New Section" | feishu-docs update <url> --body - --append

# Restore from backup
feishu-docs update <url> --restore ~/.feishu-docs/backups/xxx.json
```

### Delete

```bash
feishu-docs delete <url> --confirm
```

Moves document to recycle bin (recoverable for 30 days).

### Info

```bash
feishu-docs info <url|token>
feishu-docs info <url> --json
```

### List Files

```bash
# List root folder
feishu-docs ls

# List specific folder
feishu-docs ls <folder_token>

# Filter by type
feishu-docs ls --type docx --limit 20
```

### Share

```bash
# List collaborators
feishu-docs share list <url>

# Add collaborator
feishu-docs share add <url> user@example.com --role view
feishu-docs share add <url> ou_xxx --role edit

# Set public sharing mode
feishu-docs share set <url> --public tenant          # org-wide readable
feishu-docs share set <url> --public tenant:edit      # org-wide editable
feishu-docs share set <url> --public open             # anyone readable
feishu-docs share set <url> --public closed           # disable link sharing
```

Roles: `view`, `edit`, `manage`. Member types are auto-detected (email, openid, unionid, openchat, userid).

### Auth

```bash
feishu-docs login          # OAuth login (default callback: http://localhost:3456/callback)
feishu-docs logout         # Clear saved credentials
feishu-docs whoami         # Show current auth status
```

## Global Options

| Option | Description |
|--------|-------------|
| `--auth <user\|tenant\|auto>` | Auth mode (default: auto) |
| `--json` | Output JSON format |
| `--lark` | Use Lark (international) domain |
| `--help` | Show help |

## Auth Modes

| Mode | Token Type | Use Case |
|------|-----------|----------|
| `user` | user_access_token | Personal docs, collaboration, search |
| `tenant` | tenant_access_token | App-managed docs, CI/CD |
| `auto` | Best available | Default — tries user first, falls back to tenant |

## AI Agent Integration

### Claude Code (CLAUDE.md)

```markdown
## Feishu Docs

Read/write Feishu docs with feishu-docs-cli.

Read:     feishu-docs read <url>
Search:   feishu-docs search <keyword>
Tree:     feishu-docs tree <space_id>
Batch:    feishu-docs cat <space_id> --max-docs 10
Create:   feishu-docs create <title> --wiki <space_id> --body <file>
Update:   feishu-docs update <url> --body <file>

Env vars FEISHU_APP_ID and FEISHU_APP_SECRET are in .env.
Run `feishu-docs login` first.
```

### Programmatic Usage

All commands output to stdout (results) and stderr (errors/warnings). Exit codes:

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Invalid args |
| 2 | Auth failure |
| 3 | API error |

Use `--json` for structured output that agents can parse.

## Write Safety

Overwrite operations (`update` without `--append`) automatically:

1. **Back up** current document to `~/.feishu-docs/backups/`
2. **Clear** then **rewrite** the document
3. **Auto-recover** from backup if write fails
4. **Rotate** backups (keeps last 10)

Feishu also maintains version history — you can always roll back in the Feishu client.

## Plan

- [x] Feishu cloud document operations (read, create, update, delete, info)
- [x] Knowledge base operations (spaces, tree, cat, wiki management, share, search)
- [ ] Feishu Bitable (multi-dimensional table) operations
- [ ] Feishu Sheets (spreadsheet) operations

## Limitations

- **Supported**: docx (new documents)
- **Link only**: sheet, bitable, mindnote, board
- **Not supported**: doc (legacy format)
- Markdown conversion is lossy (colors, merged cells, layouts are dropped). Use `--blocks` for lossless JSON.
- Image write is not supported (read returns temporary URLs valid ~24h)

## License

MIT
