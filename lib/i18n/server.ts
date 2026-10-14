import { cookies } from "next/headers";
import { cache } from "react";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  i18nFor,
  isLocale,
  type Locale,
} from "./index";

/**
 * The visitor's language for this request: their saved choice, otherwise English. Reading the
 * cookie renders pages per request, which is what lets a returning Arabic visitor receive
 * Arabic, right-to-left HTML with no English flash before hydration.
 */
export const getLocale = cache(async (): Promise<Locale> => {
  const saved = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(saved) ? saved : DEFAULT_LOCALE;
});

/** Server Components: `const { t, l, locale } = await getI18n()`. */
export const getI18n = cache(async () => i18nFor(await getLocale()));
