/**
 * Event descriptions are plain text with HTTP(S) links: bare URLs and
 * `[label](https://...)` (ADR 0020). The same rules as ESWebsite's
 * lib/event-description.ts, so both public sites render a description alike.
 * HTML is always text; only absolute http/https URLs without credentials
 * become links, and anything else stays exactly as typed.
 */
export type DescriptionToken = { text: string; href?: string };

const LINK =
  /\[([^\]\r\n]{1,500})\]\((https?:\/\/[^\s<>"()]+(?:\([^\s<>"()]*\)[^\s<>"()]*)*)\)|https?:\/\/[^\s<>"\u0000-\u001f]+/gi;

export function descriptionTokens(text: string): DescriptionToken[] {
  const tokens: DescriptionToken[] = [];
  let end = 0;
  for (const match of text.matchAll(LINK)) {
    const at = match.index!;
    if (at > end) tokens.push({ text: text.slice(end, at) });
    let href = match[2] ?? match[0];
    let suffix = "";
    if (!match[2]) {
      // Sentence punctuation and an unbalanced closing bracket end a bare URL.
      while (
        /[.,;:!?،؛]$/.test(href) ||
        (href.endsWith(")") &&
          (href.match(/\)/g)?.length ?? 0) > (href.match(/\(/g)?.length ?? 0))
      ) {
        suffix = href.slice(-1) + suffix;
        href = href.slice(0, -1);
      }
    }
    try {
      const url = new URL(href);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password
      )
        throw new Error("unsafe");
      tokens.push({ text: match[1] ?? href, href: url.href });
      if (suffix) tokens.push({ text: suffix });
    } catch {
      tokens.push({ text: match[0] });
    }
    end = at + match[0].length;
  }
  if (end < text.length) tokens.push({ text: text.slice(end) });
  return tokens;
}

/** Card summaries: link syntax removed before clamping, never half a token. */
export function plainDescription(text: string) {
  return descriptionTokens(text)
    .map((token) => token.text)
    .join("");
}
