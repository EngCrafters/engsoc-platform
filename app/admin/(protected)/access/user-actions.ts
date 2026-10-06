"use server";

import { revalidatePath } from "next/cache";
import { getManagerContext } from "@/lib/auth/manager";
import {
  changeAccess,
  listAuthDirectory,
  listUserAudit,
  recordAuthAdminAction,
  type AuthAdminAction,
} from "@/lib/access/server";
import {
  createAuthUserWithPassword,
  createAuthUserWithoutPassword,
  inviteAuthUser,
  isPlausibleEmail,
  resendAuthInvitation,
  sendPasswordResetEmail,
  setTemporaryPassword,
} from "@/lib/auth/admin";
import { validateNewPassword } from "@/lib/auth/callback";
import { isUuid } from "@/lib/admin-events/types";
import { USER_ERROR_MESSAGES, type UserActionState } from "./user-state";

function error(code: string): UserActionState {
  return {
    status: "error",
    message: USER_ERROR_MESSAGES[code] ?? USER_ERROR_MESSAGES.UNAVAILABLE,
  };
}

/** Every action starts here: authenticate, then require an active Technical user. */
async function requireTechnical() {
  const actor = await getManagerContext();
  if (actor.kind !== "manager" || actor.accessLevel !== "TECHNICAL") {
    return null;
  }
  return actor;
}

function text(form: FormData, field: string) {
  const values = form.getAll(field);
  return values.length === 1 && typeof values[0] === "string"
    ? values[0].trim()
    : null;
}

function passwordText(form: FormData, field: string) {
  const values = form.getAll(field);
  return values.length === 1 && typeof values[0] === "string"
    ? values[0]
    : null;
}

async function directoryEntry(actorId: string, userId: string) {
  const rows = await listAuthDirectory(actorId);
  return rows.find((row) => row.user_id === userId) ?? null;
}

async function audit(
  actorId: string,
  targetId: string,
  action: AuthAdminAction,
  detail?: string
) {
  try {
    const result = await recordAuthAdminAction({
      actorId,
      targetId,
      action,
      detail,
    });
    if (result.code !== "SUCCESS") {
      console.error("auth_admin_audit_failed", { action, code: result.code });
    }
  } catch {
    // The account change already happened; a missing audit label must not
    // surface as a failure of the operation itself.
    console.error("auth_admin_audit_failed", { action, code: "UNAVAILABLE" });
  }
}

const LEVELS = ["COMMITTEE_MANAGER", "BOARD_ADMIN", "TECHNICAL"] as const;
type Level = (typeof LEVELS)[number];
const METHODS = ["invite", "password", "no_email"] as const;
type Method = (typeof METHODS)[number];

/**
 * Creates an Auth identity and then grants application access through the
 * audited routine. The two steps stay distinct: if the grant fails the account
 * still exists with no access, and the message says so.
 */
export async function createUserAction(
  _previous: UserActionState,
  form: FormData
): Promise<UserActionState> {
  const actor = await requireTechnical();
  if (!actor) return error("FORBIDDEN");

  const email = text(form, "email")?.toLowerCase() ?? "";
  const level = text(form, "level") as Level | null;
  const committeeId = text(form, "committeeId") ?? "";
  const method = text(form, "method") as Method | null;
  const password = passwordText(form, "password");
  const confirmation = passwordText(form, "confirmPassword");

  if (
    !isPlausibleEmail(email) ||
    !level ||
    !LEVELS.includes(level) ||
    !method ||
    !METHODS.includes(method) ||
    (level === "COMMITTEE_MANAGER" &&
      (!isUuid(committeeId) ||
        !actor.committees.some((committee) => committee.id === committeeId))) ||
    (level !== "COMMITTEE_MANAGER" && committeeId !== "")
  ) {
    return error("INVALID_INPUT");
  }
  if (method === "password") {
    const problem = validateNewPassword(password, confirmation);
    if (problem) return { status: "error", message: problem };
  }

  const created =
    method === "invite"
      ? await inviteAuthUser(email)
      : method === "password"
        ? await createAuthUserWithPassword(email, password as string)
        : await createAuthUserWithoutPassword(email);
  if (created.code !== "SUCCESS" || !created.userId) {
    return error(created.code === "SUCCESS" ? "UNAVAILABLE" : created.code);
  }
  await audit(
    actor.userId,
    created.userId,
    method === "invite" ? "user.invited" : "user.created",
    method === "invite"
      ? "invitation"
      : method === "password"
        ? "temporary password"
        : "no email"
  );

  const granted = await changeAccess({
    actorId: actor.userId,
    userId: created.userId,
    level,
    committeeId: committeeId || null,
    operation: "grant",
    note: null,
  });
  revalidatePath("/admin/access");
  if (granted.code !== "SUCCESS") {
    return {
      status: "error",
      message: `The account was created, but access could not be granted. ${
        USER_ERROR_MESSAGES[granted.code] ?? "Assign a role from the user list."
      }`,
    };
  }
  return {
    status: "success",
    message:
      method === "invite"
        ? "Invitation sent and access assigned."
        : "Account created and access assigned.",
  };
}

