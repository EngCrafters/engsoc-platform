import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/membership/db", () => ({
  submitThroughRoutine: vi.fn(),
  optionsThroughRoutine: vi.fn(),
  statusThroughRoutine: vi.fn(),
}));

const { checkDocument, sniffDocumentType, hasActivePdfContent } =
  await import("@/lib/membership/document");
const {
  createStatusToken,
  hashStatusToken,
  isStatusToken,
  validateApplication,
} = await import("@/lib/membership");
type RawApplication = import("@/lib/membership").RawApplication;

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(
    parts.flatMap((part) =>
      typeof part === "string" ? [...Buffer.from(part, "latin1")] : part
    )
  );
const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0], "synthetic jpeg");
const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "png");
const WEBP = bytes("RIFF", [0, 0, 0, 0], "WEBPVP8 ");
const PDF = bytes("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF");

// The categories and institutions the database publishes (migration 0033), as Core reads them.
const OPTIONS = {
  categories: [
    {
      id: "university_student",
      label: { en: "University Student", ar: "طالب جامعي" },
      institution: "required" as const,
      academicYear: true,
    },
    {
      id: "graduate",
      label: { en: "Graduate / Alumni", ar: "خرّيج" },
      institution: "optional" as const,
      academicYear: false,
    },
    {
      id: "industry_professional",
      label: { en: "Industry Professional", ar: "مهني" },
      institution: "none" as const,
      academicYear: false,
    },
  ],
  institutions: [
    {
      id: "squ",
      name: { en: "Sultan Qaboos University (SQU)", ar: "جامعة السلطان قابوس" },
      country: "OM",
    },
    { id: "utas", name: { en: "UTAS", ar: "جامعة التقنية" }, country: "OM" },
  ],
};

const valid: RawApplication = {
  fullName: "Aisha Al-Hinai",
  email: "aisha.alhinai@gmail.com",
  category: "university_student",
  institution: "utas",
  institutionName: null,
  academicYear: "2",
  discipline: "civil",
  interests: ["cad", "data"],
  consent: "true",
  consentVersion: "2026-11-v2",
};

describe("SQU ID card content checks (registration and SQU verification evidence)", () => {
  it("identifies files by their signature, not their name or declared type", () => {
    expect(sniffDocumentType(JPEG)).toBe("image/jpeg");
    expect(sniffDocumentType(PNG)).toBe("image/png");
    expect(sniffDocumentType(WEBP)).toBe("image/webp");
    expect(sniffDocumentType(PDF)).toBe("application/pdf");
    for (const other of [
      bytes("GIF89a..."),
      bytes("<svg xmlns='http://www.w3.org/2000/svg'/>"),
      bytes("<html><script>alert(1)</script>"),
      bytes([0x50, 0x4b, 0x03, 0x04], "zip"),
      bytes("RIFF", [0, 0, 0, 0], "AVI "),
      new Uint8Array(),
    ]) {
      expect(sniffDocumentType(other)).toBeNull();
    }
  });

  it("refuses PDFs that carry scripts, launch actions or attachments", () => {
    for (const marker of [
      "/JavaScript",
      "/JS (app.alert(1))",
      "/JS<<",
      "/Launch",
      "/EmbeddedFile",
      "/OpenAction",
      "/AA <<",
      "/XFA",
    ]) {
      const pdf = bytes(`%PDF-1.7\n1 0 obj << ${marker} >> endobj`);
      expect(hasActivePdfContent(pdf), marker).toBe(true);
      expect(checkDocument(pdf), marker).toEqual({
        ok: false,
        code: "unsupported-type",
      });
    }
    expect(hasActivePdfContent(bytes("%PDF-1.7 /JSONish /AAAA /Type"))).toBe(
      false
    );
    expect(checkDocument(PDF)).toEqual({
      ok: true,
      mediaType: "application/pdf",
    });
  });

  it("requires a file and bounds it at 4 MiB", () => {
    expect(checkDocument(null)).toEqual({ ok: false, code: "required" });
    const big = new Uint8Array(4 * 1024 * 1024 + 1);
    big.set(PNG);
    expect(checkDocument(big)).toEqual({ ok: false, code: "too-large" });
  });
});

