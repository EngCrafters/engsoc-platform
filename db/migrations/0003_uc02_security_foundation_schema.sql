CREATE SCHEMA "private";
--> statement-breakpoint
CREATE TYPE "public"."registration_status" AS ENUM('confirmed', 'waitlisted', 'superseded');--> statement-breakpoint
-- auth.users is Supabase's own table, created by the platform, not by us.
-- Drizzle's generator emits a CREATE for it because db/schema.ts declares a
-- minimal stub (just the id column) so other tables can FK to it — that
-- stub must never actually try to create the real table. Intentionally
-- removed from this migration; see db/schema.ts's authUsers comment.
--> statement-breakpoint
CREATE TABLE "committee_managers" (
	"user_id" uuid NOT NULL,
	"committee_id" uuid NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"granted_by" uuid NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	CONSTRAINT "committee_managers_user_id_committee_id_pk" PRIMARY KEY("user_id","committee_id"),
	CONSTRAINT "committee_managers_revocation_consistency" CHECK (("committee_managers"."revoked_at" IS NULL) = ("committee_managers"."revoked_by" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "private"."uc02_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"committee_id" uuid NOT NULL,
	"event_id" uuid,
	"registration_id" uuid,
	"actor_kind" text NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"changes" jsonb NOT NULL,
	CONSTRAINT "uc02_audit_actor_kind_check" CHECK ("private"."uc02_audit"."actor_kind" IN ('anonymous','authenticated','maintenance','migration')),
	CONSTRAINT "uc02_audit_actor_user_required" CHECK (("private"."uc02_audit"."actor_kind" IN ('authenticated','maintenance')) = ("private"."uc02_audit"."actor_user_id" IS NOT NULL)),
	CONSTRAINT "uc02_audit_action_check" CHECK ("private"."uc02_audit"."action" IN (
        'event.created','event.updated','event.published','event.held',
        'event.reopened','event.archived','event.restored',
        'event.review_flagged','event.review_unflagged','event.approved',
        'registration.created','registration.waitlisted','registration.promoted',
        'registration.superseded','grant.activated','grant.revoked',
        'registrations.exported','history.imported'
      ))
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "capacity" integer;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "review_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "flagged_by" uuid;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "approved_by" uuid;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "approved_revision" integer;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "status" "registration_status" DEFAULT 'confirmed' NOT NULL;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "superseded_by" uuid;--> statement-breakpoint
ALTER TABLE "committee_managers" ADD CONSTRAINT "committee_managers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_managers" ADD CONSTRAINT "committee_managers_committee_id_committees_id_fk" FOREIGN KEY ("committee_id") REFERENCES "public"."committees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_managers" ADD CONSTRAINT "committee_managers_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_managers" ADD CONSTRAINT "committee_managers_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private"."uc02_audit" ADD CONSTRAINT "uc02_audit_committee_id_committees_id_fk" FOREIGN KEY ("committee_id") REFERENCES "public"."committees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private"."uc02_audit" ADD CONSTRAINT "uc02_audit_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private"."uc02_audit" ADD CONSTRAINT "uc02_audit_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private"."uc02_audit" ADD CONSTRAINT "uc02_audit_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "committee_managers_committee_user_idx" ON "committee_managers" USING btree ("committee_id","user_id");--> statement-breakpoint
CREATE INDEX "uc02_audit_event_idx" ON "private"."uc02_audit" USING btree ("event_id","occurred_at","id");--> statement-breakpoint
CREATE INDEX "uc02_audit_committee_idx" ON "private"."uc02_audit" USING btree ("committee_id","occurred_at","id");--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_flagged_by_users_id_fk" FOREIGN KEY ("flagged_by") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_superseded_by_registrations_id_fk" FOREIGN KEY ("superseded_by") REFERENCES "public"."registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_committee_date_idx" ON "events" USING btree ("committee_id","event_date","id");--> statement-breakpoint
CREATE INDEX "events_public_discovery_idx" ON "events" USING btree ("event_date","id") WHERE "events"."archived_at" IS NULL AND "events"."status" IN ('published','full');--> statement-breakpoint
CREATE UNIQUE INDEX "registrations_active_event_email_idx" ON "registrations" USING btree ("event_id","attendee_email") WHERE "registrations"."status" IN ('confirmed','waitlisted');--> statement-breakpoint
CREATE INDEX "registrations_event_status_fifo_idx" ON "registrations" USING btree ("event_id","status","registered_at","id");--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_title_bounds" CHECK ("events"."title" = btrim("events"."title") AND char_length("events"."title") BETWEEN 1 AND 200);--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_description_bounds" CHECK ("events"."description" IS NULL OR char_length("events"."description") <= 10000);--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_location_bounds" CHECK ("events"."location" IS NULL OR char_length("events"."location") <= 500);--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_published_requires_description" CHECK ("events"."status" = 'draft' OR ("events"."description" IS NOT NULL AND char_length(btrim("events"."description")) > 0));--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_capacity_positive" CHECK ("events"."capacity" > 0);--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_revision_positive" CHECK ("events"."revision" > 0);--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_review_state" CHECK (("events"."review_required" = true AND "events"."flagged_by" IS NOT NULL) OR ("events"."review_required" = false AND "events"."flagged_by" IS NULL AND "events"."approved_by" IS NULL AND "events"."approved_at" IS NULL AND "events"."approved_revision" IS NULL));--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_approval_all_or_nothing" CHECK (("events"."approved_by" IS NULL AND "events"."approved_at" IS NULL AND "events"."approved_revision" IS NULL) OR ("events"."approved_by" IS NOT NULL AND "events"."approved_at" IS NOT NULL AND "events"."approved_revision" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_no_self_approval" CHECK ("events"."approved_by" IS NULL OR "events"."flagged_by" IS NULL OR "events"."approved_by" <> "events"."flagged_by");--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_superseded_consistency" CHECK (("registrations"."status" = 'superseded') = ("registrations"."superseded_by" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_no_self_supersede" CHECK ("registrations"."superseded_by" IS NULL OR "registrations"."superseded_by" <> "registrations"."id");--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_email_canonical" CHECK ("registrations"."attendee_email" = lower(btrim("registrations"."attendee_email")) AND char_length("registrations"."attendee_email") <= 254);--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_name_bounds" CHECK (char_length(btrim("registrations"."attendee_name")) BETWEEN 1 AND 200);