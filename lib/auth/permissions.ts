// The dashboard's permission model (ADR 0027, migration 0035). The database decides every routine;
// this module is how pages, actions and navigation ask the same question once per request, from the
// access `private.get_dashboard_access` returned for the signed-in person. It never grants anything
// the database would refuse.

export const PERMISSION_KEYS = [
  "events.view",
  "events.create",
  "events.edit",
  "events.publish",
  "events.approve",
  "events.delete",
  "registrations.view",
  "registrations.manage",
  "projects.view",
  "projects.review",
  "projects.publish",
  "projects.delete",
  "membership.view",
  "membership.review",
  "membership.final_approval",
  "members.view",
  "members.delete",
  "squ.view",
  "squ.review",
  "leadership.view",
  "leadership.review",
  "leadership.assign",
  "committees.view",
  "committees.manage",
  "teams.manage",
  "settings.verification",
  "settings.membership_policy",
  "accounts.view",
  "accounts.manage",
  "accounts.admin_levels",
  "accounts.credentials",
  "accounts.erase",
  "permissions.manage",
  "email.send",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

/** Society-wide, or the committees the permission covers. */
export type PermissionScope = "all" | readonly string[];

export type AccessLevel = "COMMITTEE_MANAGER" | "BOARD_ADMIN" | "TECHNICAL";

export type DashboardAccess = {
  /** The personal level from administrative_access, if any (for display; it grants through the mapping). */
  level: AccessLevel | null;
  levelCommitteeId: string | null;
  permissions: Partial<Record<PermissionKey, PermissionScope>>;
  /** Active Chief and Assistant Chief appointments, with how many permissions their group grants. */
  appointments: ReadonlyArray<{
    position: { id: string; label: { en: string; ar: string } };
    committee: { id: string; name: string };
    team: { id: string; name: string } | null;
    permissions: number;
  }>;
};

const isKey = (value: string): value is PermissionKey =>
  (PERMISSION_KEYS as readonly string[]).includes(value);

/** Parses the routine's answer; unknown keys are ignored, never trusted. */
export function toDashboardAccess(value: unknown): DashboardAccess | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (v.code !== "SUCCESS") return null;
  const permissions: Partial<Record<PermissionKey, PermissionScope>> = {};
  const raw = (v.permissions ?? {}) as Record<string, unknown>;
  for (const [key, scope] of Object.entries(raw)) {
    if (!isKey(key)) continue;
    if (scope === "all") permissions[key] = "all";
    else if (
      Array.isArray(scope) &&
      scope.every((id) => typeof id === "string")
    )
      permissions[key] = scope as string[];
  }
  const level =
    v.level === "COMMITTEE_MANAGER" ||
    v.level === "BOARD_ADMIN" ||
    v.level === "TECHNICAL"
      ? v.level
      : null;
  return {
    level,
    levelCommitteeId:
      typeof v.levelCommitteeId === "string" ? v.levelCommitteeId : null,
    permissions,
    appointments: Array.isArray(v.appointments)
      ? (v.appointments as DashboardAccess["appointments"])
      : [],
  };
}

export type DashboardCommittee = {
  id: string;
  name: string;
  /** `slug` is the stable committee identifier (null for legacy rows). */
  slug?: string | null;
  /** Archived committees keep their records but take no new events or managers. */
  archived?: boolean;
};

/** The routine's answer as the dashboard uses it: the access and the live committees. */
export function parseAccess(
  result: unknown
): { access: DashboardAccess; committees: DashboardCommittee[] } | null {
  const access = toDashboardAccess(result);
  if (!access) return null;
  const raw = (result as { committees?: unknown }).committees;
  const committees = (Array.isArray(raw) ? raw : [])
    .filter(
      (
        c
      ): c is {
        id: string;
        name: string;
        slug: string | null;
        archived?: boolean;
      } =>
        Boolean(c) &&
        typeof (c as { id?: unknown }).id === "string" &&
        typeof (c as { name?: unknown }).name === "string"
    )
    .map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug ?? null,
      ...(c.archived ? { archived: true } : {}),
    }));
  return { access, committees };
}

type HasAccess = { access: DashboardAccess };

/**
 * Whether the person holds the permission: society-wide, or for `committeeId` when one is given.
 * Without a committee, a scoped grant does not count (use `canAny`).
 */
export function can(
  who: HasAccess,
  key: PermissionKey,
  committeeId?: string | null
): boolean {
  const scope = who.access.permissions[key];
  if (!scope) return false;
  if (scope === "all") return true;
  return Boolean(committeeId && scope.includes(committeeId));
}

/** Held in any scope: decides whether an entry point (a page or a menu item) is offered. */
export function canAny(who: HasAccess, key: PermissionKey): boolean {
  return Boolean(who.access.permissions[key]);
}

/** Society-wide holders cover every committee; otherwise the listed ones. */
export function committeesFor<T extends { id: string }>(
  who: HasAccess,
  key: PermissionKey,
  committees: readonly T[]
): T[] {
  const scope = who.access.permissions[key];
  if (!scope) return [];
  if (scope === "all") return [...committees];
  return committees.filter((committee) => scope.includes(committee.id));
}

/** Every permission in the catalog, society-wide. */
export function hasFullAccess(who: HasAccess): boolean {
  return PERMISSION_KEYS.every((key) => who.access.permissions[key] === "all");
}

