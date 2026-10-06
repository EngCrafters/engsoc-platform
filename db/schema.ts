// Database schema for the Engineering Society platform.
//
// This file began with Technical_Blueprint.pdf, Part 2 (Full data model,
// v1.0). Later UC-02 migrations and ADR 0012 supersede its access model.
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
  pgSchema,
  text,
  integer,
  boolean,
  timestamp,
  uuid,
  pgEnum,
  inet,
  index,
  uniqueIndex,
  check,
  primaryKey,
  jsonb,
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

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
export const registrationStatus = pgEnum("registration_status", [
  "confirmed",
  "waitlisted",
  "superseded",
]);
export const administrativeAccessLevel = pgEnum("administrative_access_level", [
  "COMMITTEE_MANAGER",
  "BOARD_ADMIN",
  "TECHNICAL",
]);

// ---------------------------------------------------------------------------
// Minimal stub for Supabase's own auth.users table — we don't own or manage
// this schema, we only need to reference its primary key for FKs (committee
// grants, event flag/approval actors, audit actor). See UC-02_Data_and_Security.md
// section 4. Supabase's platform already creates this table: any
// `drizzle-kit generate` output that includes CREATE TABLE "auth"."users"
// must have that one statement removed before the migration is applied
// anywhere except a from-scratch disposable rehearsal database.
// ---------------------------------------------------------------------------
const authSchema = pgSchema("auth");
export const authUsers = authSchema.table("users", {
  id: uuid("id").primaryKey(),
});

// private schema — server-routine-only objects, never exposed through
// PostgREST. See UC-02_Data_and_Security.md section 5.
export const privateSchema = pgSchema("private");

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
  name: text("name").notNull().unique(),
  slug: text("slug").unique(), // null only for isolated legacy rows; authorization uses id
});

// ---------------------------------------------------------------------------
// Administrative access — one row per Auth user, independent of Member.
// An active manager has exactly one committee_id; Board and Technical have
// global application scope and a null committee_id. Technical authority is
// explicit, never inferred from the Technical Team committee display name.
// See ADR 0012 and ACCESS_CONTROL.md. Revocation retains the row and audit.
//
// Access rule (migration 0016): in-app Board/Manager changes use the audited
// change_administrative_access routine, callable only through app_runtime.
// Technical changes use the separate audited Technical-access routine. Neither
// runtime login has direct INSERT/UPDATE access. Authenticated browser users
// may SELECT only their own access row.
// ---------------------------------------------------------------------------
export const administrativeAccess = pgTable(
  "administrative_access",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id),
    committeeId: uuid("committee_id").references(() => committees.id),
    accessLevel: administrativeAccessLevel("access_level")
      .notNull()
      .default("COMMITTEE_MANAGER"),
    grantedAt: timestamp("granted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    grantedBy: uuid("granted_by")
      .notNull()
      .references(() => authUsers.id),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: uuid("revoked_by").references(() => authUsers.id),
  },
  (table) => [
    primaryKey({ columns: [table.userId] }),
    index("administrative_access_committee_user_idx").on(
      table.committeeId,
      table.userId
    ),
    check(
      "administrative_access_revocation_consistency",
      sql`${table.revokedAt} IS NOT NULL OR ${table.revokedBy} IS NULL`
    ),
    check(
      "administrative_access_scope_check",
      sql`(${table.accessLevel} = 'COMMITTEE_MANAGER') = (${table.committeeId} IS NOT NULL)`
    ),
  ]
);

