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
import { registerForEvent } from "@/lib/registrations";
import type { RegisterActionState } from "./action-state";

// Vercel (and most proxies) set x-forwarded-for to "client, proxy1, proxy2"
// — the first entry is the original client. Falls back to a fixed address
// in local dev, where nothing sets this header; every local request then
// shares one rate-limit bucket, which is fine, this only matters once
// there's a real proxy in front of the app.
async function getClientIp(headersList: Headers): Promise<string> {
  const forwardedFor = headersList.get("x-vercel-forwarded-for")?.trim();
  if (forwardedFor && isIP(forwardedFor) !== 0) return forwardedFor;
  return process.env.NODE_ENV === "development" ? "127.0.0.1" : "invalid";
}

function getSingleTextField(
  formData: FormData,
  name: string
): string | undefined {
  const values = formData.getAll(name);
  return values.length === 1 && typeof values[0] === "string"
    ? values[0]
    : undefined;
}

function hasUnexpectedDomainFields(formData: FormData) {
  const allowed = new Set([
    "eventId",
    "attendeeName",
    "attendeeEmail",
    "attendeePhone",
    "intent",
  ]);
  return [...formData.keys()].some(
    (name) => !allowed.has(name) && !name.startsWith("$ACTION_")
  );
}

export async function registerForEventAction(
  _prevState: RegisterActionState,
  formData: FormData
): Promise<RegisterActionState> {
  const eventId = getSingleTextField(formData, "eventId");
  const attendeeName = getSingleTextField(formData, "attendeeName");
  const attendeeEmail = getSingleTextField(formData, "attendeeEmail");
  const attendeePhone = getSingleTextField(formData, "attendeePhone");
  const intentValue = getSingleTextField(formData, "intent");
  // The phone is only required to be *present* here. A missing or duplicated
  // field is a malformed submission, but an empty one is a visitor who did not
  // fill it in — that is passed to the domain so it comes back as
  // invalid_phone and the form can point at that field.
  if (
    !eventId ||
    !attendeeName ||
    !attendeeEmail ||
    attendeePhone === undefined ||
    !intentValue ||
    hasUnexpectedDomainFields(formData)
  ) {
    return { status: "error", error: "invalid_input" };
  }
  const intent = intentValue === "join_waitlist" ? "join_waitlist" : "register";
  const ipAddress = await getClientIp(await headers());

  const result = await registerForEvent({
    eventId,
    attendeeName,
    attendeeEmail,
    attendeePhone,
    intent,
    ipAddress,
  });

  if (!result.ok) {
    return { status: "error", error: result.error };
  }
  return { status: "success", waitlisted: result.waitlisted === true };
}
