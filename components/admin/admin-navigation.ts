import {
  Building2,
  CalendarDays,
  CalendarPlus,
  CircleUserRound,
  LayoutDashboard,
  Shield,
  UserCheck,
  FolderKanban,
  Users,
} from "lucide-react";

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
  /** Shown only to membership reviewers (Society Affairs, Senior Management). */
  membership: [
    {
      href: "/admin/membership",
      label: "Membership applications",
      icon: UserCheck,
    },
  ],
  account: [
    { href: "/admin/account", label: "Account", icon: CircleUserRound },
  ],
  /** Board Administration and the Technical Team (ADR 0024). */
  administration: [
    { href: "/admin/administration", label: "Overview", icon: LayoutDashboard },
    {
      href: "/admin/administration/committees",
      label: "Committees",
      icon: Building2,
    },
    { href: "/admin/administration/members", label: "Members", icon: Users },
    { href: "/admin/access", label: "Accounts & access", icon: Shield },
  ],
} as const;

const EVENT_ID = "[0-9a-f-]+";

export function isAdminNavActive(pathname: string, href: string) {
  if (
    href === "/admin/administration/committees" ||
    href === "/admin/administration/members"
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
