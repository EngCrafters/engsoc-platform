"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_STORAGE_KEY,
  i18nFor,
  isLocale,
  type Locale,
} from "@/lib/i18n";
import type { I18n } from "@/lib/i18n";

/**
 * Client half of the language system.
 *
 * The server resolves the locale from a cookie and renders the right language
 * and direction, so a returning Arabic visitor never sees English first. This
 * provider supplies the same `{ t, l, locale, dir, intl }` shape to client
 * components, and switching writes the cookie then refreshes the server
 * component tree — no reload, no lost scroll position, no flash.
 */

const I18nContext = createContext<I18n | null>(null);
const SwitchContext = createContext<{
  switchLocale: (next: Locale) => void;
  pending: boolean;
} | null>(null);

function saveLocale(next: Locale) {
  document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
  } catch {
    // Private modes can refuse storage; the cookie above is the source of truth.
  }
}

function hasLocaleCookie() {
  return document.cookie
    .split("; ")
    .some((entry) => entry.startsWith(`${LOCALE_COOKIE}=`));
}

export function I18nProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const value = i18nFor(locale);
  const restored = useRef(false);

  // If the cookie was cleared but localStorage still remembers the choice,
  // restore it once so the visitor is not silently reset to English.
  useEffect(() => {
    if (restored.current || hasLocaleCookie()) return;
    restored.current = true;
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    } catch {
      return;
    }
    if (isLocale(saved) && saved !== locale) {
      saveLocale(saved);
      startTransition(() => router.refresh());
    }
  }, [locale, router]);

  const switchLocale = useCallback(
    (next: Locale) => {
      if (next === locale) return;
      saveLocale(next);
      startTransition(() => router.refresh());
    },
    [locale, router]
  );

  return (
    <I18nContext.Provider value={value}>
      <SwitchContext.Provider value={{ switchLocale, pending }}>
        {children}
      </SwitchContext.Provider>
    </I18nContext.Provider>
  );
}

export function useI18n(): I18n {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside I18nProvider");
  return value;
}

export function useLocaleSwitch() {
  const value = useContext(SwitchContext);
  if (!value)
    throw new Error("useLocaleSwitch must be used inside I18nProvider");
  return value;
}

export { DEFAULT_LOCALE };
