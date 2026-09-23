import type { AdminEvent } from "./server";

/**
 * The seven lifecycle states a manager can see on an event. Derived, never
 * stored — `private.*` routines are the only writers of the underlying
 * columns (status, archived_at, review_required, approved_by). See
 * docs/UC-02_Deep_Dive.md "Publication lifecycle" and "O-01 review".
 */
export type EventLifecycleStatus =
  "draft" | "review" | "approved" | "published" | "full" | "past" | "archived";

export function getEventLifecycleStatus(
  event: Pick<
    AdminEvent,
    "status" | "archivedAt" | "eventDate" | "reviewRequired" | "approvedBy"
  >,
  now: Date = new Date()
): EventLifecycleStatus {
  if (event.archivedAt) return "archived";
  if (new Date(event.eventDate).getTime() <= now.getTime()) return "past";
  if (event.status === "full") return "full";
  if (event.status === "published") return "published";
  if (event.reviewRequired) return event.approvedBy ? "approved" : "review";
  return "draft";
}

export const EVENT_STATUS_META: Record<
  EventLifecycleStatus,
  { label: string; description: string }
> = {
  draft: {
    label: "Draft",
    description: "Only visible to committee managers.",
  },
  review: {
    label: "Review required",
    description: "A different active manager must approve this revision.",
  },
  approved: {
    label: "Approved",
    description: "Approved by another manager and ready to publish.",
  },
  published: {
    label: "Published",
    description: "Visible on the public site and open for registration.",
  },
  full: {
    label: "Full",
    description: "Registration is closed; new sign-ups cannot be confirmed.",
  },
  past: {
    label: "Past",
    description: "The event date has passed.",
  },
  archived: {
    label: "Archived",
    description: "Hidden from the committee workspace by default.",
  },
};
