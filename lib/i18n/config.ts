/**
 * Language settings shared by server and client. English is the default; a visitor's choice
 * is kept in a cookie so the server renders their language (and direction) on the next visit.
 */

export const LOCALES = ["en", "ar"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "es-locale";
export const LOCALE_STORAGE_KEY = "es-locale";
/** One year: the choice persists across visits. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const DIRECTION: Record<Locale, "ltr" | "rtl"> = {
  en: "ltr",
  ar: "rtl",
};

/** Intl locale for dates and numbers. Arabic keeps Western digits, as on the society's own materials. */
export const INTL_LOCALE: Record<Locale, string> = {
  en: "en-GB",
  ar: "ar-OM-u-nu-latn",
};

/** The language's own name, shown in the switcher. */
export const LOCALE_NAME: Record<Locale, string> = {
  en: "English",
  ar: "العربية",
};

/** Visible text that exists in both languages. Content files use this for anything shown. */
export type Localized<T = string> = Record<Locale, T>;

export function isLocale(value: unknown): value is Locale {
  return (
    typeof value === "string" && (LOCALES as readonly string[]).includes(value)
  );
}
