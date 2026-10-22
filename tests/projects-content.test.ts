import { describe, expect, it } from "vitest";
import { isProjectContent, safeProjectLink } from "@/lib/projects/content";
import { projectContent } from "./fixtures/project-content";

describe("project content contract", () => {
  it("accepts bilingual engineering content with optional empty Arabic and real labelled links", () => {
    const value = projectContent();
    value.title.ar = "مشروع هندسي";
    value.links = [
      {
        label: { en: "Research", ar: "بحث" },
        href: "https://example.test/paper?q=one#section",
      },
    ];
    value.achievements = [
      {
        competition: { en: "Synthetic competition", ar: "" },
        result: "finalist",
        year: 2026,
        sample: false,
      },
    ];
    expect(isProjectContent(value)).toBe(true);
  });
  it("refuses script/credential URLs, controls, unknown nested fields, fabricated samples and unbounded values", () => {
    for (const href of [
      "javascript:alert(1)",
      "data:text/html,x",
      "//example.test",
      "https://user:pass@example.test",
      "https://example.test/\nfoo",
      "ftp://example.test",
      "https://example.test/@someone",
    ])
      expect(safeProjectLink(href)).toBe(false);
    const value = projectContent();
    for (const changed of [
      { ...value, authorId: "forged" },
      { ...value, status: "published" },
      { ...value, title: { ...value.title, html: "<script>" } },
      { ...value, title: { en: "x\u0000", ar: "" } },
      { ...value, summary: { en: "x".repeat(801), ar: "" } },
      { ...value, year: 2100 },
      { ...value, discipline: "unknown" },
      { ...value, technologies: ["invented"] },
      { ...value, parts: [{ name: { en: "Part", ar: "" }, qty: 0 }] },
      {
        ...value,
        achievements: [
          {
            competition: { en: "Award", ar: "" },
            result: "winner",
            year: 2026,
            sample: true,
          },
        ],
      },
      {
        ...value,
        mediaIds: [
          "11111111-1111-4111-8111-111111111111",
          "11111111-1111-4111-8111-111111111111",
        ],
      },
      {
        ...value,
        team: [
          {
            name: { en: "Person", ar: "" },
            role: { en: "Design", ar: "" },
            memberId: "not-uuid",
          },
        ],
      },
    ])
      expect(isProjectContent(changed)).toBe(false);
  });
});
