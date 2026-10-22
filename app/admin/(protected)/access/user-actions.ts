"use server";

import { revalidatePath } from "next/cache";
import { requireSenior } from "@/lib/administration/access";
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
import { auditStateLabel } from "./user-types";

function error(code: string): UserActionState {
  return {
    status: "error",
    message: USER_ERROR_MESSAGES[code] ?? USER_ERROR_MESSAGES.UNAVAILABLE,
  };
}

/** Credential tools (password reset, temporary password) stay with the Technical Team. */
async function requireTechnical() {
  const actor = await requireSenior();
  return actor?.accessLevel === "TECHNICAL" ? actor : null;
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
      console.error("auth_admin_audit_failed", {
        actorId,
        targetId,
        action,
        code: "REJECTED",
      });
    }
    return result.code === "SUCCESS";
  } catch {
    console.error("auth_admin_audit_failed", {
      actorId,
      targetId,
      action,
      code: "UNAVAILABLE",
    });
    return false;
  }
}

const AUDIT_NOTICE =
  "The audit record could not be saved. Do not repeat the operation; ask the Technical Team to reconcile its history.";

function completed(message: string, audited: boolean): UserActionState {
  return audited
    ? { status: "success", message }
    : { status: "error", message: `${message} ${AUDIT_NOTICE}` };
}

const LEVELS = [
  "NONE",
  "COMMITTEE_MANAGER",
  "BOARD_ADMIN",
  "TECHNICAL",
] as const;
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
  // Board Administration invites Committee Managers (or plain accounts) by email only (ADR 0024).
  const actor = await requireSenior();
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
  if (
    actor.accessLevel === "BOARD_ADMIN" &&
    ((level !== "NONE" && level !== "COMMITTEE_MANAGER") || method !== "invite")
  ) {
    return error("FORBIDDEN");
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
  const audited = await audit(
    actor.userId,
    created.userId,
    method === "invite" ? "user.invited" : "user.created",
    method === "invite"
      ? "invitation"
      : method === "password"
        ? "temporary password"
        : "no email"
  );

  if (level === "NONE") {
    revalidatePath("/admin/access");
    return completed(
      method === "invite"
        ? "Invitation sent. No administrative access assigned."
        : "Account created without administrative access.",
      audited
    );
  }

  let granted: { code: string };
  try {
    granted = await changeAccess({
      actorId: actor.userId,
      userId: created.userId,
      level,
      committeeId: committeeId || null,
      operation: "grant",
      note: null,
    });
  } catch {
    console.error("auth_admin_access_unconfirmed", {
      actorId: actor.userId,
      targetId: created.userId,
      code: "UNAVAILABLE",
    });
    revalidatePath("/admin/access");
    return {
      status: "error",
      message:
        "The account was created, but its access status could not be confirmed. Refresh the user list and check its role before assigning access. Do not create the account again." +
        (audited ? "" : ` ${AUDIT_NOTICE}`),
    };
  }
  revalidatePath("/admin/access");
  if (granted.code !== "SUCCESS") {
    return {
      status: "error",
      message: `The account was created, but access could not be granted. ${
        USER_ERROR_MESSAGES[granted.code] ?? "Assign a role from the user list."
      }${audited ? "" : ` ${AUDIT_NOTICE}`}`,
    };
  }
  return completed(
    method === "invite"
      ? "Invitation sent and access assigned."
      : "Account created and access assigned.",
    audited
  );
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
  const audited = await audit(
    actor.userId,
    entry.user_id,
    "user.password_reset_sent"
  );
  return completed(
    "Password-reset email requested. The account holder will receive it.",
    audited
  );
}

export async function resendInvitationAction(
  _previous: UserActionState,
  form: FormData
): Promise<UserActionState> {
  const actor = await requireSenior();
  if (!actor) return error("FORBIDDEN");
  const entry = await accountEmail(actor.userId, text(form, "userId") ?? "");
  if (!entry) return error("USER_NOT_FOUND");
  if (entry.email_confirmed && !entry.invited) return error("NOT_PENDING");
  const result = await resendAuthInvitation(entry.email);
  if (result.code !== "SUCCESS") {
    return error(result.code === "INVALID_INPUT" ? "NOT_PENDING" : result.code);
  }
  const audited = await audit(
    actor.userId,
    entry.user_id,
    "user.invitation_resent"
  );
  return completed("Invitation sent again.", audited);
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
  const audited = await audit(
    actor.userId,
    userId,
    "user.password_admin_reset"
  );
  revalidatePath("/admin/access");
  return completed("The password was changed.", audited);
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
  "access.suspended": "Access suspended",
  "access.reactivated": "Access reactivated",
};

/** History for one account. Contains labels and ids only, never secrets. */
export async function getUserHistoryAction(
  userId: string
): Promise<UserHistoryItem[]> {
  const actor = await requireSenior();
  if (!actor || !isUuid(userId)) return [];
  const [rows, directory] = await Promise.all([
    listUserAudit(actor.userId, userId),
    listAuthDirectory(actor.userId),
  ]);
  const emailOf = (id: string | null) =>
    id
      ? (directory.find((entry) => entry.user_id === id)?.email ?? id)
      : "System migration";
  return rows.map((row) => ({
    id: row.id,
    when: new Date(row.occurred_at).toISOString(),
    actor: emailOf(row.actor_user_id),
    label: HISTORY_LABELS[row.action] ?? row.action,
    detail: [
      row.previous_state || row.new_state
        ? `${auditStateLabel(row.previous_state, actor.committees)} → ${auditStateLabel(row.new_state, actor.committees)}`
        : "",
      row.note ?? "",
    ]
      .filter(Boolean)
      .join(" · "),
  }));
}
