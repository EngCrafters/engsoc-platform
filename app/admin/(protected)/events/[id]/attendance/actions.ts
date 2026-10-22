"use server";
import { getManagerContext } from "@/lib/auth/manager";
import { isUuid } from "@/lib/admin-events/types";
import {
  listAttendance,
  manageCheckin,
  recordManualAttendance,
  MANUAL_CHECKIN_REASONS,
  MANUAL_UNDO_REASONS,
} from "@/lib/event-management/server";
import { checkinDisplay } from "@/lib/event-management/qr";
import { logServerError } from "@/lib/api/log";

export async function attendanceListAction(
  event: string,
  filter: string,
  search: string,
  offset = 0
) {
  const actor = await getManagerContext();
  if (
    actor.kind !== "manager" ||
    !isUuid(event) ||
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset > 100_000 ||
    !["all", "attended", "absent", "waitlisted"].includes(filter) ||
    search.length > 200
  )
    return { code: "VALIDATION_ERROR" } as const;
  try {
    const [data, session] = await Promise.all([
      listAttendance(actor.userId, event, filter, search, offset),
      manageCheckin(actor.userId, event, "read"),
    ]);
    return {
      ...data,
      session:
        session.code === "SUCCESS"
          ? await checkinDisplay(event, session)
          : null,
    };
  } catch (error) {
    logServerError("attendance_list_failed", error);
    return { code: "SERVER_ERROR" } as const;
  }
}
export async function checkinAction(
  event: string,
  operation: string,
  minutes = 60
) {
  const actor = await getManagerContext();
  if (
    actor.kind !== "manager" ||
    !isUuid(event) ||
    !["read", "open", "rotate", "close"].includes(operation) ||
    !Number.isInteger(minutes) ||
    minutes < 1 ||
    minutes > 720
  )
    return { code: "VALIDATION_ERROR" } as const;
  try {
    const session = await manageCheckin(
      actor.userId,
      event,
      operation,
      operation === "open"
        ? new Date(Date.now() + minutes * 60_000).toISOString()
        : null
    );
    if (session.code !== "SUCCESS") return session;
    return await checkinDisplay(event, session);
  } catch (error) {
    logServerError("checkin_session_failed", error);
    return { code: "SERVER_ERROR" } as const;
  }
}
/** Organizer-assisted attendance; the database enforces scope, eligibility and the audit. */
export async function manualAttendanceAction(
  event: string,
  registration: string,
  attended: boolean,
  reason: string
) {
  const actor = await getManagerContext();
  const reasons: readonly string[] = attended
    ? MANUAL_CHECKIN_REASONS
    : MANUAL_UNDO_REASONS;
  if (
    actor.kind !== "manager" ||
    !isUuid(event) ||
    !isUuid(registration) ||
    typeof attended !== "boolean" ||
    !reasons.includes(reason)
  )
    return { code: "VALIDATION_ERROR" } as const;
  try {
    return await recordManualAttendance(
      actor.userId,
      event,
      registration,
      attended,
      reason
    );
  } catch (error) {
    logServerError("manual_attendance_failed", error);
    return { code: "SERVER_ERROR" } as const;
  }
}
