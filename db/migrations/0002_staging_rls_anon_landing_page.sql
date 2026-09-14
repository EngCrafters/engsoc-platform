-- Staging-only. See docs/adr/0006-staging-rls-for-anon-landing-page.md.
-- Applied directly to the staging Supabase project; NOT applied to
-- production — that's a deliberate, tracked asymmetry, not drift.

ALTER TABLE "public"."members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."archive_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."registrations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."certificates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."committees" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."mentorship_connections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."registration_attempts" ENABLE ROW LEVEL SECURITY;

-- anon may read published events only — matches getPublishedEvents() in
-- both core-platform and the landing page exactly.
CREATE POLICY "anon_select_published_events" ON "public"."events"
  FOR SELECT
  TO anon
  USING (status = 'published');

-- anon may insert a registration only with memberId null (docs/adr/0004)
-- and only against an event that is currently published. No SELECT
-- policy: the landing page never reads registrations back.
CREATE POLICY "anon_insert_registration_for_published_event" ON "public"."registrations"
  FOR INSERT
  TO anon
  WITH CHECK (
    member_id IS NULL
    AND EXISTS (
      SELECT 1 FROM "public"."events" e
      WHERE e.id = event_id AND e.status = 'published'
    )
  );
