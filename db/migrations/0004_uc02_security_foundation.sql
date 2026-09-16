-- UC-02 security foundation: roles, grants, RLS policies, and the private
-- SECURITY DEFINER routines that are the only write path into events and
-- registrations. See docs/UC-02_Data_and_Security.md sections 6-8 and the
-- deep dive section 11 (O-01) for the specification this implements.
--
-- Hand-written, like 0002: Drizzle's schema builder doesn't model roles,
-- grants, RLS policies, or functions.
--
-- IMPORTANT — placeholder passwords: app_runtime and app_maintenance are
-- created below with a placeholder password that must be rotated with
-- ALTER ROLE ... WITH PASSWORD '<strong random value>' immediately after
-- this migration runs on any real project, before either role is used in a
-- connection string. Never commit the real password.

-- ---------------------------------------------------------------------------
-- 1. Roles
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'uc02_routine_owner') THEN
    CREATE ROLE uc02_routine_owner NOLOGIN NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime LOGIN NOBYPASSRLS PASSWORD 'REPLACE_ME_ROTATE_IMMEDIATELY';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_maintenance') THEN
    CREATE ROLE app_maintenance LOGIN NOBYPASSRLS PASSWORD 'REPLACE_ME_ROTATE_IMMEDIATELY';
  END IF;
END $$;

-- On a Supabase-hosted project the migration-running `postgres` role is not
-- a true superuser (Supabase reserves that internally), so ALTER ... OWNER
-- TO a freshly created role requires explicit membership first.
GRANT uc02_routine_owner TO postgres;

GRANT USAGE ON SCHEMA public TO anon, authenticated, app_runtime, app_maintenance, uc02_routine_owner;
GRANT USAGE ON SCHEMA private TO app_runtime, app_maintenance, uc02_routine_owner;
-- Transferring function ownership to uc02_routine_owner below requires that
-- role to hold CREATE on the containing schema, not just USAGE (Postgres
-- rule: a new owner must have CREATE privilege on the object's schema).
GRANT CREATE ON SCHEMA private TO uc02_routine_owner;

-- ---------------------------------------------------------------------------
-- 2. Revoke the platform-default wide-open grants (M1 finding: anon and
-- authenticated hold ALL privileges on every public table by default on a
-- fresh Supabase project — not produced by any of our own migrations).
-- ---------------------------------------------------------------------------

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated, PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated, PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC;
REVOKE ALL ON SCHEMA private FROM anon, authenticated, PUBLIC;

-- ---------------------------------------------------------------------------
-- 3. Narrow, explicit grants
-- ---------------------------------------------------------------------------

-- Public projection only: no committee_id/status/capacity/revision/approval
-- metadata ever reaches an anon SELECT *.
GRANT SELECT (id, title, description, event_date, location) ON public.events TO anon;

-- authenticated reads full rows; RLS (below) restricts to the caller's own
-- committee grant. No INSERT/UPDATE/DELETE for anyone except the routines.
GRANT SELECT ON public.events, public.registrations, public.committees, public.committee_managers TO authenticated;

-- The routine-owner identity the SECURITY DEFINER functions execute as.
GRANT SELECT, UPDATE ON public.events TO uc02_routine_owner;
GRANT SELECT, INSERT, UPDATE ON public.registrations TO uc02_routine_owner;
GRANT SELECT ON public.committees, public.committee_managers TO uc02_routine_owner;
GRANT SELECT, INSERT ON public.registration_attempts TO uc02_routine_owner;
GRANT SELECT, INSERT ON private.uc02_audit TO uc02_routine_owner;

-- Maintenance: provisions/revokes grants, writes audit for those actions,
-- purges expired attempts. No business-table access, no public endpoint.
GRANT SELECT, INSERT, UPDATE ON public.committee_managers TO app_maintenance;
GRANT SELECT, INSERT ON private.uc02_audit TO app_maintenance;
GRANT SELECT, DELETE ON public.registration_attempts TO app_maintenance;

-- app_runtime (what the Next.js server connects as) gets NO direct table
-- grants at all — only EXECUTE on the fixed routines below.

-- ---------------------------------------------------------------------------
-- 4. RLS: enable on the two new tables, retire the ADR-0006 policies that
-- D07 replaces, and add the target policies. (RLS was already enabled on
-- the original 8 tables by migration 0002.)
-- ---------------------------------------------------------------------------

ALTER TABLE public.committee_managers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.committee_managers FORCE ROW LEVEL SECURITY;
ALTER TABLE private.uc02_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.uc02_audit FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS anon_select_published_events ON public.events;
DROP POLICY IF EXISTS anon_insert_registration_for_published_event ON public.registrations;

CREATE POLICY anon_select_visible_events ON public.events
  FOR SELECT TO anon
  USING (status IN ('published', 'full') AND archived_at IS NULL);

CREATE POLICY authenticated_select_own_committee_events ON public.events
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.committee_managers cm
      WHERE cm.committee_id = events.committee_id
        AND cm.user_id = auth.uid()
        AND cm.revoked_at IS NULL
    )
  );

