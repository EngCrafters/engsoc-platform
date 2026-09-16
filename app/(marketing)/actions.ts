"use server";

// Server Action for UC-02's registration form. Deliberately thin: it only
// adapts a form submission (FormData + request headers) into the plain
// input shape lib/registrations expects, and adapts the result back into
// state the form can render. All the actual rules — validation, the rate
// limit, event-status checks — live in lib/registrations, not here. See
// that module's README for why.
//
// No API route exists or is needed for this — this function is called
// directly from the client component's <form action={...}>.

import { headers } from "next/headers";
import { isIP } from "node:net";
import {
  registerForEvent,
  type RegisterForEventError,
} from "@/lib/registrations";

export type RegisterActionState =
  | { status: "idle" }
  | { status: "success"; waitlisted?: boolean }
  | { status: "error"; error: RegisterForEventError };

export const initialRegisterActionState: RegisterActionState = {
  status: "idle",
};

// Vercel (and most proxies) set x-forwarded-for to "client, proxy1, proxy2"
// — the first entry is the original client. Falls back to a fixed address
// in local dev, where nothing sets this header; every local request then
// shares one rate-limit bucket, which is fine, this only matters once
// there's a real proxy in front of the app.
function getClientIp(headersList: Awaited<ReturnType<typeof headers>>): string {
  const forwardedFor = headersList.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first && isIP(first) !== 0) return first;
  }
  const realIp = headersList.get("x-real-ip");
  if (realIp && isIP(realIp) !== 0) return realIp;
  return process.env.NODE_ENV === "development" ? "127.0.0.1" : "invalid";
}

export async function registerForEventAction(
  _prevState: RegisterActionState,
  formData: FormData
): Promise<RegisterActionState> {
  const eventId = String(formData.get("eventId") ?? "");
  const attendeeName = String(formData.get("attendeeName") ?? "");
  const attendeeEmail = String(formData.get("attendeeEmail") ?? "");
  const intentValue = String(formData.get("intent") ?? "register");
  const intent = intentValue === "join_waitlist" ? "join_waitlist" : "register";
  const ipAddress = getClientIp(await headers());

  const result = await registerForEvent({
    eventId,
    attendeeName,
    attendeeEmail,
    intent,
    ipAddress,
  });

  if (!result.ok) {
    return { status: "error", error: result.error };
  }
  return { status: "success", waitlisted: result.waitlisted === true };
}
