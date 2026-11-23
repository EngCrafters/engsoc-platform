// Who sees the membership section, from the person's permissions (ADR 0027), for display only.

import { canAny, type DashboardAccess } from "@/lib/auth/permissions";

/** The committee whose configuration starts with membership review (seeded by migration 0035). */
export const SOCIETY_AFFAIRS_SLUG = "society-affairs";

/**
 * Whether the person holds any membership-area permission: applications, SQU verification,
 * leadership or their settings. Used when the database cannot answer (for example, a migration is
 * missing) to decide who is told the section needs setup. It grants nothing: every list, document
 * and decision is still decided by the database routines.
 */
export function hasMembershipReviewerRole(manager: {
  access: DashboardAccess;
}): boolean {
  return (
    canAny(manager, "membership.view") ||
    canAny(manager, "squ.view") ||
    canAny(manager, "leadership.view") ||
    canAny(manager, "settings.verification")
  );
}
