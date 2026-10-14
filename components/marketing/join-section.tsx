import Link from "next/link";
import { getI18n } from "@/lib/i18n/server";
import { IconArrowRight } from "./icons";

/**
 * The closing invitation.
 *
 * Membership registration genuinely does not exist yet (UC-01 is deferred), so
 * this states that plainly and offers the one real action available: browse
 * events. It deliberately does not render a button that opens a dialog
 * explaining that nothing happens — an affordance that does nothing reads as a
 * broken feature, not as an honest placeholder.
 */
export async function JoinSection() {
  const { t } = await getI18n();

  return (
    <section
      id="join"
      aria-labelledby="join-title"
      className="on-dark bg-m-navy text-white"
    >
      <div className="mx-auto max-w-[var(--m-content-max)] px-5 py-20 sm:px-8 sm:py-24">
        <h2
          id="join-title"
          className="max-w-[20ch] text-[clamp(2rem,1.5rem+2vw,3.25rem)] font-semibold"
        >
          {t.join.title}
        </h2>
        <p className="mt-5 max-w-[var(--m-measure)] text-white/85">
          {t.join.body}
        </p>

        <div className="mt-9 flex flex-wrap gap-3">
          <Link
            href="/events"
            className="inline-flex min-h-12 items-center gap-2 rounded-m-button bg-m-brand px-6 font-semibold text-white transition-colors hover:bg-m-brand-hover"
          >
            {t.join.exploreEvents}
            <IconArrowRight className="size-4" />
          </Link>
        </div>

        <ol className="mt-12 grid gap-4 sm:grid-cols-3">
          {t.join.dialogSteps.map((step, index) => (
            <li
              key={index}
              className="border-t border-white/20 pt-4 text-sm text-white/80"
            >
              <span className="me-2 font-semibold text-white">
                {index + 1}.
              </span>
              {step}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
