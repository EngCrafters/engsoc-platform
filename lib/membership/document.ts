import {
  MAX_DOCUMENT_BYTES,
  type DocumentMediaType,
  type FieldCode,
} from "./types";

/**
 * Validation of an uploaded SQU ID card by its CONTENT.
 *
 * The browser's declared type and the file name are attacker-controlled, so
 * neither decides anything here: the media type is read from the file's own
 * signature. Only JPEG, PNG, WebP and PDF are accepted, and the stored type is
 * the sniffed one, so a reviewer's browser is never told to treat bytes as
 * something they are not.
 */

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) =>
  bytes.length >= offset + signature.length &&
  signature.every((byte, index) => bytes[offset + index] === byte);

const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));

/** The media type the bytes actually are, or null for anything else. */
export function sniffDocumentType(bytes: Uint8Array): DocumentMediaType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return "image/png";
  if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8))
    return "image/webp";
  if (startsWith(bytes, ascii("%PDF-"))) return "application/pdf";
  return null;
}

/**
 * PDF features with no place in a scanned ID card, which a viewer could act on:
 * scripts, launch actions, embedded files and auto-run actions. A card exported
 * from a phone or scanner contains none of them.
 */
const ACTIVE_PDF_MARKERS = [
  "/JavaScript",
  "/JS",
  "/Launch",
  "/EmbeddedFile",
  "/OpenAction",
  "/AA",
  "/RichMedia",
  "/XFA",
];

export function hasActivePdfContent(bytes: Uint8Array): boolean {
  // Latin-1 keeps every byte as one character, so markers are found exactly.
  const text = Buffer.from(bytes).toString("latin1");
  return ACTIVE_PDF_MARKERS.some((marker) => {
    let from = 0;
    for (;;) {
      const at = text.indexOf(marker, from);
      if (at === -1) return false;
      // A PDF name ends at whitespace, a delimiter, or end of data:
      // "/JS" must not match "/JSONFoo", but must match "/JS (" or "/JS<<".
      const next = text.charCodeAt(at + marker.length);
      if (Number.isNaN(next) || !/[A-Za-z0-9]/.test(String.fromCharCode(next)))
        return true;
      from = at + marker.length;
    }
  });
}

export type DocumentCheck =
  { ok: true; mediaType: DocumentMediaType } | { ok: false; code: FieldCode };

export function checkDocument(bytes: Uint8Array | null): DocumentCheck {
  if (!bytes || bytes.byteLength === 0) return { ok: false, code: "required" };
  if (bytes.byteLength > MAX_DOCUMENT_BYTES)
    return { ok: false, code: "too-large" };
  const mediaType = sniffDocumentType(bytes);
  if (!mediaType) return { ok: false, code: "unsupported-type" };
  if (mediaType === "application/pdf" && hasActivePdfContent(bytes))
    return { ok: false, code: "unsupported-type" };
  return { ok: true, mediaType };
}