describe("application validation", () => {
  const check = (raw: Partial<RawApplication>) =>
    validateApplication({ ...valid, ...raw }, OPTIONS);

  it("accepts the website form with any email domain and normalises it", () => {
    const result = check({
      fullName: "  Aisha Al-Hinai ",
      email: " Aisha.AlHinai@Gmail.COM ",
    });
    expect(result).toEqual({
      ok: true,
      value: {
        fullName: "Aisha Al-Hinai",
        email: "aisha.alhinai@gmail.com",
        category: "university_student",
        institutionId: "utas",
        institutionName: null,
        academicYear: 2,
        discipline: "civil",
        interests: ["cad", "data"],
        consentVersion: "2026-11-v2",
      },
    });
  });

  it("accepts Arabic names, apostrophes and hyphens (UC-01)", () => {
    for (const fullName of ["عائشة بنت سالم", "Ma'mun Al-Rawahi"]) {
      expect(check({ fullName }).ok).toBe(true);
    }
  });

  it("asks students for an institution and a year, with a typed name for an unlisted university", () => {
    expect(check({ institution: null })).toMatchObject({
      ok: false,
      errors: [{ field: "institution", code: "required" }],
    });
    expect(check({ academicYear: null })).toMatchObject({
      ok: false,
      errors: [{ field: "academicYear", code: "required" }],
    });
    expect(check({ institution: "mit" })).toMatchObject({
      ok: false,
      errors: [{ field: "institution", code: "invalid" }],
    });
    expect(check({ institution: "other" })).toMatchObject({
      ok: false,
      errors: [{ field: "institutionName", code: "required" }],
    });
    expect(
      check({ institution: "other", institutionName: "  ETH Zürich  " })
    ).toMatchObject({
      ok: true,
      value: { institutionId: null, institutionName: "ETH Zürich" },
    });
  });

  it("drops details a category does not collect instead of failing on them", () => {
    // A professional who first picked "student" leaves a year and a university behind.
    expect(
      check({
        category: "industry_professional",
        institution: "other",
        institutionName: "X",
        academicYear: "9",
      })
    ).toMatchObject({
      ok: true,
      value: { institutionId: null, institutionName: null, academicYear: null },
    });
    expect(
      check({ category: "graduate", institution: null, academicYear: "3" })
    ).toMatchObject({
      ok: true,
      value: { institutionId: null, academicYear: null },
    });
    expect(check({ category: "graduate", institution: "squ" })).toMatchObject({
      ok: true,
      value: { institutionId: "squ" },
    });
  });

  it("names every field that needs attention", () => {
    const result = validateApplication(
      {
        fullName: " ",
        email: "not-an-email",
        category: "astronaut",
        institution: null,
        institutionName: null,
        academicYear: null,
        discipline: "aerospace",
        interests: ["cad", "cad"],
        consent: null,
        consentVersion: null,
      },
      OPTIONS
    );
    expect(result).toEqual({
      ok: false,
      errors: [
        { field: "fullName", code: "required" },
        { field: "email", code: "invalid" },
        { field: "category", code: "invalid" },
        { field: "discipline", code: "invalid" },
        { field: "interests", code: "invalid" },
        { field: "consent", code: "required" },
      ],
    });
  });

  it("rejects malformed addresses, too many interests and unknown consent wordings", () => {
    for (const email of ["x@localhost", "two@@at.example", "space d@x.example"])
      expect(check({ email })).toMatchObject({ ok: false });
    expect(
      check({ interests: ["cad", "data", "power", "hse", "quality"] })
    ).toMatchObject({ ok: false });
    expect(check({ consentVersion: "prototype" })).toMatchObject({
      ok: false,
      errors: [{ field: "consent", code: "invalid" }],
    });
    // The previous website's wording stays valid during a release.
    expect(check({ consentVersion: "2026-10-v1" }).ok).toBe(true);
  });
});

describe("status tokens", () => {
  it("are 256-bit, URL-safe, and stored only as a SHA-256 hash", () => {
    const token = createStatusToken();
    expect(isStatusToken(token)).toBe(true);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(hashStatusToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashStatusToken(token)).not.toContain(token);
    expect(createStatusToken()).not.toBe(token);
    expect(isStatusToken("../../etc")).toBe(false);
    expect(isStatusToken(42)).toBe(false);
  });
});
