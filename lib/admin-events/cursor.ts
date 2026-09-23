import { isUuid, type AdminEventCursor, type AdminEventFilter } from "./types";

const MAX_CURSOR_BYTES = 1024;
type CursorScope = { committeeId: string | null; filter: AdminEventFilter };

export function encodeAdminEventCursor(
  cursor: AdminEventCursor,
  scope: CursorScope
): string {
  return Buffer.from(
    JSON.stringify({ ...cursor, ...scope, v: 1, resource: "admin-events" })
  ).toString("base64url");
}

export function decodeAdminEventCursor(
  value: string | undefined,
  scope: CursorScope
): { cursor: AdminEventCursor | null; invalid: boolean } {
  if (!value) return { cursor: null, invalid: false };
  if (Buffer.byteLength(value, "utf8") > MAX_CURSOR_BYTES)
    return { cursor: null, invalid: true };
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8")
    );
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !("v" in parsed) ||
      !("resource" in parsed) ||
      !("eventDate" in parsed) ||
      !("id" in parsed) ||
      !("committeeId" in parsed) ||
      !("filter" in parsed) ||
      parsed.v !== 1 ||
      parsed.resource !== "admin-events" ||
      typeof parsed.eventDate !== "string" ||
      typeof parsed.id !== "string" ||
      (typeof parsed.committeeId !== "string" && parsed.committeeId !== null) ||
      typeof parsed.filter !== "string" ||
      !isUuid(parsed.id) ||
      (parsed.committeeId !== null && !isUuid(parsed.committeeId)) ||
      parsed.committeeId !== scope.committeeId ||
      parsed.filter !== scope.filter ||
      Number.isNaN(new Date(parsed.eventDate).getTime())
    )
      return { cursor: null, invalid: true };
    return {
      cursor: {
        eventDate: new Date(parsed.eventDate).toISOString(),
        id: parsed.id,
      },
      invalid: false,
    };
  } catch {
    return { cursor: null, invalid: true };
  }
}
