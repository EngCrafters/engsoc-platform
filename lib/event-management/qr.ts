import "server-only";
import QRCode from "qrcode";
import type { CheckinSession } from "./server";

export function attendanceUrl(eventId: string, checkinCode?: string) {
  const origin = new URL(
    process.env.PUBLIC_WEBSITE_ORIGIN ?? "https://essqu.com"
  );
  if (
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== "/" ||
    (origin.protocol !== "https:" &&
      // Plain http only for a loopback website outside Vercel production,
      // matching the API's own origin rule.
      !(
        process.env.VERCEL_ENV !== "production" &&
        origin.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(origin.hostname)
      ))
  )
    throw new Error("Invalid public website origin");
  const url = new URL(`/events/${eventId}/attendance`, origin);
  if (checkinCode) url.hash = `checkin=${checkinCode}`;
  return url.href;
}
export async function attendanceQr(url: string) {
  return QRCode.toDataURL(url, {
    errorCorrectionLevel: "M",
    width: 720,
    margin: 4,
  });
}

/**
 * What an organizer screen shows: while check-in is open, the live code for
 * the current minute (every screen derives the same one); otherwise the
 * attendance page, where members can sign in ahead of time.
 */
export async function checkinDisplay(eventId: string, session: CheckinSession) {
  const live = session.isOpen && session.checkinCode;
  const url = attendanceUrl(eventId, live ? session.checkinCode! : undefined);
  return { ...session, url, qr: await attendanceQr(url) };
}
