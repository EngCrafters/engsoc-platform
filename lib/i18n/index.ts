import { ar } from "./dictionaries/ar";
import { en, type Dictionary } from "./dictionaries/en";
import { DIRECTION, INTL_LOCALE, type Locale, type Localized } from "./config";

export * from "./config";
export type { Dictionary };

const DICTIONARIES: Record<Locale, Dictionary> = { en, ar };

export interface I18n {
  locale: Locale;
  dir: "ltr" | "rtl";
  /** Interface copy for this language. */
  t: Dictionary;
  /** Picks this language's value from a piece of bilingual content. */
  l: <T>(value: Localized<T>) => T;
  /** Intl locale string for dates and numbers. */
  intl: string;
}

const cache = new Map<Locale, I18n>();

/** The same shape on the server (getI18n) and in client components (useI18n). */
export function i18nFor(locale: Locale): I18n {
  let value = cache.get(locale);
  if (!value) {
    value = {
      locale,
      dir: DIRECTION[locale],
      t: DICTIONARIES[locale],
      l: (v) => v[locale],
      intl: INTL_LOCALE[locale],
    };
    cache.set(locale, value);
  }
  return value;
}