CREATE POLICY authenticated_select_own_committee_registrations ON public.registrations
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      JOIN public.committee_managers cm ON cm.committee_id = e.committee_id
      WHERE e.id = registrations.event_id
        AND cm.user_id = auth.uid()
        AND cm.revoked_at IS NULL
    )
  );

CREATE POLICY authenticated_select_own_grants ON public.committee_managers
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY authenticated_select_own_committees ON public.committees
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.committee_managers cm
      WHERE cm.committee_id = committees.id
        AND cm.user_id = auth.uid()
        AND cm.revoked_at IS NULL
    )
  );

-- registration_attempts: no PostgREST policy for anon/authenticated at all
-- (no grant either) — RLS + FORCE is defense in depth, matching "private
-- bookkeeping" in the acceptance security matrix.
ALTER TABLE public.registration_attempts FORCE ROW LEVEL SECURITY;

-- uc02_routine_owner and app_maintenance are not table owners, so RLS
-- (enabled on every table since migration 0002) applies to them too. Their
-- authorization check IS the routine/maintenance-script logic itself, not a
-- row predicate, so grant them an unrestricted policy on exactly the tables
-- their table-level GRANTs above already scope them to — RLS here is not a
-- second authorization layer for these two roles, the GRANTs are.
CREATE POLICY routine_owner_full_access ON public.events
  FOR ALL TO uc02_routine_owner USING (true) WITH CHECK (true);
CREATE POLICY routine_owner_full_access ON public.registrations
  FOR ALL TO uc02_routine_owner USING (true) WITH CHECK (true);
CREATE POLICY routine_owner_full_access ON public.committees
  FOR ALL TO uc02_routine_owner USING (true) WITH CHECK (true);
CREATE POLICY routine_owner_full_access ON public.committee_managers
  FOR ALL TO uc02_routine_owner USING (true) WITH CHECK (true);
CREATE POLICY routine_owner_full_access ON public.registration_attempts
  FOR ALL TO uc02_routine_owner USING (true) WITH CHECK (true);
CREATE POLICY routine_owner_full_access ON private.uc02_audit
  FOR ALL TO uc02_routine_owner USING (true) WITH CHECK (true);

CREATE POLICY maintenance_full_access ON public.committee_managers
  FOR ALL TO app_maintenance USING (true) WITH CHECK (true);
CREATE POLICY maintenance_full_access ON public.registration_attempts
  FOR ALL TO app_maintenance USING (true) WITH CHECK (true);
CREATE POLICY maintenance_full_access ON private.uc02_audit
  FOR ALL TO app_maintenance USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 5. Private routines. Each: verify actor/grant, lock the event row FOR
