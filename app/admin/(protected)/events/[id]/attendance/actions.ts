"use server";
import { getManagerContext } from "@/lib/auth/manager";
import { isUuid } from "@/lib/admin-events/types";
import { listAttendance, manageCheckin } from "@/lib/event-management/server";
import { attendanceQr, attendanceUrl } from "@/lib/event-management/qr";

export async function attendanceListAction(
  event: string,
  filter: string,
  search: string,
  after: string | null = null
) {
  const actor = await getManagerContext();
  if (
    actor.kind !== "manager" ||
    !isUuid(event) ||
    (after !== null && !isUuid(after)) ||
    !["all", "attended", "absent", "waitlisted"].includes(filter) ||
    search.length > 200
  )
    return { code: "VALIDATION_ERROR" } as const;
  try {
    const [data, session] = await Promise.all([
      listAttendance(actor.userId, event, filter, search, after),
      manageCheckin(actor.userId, event, "read"),
    ]);
    return { ...data, session };
  } catch {
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
    const url = attendanceUrl(event, session.challenge);
    return { ...session, url, qr: await attendanceQr(url) };
  } catch {
    return { code: "SERVER_ERROR" } as const;
  }
}
