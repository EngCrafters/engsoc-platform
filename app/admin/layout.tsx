import type { Metadata } from "next";
import type { ReactNode } from "react";

/**
 * The dashboard's forms are Server Actions. A form submitted before the page's JavaScript is ready
 * is a native POST, and under the site-wide `no-referrer` policy the browser then sends
 * `Origin: null`, which Next.js refuses ("Invalid Server Actions request"): the save or sign-in
 * silently does nothing. `same-origin` keeps the real Origin on the dashboard's own requests while
 * other sites still receive no Referer, and a cross-site form post still arrives with
 * `Origin: null` and is still refused. This is the fix the registration export already uses
 * (docs/HARDENING_AUDIT_2026-10-07.md); public pages keep `no-referrer`.
 */
export const metadata: Metadata = { referrer: "same-origin" };

export default function AdminLayout({ children }: { children: ReactNode }) {
  return children;
}
