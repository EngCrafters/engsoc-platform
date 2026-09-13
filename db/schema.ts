// Database schema for the Engineering Society platform.
//
// This file is the direct implementation of Technical_Blueprint.pdf, Part 2
// (Full data model, v1.0). Every table below maps to one box in that diagram.
// If you need a field that isn't here, update the ER diagram first (open a
// short ADR note), then add it here. Don't add a column that isn't backed by
// a decision, see UC-01_Deep_Dive.pdf, Part 2 for why.
//
// Phase note: committees, events, registrations, and certificates are built
// in Phase 1 and 2. archiveItems is Phase 3. mentorshipConnections is Phase 4,
// the table is defined now so the schema doesn't need to change later, but
// no UI or logic touches it until Phase 4 actually starts.
//
// Runs on Supabase Postgres. `members.id` matches Supabase Auth's user id
// (auth.users.id), authentication itself is handled by Supabase Auth, not
// modeled as a table here.

import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  uuid,
  pgEnum,
} from "drizzle-orm/pg-core";

export const memberStatus = pgEnum("member_status", ["member", "graduate"]);
export const eventStatus = pgEnum("event_status", [
  "draft",
  "published",
  "full",
]);
export const archiveType = pgEnum("archive_type", ["project", "magazine"]);
export const archiveSource = pgEnum("archive_source", ["native", "migrated"]);
export const mentorshipStatus = pgEnum("mentorship_status", [
  "requested",
  "confirmed",
]);

// ---------------------------------------------------------------------------
// Member — the central record. Every other table connects back to this one.
// See UC-01. Open decisions on email domain restriction, university_id
// format, and whether year/major are required at registration are tracked
// in UC-01_Deep_Dive.pdf, Part 2 — resolve those before loosening the rules
// below.
//
// id matches auth.users.id from Supabase Auth (one-to-one), so login and
// profile stay linked without a separate foreign key table.
// ---------------------------------------------------------------------------
export const members = pgTable("members", {
  id: uuid("id").primaryKey(), // = auth.users.id
  fullName: text("full_name").notNull(),
  email: text("email").notNull().unique(), // compared case-insensitively in app code
  universityId: text("university_id").notNull().unique(),
  year: integer("year"),
  major: text("major"),
  status: memberStatus("status").notNull().default("member"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// Committee — who is allowed to publish events. Backs role-based access
// (NFR-03) via Supabase Row Level Security policies keyed on this table.
// ---------------------------------------------------------------------------
export const committees = pgTable("committees", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(), // e.g. "Events", "Media", "Archive"
});

// ---------------------------------------------------------------------------
// Event — one thing on the calendar. See UC-02.
// ---------------------------------------------------------------------------
export const events = pgTable("events", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  description: text("description"),
  eventDate: timestamp("event_date", { withTimezone: true }).notNull(),
  location: text("location"),
  committeeId: uuid("committee_id")
    .notNull()
    .references(() => committees.id),
  status: eventStatus("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// Registration — joins Member + Event. The busiest table in the system:
// registration, attendance, and (indirectly) certificates all pass through
// here. See UC-02 and UC-03.
//
// memberId is nullable on purpose: UC-02 (event registration) is being built
// before UC-01 (member profiles), so a registration must be able to exist
// with no Member row yet. attendeeName/attendeeEmail capture who the person
// is in that case. When UC-01 ships, a person will be able to link past
// registrations to their new profile (likely matched by email) — that
// linking flow isn't built yet. See CLAUDE.md, "Current build decision" and
// docs/adr/0004-nullable-member-id-on-registration.md. Any code reading
// memberId must handle the null case (certificate generation, attendance
// display, etc.) — don't assume it's always present.
// ---------------------------------------------------------------------------
export const registrations = pgTable("registrations", {
  id: uuid("id").primaryKey().defaultRandom(),
  memberId: uuid("member_id").references(() => members.id),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id),
  attendeeName: text("attendee_name").notNull(),
  attendeeEmail: text("attendee_email").notNull(),
  attended: boolean("attended").notNull().default(false),
  checkedInAt: timestamp("checked_in_at", { withTimezone: true }),
  registeredAt: timestamp("registered_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// Certificate — points to Registration only, not to Member or Event
// directly, since Registration already knows both. See UC-04 and the field
// note in Technical_Blueprint.pdf on why we don't duplicate those foreign
// keys here.
// ---------------------------------------------------------------------------
export const certificates = pgTable("certificates", {
  id: uuid("id").primaryKey().defaultRandom(),
  registrationId: uuid("registration_id")
    .notNull()
    .unique()
    .references(() => registrations.id),
  issuedAt: timestamp("issued_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  certificateUrl: text("certificate_url").notNull(), // Supabase Storage object URL
});

// ---------------------------------------------------------------------------
// Archive item — Phase 3. See UC-05 and UC-06. driveBackupUrl is nullable on
// purpose: only items migrated from Drive fill it in.
// ---------------------------------------------------------------------------
export const archiveItems = pgTable("archive_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  type: archiveType("type").notNull(),
  year: integer("year").notNull(),
  team: text("team"),
  fileUrl: text("file_url").notNull(), // Supabase Storage object URL
  uploadedBy: uuid("uploaded_by")
    .notNull()
    .references(() => members.id),
  source: archiveSource("source").notNull().default("native"),
  driveBackupUrl: text("drive_backup_url"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// Mentorship connection — Phase 4. Not built yet. Defined here only so the
// schema is stable ahead of time. See UC-07.
// ---------------------------------------------------------------------------
export const mentorshipConnections = pgTable("mentorship_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  graduateId: uuid("graduate_id")
    .notNull()
    .references(() => members.id),
  memberId: uuid("member_id")
    .notNull()
    .references(() => members.id),
  status: mentorshipStatus("status").notNull().default("requested"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
