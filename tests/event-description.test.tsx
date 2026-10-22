import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { EventDescription } from "@/components/event-description";
import { descriptionTokens, plainDescription } from "@/lib/events/description";

describe("event description links (Core's public pages)", () => {
  it("links bare URLs and labelled links, keeping surrounding text and punctuation", () => {
    expect(
      descriptionTokens(
        "See https://www.squ.edu.om. Or [Workshop details](https://example.com/a_(b))!"
      )
    ).toEqual([
      { text: "See " },
      { text: "https://www.squ.edu.om", href: "https://www.squ.edu.om/" },
      { text: "." },
      { text: " Or " },
      { text: "Workshop details", href: "https://example.com/a_(b)" },
      { text: "!" },
    ]);
  });

  it("never links unsafe protocols, credentials or HTML, and renders them as text", () => {
    const text =
      '[x](javascript:alert(1)) <img src=x onerror="alert(1)"> https://user:pass@evil.test data:text/html,<b>';
    expect(descriptionTokens(text).filter((t) => t.href)).toEqual([]);
    const html = renderToStaticMarkup(<EventDescription text={text} />);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("href");
    expect(html).toContain("&lt;img");
  });

  it("opens links safely and keeps line breaks", () => {
    const html = renderToStaticMarkup(
      <EventDescription text={"Line one\nhttps://www.squ.edu.om"} />
    );
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(html).toContain("whitespace-pre-wrap");
  });

  it("summarises cards without link syntax", () => {
    expect(
      plainDescription("Read [the guide](https://example.com) first")
    ).toBe("Read the guide first");
  });
});
