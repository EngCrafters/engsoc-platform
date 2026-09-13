// Layout for the public marketing site: the landing page today, and
// (eventually) a public events list / event detail page. Kept as its own
// route group, separate from any future internal/admin layout — see
// CLAUDE.md's admin dashboard scope — so public chrome (a plain header, no
// internal nav, no auth-gated links) never ends up in a committee member's
// view, and vice versa. `app/layout.tsx` still provides the required root
// <html>/<body>; this nests inside it.

export default function MarketingLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-neutral-200 px-6 py-4">
        <p className="font-mono text-xs uppercase tracking-widest text-neutral-500">
          Engineering Society
        </p>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
