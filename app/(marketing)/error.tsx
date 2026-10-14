"use client";

import { useEffect } from "react";
import { useI18n } from "@/components/marketing/i18n-provider";

/**
 * The public site's error boundary. It stays inside the marketing surface, so
 * a visitor never drops into the admin shell's visual language because a data
 * read failed.
 */
export default function MarketingError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useI18n();

  useEffect(() => {
    // The digest is the only safe identifier to log; the message may contain
    // user content.
    console.error("marketing_route_error", { digest: error.digest });
  }, [error]);

  return (
    <div className="mx-auto max-w-[var(--m-content-max)] px-5 py-24 sm:px-8">
      <h1 className="text-[clamp(1.75rem,1.4rem+1.6vw,2.5rem)] font-semibold">
        {t.events.noUpcoming}
      </h1>
      <p className="mt-3 max-w-[var(--m-measure)] text-m-ink-2">
        {t.events.noUpcomingBody}
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-6 inline-flex min-h-12 items-center rounded-m-button bg-m-brand px-6 font-semibold text-white transition-colors hover:bg-m-brand-hover"
      >
        {t.common.close}
      </button>
    </div>
  );
}
