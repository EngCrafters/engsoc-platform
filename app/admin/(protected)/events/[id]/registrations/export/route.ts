import { NextResponse } from "next/server";
import { getManagerContext } from "@/lib/auth/manager";
import {
  countAdminRegistrations,
  exportAdminRegistrations,
} from "@/lib/admin-registrations/server";
import { parseRegistrationStatus } from "@/lib/admin-registrations/types";
import { buildRegistrationCsv } from "@/lib/admin-registrations/csv";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    return new NextResponse("Forbidden", { status: 403 });
  const manager = await getManagerContext();
  if (manager.kind !== "manager")
    return new NextResponse("Not found", { status: 404 });
  const { id } = await params;
  const status = parseRegistrationStatus(
    new URL(request.url).searchParams.get("status") ?? undefined
  );
  const counts = await countAdminRegistrations(manager.userId, id).catch(
    () => null
  );
  if (!counts) return new NextResponse("Not found", { status: 404 });
  const rows = await exportAdminRegistrations(manager.userId, id, status).catch(
    () => null
  );
  if (!rows) return new NextResponse("Export unavailable", { status: 503 });
  const csv = buildRegistrationCsv(rows);
  return new NextResponse("\uFEFF" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="registrations-${id}-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
