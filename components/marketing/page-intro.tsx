import { getI18n } from "@/lib/i18n/server";

/** Inner-page header. Exactly one h1 per page, with the lead beneath it. */
export async function PageIntro({
  eyebrow,
  title,
  lead,
}: {
  eyebrow: string;
  title: string;
  lead: string;
}) {
  await getI18n();
  return (
    <header className="border-b border-m-border">
      <div className="mx-auto max-w-[var(--m-content-max)] px-5 pt-[calc(var(--m-nav-height)+var(--m-nav-offset)+3rem)] pb-10 sm:px-8 sm:pb-14">
        <p className="text-sm font-semibold uppercase tracking-[0.14em] text-m-brand">
          {eyebrow}
        </p>
        <h1 className="mt-4 text-[clamp(2rem,1.5rem+2vw,3.25rem)] font-semibold">
          {title}
        </h1>
        <p className="mt-4 max-w-[var(--m-measure)] text-lg text-m-ink-2">
          {lead}
        </p>
      </div>
    </header>
  );
}
