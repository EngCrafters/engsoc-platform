/** Shared user-facing messages for expected manager operation outcomes. */
export const ADMIN_ERROR_MESSAGES: Record<string, string> = {
  INVALID_IMAGE: "Choose a JPEG or PNG image up to 3 MiB and 20 megapixels.",
  IMAGE_UPLOAD_FAILED:
    "The image could not be uploaded. Check event Storage configuration and try again.",
  CHECKIN_CLOSED:
    "Check-in has closed. Open a new window to display a live QR.",
  AUTH_REQUIRED:
    "Your administrator session has expired. Sign in again to continue.",
  ACTOR_NOT_FOUND:
    "The administrator account is unavailable. Check the account and try again.",
  USER_NOT_FOUND:
    "The target user was not found. Check the account and try again.",
  COMMITTEE_NOT_FOUND:
    "The committee was not found. Refresh the committee list and try again.",
  ALREADY_ACTIVE:
    "This manager already has an active committee grant. Refresh the access list.",
  ALREADY_REVOKED:
    "This committee grant is already revoked. Refresh the access list.",
  DENIED: "This action is not available to your account.",
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
    "A different Board Administration or Technical Team user must review this revision.",
  GLOBAL_ACCESS_REQUIRED:
    "This action requires Board Administration or Technical Team access.",
  REGISTRATION_CLOSED:
    "Registration is closed for this event, so this operation cannot continue.",
  EVENT_FULL:
    "This event has reached capacity. Promote only when a seat is available.",
  QUEUE_ORDER_CONFLICT:
    "Only the first waitlisted registration can be promoted. Refresh the list and try again.",
  EXPORT_LIMIT:
    "This export exceeds the supported size. Contact platform maintenance for a larger export.",
  DATABASE_UNAVAILABLE:
    "The database is temporarily unavailable. Wait a moment and try again.",
  TIMEOUT: "The request timed out. Refresh the page before trying again.",
  FORBIDDEN:
    "You no longer have permission to manage this committee. Refresh your session or contact the Technical Team.",
  SERVER_ERROR:
    "We couldn't complete this action because of an unexpected server error. Try again; if it continues, contact the platform maintenance authority.",
};

export function adminErrorMessage(code: string | undefined) {
  return (
    (code && ADMIN_ERROR_MESSAGES[code]) || ADMIN_ERROR_MESSAGES.SERVER_ERROR
  );
}
