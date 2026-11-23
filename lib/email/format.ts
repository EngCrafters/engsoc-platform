// The Email Centre's message format (ADR 0028): a small, safe subset of Markdown, rendered here
// to escaped HTML and plain text. Raw HTML is never accepted: every character the author types is
// escaped, and only these constructs become markup:
//
//   # Heading / ## Heading      a line starting with one or two #
//   - item / * item             bullet lists; 1. item numbered lists
//   **bold**  *italic*          inline emphasis
//   [text](https://…)           links, https or mailto only
//   blank line                  a new paragraph; a single line break stays a line break
//   {{name}}                    the recipient's name
//
// Pure: no I/O, so it is unit tested directly.

export type RenderedMessage = { subject: string; html: string; text: string };

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** Only absolute https links and mailto addresses; anything else stays plain text. */
export function safeHref(raw: string): string | null {
  const value = raw.trim();
  if (/^mailto:[^\s<>"']+@[^\s<>"']+$/i.test(value)) return value;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

const personalize = (value: string, name: string) =>
  value.replace(/\{\{\s*name\s*\}\}/g, () => name);

/** Inline markup on already-escaped text: links, then bold, then italic. */
function inlineHtml(escaped: string): string {
  return escaped
    .replace(
      /\[([^\]\n]{1,300})\]\(([^)\s]{1,2000})\)/g,
      (match, text, href) => {
        // The href was escaped with the rest; undo the entity escaping only to validate it.
        const raw = href
          .replace(/&amp;/g, "&")
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">");
        const safe = safeHref(raw);
        return safe
          ? `<a href="${escapeHtml(safe)}" style="color:#1d4ed8">${text}</a>`
          : match;
      }
    )
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
}

function inlineText(value: string): string {
  return value
    .replace(
      /\[([^\]\n]{1,300})\]\(([^)\s]{1,2000})\)/g,
      (match, text, href) => {
        const safe = safeHref(href);
        return safe ? `${text} (${safe.replace(/^mailto:/i, "")})` : match;
      }
    )
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1$2");
}

type Block =
  | { kind: "heading"; level: 1 | 2; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "paragraph"; lines: string[] };

export function parseBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", lines: paragraph });
    if (list) blocks.push({ kind: "list", ...list });
    paragraph = [];
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = /^(#{1,2})\s+(.+)$/.exec(line);
    const bullet = /^\s*[-*]\s+(.+)$/.exec(line);
    const numbered = /^\s*\d{1,3}[.)]\s+(.+)$/.exec(line);
    if (!line.trim()) {
      flush();
    } else if (heading) {
      flush();
      blocks.push({
        kind: "heading",
        level: heading[1].length === 1 ? 1 : 2,
        text: heading[2],
      });
    } else if (bullet || numbered) {
      const ordered = Boolean(numbered);
      if (paragraph.length) {
        blocks.push({ kind: "paragraph", lines: paragraph });
        paragraph = [];
      }
      if (list && list.ordered !== ordered) {
        blocks.push({ kind: "list", ...list });
        list = null;
      }
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]);
    } else {
      if (list) {
        blocks.push({ kind: "list", ...list });
        list = null;
      }
      paragraph.push(line);
    }
  }
  flush();
  return blocks;
}

function bodyHtml(source: string, rtl: boolean): string {
  const align = rtl ? "right" : "left";
  return parseBlocks(source)
    .map((block) => {
      if (block.kind === "heading")
        return `<h${block.level + 1} style="margin:0 0 12px;font-size:${block.level === 1 ? 20 : 17}px;text-align:${align}">${inlineHtml(escapeHtml(block.text))}</h${block.level + 1}>`;
      if (block.kind === "list") {
        const tag = block.ordered ? "ol" : "ul";
        return `<${tag} style="margin:0 0 16px;padding-${rtl ? "right" : "left"}:24px">${block.items
          .map(
            (item) =>
              `<li style="margin:0 0 4px">${inlineHtml(escapeHtml(item))}</li>`
          )
          .join("")}</${tag}>`;
      }
      return `<p style="margin:0 0 16px;line-height:1.6;text-align:${align}">${block.lines
        .map((line) => inlineHtml(escapeHtml(line)))
        .join("<br>")}</p>`;
    })
    .join("\n");
}