// ---------------------------------------------------------------------------
// Event — one thing on the calendar. See UC-02.
//
// RLS (see docs/UC-02_Data_and_Security.md section 7, superseding
// docs/adr/0006 as of M2): `anon` may SELECT rows where status IN
// ('published','full') and archived_at IS NULL, public columns only.
// `authenticated` SELECT follows live Technical/Board/global or exact Manager
// committee scope (ADR 0012). All writes go through the
// private routines below, never a direct table UPDATE from anon/authenticated.
//
// review_required/flagged_by/approved_by/approved_at/approved_revision are
// the review state (ADR 0012): a different active Board or Technical actor
// approves the current revision. A manager cannot approve; self-approval is
// denied. Editing review-relevant fields clears approval and makes the editor
// the current review subject.
// ---------------------------------------------------------------------------
export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    description: text("description"),
    eventDate: timestamp("event_date", { withTimezone: true }).notNull(),
    location: text("location"),
    committeeId: uuid("committee_id")
      .notNull()
      .references(() => committees.id),
    status: eventStatus("status").notNull().default("draft"),
    capacity: integer("capacity"), // NEW (M2): null = unlimited
    revision: integer("revision").notNull().default(1), // NEW (M2): optimistic concurrency
    archivedAt: timestamp("archived_at", { withTimezone: true }), // NEW (M2)
    reviewRequired: boolean("review_required").notNull().default(false), // NEW (O-01)
    flaggedBy: uuid("flagged_by").references(() => authUsers.id), // NEW (O-01)
    approvedBy: uuid("approved_by").references(() => authUsers.id), // NEW (O-01)
    approvedAt: timestamp("approved_at", { withTimezone: true }), // NEW (O-01)
    approvedRevision: integer("approved_revision"), // NEW (O-01)
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("events_committee_date_idx").on(
      table.committeeId,
      table.eventDate,
      table.id
    ),
    index("events_public_discovery_idx")
      .on(table.eventDate, table.id)
      .where(
        sql`${table.archivedAt} IS NULL AND ${table.status} IN ('published','full')`
      ),
    check(
      "events_title_bounds",
      sql`${table.title} = btrim(${table.title}) AND char_length(${table.title}) BETWEEN 1 AND 200`
    ),
    check(
      "events_description_bounds",
      sql`${table.description} IS NULL OR char_length(${table.description}) <= 10000`
    ),
    check(
      "events_location_bounds",
      sql`${table.location} IS NULL OR char_length(${table.location}) <= 500`
    ),
    check(
      "events_published_requires_description",
      sql`${table.status} = 'draft' OR (${table.description} IS NOT NULL AND char_length(btrim(${table.description})) > 0)`
    ),
    check("events_capacity_positive", sql`${table.capacity} > 0`),
    check("events_revision_positive", sql`${table.revision} > 0`),
    check(
      "events_review_state",
      sql`(${table.reviewRequired} = true AND ${table.flaggedBy} IS NOT NULL) OR (${table.reviewRequired} = false AND ${table.flaggedBy} IS NULL AND ${table.approvedBy} IS NULL AND ${table.approvedAt} IS NULL AND ${table.approvedRevision} IS NULL)`
    ),
    check(
      "events_approval_all_or_nothing",
      sql`(${table.approvedBy} IS NULL AND ${table.approvedAt} IS NULL AND ${table.approvedRevision} IS NULL) OR (${table.approvedBy} IS NOT NULL AND ${table.approvedAt} IS NOT NULL AND ${table.approvedRevision} IS NOT NULL)`
    ),
    check(
      "events_no_self_approval",
      sql`${table.approvedBy} IS NULL OR ${table.flaggedBy} IS NULL OR ${table.approvedBy} <> ${table.flaggedBy}`
    ),
  ]
);

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
//
// RLS (see docs/UC-02_Data_and_Security.md sections 6/7, superseding
// docs/adr/0006 as of M2): direct anon/authenticated table access is DENY
// on every operation. The only public write path is the private
// register_for_event routine (D07: never a raw anon INSERT again — closes
// the rate-limit bypass ADR 0005 identified). `authenticated` may SELECT
// rows whose event is in their current committee grant.
//
// status/superseded_by (NEW, M2) implement the required waitlist (P06) and
// legacy-duplicate preservation without deleting rows: exactly one active
// (confirmed or waitlisted) row exists per (event_id, lower(btrim(email))),
// enforced by the partial unique index below, independent of app checks.
// ---------------------------------------------------------------------------
export const registrations = pgTable(
  "registrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id").references(() => members.id),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    attendeeName: text("attendee_name").notNull(),
    attendeeEmail: text("attendee_email").notNull(),
    status: registrationStatus("status").notNull().default("confirmed"), // NEW (M2)
    supersededBy: uuid("superseded_by").references(
      (): AnyPgColumn => registrations.id
    ), // NEW (M2): self-FK, preserves legacy duplicates without deleting rows
    attended: boolean("attended").notNull().default(false),
    checkedInAt: timestamp("checked_in_at", { withTimezone: true }),
    registeredAt: timestamp("registered_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("registrations_active_event_email_idx")
      .on(table.eventId, table.attendeeEmail)
      .where(sql`${table.status} IN ('confirmed','waitlisted')`),
    index("registrations_event_status_fifo_idx").on(
      table.eventId,
      table.status,
      table.registeredAt,
      table.id
    ),
    check(
      "registrations_superseded_consistency",
      sql`(${table.status} = 'superseded') = (${table.supersededBy} IS NOT NULL)`
    ),
    check(
      "registrations_no_self_supersede",
      sql`${table.supersededBy} IS NULL OR ${table.supersededBy} <> ${table.id}`
    ),
    check(
      "registrations_email_canonical",
      sql`${table.attendeeEmail} = lower(btrim(${table.attendeeEmail})) AND char_length(${table.attendeeEmail}) <= 254`
    ),
    check(
      "registrations_name_bounds",
      sql`char_length(btrim(${table.attendeeName})) BETWEEN 1 AND 200`
    ),
  ]
);

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
// Registration attempt — abuse protection for the public registration form,
// nothing else. Not part of the ER diagram's domain model (it doesn't
// represent a real-world thing, just a request log), but still a real table
// so it needs the same write-it-down treatment. See UC-02 and
// docs/adr/0005-registration-rate-limiting.md.
//
// One row per registration attempt (successful or not). The Server Action
// counts rows for an IP in the last 10 minutes before deciding whether to
// allow another one. No cleanup job exists yet — this table grows
// unbounded until one is added; see the ADR's Consequences section.
// ---------------------------------------------------------------------------
export const registrationAttempts = pgTable(
  "registration_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ipAddress: inet("ip_address").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("registration_attempts_ip_created_idx").on(
      table.ipAddress,
      table.createdAt
    ),
  ]
);

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

