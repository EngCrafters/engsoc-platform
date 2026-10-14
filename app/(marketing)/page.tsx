import { SOCIETY_STATS } from "@/content/stats";
import { getI18n } from "@/lib/i18n/server";
import { Hero } from "@/components/marketing/hero";
import { StatsStrip } from "@/components/marketing/stats-strip";
import { OverviewSection } from "@/components/marketing/overview-section";
import { EventsSection } from "@/components/marketing/events-section";
import { ActivitiesSection } from "@/components/marketing/activities-section";
import { ProjectsSection } from "@/components/marketing/projects-section";
import { DisciplinesSection } from "@/components/marketing/disciplines-section";
import { LeadershipSection } from "@/components/marketing/leadership-section";
import { JoinSection } from "@/components/marketing/join-section";

export const dynamic = "force-dynamic";

export default async function MarketingHomePage() {
  const { t } = await getI18n();

  return (
    <>
      <Hero />
      <StatsStrip stats={SOCIETY_STATS} title={t.stats.title} />
      <OverviewSection />
      <EventsSection />
      <ActivitiesSection />
      <ProjectsSection />
      <DisciplinesSection />
      <LeadershipSection />
      <JoinSection />
    </>
  );
}
