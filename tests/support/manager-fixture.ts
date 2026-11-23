// Unit-test fixture: a manager context for a personal level, with that level's permissions as
// migration 0035 maps them (private.access_level_permissions). Unit tests only; the database is
// the authority, and tests/db/permissions.test.ts checks this copy against it.
import {
  PERMISSION_KEYS,
  type AccessLevel,
  type DashboardAccess,
  type PermissionKey,
} from "@/lib/auth/permissions";

const NOT_TECHNICAL: PermissionKey[] = [
  "squ.view",
  "squ.review",
  "leadership.view",
  "leadership.review",
  "leadership.assign",
  "email.send",
];
// Migration 0039 (ADR 0030): Board Administration holds settings.membership_policy too.
const NOT_BOARD: PermissionKey[] = [
  "accounts.admin_levels",
  "accounts.credentials",
  "accounts.erase",
];
const MANAGER: PermissionKey[] = [
  "events.view",
  "events.create",
  "events.edit",
  "events.publish",
  "registrations.view",
  "registrations.manage",
];
const SOCIETY_AFFAIRS: PermissionKey[] = [
  "membership.view",
  "membership.review",
  "squ.view",
  "squ.review",
  "leadership.view",
  "leadership.review",
  "leadership.assign",
  "projects.view",
  "projects.review",
  "projects.publish",
  "settings.verification",
];

export const LEVEL_PERMISSIONS: Record<AccessLevel, PermissionKey[]> = {
  TECHNICAL: PERMISSION_KEYS.filter((k) => !NOT_TECHNICAL.includes(k)),
  BOARD_ADMIN: PERMISSION_KEYS.filter((k) => !NOT_BOARD.includes(k)),
  COMMITTEE_MANAGER: MANAGER,
};

/** The access a level gives; a Committee Manager's permissions cover their committee only. */
export function levelAccess(
  level: AccessLevel,
  committeeId: string | null = null,
  options: { societyAffairs?: boolean } = {}
): DashboardAccess {
  const permissions: DashboardAccess["permissions"] = {};
  for (const key of LEVEL_PERMISSIONS[level])
    permissions[key] =
      level === "COMMITTEE_MANAGER"
        ? committeeId
          ? [committeeId]
          : []
        : "all";
  // The Society Affairs committee's seeded configuration, received by its Committee Manager.
  if (options.societyAffairs)
    for (const key of SOCIETY_AFFAIRS) permissions[key] = "all";
  return {
    level,
    levelCommitteeId: level === "COMMITTEE_MANAGER" ? committeeId : null,
    permissions,
    appointments: [],
  };
}

/** A full manager context, as getManagerContext returns it. */
export function managerContext(
  level: AccessLevel,
  input: {
    userId?: string;
    email?: string | null;
    committees?: {
      id: string;
      name: string;
      slug?: string | null;
      archived?: boolean;
    }[];
  } = {}
) {
  const committees = input.committees ?? [];
  const own =
    level === "COMMITTEE_MANAGER" ? (committees[0]?.id ?? null) : null;
  return {
    kind: "manager" as const,
    userId: input.userId ?? "manager-id",
    email: input.email ?? "manager@example.test",
    accessLevel: level,
    access: levelAccess(level, own, {
      societyAffairs: committees.some((c) => c.slug === "society-affairs"),
    }),
    committees,
    allCommittees: committees,
  };
}

/**
 * Adds the level's permissions to a hand-built context ({kind, accessLevel, committees}), so tests
 * written for levels keep describing the same people. A context that already has `access` is kept.
 */
export function withAccess<T>(context: T): T {
  const c = context as {
    kind?: string;
    accessLevel?: AccessLevel;
    committees?: { id: string; slug?: string | null }[];
    allCommittees?: unknown;
    access?: unknown;
  } | null;
  if (!c || c.kind !== "manager" || c.access || !c.accessLevel) return context;
  const committees = c.committees ?? [];
  return {
    ...c,
    access: levelAccess(
      c.accessLevel,
      c.accessLevel === "COMMITTEE_MANAGER"
        ? (committees[0]?.id ?? null)
        : null,
      { societyAffairs: committees.some((x) => x.slug === "society-affairs") }
    ),
    committees,
    allCommittees: c.allCommittees ?? committees,
  } as T;
}
