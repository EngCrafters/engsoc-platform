import { describe, expect, it } from "vitest";
import {
  CANONICAL_PHONE_PATTERN,
  canonicalizePhone,
  isCanonicalPhone,
} from "@/lib/registrations/phone";

/**
 * The canonical phone contract.
 *
 * These cases are the TypeScript half of a rule that also exists in SQL
 * (private.normalize_phone and the registrations_phone_canonical CHECK in
 * db/migrations/0024). The database suite asserts the same shapes against the
 * real routine, so a change that drifts one layer away from the other fails
 * here, there, or both.
 */

describe("canonicalizePhone", () => {
  it.each([
    ["plain digits", "96891234567", "96891234567"],
    ["leading plus", "+96891234567", "+96891234567"],
    ["local-looking number with no country code", "91234567", "91234567"],
    ["spaces", "+968 9123 4567", "+96891234567"],
    ["non-breaking spaces", "+968\u00a09123\u00a04567", "+96891234567"],
    ["hyphens", "+968-9123-4567", "+96891234567"],
    ["typographic dashes", "+968\u20139123\u20144567", "+96891234567"],
    ["parentheses", "+968 (9123) 4567", "+96891234567"],
    ["dots", "+968.9123.4567", "+96891234567"],
    ["a mix of separators", " (+968) 9123-45.67 ", "+96891234567"],
    ["a leading zero, which must survive", "0912345678", "0912345678"],
    ["an internal zero", "+9680912345", "+9680912345"],
    ["the shortest accepted length", "1234567", "1234567"],
    [
      "the longest accepted length (E.164)",
      "+123456789012345",
      "+123456789012345",
    ],
  ])("normalizes %s", (_label, input, expected) => {
    expect(canonicalizePhone(input)).toBe(expected);
  });

  it.each([
    ["an empty string", ""],
    ["whitespace only", "   "],
    ["a non-string", null],
    ["a number", 96891234567],
    ["one digit too few", "123456"],
    ["one digit too many", "+1234567890123456"],
    ["letters", "+968abc4567"],
    ["letters smuggled in as text around a number", "call me on 96891234567"],
    ["Arabic letters", "هاتف"],
    ["two leading pluses", "++96891234567"],
    ["a plus in the middle", "+968+91234567"],
    ["a plus at the end", "96891234567+"],
    ["control characters", "96891\u0000234567"],
    ["a newline", "96891\n234567"],
    [
      "full-width digits",
      "\uff19\uff16\uff18\uff19\uff11\uff12\uff13\uff14\uff15\uff16\uff17",
    ],
    ["far too long to be worth parsing", "+" + "9".repeat(200)],
  ])("rejects %s", (_label, input) => {
    expect(canonicalizePhone(input)).toBeNull();
  });

  it("accepts Arabic-Indic digits and stores them as ASCII", () => {
    // A number typed on an Arabic keyboard. U+0660..U+0669.
    expect(
      canonicalizePhone(
        "\u0669\u0666\u0668\u0669\u0661\u0662\u0663\u0664\u0665\u0666\u0667"
      )
    ).toBe("96891234567");
  });

  it("accepts Eastern Arabic-Indic digits and stores them as ASCII", () => {
    // The Persian/Urdu forms. U+06F0..U+06F9.
    expect(
      canonicalizePhone(
        "\u06f9\u06f6\u06f8\u06f9\u06f1\u06f2\u06f3\u06f4\u06f5\u06f6\u06f7"
      )
    ).toBe("96891234567");
  });

  it("accepts Arabic-Indic digits mixed with a plus and separators", () => {
    expect(
      canonicalizePhone(
        "+\u0669\u0666\u0668 \u0669\u0661\u0662\u0663-\u0664\u0665\u0666\u0667"
      )
    ).toBe("+96891234567");
  });

  it("normalizes the same value no matter how it was typed", () => {
    const variants = [
      "+96891234567",
      "+968 9123 4567",
      "+968-9123-4567",
      "+968 (9123) 4567",
      "  +968.9123.4567  ",
      "+\u0669\u0666\u0668\u0669\u0661\u0662\u0663\u0664\u0665\u0666\u0667",
    ];
    const results = new Set(variants.map((value) => canonicalizePhone(value)));
    expect(results.size).toBe(1);
    expect([...results][0]).toBe("+96891234567");
  });
});

describe("isCanonicalPhone and the canonical pattern", () => {
  it("agrees with canonicalizePhone on what a stored value may look like", () => {
    for (const value of [
      "+96891234567",
      "96891234567",
      "0912345678",
      "1234567",
    ]) {
      expect(canonicalizePhone(value)).toBe(value);
      expect(isCanonicalPhone(value)).toBe(true);
    }
  });

  it("anchors at both ends, so a canonical value cannot carry extra content", () => {
    expect(CANONICAL_PHONE_PATTERN.test("+96891234567 and more")).toBe(false);
    expect(CANONICAL_PHONE_PATTERN.test("+968 9123 4567")).toBe(false);
  });
});
