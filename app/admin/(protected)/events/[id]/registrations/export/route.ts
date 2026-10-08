import { NextResponse } from "next/server";
import { getManagerContext } from "@/lib/auth/manager";
import {
  countAdminRegistrations,
  exportAdminRegistrations,
} from "@/lib/admin-registrations/server";
import { parseRegistrationStatus } from "@/lib/admin-registrations/types";
import { buildRegistrationCsv } from "@/lib/admin-registrations/csv";
import { isUuid } from "@/lib/admin-events/types";
import { isSameOriginPost } from "@/lib/security/request-origin";

const MAX_EXPORT_ROWS = 10_000;
const MAX_EXPORT_BYTES = 10 * 1024 * 1024;

function failure(message: string, status: number) {
  return new NextResponse(message, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isSameOriginPost(request)) {
    return failure(
      "This export request came from another site. Return to the registration page and try again.",
      403
    );
  }
  const manager = await getManagerContext();
  if (manager.kind !== "manager")
    return failure(
      "Sign in with administrative access to export registrations.",
      401
    );
  const { id } = await params;
  if (!isUuid(id))
    return failure(
      "This event link is invalid. Return to the event and try again.",
      400
    );
  const statuses = new URL(request.url).searchParams.getAll("status");
  if (
    statuses.length !== 1 ||
    !["confirmed", "waitlisted"].includes(statuses[0])
  )
    return failure(
      "Choose confirmed or waitlisted registrations, then try the export again.",
      400
    );
  const status = parseRegistrationStatus(statuses[0]);
  let counts;
  try {
    counts = await countAdminRegistrations(manager.userId, id);
  } catch {
    return failure(
      "Registrations are temporarily unavailable. Try the export again shortly.",
      503
    );
  }
  if (!counts)
    return failure(
      "This event is unavailable in your committee scope. Refresh the event list or contact platform maintenance.",
      404
    );
  const expectedCount =
    status === "confirmed" ? counts.confirmed_count : counts.waitlisted_count;
  if (expectedCount > MAX_EXPORT_ROWS)
    return failure(
      "This export exceeds 10,000 rows. Contact platform maintenance for a larger export.",
      413
    );
  let rows;
  try {
    rows = await exportAdminRegistrations(manager.userId, id, status);
  } catch {
    return failure("The export could not be prepared. Try again shortly.", 503);
  }
  if (rows.length !== expectedCount)
    return failure(
      "Registrations changed or the export limit was reached. Refresh the page and try again; contact platform maintenance if it persists.",
      409
    );
  const csv = buildRegistrationCsv(rows);
  if (Buffer.byteLength(csv, "utf8") > MAX_EXPORT_BYTES)
    return failure(
      "This export exceeds 10 MiB. Contact platform maintenance for a larger export.",
      413
    );
  return new NextResponse("\uFEFF" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="registrations-${id}-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
