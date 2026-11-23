import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { logServerError } from "@/lib/api/log";
import { dispatchEmailBatch } from "@/lib/email/dispatch";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Sends one bounded batch of queued Email Centre deliveries (ADR 0028), for a scheduler such as
 * Vercel Cron (which sends `Authorization: Bearer <CRON_SECRET>`) or any other caller holding the
 * secret. Without EMAIL_DISPATCH_SECRET (or CRON_SECRET) configured the route refuses everything.
 * Each call finishes its batch before answering.
 */
function authorized(request: Request) {
  const secret =
    process.env.EMAIL_DISPATCH_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim();
  if (!secret || secret.length < 32) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function run(request: Request) {
  if (!authorized(request))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const result = await dispatchEmailBatch();
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    logServerError("email_dispatch_failed", error);
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}

export const GET = run;
export const POST = run;
