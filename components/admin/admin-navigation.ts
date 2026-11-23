import {
  Building2,
  CalendarDays,
  CalendarPlus,
  CircleUserRound,
  Crown,
  IdCard,
  LayoutDashboard,
  Mail,
  Shield,
  ShieldCheck,
  UserCheck,
  FolderKanban,
  Users,
} from "lucide-react";
import {
  accessSummary,
  canAny,
  type DashboardAccess,
  type PermissionKey,
} from "@/lib/auth/permissions";

export const adminNavigation = {
  workspace: [
    { href: "/admin/events", label: "Events", icon: CalendarDays },
    { href: "/admin/events/new", label: "Create event", icon: CalendarPlus },
  ],
  projects: [
    {
      href: "/admin/projects",
      label: "Projects Management",
      icon: FolderKanban,
    },
  ],
  /**
   * Shown only to membership reviewers (Society Affairs, Senior Management).
   * Each queue has its own entry, so leadership requests and their switch are
   * one click away (Membership → Leadership).
   */
  membership: [
    { href: "/admin/membership", label: "Applications", icon: UserCheck },
    {
      href: "/admin/membership/verifications",
      label: "SQU verification",
      icon: IdCard,
    },
    { href: "/admin/membership/leadership", label: "Leadership", icon: Crown },
  ],
  /** Email Centre access is assigned explicitly (email.send, ADR 0028). */
  communications: [
    { href: "/admin/communications/email", label: "Email Centre", icon: Mail },
  ],
  account: [
    { href: "/admin/account", label: "Account", icon: CircleUserRound },
  ],
  /** Each entry is shown to holders of its permission (ADR 0027). */
  administration: [
    { href: "/admin/administration", label: "Overview", icon: LayoutDashboard },
    {
      href: "/admin/administration/committees",
      label: "Committees",
      icon: Building2,
    },
    { href: "/admin/administration/members", label: "Members", icon: Users },
    { href: "/admin/access", label: "Accounts & access", icon: Shield },
    {
      href: "/admin/administration/permissions",
      label: "Permissions",
      icon: ShieldCheck,
    },
  ],
} as const;

const EVENT_ID = "[0-9a-f-]+";

export function isAdminNavActive(pathname: string, href: string) {
  if (
    href === "/admin/administration/committees" ||
    href === "/admin/administration/members" ||
    href === "/admin/administration/permissions" ||
    href === "/admin/communications/email"
  )
    return pathname === href || pathname.startsWith(`${href}/`);
  if (href === "/admin/projects")
    return (
      pathname === "/admin/projects" || pathname.startsWith("/admin/projects/")
    );
  if (href === "/admin/membership") {
    return (
      pathname === "/admin/membership" ||
      new RegExp(`^/admin/membership/${EVENT_ID}$`, "i").test(pathname)
    );
  }
  if (
    href === "/admin/membership/verifications" ||
    href === "/admin/membership/leadership"
  )
    return new RegExp(`^${href}(/${EVENT_ID})?$`, "i").test(pathname);
  if (href === "/admin/events") {
    return (
      pathname === "/admin/events" ||
      new RegExp(`^/admin/events/${EVENT_ID}(?:/registrations)?$`, "i").test(
        pathname
      )
    );
  }
  return pathname === href;
}

export type AdminBreadcrumb = { label: string; href?: string };

