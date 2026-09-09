---
name: feishu-docs
description: Feishu/Lark cloud documents (飞书云文档), knowledge bases, and Bitable records via the feishu-docs CLI. Use as the primary interface for every document, wiki, or Bitable read task involving a supported URL (*.feishu.cn, *.larksuite.com, or *.larkoffice.com with /wiki/, /docx/, /doc/, /sheets/, /base/, or /record/) or a raw document token—even when the user only pastes the link or asks to open, read, inspect, summarize, translate, extract, or edit it. Also use for creating, updating, appending, deleting, searching, sharing, moving, copying, organizing, or browsing Feishu/Lark documents, folders, and wiki spaces, and whenever feishu-docs or feishu-docs-cli is mentioned.
---

# Feishu Docs CLI

Use the separate `feishu-docs` CLI for document operations. Prefer `--json` for agent consumption; plain `read` returns Markdown. Use `--help` for the command index.

## Setup and Authentication

Before the first CLI operation in a session, check installation:

```bash
command -v feishu-docs >/dev/null 2>&1 && feishu-docs --version || echo "NOT_INSTALLED"
```

If missing, check `node --version` and `npm --version`, then run `npm install -g feishu-docs-cli` and verify `feishu-docs --version`. Node.js ≥ 18.3.0 is required. Ask the user to resolve a missing Node/npm installation or npm permission errors; do not silently use `sudo`.

Run `feishu-docs whoami --json` to check authentication. For OAuth login, set `FEISHU_APP_ID` and `FEISHU_APP_SECRET` and have the user run `feishu-docs login` interactively. Tenant auth only accesses resources granted to the app; search requires user auth.

Global options: `--auth user|tenant|auto` (default `auto`, user first), `--lark` for Lark international, and `--json` for structured output. A fixed `FEISHU_USER_TOKEN` overrides saved OAuth tokens and must carry its own grants. Follow returned scope/recovery hints; app-console enablement alone does not update a user's OAuth grant. JSON, non-interactive, tenant and fixed-token scope-recovery flows do not open OAuth.

## Read Documents and Bitable

```bash
feishu-docs read <url|token>
feishu-docs read <url> --blocks --json    # Raw block JSON for fidelity and patch IDs
feishu-docs read <url> --raw             # Plain text
feishu-docs read <url> --with-meta       # Include source, revision and ownership metadata
feishu-docs read <bitable-url> --json    # Matching records with raw field values
feishu-docs read <record-url> --json     # One record from a share link
feishu-docs info <url|token> --json      # Document metadata; docx revision is `revision`
```

URLs resolve document types automatically; wiki links resolve their target. Most commands accept raw tokens; standalone Sheets require `--type sheet` when using a raw token.

- Docx Markdown uses Feishu's renderer and may contain XML-like tags. Use `--blocks` for exact elements and IDs. Task enrichment may retain original tags when permission is missing; check warnings before claiming complete content.
- Bitable is read-only: table/view reads apply filtering and sorting but keep the full field schema. `--raw`, `--blocks` and `--with-meta` are unsupported.
- Legacy `doc` is unsupported. Embedded sheets/bitables are lossy tables; boards/whiteboards export as images; mindnotes render as links.
- Image references are normally Feishu-hosted; the fallback reader caches downloaded images in `~/.feishu-docs/images/` for 30 days.
- `info` resolves user names where permitted. Missing Drive metadata scopes produce a hint while basic docx info can still succeed.

## Read and Export Spreadsheets

```bash
feishu-docs read <sheets-or-wiki-url> --json
feishu-docs read <url> --sheet <sheet_id> --range B2:AA600 --json
feishu-docs read <spreadsheet_token> --type sheet --json
feishu-docs export <url> --output ./workbook.xlsx --json
```

Choose `read` for displayed values and `export` for an official xlsx workbook:

- `read` includes all worksheets, including hidden sheets, in workbook order. `--sheet` overrides the URL's sheet. A finite `--range` must fit the grid and have a selected or uniquely readable ordinary worksheet. `--with-meta` adds source details; `--raw`/`--blocks` are unsupported.
- JSON uses rectangular arrays with null padding and coordinates. Whole-sheet reads trim trailing empty rows/columns. Reads do not preserve formulas, formatting or merges; missing revisions cannot establish a consistent snapshot.
- `export` always exports the whole workbook, including when the URL selects a sheet. Only xlsx is supported; `--sheet`/`--range` are rejected. The parent directory must exist and the output must not exist. Success reports `path`, `format` and byte `size`.
- Export success does not guarantee Excel formula compatibility. Unsupported functions such as `IMPORTRANGE` may cause `#NAME?`; absent cached formula values may look empty to `data_only` readers. Neither symptom proves source data changed; recalculation cannot fix unsupported functions.

On `90235: Data not ready`, wait and rerun; this business error is not automatically retried. Failed standalone reads fail the command; embedded failures leave warnings/placeholders. Check those before reporting completeness.

