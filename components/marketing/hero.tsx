import Link from "next/link";
import { getI18n } from "@/lib/i18n/server";
import { IconArrowRight } from "./icons";
import { HeroArt } from "./hero-art";

/** The landing hero: what the society is, in one sentence, and two ways in. */
export async function Hero() {
  const { t } = await getI18n();

  return (
    <section className="relative overflow-hidden pt-[calc(var(--m-nav-height)+var(--m-nav-offset)+2.5rem)] pb-16 sm:pb-20 lg:pt-[calc(var(--m-nav-height)+var(--m-nav-offset)+4rem)] lg:pb-24">
      <div className="mx-auto grid max-w-[var(--m-content-max)] items-center gap-12 px-5 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-8">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-m-brand">
            {t.site.eyebrow}
          </p>
          <h1
            id="hero-title"
            className="mt-4 text-[clamp(2.75rem,1.55rem+4.6vw,5.5rem)] font-semibold text-balance"
          >
            <span className="block">{t.hero.titleStart}</span>
            <span className="block text-m-brand">{t.hero.titleEnd}</span>
          </h1>
          <p className="mt-6 max-w-[var(--m-measure)] text-[clamp(1.05rem,1rem+0.4vw,1.3rem)] text-m-ink-2">
            {t.hero.lead}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/events"
              className="inline-flex min-h-12 items-center gap-2 rounded-m-button bg-m-brand px-6 font-semibold text-white transition-colors hover:bg-m-brand-hover"
            >
              {t.hero.exploreEvents}
              <IconArrowRight className="size-4" />
            </Link>
            <Link
              href="/#projects"
              className="inline-flex min-h-12 items-center gap-2 rounded-m-button border border-m-border-strong bg-m-surface px-6 font-semibold text-m-ink transition-colors hover:border-m-brand hover:text-m-brand"
            >
              {t.hero.discoverProjects}
            </Link>
          </div>
        </div>

        <div className="relative">
          <HeroArt />
          <p className="mt-6 text-center text-sm text-m-ink-2 lg:text-start">
            {t.hero.caption}
          </p>
        </div>
      </div>
    </section>
  );
}
