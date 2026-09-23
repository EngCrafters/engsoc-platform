/** Shared user-facing messages for expected manager operation outcomes. */
export const ADMIN_ERROR_MESSAGES: Record<string, string> = {
  AUTH_REQUIRED: "Your manager session has expired. Sign in again to continue.",
  NOT_FOUND:
    "This record is no longer available in your committee scope. Refresh the page and try again.",
  VALIDATION_ERROR:
    "Check the highlighted details. Use a future date, a valid capacity, and complete all required fields.",
  CONFLICT:
    "This record changed in another session. Refresh the page to load the latest version before saving again.",
  INVALID_TRANSITION:
    "This change is not available in the event's current lifecycle state. Archived events must be restored first; published events with registrations cannot move date, and past events cannot change date or capacity.",
  CAPACITY_BELOW_COUNT:
    "Capacity cannot be lower than the number of confirmed registrations. Increase capacity or leave it unchanged.",
  APPROVAL_REQUIRED:
    "This event cannot be published while review approval is required.",
  SELF_APPROVAL_DENIED:
    "A different active committee manager must approve this revision.",
  REGISTRATION_CLOSED:
    "Registration is closed for this event, so this operation cannot continue.",
  EVENT_FULL:
    "This event has reached capacity. Promote only when a seat is available.",
  QUEUE_ORDER_CONFLICT:
    "Only the first waitlisted registration can be promoted. Refresh the list and try again.",
  FORBIDDEN:
    "You no longer have permission to manage this committee. Refresh your session or contact the platform maintenance authority.",
  SERVER_ERROR:
    "We couldn't complete this action because of an unexpected server error. Try again; if it continues, contact the platform maintenance authority.",
};

export function adminErrorMessage(code: string | undefined) {
  return (
    (code && ADMIN_ERROR_MESSAGES[code]) || ADMIN_ERROR_MESSAGES.SERVER_ERROR
  );
}
