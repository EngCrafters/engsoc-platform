import { CalendarDays } from "lucide-react";

export const adminNavigation = [
  { href: "/admin/events", label: "Events", icon: CalendarDays },
] as const;

export function isAdminNavActive(pathname: string, href: string) {
  if (href !== "/admin/events") return false;
  return (
    pathname === "/admin/events" ||
    /^\/admin\/events\/[0-9a-f-]+(?:\/registrations)?$/i.test(pathname)
  );
}

export function adminPageLabel(pathname: string) {
  if (pathname === "/admin/events/new") return "Create event";
  if (pathname === "/admin/account") return "Account & security";
  return (
    adminNavigation.find((link) => isAdminNavActive(pathname, link.href))
      ?.label ?? "Events"
  );
}
