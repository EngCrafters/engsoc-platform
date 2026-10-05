import type { AccessLevel } from "@/lib/auth/manager";

export type Committee = { id: string; name: string };

/**
 * One Auth identity joined with its (optional) application access. The two are
 * deliberately separate: an account with `access === null` can sign in but sees
 * nothing in the dashboard.
 */
export type UserRecord = {
  userId: string;
  email: string;
  emailConfirmed: boolean;
  invited: boolean;
  createdAt: string;
  lastSignInAt: string | null;
  access: {
    level: AccessLevel;
    committeeId: string | null;
    committeeName: string | null;
    active: boolean;
  } | null;
};

export function roleLabel(level: AccessLevel | undefined | null) {
  return level === "TECHNICAL"
    ? "Technical Team"
    : level === "BOARD_ADMIN"
      ? "Board Administration"
      : level === "COMMITTEE_MANAGER"
        ? "Committee Manager"
        : "No role";
}

/** What the committee column shows for an account. */
export function scopeLabel(user: UserRecord) {
  const access = user.access;
  if (!access || !access.active) return "—";
  if (access.level === "COMMITTEE_MANAGER") {
    return access.committeeName ?? "Committee";
  }
  return access.level === "TECHNICAL" ? "Technical Team" : "All Committees";
}

export function accessStatus(user: UserRecord) {
  if (!user.access) return "No access";
  return user.access.active ? "Active" : "Revoked";
}

export function authStatus(user: UserRecord) {
  if (user.emailConfirmed) return "Confirmed";
  return user.invited ? "Invited" : "Unconfirmed";
}

export function formatWhen(value: string | null) {
  if (!value) return "Never";
  return new Date(value).toLocaleString("en-GB", {
    timeZone: "Asia/Muscat",
    dateStyle: "medium",
    timeStyle: "short",
  });
}
