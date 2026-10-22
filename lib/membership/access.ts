// Who the membership rules name as reviewers (ADR 0017), for display only.

/** The committee whose managers review membership applications. */
export const SOCIETY_AFFAIRS_SLUG = "society-affairs";

/**
 * Whether an administrative role is one the membership rules name: the
 * Society Affairs manager, Board Administration or Technical. Used only when
 * the database cannot answer (for example, migration 0025 is missing), to
 * decide who is told that membership review needs setup. It grants nothing:
 * every list, document and decision is still decided by the database routines,
 * which apply the same rule to live access.
 */
export function hasMembershipReviewerRole(manager: {
  accessLevel: "COMMITTEE_MANAGER" | "BOARD_ADMIN" | "TECHNICAL";
  committees: ReadonlyArray<{ slug?: string | null }>;
}): boolean {
  if (manager.accessLevel !== "COMMITTEE_MANAGER") return true;
  return manager.committees.some(
    (committee) => committee.slug === SOCIETY_AFFAIRS_SLUG
  );
}
