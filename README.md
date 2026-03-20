# feishu-docs-cli

[中文文档](./README.zh.md)

CLI tool for AI Agents to read/write Feishu (Lark) docs via shell commands.

## Why feishu-docs-cli?

Feishu/Lark already offers the official [lark-mcp](https://github.com/larksuite/lark-openapi-mcp) MCP server. Here's what this project does differently:

| Capability | feishu-docs-cli | lark-mcp |
|------------|:-:|:-:|
| Read docs as Markdown | **Yes** — 30+ block types rendered | No — returns raw Block JSON |
| Write docs from Markdown | **Yes** — auto-convert, auto-batch (>1000 blocks) | No |
| Knowledge base tree browsing | **Yes** — `spaces` → `tree` → `cat` workflow | Search/get single node only |
| Batch read entire wiki subtree | **Yes** — `cat` recursively exports Markdown | No |
| Write safety (backup/restore) | **Yes** — auto-backup before overwrite, auto-recover on failure | No |
| OAuth user login | **Yes** — full OAuth v2 with token refresh, tiered scope management | Tenant token only |
| Interactive scope recovery | **Yes** — prompts user to authorize missing scopes | No |
| Works with any AI agent | **Yes** — standard CLI, pipes, scripts | MCP protocol only |
| IM / messaging | No | Yes |
| Bitable CRUD | Read-only (rendered as table) | Yes |
| Contact lookup | Via `share add` only | Yes |

**In short**: lark-mcp is a thin wrapper over Feishu APIs with broad coverage. feishu-docs-cli is purpose-built for **document workflows** — it lets AI agents truly read, understand, and write Feishu documents as Markdown, with safety guardrails that the raw API doesn't provide.

## Features

- **Read** documents as Markdown, raw text, or original Block JSON
- **Create** documents in knowledge bases or cloud folders
- **Update** documents with overwrite or append mode (auto-batch for large content)
- **Delete** documents (move to recycle bin)
- **Info** — view document metadata (title, type, URL, revision)
- **Browse** knowledge base structure (spaces, tree, cat)
- **Search** documents by keyword
- **Share** — manage collaborators (list, add, set public mode)
- **List** files in cloud folders
- Written in TypeScript with strict mode
- Zero runtime dependencies — uses native `fetch` for all API calls
- Agent-friendly output — pure text or JSON, no interactive UI

## Install

```bash
npm install -g feishu-docs-cli
```

Or use directly with npx:

```bash
npx feishu-docs-cli read <url>
```

You can also install from GitHub:

```bash
npm install -g github:cliff-byte/feishu-docs-cli
```

Requires Node.js >= 18.3.

## Setup

### 1. Create a Feishu App

1. Go to [Feishu Open Platform](https://open.feishu.cn/app) (or [Lark Developer](https://open.larksuite.com/app) for international)
2. Click **Create Custom App**, fill in the app name and description
3. After creation, go to the app's **Credentials & Basic Info** page. Copy the **App ID** (`cli_xxx`) and **App Secret** — you'll need them for environment variables
4. Go to **Permissions & Scopes**, search and add the following scopes:

   **Base scopes** (no admin review needed — requested automatically during `feishu-docs login`):

   | Scope | Description |
   |-------|-------------|
   | `wiki:wiki` | Knowledge base read/write |
   | `docx:document` | Document read/write |
   | `docx:document.block:convert` | Markdown to block conversion (create/update) |
   | `sheets:spreadsheet:readonly` | Embedded spreadsheet read (read command) |
   | `board:whiteboard:node:read` | Whiteboard export as image (read command) |
   | `bitable:app:readonly` | Embedded bitable/table read (read command) |

   **Feature scopes** (require admin review — requested on-demand via `feishu-docs authorize`):

   | Scope | Description | Commands |
   |-------|-------------|----------|
   | `drive:drive` | Cloud file management & permissions | ls, delete, share, create --folder |
   | `contact:contact.base:readonly` | User lookup by email/phone | share add |
   | `drive:drive.search:readonly` | Document search | search |
   | `wiki:wiki.space:create` | Create knowledge bases | wiki create-space |
   | `wiki:wiki.space.node` | Edit knowledge base nodes | wiki rename, move, copy |
   | `wiki:wiki.space.member` | Manage knowledge base members | wiki add-member, remove-member |

5. Go to **Security Settings**, add the OAuth callback URL to the **Redirect URLs** allowlist:
   - Default: `http://localhost:3456/callback`
   - This must match exactly what you use during `feishu-docs login`

6. **Publish the app version**: Go to **App Release** → **Create Version** → Submit for review → Approve (self-built apps in your org are usually auto-approved)

> **Note**: For tenant-level access (e.g., CI/CD), the app must be granted access to specific docs or knowledge bases. Add the app as a collaborator, or use the admin console to authorize document scope.

### 2. Set Environment Variables

```bash
export FEISHU_APP_ID="cli_xxx"        # From step 3 above
export FEISHU_APP_SECRET="xxx"         # From step 3 above
```

### 3. Login (for user-level access)

User-level access enables personal docs, search, and collaboration features.

```bash
feishu-docs login
```

This opens a browser for OAuth authorization and saves the encrypted token to `~/.feishu-docs/auth.json`.

If your app's registered redirect URL differs from the default (`http://localhost:3456/callback`), pass the exact same value:

```bash
# Match the exact redirect URI registered in Feishu Open Platform
feishu-docs login --redirect-uri http://127.0.0.1:3456/callback

# Or change only the port and keep the default localhost path
feishu-docs login --port 4567
```

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
| `-v, --version` | Show version |

## Auth Modes

| Mode | Token Type | Use Case |
|------|-----------|----------|
| `user` | user_access_token | Personal docs, collaboration, search |
| `tenant` | tenant_access_token | App-managed docs, CI/CD |
| `auto` | Best available | Default — tries user first, falls back to tenant |

## AI Agent Integration

### Claude Code

Install the skill via [skills.sh](https://skills.sh) (works with Claude Code, Cursor, Codex, and 37+ agents):

```bash
npx skills add cliff-byte/feishu-docs-cli
```

Or install directly via the CLI:

```bash
feishu-docs install-skill
```

After installation, use `/feishu-docs` in Claude Code to activate the skill.

### Other Agents

Add these instructions to your agent's system prompt or configuration:

```
Read Feishu docs:    feishu-docs read <url>
Search docs:         feishu-docs search <keyword>
Browse wiki:         feishu-docs tree <space_id>
Batch read:          feishu-docs cat <space_id> --max-docs 10
Create doc:          feishu-docs create <title> --wiki <space_id> --body <file>
Update doc:          feishu-docs update <url> --body <file>
Use --json for structured output. Run feishu-docs --help for all commands.
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

## Development

```bash
git clone https://github.com/cliff-byte/feishu-docs-cli.git
cd feishu-docs-cli
npm install

# Type check
npm run build:check

# Build (outputs to dist/)
npm run build

# Run tests
npm test

# Run CLI from source
npm run build && node bin/feishu-docs.js --help
```

### Project Structure

```
src/
  types/          # Shared TypeScript type definitions
  commands/       # CLI command handlers
  services/       # API service layer
  parser/         # Block-to-Markdown parser
  utils/          # Validation, error handling, URL parsing
test/             # Unit tests (node:test)
bin/              # CLI entry point (JS shim → dist/)
dist/             # Compiled output (git-ignored)
```

## Roadmap

- [x] Feishu cloud document operations (read, create, update, delete, info)
- [x] Knowledge base operations (spaces, tree, cat, wiki management, share, search)
- [ ] Feishu Bitable (multi-dimensional table) operations
- [ ] Feishu Sheets (spreadsheet) operations

## Limitations

- **Supported**: docx (new documents)
- **Embedded content**: sheet (rendered as table), bitable (rendered as table), board/whiteboard (exported as image)
- **Link only**: mindnote
- **Not supported**: doc (legacy format)
- Markdown conversion is lossy (colors, merged cells, layouts are dropped). Use `--blocks` for lossless JSON.
- Image write is not supported (read returns temporary URLs valid ~24h)

## License

MIT
