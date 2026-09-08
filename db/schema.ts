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

import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const timestamps = {
  createdAt: text("created_at")
    .notNull()
    .default(sql`(current_timestamp)`),
};

// ---------------------------------------------------------------------------
// Member — the central record. Every other table connects back to this one.
// See UC-01. Open decisions on email domain restriction, university_id
// format, and whether year/major are required at registration are tracked
// in UC-01_Deep_Dive.pdf, Part 2 — resolve those before loosening the rules
// below.
// ---------------------------------------------------------------------------
export const members = sqliteTable("members", {
  id: id(),
  fullName: text("full_name").notNull(),
  email: text("email").notNull().unique(), // compared case-insensitively in app code
  universityId: text("university_id").notNull().unique(),
  year: integer("year"),
  major: text("major"),
  status: text("status", { enum: ["member", "graduate"] })
    .notNull()
    .default("member"),
  ...timestamps,
});

// ---------------------------------------------------------------------------
// Committee — who is allowed to publish events. Backs role-based access
// (NFR-03): a committee should only manage its own events.
// ---------------------------------------------------------------------------
export const committees = sqliteTable("committees", {
  id: id(),
  name: text("name").notNull().unique(), // e.g. "Events", "Media", "Archive"
});

// ---------------------------------------------------------------------------
// Event — one thing on the calendar. See UC-02.
// ---------------------------------------------------------------------------
export const events = sqliteTable("events", {
  id: id(),
  title: text("title").notNull(),
  description: text("description"),
  eventDate: text("event_date").notNull(),
  location: text("location"),
  committeeId: text("committee_id")
    .notNull()
    .references(() => committees.id),
  status: text("status", { enum: ["draft", "published", "full"] })
    .notNull()
    .default("draft"),
  ...timestamps,
});

// ---------------------------------------------------------------------------
// Registration — joins Member + Event. The busiest table in the system:
// registration, attendance, and (indirectly) certificates all pass through
// here. See UC-02 and UC-03.
// ---------------------------------------------------------------------------
export const registrations = sqliteTable("registrations", {
  id: id(),
  memberId: text("member_id")
    .notNull()
    .references(() => members.id),
  eventId: text("event_id")
    .notNull()
    .references(() => events.id),
  attended: integer("attended", { mode: "boolean" }).notNull().default(false),
  checkedInAt: text("checked_in_at"),
  registeredAt: text("registered_at")
    .notNull()
    .default(sql`(current_timestamp)`),
});

// ---------------------------------------------------------------------------
// Certificate — points to Registration only, not to Member or Event
// directly, since Registration already knows both. See UC-04 and the field
// note in Technical_Blueprint.pdf on why we don't duplicate those foreign
// keys here.
// ---------------------------------------------------------------------------
export const certificates = sqliteTable("certificates", {
  id: id(),
  registrationId: text("registration_id")
    .notNull()
    .unique()
    .references(() => registrations.id),
  issuedAt: text("issued_at")
    .notNull()
    .default(sql`(current_timestamp)`),
  certificateUrl: text("certificate_url").notNull(), // R2 object URL
});

// ---------------------------------------------------------------------------
// Archive item — Phase 3. See UC-05 and UC-06. driveBackupUrl is nullable on
// purpose: only items migrated from Drive fill it in.
// ---------------------------------------------------------------------------
export const archiveItems = sqliteTable("archive_items", {
  id: id(),
  title: text("title").notNull(),
  type: text("type", { enum: ["project", "magazine"] }).notNull(),
  year: integer("year").notNull(),
  team: text("team"),
  fileUrl: text("file_url").notNull(), // R2 object URL
  uploadedBy: text("uploaded_by")
    .notNull()
    .references(() => members.id),
  source: text("source", { enum: ["native", "migrated"] })
    .notNull()
    .default("native"),
  driveBackupUrl: text("drive_backup_url"),
  ...timestamps,
});

// ---------------------------------------------------------------------------
// Mentorship connection — Phase 4. Not built yet. Defined here only so the
// schema is stable ahead of time. See UC-07.
// ---------------------------------------------------------------------------
export const mentorshipConnections = sqliteTable("mentorship_connections", {
  id: id(),
  graduateId: text("graduate_id")
    .notNull()
    .references(() => members.id),
  memberId: text("member_id")
    .notNull()
    .references(() => members.id),
  status: text("status", { enum: ["requested", "confirmed"] })
    .notNull()
    .default("requested"),
  ...timestamps,
});
