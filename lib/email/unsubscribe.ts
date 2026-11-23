import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed one-click unsubscribe links (ADR 0028): `<deliveryId>.<signature>`, where the signature
 * is HMAC-SHA256 of the delivery id under EMAIL_UNSUBSCRIBE_SECRET. Nothing is stored, the link
 * stays the same across retries, and a link cannot be forged for another delivery.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const sign = (deliveryId: string, secret: string) =>
  createHmac("sha256", secret)
    .update(`unsubscribe:${deliveryId}`)
    .digest("base64url");

export function unsubscribeToken(deliveryId: string, secret: string): string {
  return `${deliveryId}.${sign(deliveryId, secret)}`;
}

/** The delivery id a token was issued for, or null when it is malformed or forged. */
export function verifyUnsubscribeToken(
  token: string,
  secret: string | undefined
): string | null {
  if (!secret || secret.length < 32 || token.length > 200) return null;
  const [id, signature, ...rest] = token.split(".");
  if (rest.length || !id || !signature || !UUID.test(id)) return null;
  const expected = Buffer.from(sign(id, secret));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given)
    ? id
    : null;
}

/** The public link (Core's /v1/email/unsubscribe), from APP_ORIGIN. */
export function unsubscribeUrl(
  token: string,
  origin = process.env.APP_ORIGIN
): string | null {
  if (!origin) return null;
  try {
    const url = new URL("/v1/email/unsubscribe", origin);
    url.searchParams.set("token", token);
    return url.toString();
  } catch {
    return null;
  }
}
