import Link from "next/link";
import { ACTIVITIES } from "@/content/activities";
import { getI18n } from "@/lib/i18n/server";

/**
 * The archive has no editions yet, and says so — with a useful list of the
 * programmes it will eventually hold, rather than an empty grid or a spinner.
 */
export async function ArchiveEmpty() {
  const { t, locale } = await getI18n();

  return (
    <div className="rounded-m-card border border-dashed border-m-border-strong bg-m-surface p-8 sm:p-10">
      <h2 className="text-xl font-semibold">{t.archive.emptyTitle}</h2>
      <p className="mt-3 max-w-[var(--m-measure)] text-m-ink-2">
        {t.archive.emptyBody}
      </p>

      <p className="mt-8 text-xs font-medium uppercase tracking-wide text-m-ink-2">
        {t.archive.toBeArchived}
      </p>
      <ul className="mt-3 flex flex-wrap gap-2">
        {ACTIVITIES.map((activity) => (
          <li
            key={activity.id}
            className="rounded-full border border-m-border px-3 py-1.5 text-sm text-m-ink-2"
          >
            {locale === "ar" ? activity.nameAr : activity.nameEn}
          </li>
        ))}
      </ul>

      <Link
        href="/#activities"
        className="mt-8 inline-flex min-h-12 items-center rounded-m-button border border-m-border-strong px-6 font-semibold transition-colors hover:border-m-brand hover:text-m-brand"
      >
        {t.archive.back}
      </Link>
    </div>
  );
}