-- UPDATE, re-check state after the lock, mutate, write one audit row,
-- return a jsonb {code, ...} result. Fixed search_path, no dynamic SQL.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.register_for_event(
  p_event_id uuid,
  p_attendee_name text,
  p_attendee_email text,
  p_intent text, -- 'register' or 'join_waitlist'
  p_ip inet
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event record;
  v_norm_email text := lower(btrim(p_attendee_email));
  v_confirmed_count integer;
  v_waitlist_pending boolean;
  v_existing record;
  v_new_id uuid;
  v_status public.registration_status;
BEGIN
  INSERT INTO public.registration_attempts (ip_address) VALUES (p_ip);

  IF p_intent NOT IN ('register', 'join_waitlist') THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR');
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.archived_at IS NOT NULL
     OR v_event.status NOT IN ('published', 'full') THEN
    RETURN jsonb_build_object('code', 'EVENT_NOT_FOUND');
  END IF;

  SELECT * INTO v_existing FROM public.registrations
    WHERE event_id = p_event_id AND attendee_email = v_norm_email
      AND status IN ('confirmed', 'waitlisted');
  IF FOUND THEN
    RETURN jsonb_build_object(
      'code', CASE WHEN v_existing.status = 'confirmed' THEN 'ALREADY_REGISTERED' ELSE 'ALREADY_WAITLISTED' END
    );
  END IF;

  IF v_event.event_date <= clock_timestamp() THEN
    RETURN jsonb_build_object('code', 'REGISTRATION_CLOSED');
  END IF;

  SELECT count(*) FILTER (WHERE status = 'confirmed') INTO v_confirmed_count
    FROM public.registrations WHERE event_id = p_event_id;
  SELECT EXISTS (
    SELECT 1 FROM public.registrations
    WHERE event_id = p_event_id AND status = 'waitlisted'
  ) INTO v_waitlist_pending;

  IF p_intent = 'register' THEN
    IF v_event.status = 'full'
       OR (v_event.capacity IS NOT NULL AND v_confirmed_count >= v_event.capacity)
       OR v_waitlist_pending THEN
      RETURN jsonb_build_object('code', 'EVENT_FULL');
    END IF;
    v_status := 'confirmed';
  ELSE
    v_status := 'waitlisted';
  END IF;

  INSERT INTO public.registrations (id, event_id, attendee_name, attendee_email, status)
  VALUES (gen_random_uuid(), p_event_id, btrim(p_attendee_name), v_norm_email, v_status)
  RETURNING id INTO v_new_id;

  INSERT INTO private.uc02_audit (committee_id, event_id, registration_id, actor_kind, action, changes)
  VALUES (
    v_event.committee_id, p_event_id, v_new_id, 'anonymous',
    CASE WHEN v_status = 'confirmed' THEN 'registration.created' ELSE 'registration.waitlisted' END,
    jsonb_build_object('status', v_status)
  );

  RETURN jsonb_build_object(
    'code', CASE WHEN v_status = 'confirmed' THEN 'SUCCESS' ELSE 'WAITLISTED' END,
    'registrationId', v_new_id
  );
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('code', 'ALREADY_REGISTERED');
END;
$$;

CREATE OR REPLACE FUNCTION private.flag_review(
  p_actor uuid, p_event_id uuid, p_expected_revision integer, p_required boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_event record;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.committee_managers cm
    JOIN public.events e ON e.committee_id = cm.committee_id
    WHERE e.id = p_event_id AND cm.user_id = p_actor AND cm.revoked_at IS NULL
  ) THEN
    RETURN jsonb_build_object('code', 'NOT_FOUND');
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF v_event.revision != p_expected_revision THEN
    RETURN jsonb_build_object('code', 'CONFLICT', 'currentRevision', v_event.revision);
  END IF;

  UPDATE public.events SET
    review_required = p_required,
    flagged_by = CASE WHEN p_required THEN p_actor ELSE NULL END,
    approved_by = NULL, approved_at = NULL, approved_revision = NULL,
    revision = revision + 1
  WHERE id = p_event_id;

  INSERT INTO private.uc02_audit (committee_id, event_id, actor_kind, actor_user_id, action, changes)
  VALUES (v_event.committee_id, p_event_id, 'authenticated', p_actor,
    CASE WHEN p_required THEN 'event.review_flagged' ELSE 'event.review_unflagged' END,
    jsonb_build_object('reviewRequired', p_required));

  RETURN jsonb_build_object('code', 'SUCCESS', 'revision', v_event.revision + 1);
END;
$$;

CREATE OR REPLACE FUNCTION private.approve_event(
  p_actor uuid, p_event_id uuid, p_expected_revision integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_event record;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.committee_managers cm
    JOIN public.events e ON e.committee_id = cm.committee_id
    WHERE e.id = p_event_id AND cm.user_id = p_actor AND cm.revoked_at IS NULL
  ) THEN
    RETURN jsonb_build_object('code', 'NOT_FOUND');
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT v_event.review_required THEN
    RETURN jsonb_build_object('code', 'INVALID_TRANSITION');
  END IF;
  IF v_event.flagged_by = p_actor THEN
    RETURN jsonb_build_object('code', 'SELF_APPROVAL_DENIED');
  END IF;
  IF v_event.revision != p_expected_revision THEN
    RETURN jsonb_build_object('code', 'CONFLICT', 'currentRevision', v_event.revision);
  END IF;
  IF v_event.approved_by = p_actor AND v_event.approved_revision = v_event.revision THEN
    RETURN jsonb_build_object('code', 'SUCCESS', 'revision', v_event.revision); -- idempotent, no second audit row
  END IF;

  UPDATE public.events SET
    approved_by = p_actor, approved_at = now(), approved_revision = v_event.revision
  WHERE id = p_event_id;

  INSERT INTO private.uc02_audit (committee_id, event_id, actor_kind, actor_user_id, action, changes)
  VALUES (v_event.committee_id, p_event_id, 'authenticated', p_actor, 'event.approved',
    jsonb_build_object('approvedRevision', v_event.revision));

  RETURN jsonb_build_object('code', 'SUCCESS', 'revision', v_event.revision);
END;
$$;

CREATE OR REPLACE FUNCTION private.publish_event(
  p_actor uuid, p_event_id uuid, p_expected_revision integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_event record;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.committee_managers cm
    JOIN public.events e ON e.committee_id = cm.committee_id
    WHERE e.id = p_event_id AND cm.user_id = p_actor AND cm.revoked_at IS NULL
  ) THEN
    RETURN jsonb_build_object('code', 'NOT_FOUND');
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF v_event.archived_at IS NOT NULL OR v_event.status NOT IN ('draft', 'full') THEN
    RETURN jsonb_build_object('code', 'INVALID_TRANSITION');
  END IF;
  IF v_event.event_date <= clock_timestamp() THEN
    RETURN jsonb_build_object('code', 'INVALID_TRANSITION');
  END IF;
  IF v_event.description IS NULL OR char_length(btrim(v_event.description)) = 0 THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR');
  END IF;
  IF v_event.revision != p_expected_revision THEN
    RETURN jsonb_build_object('code', 'CONFLICT', 'currentRevision', v_event.revision);
  END IF;
  IF v_event.review_required AND (v_event.approved_by IS NULL OR v_event.approved_revision != v_event.revision) THEN
    RETURN jsonb_build_object('code', 'APPROVAL_REQUIRED');
  END IF;

  UPDATE public.events SET status = 'published', revision = revision + 1 WHERE id = p_event_id;

  INSERT INTO private.uc02_audit (committee_id, event_id, actor_kind, actor_user_id, action, changes)
  VALUES (v_event.committee_id, p_event_id, 'authenticated', p_actor, 'event.published',
    jsonb_build_object('fromStatus', v_event.status));

  RETURN jsonb_build_object('code', 'SUCCESS', 'revision', v_event.revision + 1);
END;
$$;

CREATE OR REPLACE FUNCTION private.hold_event_full(
  p_actor uuid, p_event_id uuid, p_expected_revision integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_event record;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.committee_managers cm
    JOIN public.events e ON e.committee_id = cm.committee_id
    WHERE e.id = p_event_id AND cm.user_id = p_actor AND cm.revoked_at IS NULL
  ) THEN
    RETURN jsonb_build_object('code', 'NOT_FOUND');
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF v_event.status != 'published' OR v_event.event_date <= clock_timestamp() THEN
    RETURN jsonb_build_object('code', 'INVALID_TRANSITION');
  END IF;
  IF v_event.revision != p_expected_revision THEN
    RETURN jsonb_build_object('code', 'CONFLICT', 'currentRevision', v_event.revision);
  END IF;

  UPDATE public.events SET status = 'full', revision = revision + 1 WHERE id = p_event_id;

  INSERT INTO private.uc02_audit (committee_id, event_id, actor_kind, actor_user_id, action, changes)
  VALUES (v_event.committee_id, p_event_id, 'authenticated', p_actor, 'event.held', '{}'::jsonb);

  RETURN jsonb_build_object('code', 'SUCCESS', 'revision', v_event.revision + 1);
END;
$$;

CREATE OR REPLACE FUNCTION private.archive_event(
  p_actor uuid, p_event_id uuid, p_expected_revision integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_event record;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.committee_managers cm
    JOIN public.events e ON e.committee_id = cm.committee_id
    WHERE e.id = p_event_id AND cm.user_id = p_actor AND cm.revoked_at IS NULL
  ) THEN
    RETURN jsonb_build_object('code', 'NOT_FOUND');
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF v_event.archived_at IS NOT NULL
     OR (v_event.status NOT IN ('draft') AND v_event.event_date > clock_timestamp()) THEN
    RETURN jsonb_build_object('code', 'INVALID_TRANSITION');
  END IF;
  IF v_event.revision != p_expected_revision THEN
    RETURN jsonb_build_object('code', 'CONFLICT', 'currentRevision', v_event.revision);
  END IF;

  UPDATE public.events SET archived_at = now(), revision = revision + 1 WHERE id = p_event_id;

  INSERT INTO private.uc02_audit (committee_id, event_id, actor_kind, actor_user_id, action, changes)
  VALUES (v_event.committee_id, p_event_id, 'authenticated', p_actor, 'event.archived', '{}'::jsonb);

  RETURN jsonb_build_object('code', 'SUCCESS', 'revision', v_event.revision + 1);
END;
$$;

CREATE OR REPLACE FUNCTION private.restore_event(
  p_actor uuid, p_event_id uuid, p_expected_revision integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_event record;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.committee_managers cm
    JOIN public.events e ON e.committee_id = cm.committee_id
    WHERE e.id = p_event_id AND cm.user_id = p_actor AND cm.revoked_at IS NULL
  ) THEN
    RETURN jsonb_build_object('code', 'NOT_FOUND');
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF v_event.archived_at IS NULL THEN
    RETURN jsonb_build_object('code', 'INVALID_TRANSITION');
  END IF;
  IF v_event.revision != p_expected_revision THEN
    RETURN jsonb_build_object('code', 'CONFLICT', 'currentRevision', v_event.revision);
  END IF;

  UPDATE public.events SET archived_at = NULL, revision = revision + 1 WHERE id = p_event_id;

  INSERT INTO private.uc02_audit (committee_id, event_id, actor_kind, actor_user_id, action, changes)
  VALUES (v_event.committee_id, p_event_id, 'authenticated', p_actor, 'event.restored', '{}'::jsonb);

  RETURN jsonb_build_object('code', 'SUCCESS', 'revision', v_event.revision + 1);
END;
$$;

CREATE OR REPLACE FUNCTION private.promote_waitlist(
  p_actor uuid, p_event_id uuid, p_registration_id uuid, p_contact_confirmed boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_event record;
  v_reg record;
  v_first record;
  v_confirmed_count integer;
BEGIN
  IF NOT p_contact_confirmed THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.committee_managers cm
    JOIN public.events e ON e.committee_id = cm.committee_id
    WHERE e.id = p_event_id AND cm.user_id = p_actor AND cm.revoked_at IS NULL
  ) THEN
    RETURN jsonb_build_object('code', 'NOT_FOUND');
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF v_event.status = 'full' AND v_event.event_date <= clock_timestamp() THEN
    RETURN jsonb_build_object('code', 'REGISTRATION_CLOSED');
  END IF;

  SELECT * INTO v_reg FROM public.registrations
    WHERE id = p_registration_id AND event_id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('code', 'NOT_FOUND');
  END IF;
  IF v_reg.status = 'confirmed' THEN
    RETURN jsonb_build_object('code', 'SUCCESS'); -- idempotent retry of an already-promoted row
  END IF;
  IF v_reg.status != 'waitlisted' THEN
    RETURN jsonb_build_object('code', 'INVALID_TRANSITION');
  END IF;

  SELECT * INTO v_first FROM public.registrations
    WHERE event_id = p_event_id AND status = 'waitlisted'
    ORDER BY registered_at, id LIMIT 1;
  IF v_first.id != p_registration_id THEN
    RETURN jsonb_build_object('code', 'QUEUE_ORDER_CONFLICT');
  END IF;

  SELECT count(*) INTO v_confirmed_count FROM public.registrations
    WHERE event_id = p_event_id AND status = 'confirmed';
  IF v_event.capacity IS NOT NULL AND v_confirmed_count >= v_event.capacity THEN
    RETURN jsonb_build_object('code', 'CAPACITY_BELOW_COUNT');
  END IF;

  UPDATE public.registrations SET status = 'confirmed' WHERE id = p_registration_id;

  INSERT INTO private.uc02_audit (committee_id, event_id, registration_id, actor_kind, actor_user_id, action, changes)
  VALUES (v_event.committee_id, p_event_id, p_registration_id, 'authenticated', p_actor, 'registration.promoted',
    jsonb_build_object('contactConfirmed', true));

  RETURN jsonb_build_object('code', 'SUCCESS');
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Function ownership and EXECUTE grants: functions run as
-- uc02_routine_owner's privileges; only app_runtime may call them.
-- ---------------------------------------------------------------------------

ALTER FUNCTION private.register_for_event(uuid, text, text, text, inet) OWNER TO uc02_routine_owner;
ALTER FUNCTION private.flag_review(uuid, uuid, integer, boolean) OWNER TO uc02_routine_owner;
ALTER FUNCTION private.approve_event(uuid, uuid, integer) OWNER TO uc02_routine_owner;
ALTER FUNCTION private.publish_event(uuid, uuid, integer) OWNER TO uc02_routine_owner;
ALTER FUNCTION private.hold_event_full(uuid, uuid, integer) OWNER TO uc02_routine_owner;
ALTER FUNCTION private.archive_event(uuid, uuid, integer) OWNER TO uc02_routine_owner;
ALTER FUNCTION private.restore_event(uuid, uuid, integer) OWNER TO uc02_routine_owner;
ALTER FUNCTION private.promote_waitlist(uuid, uuid, uuid, boolean) OWNER TO uc02_routine_owner;

REVOKE EXECUTE ON FUNCTION private.register_for_event(uuid, text, text, text, inet) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.flag_review(uuid, uuid, integer, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.approve_event(uuid, uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.publish_event(uuid, uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.hold_event_full(uuid, uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.archive_event(uuid, uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.restore_event(uuid, uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.promote_waitlist(uuid, uuid, uuid, boolean) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION private.register_for_event(uuid, text, text, text, inet) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.flag_review(uuid, uuid, integer, boolean) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.approve_event(uuid, uuid, integer) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.publish_event(uuid, uuid, integer) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.hold_event_full(uuid, uuid, integer) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.archive_event(uuid, uuid, integer) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.restore_event(uuid, uuid, integer) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.promote_waitlist(uuid, uuid, uuid, boolean) TO app_runtime;
