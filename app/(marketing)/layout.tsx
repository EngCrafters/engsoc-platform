import type { Metadata } from "next";
import { IBM_Plex_Sans_Arabic, Manrope, Space_Grotesk } from "next/font/google";
import "./marketing.css";
import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";
import { I18nProvider } from "@/components/marketing/i18n-provider";
import { getI18n } from "@/lib/i18n/server";

/**
 * The public site's shell.
 *
 * Language and direction are applied here, on the marketing subtree, rather
 * than on <html>. The admin area in the same application is English-only and
 * must not inherit a right-to-left direction from a visitor's public language
 * choice, so the switch is contained where it belongs.
 *
 * The three faces are loaded here too: the admin shell keeps Geist, and the
 * public identity gets its own display and body faces plus an Arabic face.
 */
const display = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

const body = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-marketing-body",
  display: "swap",
});

const arabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic"],
  weight: ["400", "500", "600"],
  variable: "--font-arabic",
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const { t, locale } = await getI18n();
  return {
    title: t.meta.title,
    description: t.meta.description,
    openGraph: {
      title: t.meta.title,
      description: t.meta.description,
      locale: locale === "ar" ? "ar_OM" : "en_GB",
      type: "website",
    },
  };
}

export default async function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { t, locale, dir } = await getI18n();

  return (
    <I18nProvider locale={locale}>
      <div
        lang={locale}
        dir={dir}
        className={`marketing-surface flex min-h-full flex-col ${display.variable} ${body.variable} ${arabic.variable}`}
        style={{
          fontFamily:
            "var(--font-marketing-body), ui-sans-serif, system-ui, sans-serif",
        }}
      >
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-[60] focus:rounded-m-button focus:bg-m-brand focus:px-4 focus:py-2 focus:font-semibold focus:text-white"
        >
          {t.common.skipToContent}
        </a>
        <SiteHeader />
        <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">
          {children}
        </main>
        <SiteFooter />
      </div>
    </I18nProvider>
  );
}
