import { notFound } from "next/navigation";
import Link from "next/link";
import { getManagerContext } from "@/lib/auth/manager";
import { getAdminEvent } from "@/lib/admin-events/server";
import { listAttendance, manageCheckin } from "@/lib/event-management/server";
import {
  attendanceQr,
  attendanceUrl,
  checkinDisplay,
} from "@/lib/event-management/qr";
import { AdminPageHeader } from "@/components/admin/page-header";
import { AttendanceManager } from "./view";
export const metadata = { referrer: "same-origin" as const };
export default async function AttendancePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ id }, manager] = await Promise.all([params, getManagerContext()]);
  if (manager.kind !== "manager") return null;
  const event = await getAdminEvent(manager.userId, id);
  if (!event) notFound();
  const [session, list] = await Promise.all([
    manageCheckin(manager.userId, id, "read"),
    listAttendance(manager.userId, id),
  ]);
  const [display, printQr] = await Promise.all([
    checkinDisplay(id, session),
    attendanceQr(attendanceUrl(id)),
  ]);
  return (
    <section className="flex flex-col gap-6">
      <AdminPageHeader
        title={`Attendance · ${event.title}`}
        description="Display the live QR, control check-in and follow attendance."
        actions={
          <Link href={`/admin/events/${id}`} className="text-sm underline">
            Back to event
          </Link>
        }
      />
      <AttendanceManager
        eventId={id}
        title={event.title}
        initialSession={display}
        printQr={printQr}
        initialList={list}
      />
    </section>
  );
}
