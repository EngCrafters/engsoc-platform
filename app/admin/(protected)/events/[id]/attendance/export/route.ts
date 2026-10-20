import { getManagerContext } from "@/lib/auth/manager";
import { isUuid } from "@/lib/admin-events/types";
import { isSameOriginPost } from "@/lib/security/request-origin";
import { listAttendance } from "@/lib/event-management/server";
const fail = (status: number) =>
  new Response("Attendance export unavailable. Refresh and try again.", {
    status,
    headers: { "cache-control": "private, no-store" },
  });
const cell = (value: string) =>
  `"${(/^[\s]*[=+\-@\t\r]/.test(value) ? "'" + value : value).replaceAll('"', '""')}"`;
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isSameOriginPost(request)) return fail(403);
  const manager = await getManagerContext();
  if (manager.kind !== "manager") return fail(401);
  const { id } = await params;
  if (!isUuid(id)) return fail(400);
  const declared = Number(request.headers.get("content-length"));
  if (declared > 4096) return fail(413);
  const body = await request.text();
  if (body.length > 4096) return fail(413);
  const form = new URLSearchParams(body);
  if (form.getAll("filter").length !== 1 || form.getAll("search").length !== 1)
    return fail(400);
  try {
    const data = await listAttendance(
      manager.userId,
      id,
      form.get("filter")!,
      form.get("search")!,
      null,
      10000,
      true
    );
    if (data.code !== "SUCCESS")
      return fail(
        data.code === "NOT_FOUND"
          ? 404
          : data.code === "EXPORT_LIMIT"
            ? 413
            : 400
      );
    const lines = [
      [
        "Name",
        "Email",
        "Registration",
        "Attendance",
        "Checked in (UTC)",
        "Registered (UTC)",
      ],
      ...data.rows.map((r) => [
        r.name,
        r.email,
        r.status,
        r.attended ? "attended" : "not checked in",
        r.checkedInAt ?? "",
        r.registeredAt,
      ]),
    ];
    const csv =
      "\uFEFF" + lines.map((row) => row.map(cell).join(",")).join("\r\n");
    if (Buffer.byteLength(csv) > 10 * 1024 * 1024) return fail(413);
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="attendance-${id}.csv"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return fail(503);
  }
}
