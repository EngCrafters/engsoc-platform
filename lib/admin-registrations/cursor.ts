import {
  isUuid,
  type AdminRegistrationCursor,
  type AdminRegistrationStatus,
} from "./types";

export function encodeRegistrationCursor(
  cursor: AdminRegistrationCursor,
  eventId: string,
  status: AdminRegistrationStatus
) {
  return Buffer.from(
    JSON.stringify({
      v: 1,
      resource: "admin-registrations",
      eventId,
      status,
      ...cursor,
    })
  ).toString("base64url");
}

export function decodeRegistrationCursor(
  value: string | undefined,
  eventId: string,
  status: AdminRegistrationStatus
) {
  if (!value || Buffer.byteLength(value, "utf8") > 1024)
    return { cursor: null, invalid: Boolean(value) };
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8")
    );
    if (!parsed || typeof parsed !== "object")
      return { cursor: null, invalid: true };
    const data = parsed as Record<string, unknown>;
    if (
      data.v !== 1 ||
      data.resource !== "admin-registrations" ||
      data.eventId !== eventId ||
      data.status !== status ||
      typeof data.id !== "string" ||
      !isUuid(data.id) ||
      typeof data.registeredAt !== "string" ||
      Number.isNaN(new Date(data.registeredAt).getTime())
    )
      return { cursor: null, invalid: true };
    return {
      cursor: {
        id: data.id,
        registeredAt: new Date(data.registeredAt as string).toISOString(),
      },
      invalid: false,
    };
  } catch {
    return { cursor: null, invalid: true };
  }
}
