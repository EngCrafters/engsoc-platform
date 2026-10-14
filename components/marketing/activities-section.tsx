import Link from "next/link";
import { ACTIVITIES } from "@/content/activities";
import { getI18n } from "@/lib/i18n/server";
import { ActivitySlideshow } from "./activity-slideshow";
import { IconArrowRight } from "./icons";
import { Reveal } from "./reveal";

/**
 * The society's six programmes, each with a slideshow of its own previous
 * events. Every demonstration entry stays tagged on the slide, and the section
 * states plainly which figures are samples.
 */
export async function ActivitiesSection() {
  const { t, l, locale } = await getI18n();
  const activitiesWithEvents = ACTIVITIES.filter(
    (activity) => activity.events.length > 0
  );
  const hasDemo = activitiesWithEvents.some((activity) =>
    activity.events.some((event) => event.demo)
  );
  const hasPhotosPending = activitiesWithEvents.some(
    (activity) => activity.descriptionStatus === "needs-input"
  );

  return (
    <section
      id="activities"
      aria-labelledby="activities-title"
      className="bg-m-surface-soft"
    >
      <div className="mx-auto max-w-[var(--m-content-max)] px-5 py-20 sm:px-8 sm:py-24">
        <h2
          id="activities-title"
          className="max-w-[22ch] text-[clamp(2rem,1.5rem+2vw,3.25rem)] font-semibold"
        >
          {t.activities.title}
        </h2>
        <p className="mt-4 max-w-[var(--m-measure)] text-lg text-m-ink-2">
          {t.activities.lead}
        </p>

        {/* Both notices can apply at once: demonstration events are shown, and one
            programme still has no description. They are separate facts, so they are
            stated separately rather than one hiding the other. */}
        {hasDemo ? (
          <p className="mt-4 max-w-[var(--m-measure)] text-sm text-m-ink-2">
            <strong className="font-semibold text-m-ink">
              {t.activities.demoStrong}
            </strong>{" "}
            {t.activities.demoBody}
          </p>
        ) : null}
        {hasPhotosPending ? (
          <p className="mt-3 max-w-[var(--m-measure)] text-sm text-m-ink-2">
            <strong className="font-semibold text-m-ink">
              {t.activities.photosStrong}
            </strong>{" "}
            {t.activities.photosBody}
          </p>
        ) : null}

        <div className="mt-12 grid gap-10 lg:gap-14">
          {activitiesWithEvents.map((activity, index) => (
            <Reveal key={activity.id}>
              <article
                id={activity.id}
                className={`grid items-center gap-8 lg:grid-cols-2 lg:gap-12 ${
                  index % 2 === 1 ? "lg:[&>*:first-child]:order-2" : ""
                }`}
              >
                <div>
                  <h3 className="text-2xl font-semibold sm:text-3xl">
                    {locale === "ar" ? activity.nameAr : activity.nameEn}
                  </h3>
                  <p
                    className={`mt-4 max-w-[var(--m-measure)] ${
                      activity.descriptionStatus === "needs-input"
                        ? "text-m-ink-2 italic"
                        : "text-m-ink-2"
                    }`}
                  >
                    {l(activity.description)}
                  </p>
                </div>
                <ActivitySlideshow
                  events={activity.events}
                  label={locale === "ar" ? activity.nameAr : activity.nameEn}
                />
              </article>
            </Reveal>
          ))}
        </div>

        <div className="mt-14">
          <Link
            href="/activities"
            className="inline-flex min-h-12 items-center gap-2 rounded-m-button border border-m-border-strong bg-m-surface px-6 font-semibold transition-colors hover:border-m-brand hover:text-m-brand"
          >
            {t.activities.explorePrevious}
            <IconArrowRight className="size-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}
