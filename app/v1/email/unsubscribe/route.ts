import { logServerError } from "@/lib/api/log";
import { unsubscribeDelivery } from "@/lib/email/server";
import { verifyUnsubscribeToken } from "@/lib/email/unsubscribe";
export const dynamic = "force-dynamic";

/**
 * The signed unsubscribe link in every Email Centre message (ADR 0028). GET shows a confirmation
 * page, so a link scanner opening it unsubscribes nobody. POST unsubscribes: the page's button and
 * mail clients' one-click unsubscribe (RFC 8058, `List-Unsubscribe=One-Click`). It turns off
 * optional announcements only; membership is unchanged.
 */

const escape = (value: string) =>
  value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function page(title: string, body: string, status = 200) {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escape(title)}</title><style>body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Tahoma,Arial,sans-serif;background:#f8fafc;color:#111827}main{max-width:560px;margin:10vh auto;padding:24px;background:#fff;border:1px solid #e5e7eb;border-radius:12px}h1{font-size:22px;margin:0 0 12px}p{line-height:1.6}button{font:inherit;padding:10px 16px;border-radius:8px;border:none;background:#111827;color:#fff;cursor:pointer}[dir=rtl]{text-align:right}</style></head><body><main>${body}</main></body></html>`,
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    }
  );
}

const invalid = () =>
  page(
    "Link not valid",
    `<h1>This link is not valid</h1><p>It may be incomplete. You can turn announcements off on your profile on the Engineering Society website.</p><p dir="rtl" lang="ar">هذا الرابط غير صالح. يمكنك إيقاف الإعلانات من ملفك الشخصي على موقع الجمعية الهندسية.</p>`,
    400
  );

function tokenOf(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  return verifyUnsubscribeToken(token, process.env.EMAIL_UNSUBSCRIBE_SECRET)
    ? token
    : null;
}

export async function GET(request: Request) {
  const token = tokenOf(request);
  if (!token) return invalid();
  return page(
    "Unsubscribe from announcements",
    `<h1>Unsubscribe from announcements?</h1><p>You will no longer receive the Engineering Society's optional announcements by email. Your membership does not change, and you can turn them back on from your profile.</p><p dir="rtl" lang="ar">لن تصلك إعلانات الجمعية الهندسية الاختيارية عبر البريد. لا تتغير عضويتك، ويمكنك إعادة تفعيلها من ملفك الشخصي.</p><form method="post"><input type="hidden" name="List-Unsubscribe" value="One-Click"><button type="submit">Unsubscribe · إلغاء الاشتراك</button></form>`
  );
}

export async function POST(request: Request) {
  const token = tokenOf(request);
  const delivery = token
    ? verifyUnsubscribeToken(token, process.env.EMAIL_UNSUBSCRIBE_SECRET)
    : null;
  if (!delivery) return invalid();
  try {
    const result = await unsubscribeDelivery(delivery);
    if (result.code !== "SUCCESS") return invalid();
  } catch (error) {
    logServerError("email_unsubscribe_failed", error);
    return page(
      "Try again",
      `<h1>Something went wrong</h1><p>Your choice was not saved. Please try again shortly.</p>`,
      503
    );
  }
  return page(
    "Unsubscribed",
    `<h1>You are unsubscribed</h1><p>You will no longer receive optional announcements by email. You can turn them back on from your profile on the Engineering Society website.</p><p dir="rtl" lang="ar">تم إلغاء اشتراكك في الإعلانات الاختيارية. يمكنك إعادة تفعيلها من ملفك الشخصي.</p>`
  );
}
