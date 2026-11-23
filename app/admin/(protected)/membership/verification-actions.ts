"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { getManagerContext } from "@/lib/auth/manager";
import { can } from "@/lib/auth/permissions";
import { logServerError } from "@/lib/api/log";
import { processMembershipStorageDeletions } from "@/lib/membership/server";
import {
  decideLeadershipRequest,
  decideSquVerification,
  revokeAppointment,
  revokeSquVerification,
  setLeadershipRequestsOpen,
  setPositionLimit,
  setVerificationSettings,
} from "@/lib/verification/review";

/**
 * SQU verification and leadership review actions (ADR 0025). The actor is
 * always the verified session user; the routines decide whether that user may
 * act, in which state, and refuse their own records. Nothing here trusts a
 * role, status or member from the form.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POSITION = /^[a-z][a-z_]{1,39}$/;

export type ReviewActionState = {
  code: string;
  field?: string;
  /** RETENTION_CONFIRMATION_REQUIRED: how many stored evidence files would become eligible. */
  eligible?: number;
} | null;

function one(form: FormData, key: string) {
  const values = form.getAll(key);
  return values.length === 1 && typeof values[0] === "string"
    ? values[0]
    : null;
}
const text = (form: FormData, key: string) => one(form, key)?.trim() || null;
const revisionOf = (form: FormData) => {
  const n = Number(one(form, "revision"));
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
};

async function run(
  work: () => Promise<{ code: string; field?: string; eligible?: number }>,
  paths: string[]
): Promise<ReviewActionState> {
  try {
    const result = await work();
    if (result.code === "SUCCESS")
      for (const path of paths) revalidatePath(path);
    return {
      code: result.code,
      field: result.field,
      ...(typeof result.eligible === "number"
        ? { eligible: result.eligible }
        : {}),
    };
  } catch (error) {
    logServerError("verification_review_action_failed", error);
    return { code: "SERVER_ERROR" };
  }
}

export async function decideSquAction(
  _previous: ReviewActionState,
  form: FormData
): Promise<ReviewActionState> {
  const manager = await getManagerContext();
  if (manager.kind !== "manager") return { code: "FORBIDDEN" };
  const id = one(form, "requestId");
  const revision = revisionOf(form);
  const decision = one(form, "decision");
  const reason = text(form, "reason");
  const note = text(form, "note");
  if (
    !id ||
    !UUID.test(id) ||
    !revision ||
    (decision !== "approve" && decision !== "reject") ||
    (reason?.length ?? 0) > 500 ||
    (note?.length ?? 0) > 1000
  )
    return { code: "VALIDATION_ERROR" };
  return run(
    () =>
      decideSquVerification(
        manager.userId,
        id,
        revision,
        decision,
        decision === "reject" ? reason : null,
        note
      ),
    ["/admin/membership/verifications", `/admin/membership/verifications/${id}`]
  );
}

export async function revokeSquAction(
  _previous: ReviewActionState,
  form: FormData
): Promise<ReviewActionState> {
  const manager = await getManagerContext();
  if (manager.kind !== "manager") return { code: "FORBIDDEN" };
  const verification = one(form, "verificationId");
  const request = one(form, "requestId");
  const reason = text(form, "reason");
  const note = text(form, "note");
  if (
    !verification ||
    !UUID.test(verification) ||
    !request ||
    !UUID.test(request) ||
    (reason?.length ?? 0) > 500 ||
    (note?.length ?? 0) > 1000
  )
    return { code: "VALIDATION_ERROR" };
  if (!reason) return { code: "VALIDATION_ERROR", field: "reason" };
  return run(
    () => revokeSquVerification(manager.userId, verification, reason, note),
    [
      "/admin/membership/verifications",
      `/admin/membership/verifications/${request}`,
    ]
  );
}

export async function decideLeadershipAction(
  _previous: ReviewActionState,
  form: FormData
): Promise<ReviewActionState> {
  const manager = await getManagerContext();
  if (manager.kind !== "manager") return { code: "FORBIDDEN" };
  const id = one(form, "requestId");
  const revision = revisionOf(form);
  const decision = one(form, "decision");
  const reason = text(form, "reason");
  const note = text(form, "note");
  if (
    !id ||
    !UUID.test(id) ||
    !revision ||
    (decision !== "approve" && decision !== "reject") ||
    (reason?.length ?? 0) > 500 ||
    (note?.length ?? 0) > 1000
  )
    return { code: "VALIDATION_ERROR" };
  return run(
    () =>
      decideLeadershipRequest(
        manager.userId,
        id,
        revision,
        decision,
        decision === "reject" ? reason : null,
        note
      ),
    ["/admin/membership/leadership", `/admin/membership/leadership/${id}`]
  );
}

