import Image from "next/image";
import Link from "next/link";
import { FOOTER_SOCIAL_ACCOUNTS } from "@/content/social";
import { SITE } from "@/content/site";
import { getI18n } from "@/lib/i18n/server";
import { SocialIcon } from "./SocialIcon";

/** The public footer: society identity, where to follow it, and the way to committee sign-in. */
export async function SiteFooter() {
  const { t, l } = await getI18n();
  const year = new Date().getFullYear();

  return (
    <footer className="on-dark mt-24 bg-m-navy text-white" data-part="footer">
      <div className="mx-auto grid max-w-[var(--m-content-max)] gap-10 px-5 py-14 sm:px-8 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] md:py-16">
        <div>
          <div className="flex items-center gap-3">
            <Image
              src="/brand/es-emblem.webp"
              alt=""
              width={256}
              height={256}
              className="size-12"
            />
            <div className="leading-tight">
              <p className="font-semibold">{t.site.name}</p>
              <p className="text-sm text-white/70">{t.site.affiliation}</p>
            </div>
          </div>
          <p className="mt-5 max-w-[var(--m-measure)] text-white/80">
            {t.footer.tagline}
          </p>

          <p className="mt-7 text-sm font-semibold uppercase tracking-wide text-white/60">
            {t.footer.follow}
          </p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {FOOTER_SOCIAL_ACCOUNTS.map((account) =>
              account.href ? (
                <li key={account.platform}>
                  <a
                    href={account.href}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/25 px-4 text-sm font-medium transition-colors hover:border-white/60"
                  >
                    <SocialIcon
                      platform={account.platform}
                      className="size-4"
                    />
                    {l(account.label)}
                    <span className="sr-only">{t.common.opensInNewTab}</span>
                  </a>
                </li>
              ) : (
                // No verified URL exists yet. The account is named, marked, and
                // never turned into a link to a guessed address.
                <li key={account.platform}>
                  <span className="inline-flex min-h-11 items-center gap-2 rounded-full border border-dashed border-white/25 px-4 text-sm text-white/60">
                    <SocialIcon
                      platform={account.platform}
                      className="size-4"
                    />
                    {l(account.label)}
                    <span className="text-xs">· {t.footer.linkToCome}</span>
                  </span>
                </li>
              )
            )}
          </ul>
        </div>

        <nav aria-label={t.footer.navLabel}>
          <ul className="grid gap-1">
            <li>
              <Link
                href="/events"
                className="inline-flex min-h-11 items-center text-white/85 hover:text-white"
              >
                {t.nav.links.events}
              </Link>
            </li>
            <li>
              <Link
                href="/#activities"
                className="inline-flex min-h-11 items-center text-white/85 hover:text-white"
              >
                {t.nav.links.activities}
              </Link>
            </li>
            <li>
              <Link
                href="/#projects"
                className="inline-flex min-h-11 items-center text-white/85 hover:text-white"
              >
                {t.nav.links.projects}
              </Link>
            </li>
            <li>
              <Link
                href="/#disciplines"
                className="inline-flex min-h-11 items-center text-white/85 hover:text-white"
              >
                {t.nav.links.disciplines}
              </Link>
            </li>
            <li>
              <Link
                href="/about"
                className="inline-flex min-h-11 items-center text-white/85 hover:text-white"
              >
                {t.nav.links.about}
              </Link>
            </li>
            {SITE.signInUrl ? (
              <li>
                <Link
                  href={SITE.signInUrl}
                  className="inline-flex min-h-11 items-center text-white/85 hover:text-white"
                >
                  {t.nav.signIn}
                </Link>
              </li>
            ) : null}
          </ul>
        </nav>
      </div>

      <div className="border-t border-white/15">
        <div className="mx-auto flex max-w-[var(--m-content-max)] flex-col gap-2 px-5 py-6 text-sm text-white/60 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <p>{t.footer.copyright(year, t.site.name, t.site.affiliation)}</p>
          <p>{t.footer.previewSite}</p>
        </div>
      </div>
    </footer>
  );
}
