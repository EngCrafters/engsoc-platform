import { CalendarDays, ShieldCheck } from "lucide-react";

export const adminNavigation = [
  { href: "/admin/events", label: "Events", icon: CalendarDays },
  { href: "/admin/account", label: "Account & security", icon: ShieldCheck },
] as const;

export function isAdminNavActive(pathname: string, href: string) {
  if (href === "/admin/account") return pathname === href;
  return (
    pathname === "/admin/events" ||
    /^\/admin\/events\/[0-9a-f-]+(?:\/registrations)?$/i.test(pathname)
  );
}

export function adminPageLabel(pathname: string) {
  if (pathname === "/admin/events/new") return "Create event";
  return (
    adminNavigation.find((link) => isAdminNavActive(pathname, link.href))
      ?.label ?? "Events"
  );
}