function bodyText(source: string): string {
  return parseBlocks(source)
    .map((block) => {
      if (block.kind === "heading") return inlineText(block.text).toUpperCase();
      if (block.kind === "list")
        return block.items
          .map(
            (item, i) =>
              `${block.ordered ? `${i + 1}.` : "-"} ${inlineText(item)}`
          )
          .join("\n");
      return block.lines.map(inlineText).join("\n");
    })
    .join("\n\n");
}

export type MessageContent = {
  language: "en" | "ar" | "both";
  subjectEn: string | null;
  subjectAr: string | null;
  bodyEn: string | null;
  bodyAr: string | null;
};

/**
 * One recipient's message: personalized, escaped and wrapped in a plain, accessible layout with
 * the unsubscribe footer. With both languages the English part comes first, then the Arabic part
 * in a right-to-left section.
 */
export function renderMessage(
  content: MessageContent,
  options: { name: string; unsubscribeUrl: string | null }
): RenderedMessage {
  const name = options.name.trim() || "member";
  const parts: { lang: "en" | "ar"; subject: string; body: string }[] = [];
  if (content.language !== "ar" && content.subjectEn && content.bodyEn)
    parts.push({
      lang: "en",
      subject: personalize(content.subjectEn, name),
      body: personalize(content.bodyEn, name),
    });
  if (content.language !== "en" && content.subjectAr && content.bodyAr)
    parts.push({
      lang: "ar",
      subject: personalize(content.subjectAr, name),
      body: personalize(content.bodyAr, name),
    });
  const subject = parts
    .map((p) => p.subject)
    .join(" | ")
    .slice(0, 400);
  const footerEn = options.unsubscribeUrl
    ? `You receive this as a member of the Engineering Society. Unsubscribe from announcements: ${options.unsubscribeUrl}`
    : "You receive this as a member of the Engineering Society.";
  const footerAr = options.unsubscribeUrl
    ? `تصلك هذه الرسالة بصفتك عضواً في الجمعية الهندسية. لإلغاء الاشتراك في الإعلانات: ${options.unsubscribeUrl}`
    : "تصلك هذه الرسالة بصفتك عضواً في الجمعية الهندسية.";
  const sections = parts
    .map(
      (p) =>
        `<div lang="${p.lang}" dir="${p.lang === "ar" ? "rtl" : "ltr"}" style="margin:0 0 24px">${bodyHtml(p.body, p.lang === "ar")}</div>`
    )
    .join(
      '<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">'
    );
  const unsubscribe = options.unsubscribeUrl
    ? `<a href="${escapeHtml(options.unsubscribeUrl)}" style="color:#4b5563">Unsubscribe · إلغاء الاشتراك</a>`
    : "";
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head><body style="margin:0;background:#f8fafc;font-family:system-ui,-apple-system,'Segoe UI',Tahoma,Arial,sans-serif;color:#111827"><div style="max-width:600px;margin:0 auto;padding:24px;background:#ffffff">${sections}<p style="margin:24px 0 0;font-size:12px;color:#6b7280;line-height:1.5">Engineering Society · الجمعية الهندسية<br>${unsubscribe}</p></div></body></html>`;
  const text = [
    ...parts.map((p) => bodyText(p.body)),
    parts.some((p) => p.lang === "en") || parts.length === 0 ? footerEn : "",
    parts.some((p) => p.lang === "ar") ? footerAr : "",
  ]
    .filter(Boolean)
    .join("\n\n---\n\n");
  return { subject, html, text };
}

/** Whether a message has the parts its language needs. */
export function contentComplete(content: MessageContent): boolean {
  const en = Boolean(content.subjectEn?.trim() && content.bodyEn?.trim());
  const ar = Boolean(content.subjectAr?.trim() && content.bodyAr?.trim());
  return content.language === "en"
    ? en
    : content.language === "ar"
      ? ar
      : en && ar;
}