/** Location trail for the header breadcrumb. The last item is the current page. */
export function adminBreadcrumbs(pathname: string): AdminBreadcrumb[] {
  if (pathname === "/admin/projects") return [{ label: "Projects Management" }];
  if (pathname.startsWith("/admin/projects/"))
    return [
      { label: "Projects Management", href: "/admin/projects" },
      { label: "Project" },
    ];
  if (pathname === "/admin/access")
    return [
      { label: "Administration", href: "/admin/administration" },
      { label: "Accounts & access" },
    ];
  if (pathname === "/admin/administration")
    return [{ label: "Administration" }];
  if (pathname === "/admin/administration/permissions")
    return [
      { label: "Administration", href: "/admin/administration" },
      { label: "Permissions" },
    ];
  if (pathname.startsWith("/admin/administration/permissions/"))
    return [
      { label: "Administration", href: "/admin/administration" },
      { label: "Permissions", href: "/admin/administration/permissions" },
      { label: "Group" },
    ];
  if (pathname === "/admin/communications/email")
    return [{ label: "Communications" }, { label: "Email Centre" }];
  if (pathname.startsWith("/admin/communications/email/"))
    return [
      { label: "Communications" },
      { label: "Email Centre", href: "/admin/communications/email" },
      { label: "Message" },
    ];
  for (const [section, label, item] of [
    ["committees", "Committees", "Committee"],
    ["members", "Members", "Member"],
  ] as const) {
    const base = `/admin/administration/${section}`;
    if (pathname === base)
      return [
        { label: "Administration", href: "/admin/administration" },
        { label },
      ];
    if (pathname.startsWith(`${base}/`))
      return [
        { label: "Administration", href: "/admin/administration" },
        { label, href: base },
        { label: item },
      ];
  }
  if (pathname === "/admin/membership")
    return [{ label: "Membership applications" }];
  for (const [section, label] of [
    ["verifications", "SQU verification"],
    ["leadership", "Leadership"],
  ] as const) {
    const base = `/admin/membership/${section}`;
    if (pathname === base)
      return [{ label: "Membership", href: "/admin/membership" }, { label }];
    if (new RegExp(`^${base}/${EVENT_ID}$`, "i").test(pathname))
      return [
        { label: "Membership", href: "/admin/membership" },
        { label, href: base },
        { label: "Request" },
      ];
  }
  if (new RegExp(`^/admin/membership/${EVENT_ID}$`, "i").test(pathname)) {
    return [
      { label: "Membership applications", href: "/admin/membership" },
      { label: "Application" },
    ];
  }
  if (pathname === "/admin/account") return [{ label: "Account" }];
  if (pathname === "/admin/events/new") {
    return [{ label: "Events", href: "/admin/events" }, { label: "New event" }];
  }
  const registrations = pathname.match(
    new RegExp(`^/admin/events/(${EVENT_ID})/registrations$`, "i")
  );
  if (registrations) {
    return [
      { label: "Events", href: "/admin/events" },
      { label: "Event", href: `/admin/events/${registrations[1]}` },
      { label: "Registrations" },
    ];
  }
  if (new RegExp(`^/admin/events/${EVENT_ID}$`, "i").test(pathname)) {
    return [{ label: "Events", href: "/admin/events" }, { label: "Event" }];
  }
  return [{ label: "Events" }];
}

/**
 * Which navigation entries to show, from the person's permissions (ADR 0027). Computed on the
 * server and passed to the sidebar as plain data; it only hides entries, and every page and routine
 * checks its permission again.
 */
export type DashboardNav = {
  roleLabel: string;
  /** "All Committees", one committee's name, or how many committees the events cover. */
  scopeLabel: string | null;
  items: Record<string, boolean>;
};

const NAV_PERMISSION: Record<string, PermissionKey[]> = {
  "/admin/events": ["events.view"],
  "/admin/events/new": ["events.create"],
  "/admin/projects": ["projects.view"],
  "/admin/membership": ["membership.view"],
  "/admin/membership/verifications": ["squ.view", "settings.verification"],
  "/admin/membership/leadership": ["leadership.view", "settings.verification"],
  "/admin/communications/email": ["email.send"],
  "/admin/account": [],
  "/admin/administration": ["committees.view"],
  "/admin/administration/committees": [
    "committees.view",
    "teams.manage",
    "leadership.assign",
  ],
  "/admin/administration/members": ["members.view"],
  "/admin/access": ["accounts.view"],
  "/admin/administration/permissions": ["permissions.manage"],
};

export function dashboardNav(manager: {
  access: DashboardAccess;
  committees: ReadonlyArray<{ name: string }>;
}): DashboardNav {
  const items: Record<string, boolean> = {};
  for (const [href, keys] of Object.entries(NAV_PERMISSION))
    items[href] = keys.length === 0 || keys.some((key) => canAny(manager, key));
  const scope = manager.access.permissions["events.view"];
  return {
    roleLabel: accessSummary(manager.access),
    scopeLabel: !scope
      ? null
      : scope === "all"
        ? "All Committees"
        : manager.committees.length === 1
          ? manager.committees[0].name
          : `${manager.committees.length} committees`,
    items,
  };
}
