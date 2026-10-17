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
import { resolveClientIp } from "@/lib/client-ip/server";
import { registerForEvent } from "@/lib/registrations";
import type { RegisterActionState } from "./action-state";

// The client address is a security input: it keys the database rate limiter.
// It is resolved in exactly one place (lib/client-ip/server.ts) so this Server
// Action and the public API cannot drift apart. Anything unrecognised fails
// closed rather than being passed through as a made-up address.
async function getClientIp(headersList: Headers): Promise<string> {
  const resolved = resolveClientIp(headersList);
  return resolved.ok ? resolved.ip : "invalid";
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
  const intentValue = getSingleTextField(formData, "intent");
  if (
    !eventId ||
    !attendeeName ||
    !attendeeEmail ||
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
    intent,
    ipAddress,
  });

  if (!result.ok) {
    return { status: "error", error: result.error };
  }
  return { status: "success", waitlisted: result.waitlisted === true };
}