Export requires either `docs:document:export` or `drive:export:readonly`. For a missing user grant, use `feishu-docs authorize --scope "docs:document:export"` if that scope is enabled for the app. Transient export retries reuse the current task. After timeout, the remote task may still run; follow recovery hints before starting another. Forced termination may leave a hidden temporary directory beside the output.

## Create, Append or Rewrite Documents

```bash
feishu-docs create "Title" --wiki <space_id> --body ./content.md
feishu-docs create "Title" --folder <folder_token> --body ./content.md
feishu-docs create "Title"                          # Empty docx, returns URL
feishu-docs update <url> --body ./extra.md --append
feishu-docs update <url> --body ./replacement.md     # Whole-document rewrite
feishu-docs update <url> --restore ~/.feishu-docs/backups/<backup-file>.json
```

`create`/`update` write docx only. `--body` takes a Markdown file or `-` for stdin; conversion is server-side. To create beneath a wiki node, add `--parent <node_token>` with `--wiki`.

Choose `patch` below for local edits that preserve existing rich content. Whole-document `update` clears and rebuilds the body; Markdown round trips are lossy. It backs up to `~/.feishu-docs/backups/` first and attempts restoration if content writing fails. Up to 10 backups per document are retained.

Table and image options apply to both `create` and `update`:

- Tables default to a header row and estimated content-based column widths. `--no-table-header` disables the header; `--no-table-column-width` keeps equal widths. `--table-width <px>` (200–2000) overrides the default page-width target of about 815px.
- Standalone local images (`![alt](./images/demo.png)` or `file://` URLs) are uploaded when inside the Markdown file's directory tree and under 20MB each. Stdin paths resolve from the current directory. Inline images, images inside lists/tables and paths outside that tree are skipped; remote HTTP(S) images remain supported.
- Mermaid stays a code block; the API does not create a visual text diagram.

## Patch Existing Text

Obtain `revision` using `info <url> --json`, then use `read <url> --blocks --json` for block IDs and original text. Save `edits.json` with actual values:

```json
{
  "document_revision_id": 42,
  "edits": [
    { "block_id": "actualBlockId", "old_text": "Original text", "new_text": "Replacement text" }
  ]
}
```

```bash
feishu-docs patch <url> --body edits.json --dry-run --json
feishu-docs patch <url> --body edits.json --json
```

- Docx only; `--body -` also accepts JSON from stdin. Each patch accepts 1–200 distinct blocks and an explicit nonnegative revision (`-1` is rejected).
- `old_text` must match uniquely within one `text_run`. Replacement is literal text, inherits its style and preserves other elements, including mentions. For table cells, target their child text blocks.
- Cross-format/mention matches, unknown inline elements and ambiguous/missing matches fail before writing. `--dry-run` only previews; all edits are validated before one batch write. Patch does not perform whole-document backup/restore.
- A preflight version mismatch stops without writing: re-read and rebuild the patch. Feishu can accept an old revision after the last check, so concurrent edits can still be overwritten; there is no atomic protection.
- A returned revision jump reports `error.details.write_may_have_applied: true`. After this or an unconfirmed write, inspect current blocks and version history instead of retrying or rolling back automatically.

## Discover and Search

```bash
feishu-docs spaces --json
feishu-docs tree <space_id> --depth 3 --json
feishu-docs tree <space_id> --names                 # Resolve member names
feishu-docs cat <space_id> --max-docs 20            # Read docs recursively
feishu-docs cat <space_id> --title-only             # List titles
feishu-docs cat <space_id> --node <node_token>      # Restrict to a subtree
feishu-docs search "keyword" --type docx --limit 10 --json
```

Use `spaces` to find a space ID, `tree` to locate nodes, then `read` for one document or `cat` for a collection.

## Cloud Files

```bash
feishu-docs ls --json                             # Root folder
feishu-docs ls <folder_token> --type docx --limit 20 --json
feishu-docs mkdir "Folder Name" --parent <folder_token>
feishu-docs mv <url|token> <target_folder_token>
feishu-docs cp <url|token> <target_folder> --name "My Copy"
feishu-docs delete <url|token> --confirm
```

`mv` polls its asynchronous task for up to 30s. Without `--name`, `cp` appends " - 副本" to the original title. `delete --confirm` moves a document to the recycle bin, recoverable for 30 days.

## Sharing and Permissions

```bash
feishu-docs share list <url> --json
feishu-docs share add <url> user@example.com --role view
feishu-docs share update <url> ou_xxx --role edit
feishu-docs share remove <url> user@example.com
feishu-docs share set <url> --public tenant
```

Roles: `view`, `edit`, `manage`; member ID types are detected automatically. Public modes: `tenant` (organization view), `tenant:edit` (organization edit), `open` (internet view), `closed` (disable link sharing).

## Wiki Management

```bash
feishu-docs wiki create-space <name>
feishu-docs wiki add-member <space_id> <member>
feishu-docs wiki remove-member <space_id> <member>
feishu-docs wiki rename <url> --title <new_title>
feishu-docs wiki move <url> --to <space_id>
feishu-docs wiki copy <url> --to <space_id>
```
