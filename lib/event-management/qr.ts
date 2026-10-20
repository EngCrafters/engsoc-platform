import "server-only";
import QRCode from "qrcode";

export function attendanceUrl(eventId: string, challenge?: string) {
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
      !(
        process.env.NODE_ENV !== "production" &&
        origin.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(origin.hostname)
      ))
  )
    throw new Error("Invalid public website origin");
  const url = new URL(`/events/${eventId}/attendance`, origin);
  if (challenge) url.hash = `checkin=${challenge}`;
  return url.href;
}
export async function attendanceQr(url: string) {
  return QRCode.toDataURL(url, {
    errorCorrectionLevel: "M",
    width: 720,
    margin: 4,
  });
}
