import { COMMITTEES, LEADERSHIP, SENIOR_LEADERSHIP } from "@/content/structure";
import { getI18n } from "@/lib/i18n/server";

/** How the society is organised: senior leadership, then committees and their teams. */
export async function StructureSection() {
  const { t, l } = await getI18n();
  const positions = [LEADERSHIP.president, ...LEADERSHIP.vicePresidents];

  return (
    <section
      id="structure"
      aria-labelledby="structure-title"
      className="mx-auto max-w-[var(--m-content-max)] px-5 py-20 sm:px-8 sm:py-24"
    >
      <h2
        id="structure-title"
        className="text-[clamp(2rem,1.5rem+2vw,3.25rem)] font-semibold"
      >
        {t.structure.title}
      </h2>
      <p className="mt-4 max-w-[var(--m-measure)] text-lg text-m-ink-2">
        {t.structure.lead}
      </p>
      <p className="mt-4 max-w-[var(--m-measure)] text-sm text-m-ink-2">
        <strong className="font-semibold text-m-ink">
          {t.structure.rosterStrong}
        </strong>{" "}
        {t.structure.rosterBody}
      </p>

      {LEADERSHIP.term ? (
        <p className="mt-2 text-sm text-m-ink-2">{l(LEADERSHIP.term)}</p>
      ) : null}

      <h3 className="mt-12 text-xl font-semibold">{l(SENIOR_LEADERSHIP)}</h3>
      <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {positions.map((position) => (
          <li
            key={position.id}
            className="rounded-m-card border border-m-border bg-m-surface p-4"
          >
            <p className="font-medium">{l(position.title)}</p>
            <p className="mt-1 text-sm text-m-ink-2">
              {position.holder
                ? l(position.holder.name)
                : t.leadership.nameToBeAnnounced}
            </p>
          </li>
        ))}
      </ul>

      <h3 className="mt-14 text-xl font-semibold">{t.structure.committees}</h3>
      <ul className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {COMMITTEES.map((committee) => (
          <li
            key={committee.id}
            className="rounded-m-card border border-m-border bg-m-surface p-5"
          >
            <h4 className="font-semibold">{l(committee.name)}</h4>
            {committee.teams.length > 0 ? (
              <>
                <p className="mt-3 text-xs font-medium uppercase tracking-wide text-m-ink-2">
                  {t.structure.teamsIn(l(committee.name))}
                </p>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {committee.teams.map((team) => (
                    <li
                      key={team.id}
                      className="rounded-full border border-m-border px-3 py-1 text-xs text-m-ink-2"
                    >
                      {l(team.name)}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="mt-3 text-sm text-m-ink-2">
                {t.common.toBeAnnounced}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
