"use client";

import { LOCALES, LOCALE_NAME, type Locale } from "@/lib/i18n";
import { useI18n, useLocaleSwitch } from "./i18n-provider";

/**
 * Language switch. A single control with two states: at narrow widths the
 * inactive language's own name is the target, which is what a visitor looks
 * for; from 80rem both names are shown.
 *
 * It is a real button group rather than a link, because switching does not
 * navigate — it re-renders the current route on the server.
 */
export function LanguageSwitch({
  variant = "bar",
}: {
  variant?: "bar" | "panel";
}) {
  const { locale, t } = useI18n();
  const { switchLocale, pending } = useLocaleSwitch();
  const other = LOCALES.find((candidate) => candidate !== locale) ?? LOCALES[0];

  if (variant === "panel") {
    return (
      <div
        className="flex items-center gap-2"
        role="group"
        aria-label={t.nav.language}
      >
        {LOCALES.map((candidate) => (
          <button
            key={candidate}
            type="button"
            lang={candidate}
            aria-current={candidate === locale ? "true" : undefined}
            disabled={pending}
            onClick={() => switchLocale(candidate as Locale)}
            className="min-h-11 min-w-11 rounded-m-button border border-m-border bg-m-surface px-3 text-sm font-medium aria-current:border-m-brand aria-current:bg-m-brand-soft aria-current:text-m-brand disabled:opacity-60"
          >
            {LOCALE_NAME[candidate]}
          </button>
        ))}
      </div>
    );
  }

  return (
    <button
      type="button"
      lang={other}
      disabled={pending}
      onClick={() => switchLocale(other as Locale)}
      title={t.nav.switchTo}
      className="grid size-10 place-items-center rounded-full text-sm font-semibold text-m-ink-2 transition-colors hover:bg-m-brand-soft hover:text-m-brand disabled:opacity-60 sm:size-11"
    >
      <span aria-hidden="true">{other === "ar" ? "ع" : "EN"}</span>
      <span className="sr-only">{t.nav.switchTo}</span>
    </button>
  );
}
