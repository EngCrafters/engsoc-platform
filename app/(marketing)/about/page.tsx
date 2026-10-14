import type { Metadata } from "next";
import { SOCIETY_FACTS } from "@/content/stats";
import { getI18n } from "@/lib/i18n/server";
import { PageIntro } from "@/components/marketing/page-intro";
import { StatsStrip } from "@/components/marketing/stats-strip";
import { OverviewSection } from "@/components/marketing/overview-section";
import { StructureSection } from "@/components/marketing/structure-section";
import { JoinSection } from "@/components/marketing/join-section";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.meta.aboutTitle, description: t.meta.aboutDescription };
}

export default async function AboutPage() {
  const { t } = await getI18n();

  return (
    <>
      <PageIntro
        eyebrow={t.site.affiliation}
        title={t.about.title}
        lead={t.about.lead}
      />
      <StatsStrip stats={SOCIETY_FACTS} title={t.stats.factsTitle} />
      <OverviewSection showLink={false} />
      <StructureSection />
      <JoinSection />
    </>
  );
}
