// Hidden implementation of the registrations domain — queries against
// db/schema.ts's `registrations`, `events`, and `registration_attempts`
// tables. Nothing outside lib/registrations/ should import this file
// directly; go through index.ts instead.

import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "@/db";
import { events, registrationAttempts, registrations } from "@/db/schema";

export const RATE_LIMIT_WINDOW_MINUTES = 10;
export const RATE_LIMIT_MAX_ATTEMPTS = 5;

/** Attempts from this IP in the last RATE_LIMIT_WINDOW_MINUTES, not counting this one. */
export async function countRecentAttempts(ipAddress: string): Promise<number> {
  const windowStart = new Date(
    Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000
  );
  const rows = await db
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(registrationAttempts)
    .where(
      and(
        eq(registrationAttempts.ipAddress, ipAddress),
        gt(registrationAttempts.createdAt, windowStart)
      )
    );
  return rows[0]?.count ?? 0;
}

/** Logs this attempt, allowed or not — see docs/adr/0005's Decision section. */
export async function recordAttempt(ipAddress: string): Promise<void> {
  await db.insert(registrationAttempts).values({ ipAddress });
}

export async function findEventForRegistration(
  eventId: string
): Promise<{ id: string; status: "draft" | "published" | "full" } | null> {
  const rows = await db
    .select({ id: events.id, status: events.status })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);
  return rows[0] ?? null;
}

export async function insertRegistration(input: {
  eventId: string;
  attendeeName: string;
  attendeeEmail: string;
}): Promise<void> {
  // memberId left null on purpose — see docs/adr/0004 and CLAUDE.md's
  // "Current build decision": UC-01 (member profiles) doesn't exist yet,
  // so every registration is captured this way for now.
  await db.insert(registrations).values({
    eventId: input.eventId,
    attendeeName: input.attendeeName,
    attendeeEmail: input.attendeeEmail,
    memberId: null,
  });
}
