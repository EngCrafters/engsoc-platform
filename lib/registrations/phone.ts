/**
 * The single definition of "a phone number we will store".
 *
 * Two layers enforce this contract and they must not drift:
 *
 *   * this module, used by the registration domain and the Server Action, and
 *   * `private.normalize_phone` in db/migrations/0024_registration_attendee_phone.sql,
 *     used by `private.register_for_event`, plus the
 *     `registrations_phone_canonical` CHECK that permits only the canonical
 *     shape on the column itself.
 *
 * The rule is intentionally identical in both places:
 *
 *   1. Arabic-Indic and Eastern Arabic-Indic digits become ASCII, so a number
 *      typed on an Arabic keyboard is accepted instead of silently rejected.
 *   2. A letter or a control character makes the value invalid. They are
 *      refused, never stripped: quietly reading "call me on 968..." as a phone
 *      number would be worse than saying no.
 *   3. Every remaining character that is not a digit or a plus is presentation
 *      formatting — spaces, non-breaking spaces, hyphens, parentheses, dots,
 *      slashes — and is removed, so a person can type the number the way they
 *      write it.
 *   4. What is left must be an optional leading "+" followed by 7 to 15 digits.
 *      Fifteen is the E.164 maximum; seven is the shortest national number in
 *      common use. Deliberately not country-specific: registration is open to
 *      anyone, not only to Omani numbers.
 *
 * No library is used. A well-known phone-number package would be a large
 * dependency for a rule this small, and its metadata would still not tell us
 * which countries our visitors are in.
 */

/** The canonical stored shape. Mirrored by the SQL CHECK and normalize_phone. */
export const CANONICAL_PHONE_PATTERN = /^[+]?[0-9]{7,15}$/;

/** Digit-count bounds, excluding any leading "+". */
export const PHONE_MIN_DIGITS = 7;
export const PHONE_MAX_DIGITS = 15;

/**
 * Bounded work: anything longer than this cannot become a valid number, so it
 * is rejected before any regular expression runs over it.
 */
const MAX_INPUT_LENGTH = 64;

const ARABIC_INDIC_DIGITS = /[\u0660-\u0669\u06F0-\u06F9]/g;

const DIGIT_TRANSLATION: Record<string, string> = {
  "\u0660": "0",
  "\u0661": "1",
  "\u0662": "2",
  "\u0663": "3",
  "\u0664": "4",
  "\u0665": "5",
  "\u0666": "6",
  "\u0667": "7",
  "\u0668": "8",
  "\u0669": "9",
  "\u06F0": "0",
  "\u06F1": "1",
  "\u06F2": "2",
  "\u06F3": "3",
  "\u06F4": "4",
  "\u06F5": "5",
  "\u06F6": "6",
  "\u06F7": "7",
  "\u06F8": "8",
  "\u06F9": "9",
};

/**
 * Normalize user input to the canonical stored form, or return `null` when the
 * value is not a phone number. Returning `null` rather than throwing keeps the
 * caller's error vocabulary in the caller's hands.
 */
export function canonicalizePhone(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (raw.length > MAX_INPUT_LENGTH) return null;

  // 1. Arabic-Indic digits become ASCII.
  let value = raw.replace(
    ARABIC_INDIC_DIGITS,
    (digit) => DIGIT_TRANSLATION[digit] ?? digit
  );
  value = value.trim();
  if (value.length === 0) return null;

  // 2. Refuse letters (any script) and control characters.
  if (/\p{L}/u.test(value)) return null;
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;

  // 3. Drop presentation formatting.
  const digits = value.replace(/[^0-9+]/g, "");

  // 4. Require the canonical shape.
  if (!CANONICAL_PHONE_PATTERN.test(digits)) return null;
  return digits;
}

/** True when a value is already in the canonical stored form. */
export function isCanonicalPhone(value: string): boolean {
  return CANONICAL_PHONE_PATTERN.test(value);
}
