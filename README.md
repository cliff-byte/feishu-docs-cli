# feishu-docs-cli

[中文文档](./README.zh.md)

CLI tool for AI Agents to read/write Feishu (Lark) docs via shell commands.

## Project Status

> **Note**: The official [lark-cli](https://github.com/larksuite/cli) has been released by the Lark/Feishu team (2025). It covers a much broader range of Feishu APIs (IM, calendar, tasks, contacts, bitable, etc.). We believe the official tool will continue to improve, so **this project will slow down on new feature development**. Existing functionality will be maintained but no major additions are planned.
>
> If you need full Feishu API coverage, use [lark-cli](https://github.com/larksuite/cli). If you primarily work with **documents and knowledge bases** and need clean Markdown I/O, feishu-docs-cli still offers a better experience in that specific area.

## Comparison with lark-cli

Based on real-world testing against the same knowledge base (2026-03-29):

| Capability | feishu-docs-cli | lark-cli (official) |
|------------|-----------------|---------------------|
| **Read as Markdown** | Standard Markdown — tables, lists, code blocks render correctly | Returns JSON with `<lark-table>` custom HTML tags, not standard Markdown |
| **Knowledge base tree** | `tree` command — one call, full recursive tree | No equivalent — must call `get_node` per node |
| **Batch read wiki** | `cat` — recursively reads all child docs | No equivalent |
| **Create in wiki** | `--wiki <space> --parent <node>` — supports parent node placement | `--wiki-space` and `--wiki-node` are mutually exclusive |
| **Update docs** | Accepts file path (`--body file.md`), auto-backup before overwrite | Inline `--markdown` only, `--mode` required |
| **Search** | `search "keyword"` — one step | Requires separate scope authorization |
| **Share / permissions** | `share list/add/remove/update/set` — fully wrapped | No wrapper — requires raw API calls |
| **JSON output** | Clean, pipe-friendly `--json` | Mixes progress text (`[page 1] fetching...`) into stdout |
| **Error messages** | Chinese messages with recovery hints, missing scope auto-detection | English errors, manual scope lookup |
| **API coverage** | Documents, wiki, drive, search, permissions | **Full platform** — IM, calendar, tasks, contacts, bitable, mail, video conference, etc. |
| **Dependencies** | Zero runtime deps (Node.js built-ins only) | Go binary |
| **Cold start** | ~0.5s (Node.js) | ~0.1s (Go) |

**In short**: feishu-docs-cli is purpose-built for **document workflows** — clean Markdown I/O, recursive wiki browsing, and write safety. lark-cli is a comprehensive platform CLI with broader API coverage. They are complementary rather than competing.

## Features

- **Read** documents as Markdown (images downloaded to local files), raw text, or original Block JSON
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
   | `offline_access` | Token auto-refresh (enables refresh_token for 7-day validity) |
   | `wiki:wiki` | Knowledge base read/write |
   | `docx:document` | Document read/write |
   | `docx:document.block:convert` | Markdown to block conversion (create/update) |
   | `sheets:spreadsheet:readonly` | Embedded spreadsheet read (read command) |
   | `board:whiteboard:node:read` | Whiteboard export as image (read command) |
   | `bitable:app:readonly` | Embedded bitable/table read (read command) |
   | `docs:document.media:download` | Download images and attachments from documents |

   **Additional scopes** are requested reactively — when an API call needs a scope you haven't authorized, the CLI detects this from the API error response and prompts you. Common ones:

   | Scope | Description |
   |-------|-------------|
   | `drive:drive` | Cloud file management (ls, delete, share, mv, cp, mkdir) |
   | `contact:contact.base:readonly` | User lookup by email/phone |
   | `drive:drive.search:readonly` | Document search |

5. Go to **Security Settings**, add the OAuth callback URL to the **Redirect URLs** allowlist:
   - Default: `http://127.0.0.1:3456/callback`
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

If your app's registered redirect URL differs from the default (`http://127.0.0.1:3456/callback`), pass the exact same value:

```bash
# Match the exact redirect URI registered in Feishu Open Platform
feishu-docs login --redirect-uri http://127.0.0.1:3456/callback

# Or change only the port and keep the default localhost path
feishu-docs login --port 4567
```

### CI / Container Environments

In CI pipelines, Docker containers, or headless servers where interactive OAuth login is not possible, use the `FEISHU_USER_TOKEN` environment variable instead of `feishu-docs login`:

```bash
export FEISHU_APP_ID="cli_xxx"
export FEISHU_APP_SECRET="xxx"
export FEISHU_USER_TOKEN="u-xxx"   # User access token from Feishu API
```

With these three variables set, all commands work without `feishu-docs login`. The token is used directly without local encryption or storage.

**Important:**
- `FEISHU_USER_TOKEN` has no auto-refresh -- you are responsible for rotating it before expiry
- Do NOT use `feishu-docs login` in containers -- it spawns a local HTTP server and attempts to open a browser
- For tenant-only access (no user context), `FEISHU_APP_ID` and `FEISHU_APP_SECRET` are sufficient

## Usage

### Read

```bash
# Read document as Markdown (images auto-downloaded to ~/.feishu-docs/images/)
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

Images in documents are automatically downloaded to `~/.feishu-docs/images/` and referenced as local file paths in the Markdown output. Cached images are reused for 30 days.

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

### File Operations

```bash
# Move file to a folder
feishu-docs mv <url|token> <target_folder_token>

# Copy file (auto-names as "Title - 副本")
feishu-docs cp <url|token> <target_folder_token>

# Copy with custom name
feishu-docs cp <url|token> <target_folder_token> --name "My Copy"

# Create a folder
feishu-docs mkdir "New Folder" --parent <parent_folder_token>
```

### Share

```bash
# List collaborators
feishu-docs share list <url>

# Add collaborator
feishu-docs share add <url> user@example.com --role view
feishu-docs share add <url> ou_xxx --role edit

# Remove collaborator
feishu-docs share remove <url> user@example.com

# Update collaborator role
feishu-docs share update <url> ou_xxx --role manage

# Set public sharing mode
feishu-docs share set <url> --public tenant          # org-wide readable
feishu-docs share set <url> --public tenant:edit      # org-wide editable
feishu-docs share set <url> --public open             # anyone readable
feishu-docs share set <url> --public closed           # disable link sharing
```

Roles: `view`, `edit`, `manage`. Member types are auto-detected (email, openid, unionid, openchat, userid).

### Auth

```bash
feishu-docs login          # OAuth login (default callback: http://127.0.0.1:3456/callback)
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
- [x] Quality hardening — 456 tests, retry logic, error recovery, dead code cleanup

> Bitable and Sheets operations are not planned. For those, use the official [lark-cli](https://github.com/larksuite/cli).

## Mermaid Diagrams

feishu-docs-cli and lark-cli handle Mermaid differently when writing:

| | feishu-docs-cli | lark-cli (official) |
|---|---|---|
| **Write** | Stored as `` ```mermaid `` code block (block_type 14) | Converted to whiteboard/board (block_type 43) via Lark MCP |
| **Read back own output** | Returns original Mermaid code — lossless round-trip | Returns whiteboard node graph (shapes, coordinates, connectors) — cannot recover Mermaid source |
| **Read native Mermaid** | Both tools can read Mermaid code blocks written natively in Feishu — no issue here |
| **Human readability** | Code block in document — not visually rendered (Feishu supports "text diagram" blocks but the Open API cannot create them) | Renders as interactive diagram immediately |
| **Best for** | AI agent workflows — Mermaid survives read/write round-trips | Human consumption — visual diagrams, but one-way (write-only) |

**Why this trade-off?** Feishu has a native "text diagram" block that renders Mermaid visually, but the Open API's Convert endpoint does not support creating it — Mermaid is treated as a plain code block. lark-cli works around this by converting Mermaid to a whiteboard (board) via the Lark MCP protocol, which produces a visual result but loses the Mermaid source code. We chose to preserve the code block so AI agents can reliably read and modify diagrams.

## Limitations

- **Supported**: docx (new documents)
- **Embedded content**: sheet (rendered as table), bitable (rendered as table), board/whiteboard (exported as image)
- **Link only**: mindnote
- **Not supported**: doc (legacy format)
- Markdown conversion is lossy (colors, merged cells, layouts are dropped). Use `--blocks` for lossless JSON.
- Image read downloads to local files (`~/.feishu-docs/images/`) with 30-day cache. Image write is not supported.

## License

MIT