// ---------------------------------------------------------------------------
// UC-02 audit — permanent, append-only history of every domain mutation and
// grant change (P09, NFR-01/02). Lives in the private schema: never exposed
// through PostgREST, readable only by the owner-scoped server routine. See
// UC-02_Data_and_Security.md section 5. Immutable-append is enforced by
// revoking runtime UPDATE/DELETE/TRUNCATE in the security-foundation
// migration, not by anything Drizzle can express here.
// ---------------------------------------------------------------------------
export const uc02Audit = privateSchema.table(
  "uc02_audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    committeeId: uuid("committee_id").references(() => committees.id),
    eventId: uuid("event_id").references(() => events.id),
    registrationId: uuid("registration_id").references(() => registrations.id),
    actorKind: text("actor_kind").notNull(),
    actorUserId: uuid("actor_user_id").references(() => authUsers.id),
    action: text("action").notNull(),
    changes: jsonb("changes").notNull(),
  },
  (table) => [
    index("uc02_audit_event_idx").on(table.eventId, table.occurredAt, table.id),
    index("uc02_audit_committee_idx").on(
      table.committeeId,
      table.occurredAt,
      table.id
    ),
    check(
      "uc02_audit_actor_kind_check",
      sql`${table.actorKind} IN ('anonymous','authenticated','maintenance','migration')`
    ),
    check(
      "uc02_audit_actor_user_required",
      sql`(${table.actorKind} IN ('authenticated','maintenance')) = (${table.actorUserId} IS NOT NULL)`
    ),
    check(
      "uc02_audit_action_check",
      sql`${table.action} IN (
        'event.created','event.updated','event.published','event.held',
        'event.reopened','event.archived','event.restored',
        'event.review_flagged','event.review_unflagged','event.approved','event.review_rejected',
        'registration.created','registration.waitlisted','registration.promoted',
        'registration.superseded','grant.activated','grant.revoked',
        'access.granted','access.reassigned','access.revoked','access.technical_changed',
        'registrations.exported','history.imported'
      )`
    ),
  ]
);
