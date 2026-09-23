export const ADMIN_EVENT_FILTERS = [
  "all",
  "draft",
  "published",
  "full",
  "past",
  "archived",
] as const;

export type AdminEventFilter = (typeof ADMIN_EVENT_FILTERS)[number];

export type AdminEventCursor = { eventDate: string; id: string };

export type AdminEvent = {
  id: string;
  title: string;
  description: string | null;
  eventDate: string;
  location: string | null;
  committeeId: string;
  committeeName: string;
  status: "draft" | "published" | "full";
  capacity: number | null;
  revision: number;
  archivedAt: string | null;
  reviewRequired: boolean;
  flaggedBy: string | null;
  approvedBy: string | null;
  confirmedCount: number;
  waitlistedCount: number;
};

export const ADMIN_EVENT_PAGE_SIZE = 20;

export function parseAdminEventFilter(
  value: string | undefined
): AdminEventFilter {
  return ADMIN_EVENT_FILTERS.includes(value as AdminEventFilter)
    ? (value as AdminEventFilter)
    : "all";
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value
  );
}
