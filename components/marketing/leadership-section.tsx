import Link from "next/link";
import { LEADERSHIP, SENIOR_LEADERSHIP } from "@/content/structure";
import { getI18n } from "@/lib/i18n/server";
import { IconArrowRight } from "./icons";

/**
 * Senior leadership.
 *
 * No roster has been supplied, so every position renders as an intentional
 * vacant placeholder rather than an invented name. That is the honest state and
 * the section says so in words as well.
 */
export async function LeadershipSection() {
  const { t, l } = await getI18n();
  const positions = [LEADERSHIP.president, ...LEADERSHIP.vicePresidents];

  return (
    <section
      id="leadership"
      aria-labelledby="leadership-title"
      className="bg-m-surface-soft"
    >
      <div className="mx-auto max-w-[var(--m-content-max)] px-5 py-20 sm:px-8 sm:py-24">
        <h2
          id="leadership-title"
          className="max-w-[22ch] text-[clamp(2rem,1.5rem+2vw,3.25rem)] font-semibold"
        >
          {t.leadership.title}
        </h2>
        <p className="mt-4 max-w-[var(--m-measure)] text-sm text-m-ink-2">
          <strong className="font-semibold text-m-ink">
            {t.leadership.rosterStrong}
          </strong>{" "}
          {t.leadership.rosterBody}
        </p>

        <ul
          aria-label={l(SENIOR_LEADERSHIP)}
          className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4"
        >
          {positions.map((position) => (
            <li
              key={position.id}
              className="rounded-m-card border border-m-border bg-m-surface p-5 text-center"
            >
              <span
                aria-hidden="true"
                className="mx-auto grid size-24 place-items-center rounded-[50%_50%_50%_0] border border-dashed border-m-border-strong bg-m-surface-soft"
              >
                <span className="text-2xl text-m-border-strong">{"●"}</span>
              </span>
              <p className="mt-4 font-semibold">{l(position.title)}</p>
              <p className="mt-1 text-sm text-m-ink-2">
                {position.holder
                  ? l(position.holder.name)
                  : t.leadership.nameToBeAnnounced}
              </p>
            </li>
          ))}
        </ul>

        <Link
          href="/about#structure"
          className="mt-10 inline-flex min-h-12 items-center gap-2 rounded-m-button border border-m-border-strong bg-m-surface px-6 font-semibold transition-colors hover:border-m-brand hover:text-m-brand"
        >
          {t.leadership.viewStructure}
          <IconArrowRight className="size-4" />
        </Link>
      </div>
    </section>
  );
}
