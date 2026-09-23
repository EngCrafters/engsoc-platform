export const ADMIN_REGISTRATION_STATUSES = ["confirmed", "waitlisted"] as const;
export type AdminRegistrationStatus =
  (typeof ADMIN_REGISTRATION_STATUSES)[number];

export type AdminRegistrationCursor = { registeredAt: string; id: string };

export type AdminRegistration = {
  id: string;
  attendeeName: string;
  attendeeEmail: string;
  status: AdminRegistrationStatus;
  registeredAt: string;
};

export const ADMIN_REGISTRATION_PAGE_SIZE = 25;

export function parseRegistrationStatus(
  value: string | undefined
): AdminRegistrationStatus {
  return value === "waitlisted" ? "waitlisted" : "confirmed";
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}
