export default function MarketingLoading() {
  return (
    <div
      aria-busy="true"
      className="mx-auto max-w-[var(--m-content-max)] px-5 py-24 sm:px-8"
    >
      <p className="sr-only">Loading…</p>
      <div className="grid gap-4">
        <div className="h-5 w-40 animate-pulse rounded-full bg-m-surface-soft" />
        <div className="h-12 w-80 max-w-full animate-pulse rounded-m-card bg-m-surface-soft" />
        <div className="h-6 w-96 max-w-full animate-pulse rounded-full bg-m-surface-soft" />
      </div>
      <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div
            key={index}
            className="h-40 animate-pulse rounded-m-card bg-m-surface-soft"
          />
        ))}
      </div>
    </div>
  );
}