export const ACCESS_LEVEL_LABELS: Record<AccessLevel, string> = {
  COMMITTEE_MANAGER: "Committee Manager",
  BOARD_ADMIN: "Board Administration",
  TECHNICAL: "Technical Team",
};

/** A short description of where the person's dashboard access comes from. */
export function accessSummary(access: DashboardAccess): string {
  const parts: string[] = [];
  if (access.level) parts.push(ACCESS_LEVEL_LABELS[access.level]);
  for (const a of access.appointments)
    if (a.permissions > 0)
      parts.push(
        `${a.position.label.en}, ${a.team ? `${a.team.name} (${a.committee.name})` : a.committee.name}`
      );
  return parts.length ? parts.join(" · ") : "No dashboard permissions";
}

export const PERMISSION_AREAS = [
  ["events", "Events and registrations"],
  ["projects", "Projects"],
  ["membership", "Membership"],
  ["verification", "SQU verification"],
  ["leadership", "Leadership"],
  ["organization", "Committees and teams"],
  ["settings", "Settings"],
  ["accounts", "Accounts and access"],
  ["communications", "Communications"],
] as const;

/** The catalog's labels (migration 0035); a database test keeps them identical. */
export const PERMISSION_INFO: Record<
  PermissionKey,
  { area: (typeof PERMISSION_AREAS)[number][0]; label: string }
> = {
  "events.view": { area: "events", label: "View events" },
  "events.create": { area: "events", label: "Create events" },
  "events.edit": { area: "events", label: "Edit events" },
  "events.publish": { area: "events", label: "Publish events" },
  "events.approve": { area: "events", label: "Approve events" },
  "events.delete": { area: "events", label: "Delete events" },
  "registrations.view": { area: "events", label: "View registrations" },
  "registrations.manage": { area: "events", label: "Manage registrations" },
  "projects.view": { area: "projects", label: "View projects" },
  "projects.review": { area: "projects", label: "Review projects" },
  "projects.publish": { area: "projects", label: "Publish projects" },
  "projects.delete": { area: "projects", label: "Delete projects" },
  "membership.view": { area: "membership", label: "View applications" },
  "membership.review": { area: "membership", label: "Review applications" },
  "membership.final_approval": { area: "membership", label: "Final approval" },
  "members.view": { area: "membership", label: "View members" },
  "members.delete": {
    area: "membership",
    label: "Delete membership records",
  },
  "squ.view": { area: "verification", label: "View SQU verification" },
  "squ.review": { area: "verification", label: "Review SQU verification" },
  "leadership.view": { area: "leadership", label: "View leadership requests" },
  "leadership.review": {
    area: "leadership",
    label: "Decide leadership requests",
  },
  "leadership.assign": { area: "leadership", label: "Appoint leaders" },
  "committees.view": { area: "organization", label: "View committees" },
  "committees.manage": { area: "organization", label: "Manage committees" },
  "teams.manage": { area: "organization", label: "Manage teams" },
  "settings.verification": {
    area: "settings",
    label: "Verification and leadership settings",
  },
  "settings.membership_policy": {
    area: "settings",
    // Both membership settings: the approval policy and account activation (ADR 0030).
    label: "Membership settings",
  },
  "accounts.view": { area: "accounts", label: "View accounts" },
  "accounts.manage": { area: "accounts", label: "Manage committee access" },
  "accounts.admin_levels": {
    area: "accounts",
    label: "Manage administrator access",
  },
  "accounts.credentials": { area: "accounts", label: "Account credentials" },
  "accounts.erase": { area: "accounts", label: "Delete sign-in accounts" },
  "permissions.manage": { area: "accounts", label: "Manage permissions" },
  "email.send": { area: "communications", label: "Email Centre" },
};

/** What the account page shows: plain data, safe to pass to client components. */
export type AccountAccessView = {
  roleLabel: string;
  level: string | null;
  appointments: string[];
  permissions: {
    key: PermissionKey;
    area: string;
    label: string;
    scope: string;
  }[];
};

export function accountAccessView(manager: {
  access: DashboardAccess;
  allCommittees: ReadonlyArray<{ id: string; name: string }>;
}): AccountAccessView {
  const names = new Map(manager.allCommittees.map((c) => [c.id, c.name]));
  const areaLabel = new Map<string, string>(PERMISSION_AREAS);
  return {
    roleLabel: accessSummary(manager.access),
    level: manager.access.level
      ? ACCESS_LEVEL_LABELS[manager.access.level]
      : null,
    appointments: manager.access.appointments.map(
      (a) =>
        `${a.position.label.en}, ${a.team ? `${a.team.name} (${a.committee.name})` : a.committee.name}: ${a.permissions === 0 ? "no dashboard permissions" : `${a.permissions} permission${a.permissions === 1 ? "" : "s"}`}`
    ),
    permissions: PERMISSION_KEYS.filter(
      (key) => manager.access.permissions[key]
    ).map((key) => {
      const scope = manager.access.permissions[key]!;
      return {
        key,
        area: areaLabel.get(PERMISSION_INFO[key].area) ?? "",
        label: PERMISSION_INFO[key].label,
        scope:
          scope === "all"
            ? "Society-wide"
            : scope.map((id) => names.get(id) ?? "A committee").join(", "),
      };
    }),
  };
}
