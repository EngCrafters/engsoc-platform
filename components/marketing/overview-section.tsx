import Image from "next/image";
import Link from "next/link";
import { OVERVIEW } from "@/content/overview";
import { getI18n } from "@/lib/i18n/server";
import { IconArrowRight } from "./icons";
import { Reveal } from "./reveal";

/** The society, in its own words, over its own photograph. */
export async function OverviewSection({
  showLink = true,
}: {
  showLink?: boolean;
}) {
  const { t, l } = await getI18n();

  return (
    <section
      id="overview"
      className="relative overflow-hidden bg-m-navy text-white"
    >
      <Image
        src={OVERVIEW.backdrop.src}
        alt=""
        width={OVERVIEW.backdrop.width}
        height={OVERVIEW.backdrop.height}
        sizes="100vw"
        className="absolute inset-0 size-full object-cover opacity-25"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[linear-gradient(180deg,rgb(13_36_87/0.72),rgb(9_24_56/0.92))]"
      />
      <div className="relative mx-auto max-w-[var(--m-content-max)] px-5 py-20 sm:px-8 sm:py-28">
        <Reveal>
          <h2 className="max-w-[24ch] text-[clamp(2rem,1.5rem+2vw,3.25rem)] font-semibold">
            {l(OVERVIEW.heading)}
          </h2>
        </Reveal>
        <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-16">
          <div className="grid gap-5 text-white/85">
            {OVERVIEW.paragraphs.map((paragraph, index) => (
              <p key={index} className="max-w-[var(--m-measure)]">
                {l(paragraph)}
              </p>
            ))}
            {showLink ? (
              <Link
                href="/about"
                className="mt-2 inline-flex w-fit min-h-12 items-center gap-2 rounded-m-button border border-white/30 px-6 font-semibold transition-colors hover:border-white/70"
              >
                {t.overview.more}
                <IconArrowRight className="size-4" />
              </Link>
            ) : null}
          </div>
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-1">
            {OVERVIEW.points.map((point) => (
              <li key={point.id} className="border-s-2 border-white/25 ps-4">
                <p className="font-semibold">{l(point.title)}</p>
                <p className="mt-1 text-sm text-white/75">{l(point.body)}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
