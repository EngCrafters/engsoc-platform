import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/membership/db", () => ({
  submitThroughRoutine: vi.fn(),
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

const valid = {
  fullName: "Aisha Al-Hinai",
  email: "s123456@student.squ.edu.om",
  universityId: "123456",
  academicYear: "2",
  discipline: "civil",
  interests: ["cad", "data"],
  consent: "true",
  consentVersion: "2026-10-v1",
  document: PNG,
};

describe("SQU ID card content checks", () => {
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
  it("accepts the website form and normalises it", () => {
    const result = validateApplication({
      ...valid,
      fullName: "  Aisha Al-Hinai ",
      email: " S123456@SQU.EDU.OM ",
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        fullName: "Aisha Al-Hinai",
        email: "s123456@squ.edu.om",
        academicYear: 2,
        document: { mediaType: "image/png" },
      },
    });
  });

  it("accepts Arabic names, apostrophes and hyphens (UC-01)", () => {
    for (const fullName of ["عائشة بنت سالم", "Ma'mun Al-Rawahi"]) {
      expect(validateApplication({ ...valid, fullName }).ok).toBe(true);
    }
  });

  it("names every field that needs attention", () => {
    const result = validateApplication({
      fullName: " ",
      email: "someone@gmail.com",
      universityId: "12a4",
      academicYear: "7",
      discipline: "aerospace",
      interests: ["cad", "cad"],
      consent: null,
      consentVersion: null,
      document: bytes("GIF89a"),
    });
    expect(result).toEqual({
      ok: false,
      errors: [
        { field: "fullName", code: "required" },
        { field: "email", code: "invalid" },
        { field: "universityId", code: "invalid" },
        { field: "academicYear", code: "invalid" },
        { field: "discipline", code: "invalid" },
        { field: "interests", code: "invalid" },
        { field: "consent", code: "required" },
        { field: "idDocument", code: "unsupported-type" },
      ],
    });
  });

  it("rejects look-alike domains, too many interests and unknown consent wordings", () => {
    expect(
      validateApplication({ ...valid, email: "x@squ.edu.om.evil.example" })
    ).toMatchObject({ ok: false });
    expect(
      validateApplication({ ...valid, email: "x@notsqu.edu.om" })
    ).toMatchObject({ ok: false });
    expect(
      validateApplication({
        ...valid,
        interests: ["cad", "data", "power", "hse", "quality"],
      })
    ).toMatchObject({ ok: false });
    expect(
      validateApplication({ ...valid, consentVersion: "prototype" })
    ).toMatchObject({
      ok: false,
      errors: [{ field: "consent", code: "invalid" }],
    });
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
