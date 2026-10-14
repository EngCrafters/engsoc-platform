import type { Metadata } from "next";
import { getI18n } from "@/lib/i18n/server";
import { PageIntro } from "@/components/marketing/page-intro";
import { ArchiveEmpty } from "@/components/marketing/archive-empty";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.meta.archiveTitle, description: t.meta.archiveDescription };
}

/**
 * The archive of previous editions.
 *
 * It is empty because none have been documented yet, and the page says exactly
 * that rather than showing an empty grid. Real editions become database rows
 * when the archive use case is built.
 */
export default async function ActivitiesArchivePage() {
  const { t } = await getI18n();

  return (
    <>
      <PageIntro
        eyebrow={t.archive.eyebrow}
        title={t.archive.title}
        lead={t.archive.lead}
      />
      <div className="mx-auto max-w-[var(--m-content-max)] px-5 py-14 sm:px-8 sm:py-20">
        <ArchiveEmpty />
      </div>
    </>
  );
}