/** Ends an appointment, from a leadership request's page or from the committee page. */
export async function revokeAppointmentAction(
  _previous: ReviewActionState,
  form: FormData
): Promise<ReviewActionState> {
  const manager = await getManagerContext();
  if (manager.kind !== "manager") return { code: "FORBIDDEN" };
  const appointment = one(form, "appointmentId");
  const revision = revisionOf(form);
  const reason = text(form, "reason");
  const note = text(form, "note");
  const back = one(form, "returnPath");
  if (
    !appointment ||
    !UUID.test(appointment) ||
    !revision ||
    (reason?.length ?? 0) > 500 ||
    (note?.length ?? 0) > 1000
  )
    return { code: "VALIDATION_ERROR" };
  if (!reason) return { code: "VALIDATION_ERROR", field: "reason" };
  // Only a dashboard path of this section is revalidated, never a caller's URL.
  const path =
    back &&
    /^\/admin\/(membership\/leadership|administration\/committees)\/[0-9a-f-]{36}$/i.test(
      back
    )
      ? back
      : null;
  return run(
    () =>
      revokeAppointment(manager.userId, appointment, revision, reason, note),
    ["/admin/membership/leadership", ...(path ? [path] : [])]
  );
}

const optionalInt = (value: string | null) =>
  value === null || value.trim() === "" ? null : Number(value);
const inRange = (n: number | null, min: number, max: number) =>
  n === null || (Number.isInteger(n) && n >= min && n <= max);

/**
 * Limits and the retention period: settings.verification (ADR 0027; initially Board Administration,
 * Technical and Society Affairs). The routine re-checks and audits. A retention period that makes
 * stored evidence eligible for deletion needs the explicit confirmation the form sends after showing
 * the count; saving deletes nothing.
 */
export async function saveVerificationSettingsAction(
  _previous: ReviewActionState,
  form: FormData
): Promise<ReviewActionState> {
  const manager = await getManagerContext();
  if (manager.kind !== "manager" || !can(manager, "settings.verification"))
    return { code: "FORBIDDEN" };
  const squ = optionalInt(one(form, "squSubmissionsPer30Days"));
  const retention = optionalInt(one(form, "documentRetentionDays"));
  const leadership = optionalInt(one(form, "leadershipRequestsPer30Days"));
  const maxActive = optionalInt(one(form, "maxActiveAppointmentsPerMember"));
  if (squ === null || !inRange(squ, 1, 20))
    return { code: "VALIDATION_ERROR", field: "squSubmissionsPer30Days" };
  if (!inRange(retention, 30, 3650))
    return { code: "VALIDATION_ERROR", field: "documentRetentionDays" };
  if (leadership === null || !inRange(leadership, 1, 50))
    return { code: "VALIDATION_ERROR", field: "leadershipRequestsPer30Days" };
  if (!inRange(maxActive, 1, 20))
    return {
      code: "VALIDATION_ERROR",
      field: "maxActiveAppointmentsPerMember",
    };
  const result = await run(
    () =>
      setVerificationSettings(
        manager.userId,
        {
          squSubmissionsPer30Days: squ,
          documentRetentionDays: retention,
          leadershipRequestsPer30Days: leadership,
          maxActiveAppointmentsPerMember: maxActive,
        },
        one(form, "confirmRetention") === "true"
      ),
    ["/admin/membership/verifications", "/admin/membership/leadership"]
  );
  // A newly set retention period applies from the next list view; queued
  // objects from earlier cleanups are retried now.
  if (result?.code === "SUCCESS")
    after(() => processMembershipStorageDeletions());
  return result;
}

export async function setPositionLimitAction(
  _previous: ReviewActionState,
  form: FormData
): Promise<ReviewActionState> {
  const manager = await getManagerContext();
  if (manager.kind !== "manager" || !can(manager, "settings.verification"))
    return { code: "FORBIDDEN" };
  const position = one(form, "position");
  const level = one(form, "level") ?? "team";
  const max = optionalInt(one(form, "maxHolders"));
  if (level !== "team" && level !== "committee")
    return { code: "VALIDATION_ERROR", field: "level" };
  if (!position || !POSITION.test(position) || !inRange(max, 1, 50))
    return { code: "VALIDATION_ERROR", field: "maxHolders" };
  return run(
    () => setPositionLimit(manager.userId, position, level, max),
    ["/admin/membership/verifications", "/admin/membership/leadership"]
  );
}

/**
 * Opens or closes new leadership requests (ADR 0026), from Membership →
 * Leadership: settings.verification (ADR 0027). The routine re-checks and
 * audits. Members see the state on their profile at once; existing
 * appointments and pending requests are unaffected.
 */
export async function setLeadershipRequestsOpenAction(
  _previous: ReviewActionState,
  form: FormData
): Promise<ReviewActionState> {
  const manager = await getManagerContext();
  if (manager.kind !== "manager" || !can(manager, "settings.verification"))
    return { code: "FORBIDDEN" };
  const value = one(form, "open");
  if (value !== "true" && value !== "false")
    return { code: "VALIDATION_ERROR", field: "open" };
  return run(
    () => setLeadershipRequestsOpen(manager.userId, value === "true"),
    ["/admin/membership/leadership"]
  );
}