async function accountEmail(actorId: string, userId: string) {
  if (!isUuid(userId)) return null;
  return directoryEntry(actorId, userId);
}

export async function sendResetEmailAction(
  _previous: UserActionState,
  form: FormData
): Promise<UserActionState> {
  const actor = await requireTechnical();
  if (!actor) return error("FORBIDDEN");
  const entry = await accountEmail(actor.userId, text(form, "userId") ?? "");
  if (!entry) return error("USER_NOT_FOUND");
  const result = await sendPasswordResetEmail(entry.email);
  if (result.code !== "SUCCESS") return error(result.code);
  await audit(actor.userId, entry.user_id, "user.password_reset_sent");
  return {
    status: "success",
    message:
      "Password-reset email requested. The account holder will receive it.",
  };
}

export async function resendInvitationAction(
  _previous: UserActionState,
  form: FormData
): Promise<UserActionState> {
  const actor = await requireTechnical();
  if (!actor) return error("FORBIDDEN");
  const entry = await accountEmail(actor.userId, text(form, "userId") ?? "");
  if (!entry) return error("USER_NOT_FOUND");
  if (entry.email_confirmed && !entry.invited) return error("NOT_PENDING");
  const result = await resendAuthInvitation(entry.email);
  if (result.code !== "SUCCESS") {
    return error(result.code === "INVALID_INPUT" ? "NOT_PENDING" : result.code);
  }
  await audit(actor.userId, entry.user_id, "user.invitation_resent");
  return { status: "success", message: "Invitation sent again." };
}

/**
 * Technical-only fallback for the pilot, when email cannot be relied on. The
 * password is validated, handed to the Auth Admin API and forgotten: it is
 * never returned, logged, put in a URL or written to the audit trail.
 */
export async function setTemporaryPasswordAction(
  _previous: UserActionState,
  form: FormData
): Promise<UserActionState> {
  const actor = await requireTechnical();
  if (!actor) return error("FORBIDDEN");
  const userId = text(form, "userId") ?? "";
  if (!isUuid(userId)) return error("USER_NOT_FOUND");
  if (userId === actor.userId) return error("SELF_TARGET");
  const password = passwordText(form, "password");
  const confirmation = passwordText(form, "confirmPassword");
  const problem = validateNewPassword(password, confirmation);
  if (problem) return { status: "error", message: problem };
  const entry = await directoryEntry(actor.userId, userId);
  if (!entry) return error("USER_NOT_FOUND");

  const result = await setTemporaryPassword(userId, password as string);
  if (result.code !== "SUCCESS") return error(result.code);
  await audit(actor.userId, userId, "user.password_admin_reset");
  revalidatePath("/admin/access");
  return { status: "success", message: "The password was changed." };
}

export type UserHistoryItem = {
  id: string;
  when: string;
  actor: string;
  label: string;
  detail: string;
};

const HISTORY_LABELS: Record<string, string> = {
  "manager.assigned": "Committee Manager assigned",
  "manager.reassigned": "Committee reassigned",
  "manager.revoked": "Committee Manager access revoked",
  "board_admin.granted": "Board Administration granted",
  "board_admin.revoked": "Board Administration revoked",
  "technical.granted": "Technical Team access granted",
  "technical.revoked": "Technical Team access revoked",
  "access.granted": "Access granted",
  "access.reassigned": "Access reassigned",
  "access.revoked": "Access revoked",
  "access.technical_changed": "Technical access changed",
  "user.created": "Account created",
  "user.invited": "Invitation sent",
  "user.invitation_resent": "Invitation sent again",
  "user.password_reset_sent": "Password-reset email requested",
  "user.password_admin_reset": "Password changed by an administrator",
};

/** History for one account. Contains labels and ids only, never secrets. */
export async function getUserHistoryAction(
  userId: string
): Promise<UserHistoryItem[]> {
  const actor = await requireTechnical();
  if (!actor || !isUuid(userId)) return [];
  const [rows, directory] = await Promise.all([
    listUserAudit(actor.userId, userId),
    listAuthDirectory(actor.userId),
  ]);
  const emailOf = (id: string | null) =>
    id
      ? (directory.find((entry) => entry.user_id === id)?.email ?? "Unknown")
      : "System migration";
  return rows.map((row) => ({
    id: row.id,
    when: new Date(row.occurred_at).toISOString(),
    actor: emailOf(row.actor_user_id),
    label: HISTORY_LABELS[row.action] ?? row.action,
    detail: row.note ?? "",
  }));
}
