/**
 * Convert Feishu TextRun elements to/from Markdown inline format.
 */

/**
 * Escape Markdown special characters in plain text.
 */
function escapeMarkdown(text) {
  return text.replace(/([\\*_`~\[\]|<>#!])/g, "\\$1");
}

/**
 * Render a list of text elements to Markdown inline string.
 */
export function elementsToMarkdown(elements, ctx) {
  if (!elements || elements.length === 0) return "";

  const userNameMap = ctx?.userNameMap;

  return elements
    .map((el) => {
      if (el.text_run) {
        return textRunToMarkdown(el.text_run);
      }
      if (el.equation) {
        const content = (el.equation.content || "").trim();
        // Use $$ for block-level (sole element), $ for inline
        if (elements.length === 1) {
          return `$$${content}$$`;
        }
        return `$${content}$`;
      }
      if (el.mention_user) {
        const uid = el.mention_user.user_id || "";
        const name =
          (userNameMap && userNameMap.get(uid)) ||
          el.mention_user.user_name ||
          el.mention_user.name;
        if (name) return `@${name}`;
        // Fallback: show shortened user_id
        return `@[用户](feishu://user/${uid})`;
      }
      if (el.mention_doc) {
        const title = el.mention_doc.title || "文档";
        const url = el.mention_doc.url || "";
        return url ? `[${title}](${url})` : title;
      }
      return "";
    })
    .join("");
}

function textRunToMarkdown(textRun) {
  let text = textRun.content || "";
  if (!text) return "";

  const style = textRun.text_element_style || {};

  // Inline code takes priority — no other formatting inside code
  if (style.inline_code) {
    return `\`${text}\``;
  }

  // Escape Markdown special characters in plain text
  text = escapeMarkdown(text);

  // Apply style markers to text first (before link wrapping)
  if (style.bold && style.italic) {
    text = `***${text}***`;
  } else if (style.bold) {
    text = `**${text}**`;
  } else if (style.italic) {
    text = `*${text}*`;
  }

  if (style.strikethrough) {
    text = `~~${text}~~`;
  }

  if (style.underline) {
    text = `<u>${text}</u>`;
  }

  // Link wrapping (after style markers so bold/italic wraps text, not link syntax)
  if (style.link?.url) {
    const url = decodeURIComponent(style.link.url);
    text = `[${text}](${url})`;
  }

  return text;
}
