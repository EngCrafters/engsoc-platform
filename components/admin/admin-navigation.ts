import { CalendarDays, CalendarPlus, CircleUserRound } from "lucide-react";

export const adminNavigation = {
  workspace: [
    { href: "/admin/events", label: "Events", icon: CalendarDays },
    { href: "/admin/events/new", label: "Create event", icon: CalendarPlus },
  ],
  account: [
    { href: "/admin/account", label: "Account", icon: CircleUserRound },
  ],
} as const;

const EVENT_ID = "[0-9a-f-]+";

export function isAdminNavActive(pathname: string, href: string) {
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
