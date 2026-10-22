import type { MembershipCursor, MembershipFilter } from "./server";

/**
 * The list page's "next" link carries an opaque base64url cursor bound to its
 * filter and search, so a cursor from one view cannot be replayed in another.
 * The position is the routine's exact microsecond text, never a rounded Date.
 */

type Payload = { v: 1; f: MembershipFilter; q: string; at: string; id: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRECISE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

export function encodeMembershipCursor(
  cursor: MembershipCursor,
  view: { filter: MembershipFilter; query: string | null }
): string {
  const payload: Payload = {
    v: 1,
    f: view.filter,
    q: view.query ?? "",
    at: cursor.submittedAt,
    id: cursor.id,
  };
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

export function decodeMembershipCursor(
  value: string | undefined,
  view: { filter: MembershipFilter; query: string | null }
): { cursor: MembershipCursor | null; invalid: boolean } {
  if (!value) return { cursor: null, invalid: false };
  try {
    if (value.length > 400) throw new Error("too long");
    const payload = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8")
    ) as Payload;
    if (
      payload.v !== 1 ||
      payload.f !== view.filter ||
      payload.q !== (view.query ?? "") ||
      !PRECISE.test(payload.at) ||
      !UUID.test(payload.id)
    )
      throw new Error("mismatch");
    return {
      cursor: { submittedAt: payload.at, id: payload.id },
      invalid: false,
    };
  } catch {
    return { cursor: null, invalid: true };
  }
}
