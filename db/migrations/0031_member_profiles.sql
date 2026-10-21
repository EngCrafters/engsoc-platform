-- ADR 0023. Forward-only; apply after 0030, with approval. Changes no existing row: the new
-- member columns start empty, and interests fall back to the approved application until the
-- member edits them.

CREATE OR REPLACE FUNCTION private.core_schema_version() RETURNS integer
LANGUAGE sql IMMUTABLE AS $$ SELECT 31 $$;

-- The application's own lists (0025), shared by profile edits.
CREATE FUNCTION private.member_discipline_ids() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['mechanical', 'electrical', 'civil', 'petroleum', 'chemical', 'mechatronics', 'industrial']
$$;
CREATE FUNCTION private.member_interest_ids() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['cad', 'simulation', 'embedded', 'robotics', 'structures', 'process', 'data',
    'programming', 'power', 'reservoir', 'quality', 'management', 'sustainability', 'hse']
$$;

ALTER TABLE public.members
  ADD COLUMN photo_key text CHECK (photo_key IS NULL OR photo_key ~ '^member-photos/[0-9a-f-]{36}\.jpg$'),
  ADD COLUMN interests text[] CHECK (interests IS NULL OR (cardinality(interests) <= 4
    AND array_position(interests, NULL) IS NULL
    AND interests <@ ARRAY['cad', 'simulation', 'embedded', 'robotics', 'structures', 'process', 'data',
      'programming', 'power', 'reservoir', 'quality', 'management', 'sustainability', 'hse'])),
  ADD COLUMN updated_at timestamptz;
GRANT UPDATE (full_name, email, university_id, year, major, phone, photo_key, interests, updated_at)
  ON public.members TO uc02_routine_owner;

-- Verified fields (name, student ID) change only through a reviewed request.
CREATE TABLE private.member_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.members (id),
  field text NOT NULL CHECK (field IN ('full_name', 'university_id')),
  requested_value text NOT NULL CHECK (char_length(requested_value) BETWEEN 1 AND 200),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  decided_by uuid REFERENCES auth.users (id),
  decided_at timestamptz,
  decision_note text CHECK (decision_note IS NULL OR char_length(decision_note) <= 500),
  CHECK ((status = 'pending') = (decided_at IS NULL)),
  CHECK ((decided_at IS NULL) = (decided_by IS NULL))
);
CREATE UNIQUE INDEX member_change_requests_pending_idx
  ON private.member_change_requests (member_id, field) WHERE status = 'pending';
ALTER TABLE private.member_change_requests OWNER TO uc02_routine_owner;
ALTER TABLE private.member_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.member_change_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY routine_owner ON private.member_change_requests
  TO uc02_routine_owner USING (true) WITH CHECK (true);
REVOKE ALL ON private.member_change_requests FROM PUBLIC, anon, authenticated,
  app_runtime, app_maintenance, service_role;

DO $$ DECLARE v_check text; BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_check FROM pg_constraint
    WHERE conrelid = 'private.uc02_audit'::regclass AND conname = 'uc02_audit_action_check';
  EXECUTE 'ALTER TABLE private.uc02_audit DROP CONSTRAINT uc02_audit_action_check';
  EXECUTE 'ALTER TABLE private.uc02_audit ADD CONSTRAINT uc02_audit_action_check CHECK (' ||
    substring(v_check from 8 for char_length(v_check) - 8) ||
    ' OR action IN (''member.profile_updated'',''member.photo_changed'',''member.email_synced'',''member.change_requested'',''member.change_decided''))';
END $$;

-- ---------------------------------------------------------------------------------------------
-- The signed-in member's own profile: a confirmed account with a member record, never anyone
-- else's. Applicants get MEMBER_REQUIRED and keep only their application status (0027).
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION private.get_own_profile(p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_email text; v_confirmed boolean; v_member public.members%ROWTYPE;
  v_app private.membership_applications%ROWTYPE; v_has_app boolean;
BEGIN
  SELECT lower(email), email_confirmed_at IS NOT NULL INTO v_email, v_confirmed
  FROM private.access_auth_users WHERE id = p_actor;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  IF NOT v_confirmed THEN RETURN jsonb_build_object('code', 'EMAIL_UNCONFIRMED'); END IF;
  SELECT * INTO v_member FROM public.members WHERE id = p_actor FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'MEMBER_REQUIRED'); END IF;
  -- A sign-in email changed through Supabase Auth's own confirmation becomes the member's
  -- email, if it is an SQU address no other member uses.
  IF v_email <> lower(v_member.email)
     AND v_email ~ '^[^[:space:]@]+@([a-z0-9-]+\.)*squ\.edu\.om$'
     AND NOT EXISTS (SELECT 1 FROM public.members WHERE lower(email) = v_email AND id <> p_actor) THEN
    UPDATE public.members SET email = v_email, updated_at = clock_timestamp() WHERE id = p_actor;
    INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
    VALUES (NULL, 'authenticated', p_actor, 'member.email_synced', '{}'::jsonb);
    v_member.email := v_email;
  END IF;
  SELECT * INTO v_app FROM private.membership_applications
  WHERE member_id = p_actor OR auth_user_id = p_actor ORDER BY submitted_at DESC LIMIT 1;
  v_has_app := FOUND;
  RETURN jsonb_build_object('code', 'SUCCESS',
    'name', v_member.full_name, 'email', v_member.email, 'signInEmail', v_email,
    'universityId', v_member.university_id, 'academicYear', v_member.year,
    'discipline', v_member.major,
    'interests', to_jsonb(coalesce(v_member.interests, CASE WHEN v_has_app THEN v_app.interests END, '{}'::text[])),
    'phone', v_member.phone, 'hasPhoto', v_member.photo_key IS NOT NULL,
    'photoVersion', split_part(split_part(v_member.photo_key, '/', 2), '.', 1),
    'status', v_member.status, 'memberSince', v_member.created_at, 'updatedAt', v_member.updated_at,
    'application', CASE WHEN v_has_app THEN jsonb_build_object('status', v_app.status,
      'submittedAt', v_app.submitted_at, 'verifiedAt', v_app.verified_at,
      'decidedAt', v_app.decided_at, 'activatedAt', v_app.activated_at) END,
    'changeRequests', (SELECT coalesce(jsonb_agg(jsonb_build_object('field', field, 'status', status,
        'requestedValue', requested_value, 'requestedAt', requested_at, 'decidedAt', decided_at)
        ORDER BY requested_at DESC), '[]'::jsonb)
      FROM (SELECT * FROM private.member_change_requests WHERE member_id = p_actor
        AND (status = 'pending' OR decided_at > clock_timestamp() - interval '30 days')
        ORDER BY requested_at DESC LIMIT 10) r));
END $$;

-- Self-service fields: phone, academic year, discipline and interests, all validated here.
CREATE FUNCTION private.update_own_profile(p_actor uuid, p_phone text, p_year integer,
  p_discipline text, p_interests text[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_profile jsonb; v_member public.members%ROWTYPE; v_current text[]; v_changed text[] := '{}';
BEGIN
  v_profile := private.get_member_profile(p_actor);
  IF v_profile->>'code' <> 'SUCCESS' THEN RETURN v_profile; END IF;
  IF p_phone IS NOT NULL AND p_phone !~ '^\+[1-9][0-9]{6,14}$' THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'phone'); END IF;
  IF p_year IS NULL OR p_year NOT BETWEEN 1 AND 5 THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'academicYear'); END IF;
  IF p_discipline IS NULL OR NOT (p_discipline = ANY (private.member_discipline_ids())) THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'discipline'); END IF;
  IF p_interests IS NULL OR cardinality(p_interests) > 4 OR array_position(p_interests, NULL) IS NOT NULL
     OR NOT (p_interests <@ private.member_interest_ids())
     OR (SELECT count(DISTINCT x) FROM unnest(p_interests) x) <> cardinality(p_interests) THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'interests'); END IF;
  SELECT * INTO v_member FROM public.members WHERE id = p_actor FOR UPDATE;
  v_current := coalesce(v_member.interests, (SELECT interests FROM private.membership_applications
    WHERE member_id = p_actor OR auth_user_id = p_actor ORDER BY submitted_at DESC LIMIT 1), '{}');
  IF v_member.phone IS DISTINCT FROM p_phone THEN v_changed := array_append(v_changed, 'phone'); END IF;
  IF v_member.year IS DISTINCT FROM p_year THEN v_changed := array_append(v_changed, 'academicYear'); END IF;
  IF v_member.major IS DISTINCT FROM p_discipline THEN v_changed := array_append(v_changed, 'discipline'); END IF;
  IF v_current IS DISTINCT FROM p_interests THEN v_changed := array_append(v_changed, 'interests'); END IF;
  IF cardinality(v_changed) > 0 THEN
    UPDATE public.members SET phone = p_phone, year = p_year, major = p_discipline,
      interests = p_interests, updated_at = clock_timestamp() WHERE id = p_actor;
    INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
    VALUES (NULL, 'authenticated', p_actor, 'member.profile_updated', jsonb_build_object('fields', to_jsonb(v_changed)));
  END IF;
  RETURN private.get_own_profile(p_actor);
END $$;

-- The photo: a private object Core stored and re-encoded; the database keeps only its key.
CREATE FUNCTION private.set_own_photo(p_actor uuid, p_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_profile jsonb; v_previous text;
BEGIN
  v_profile := private.get_member_profile(p_actor);
  IF v_profile->>'code' <> 'SUCCESS' THEN RETURN v_profile; END IF;
  IF p_key IS NOT NULL AND p_key !~ '^member-photos/[0-9a-f-]{36}\.jpg$' THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR'); END IF;
  SELECT photo_key INTO v_previous FROM public.members WHERE id = p_actor FOR UPDATE;
  IF v_previous IS NOT DISTINCT FROM p_key THEN
    RETURN jsonb_build_object('code', 'SUCCESS', 'previousKey', NULL); END IF;
  UPDATE public.members SET photo_key = p_key, updated_at = clock_timestamp() WHERE id = p_actor;
  INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
  VALUES (NULL, 'authenticated', p_actor, 'member.photo_changed', jsonb_build_object('removed', p_key IS NULL));
  RETURN jsonb_build_object('code', 'SUCCESS', 'previousKey', v_previous);
END $$;

CREATE FUNCTION private.get_own_photo_key(p_actor uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF private.get_member_profile(p_actor)->>'code' <> 'SUCCESS' THEN RETURN NULL; END IF;
  RETURN (SELECT photo_key FROM public.members WHERE id = p_actor);
END $$;

-- The member's own registrations, newest event first. Guest registrations made with the
-- member's confirmed email are linked first, under the ADR 0022 rule.
CREATE FUNCTION private.list_own_registrations(p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_profile jsonb; v_email text; v_event uuid; v_rows jsonb;
BEGIN
  v_profile := private.get_member_profile(p_actor);
  IF v_profile->>'code' <> 'SUCCESS' THEN RETURN v_profile; END IF;
  SELECT lower(email) INTO v_email FROM private.access_auth_users WHERE id = p_actor;
  FOR v_event IN SELECT DISTINCT event_id FROM public.registrations
      WHERE member_id IS NULL AND attendee_email = v_email AND status IN ('confirmed', 'waitlisted') LOOP
    PERFORM private.link_member_registration(p_actor, v_event);
  END LOOP;
  SELECT coalesce(jsonb_agg(x ORDER BY x."eventDate" DESC, x."eventId"), '[]'::jsonb) INTO v_rows FROM (
    SELECT e.id AS "eventId", e.title, e.event_date AS "eventDate", e.location, r.status,
      r.attended, r.checked_in_at AS "checkedInAt", r.checkin_method AS method, r.registered_at AS "registeredAt"
    FROM public.registrations r JOIN public.events e ON e.id = r.event_id
    WHERE r.member_id = p_actor AND r.status IN ('confirmed', 'waitlisted')
      AND e.archived_at IS NULL AND e.status IN ('published', 'full')
    ORDER BY e.event_date DESC LIMIT 100
  ) x;
  RETURN jsonb_build_object('code', 'SUCCESS', 'registrations', v_rows);
END $$;

-- A correction to a verified field, for a membership reviewer to decide.
CREATE FUNCTION private.request_profile_change(p_actor uuid, p_field text, p_value text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_profile jsonb; v_member public.members%ROWTYPE; v_value text := btrim(coalesce(p_value, ''));
BEGIN
  v_profile := private.get_member_profile(p_actor);
  IF v_profile->>'code' <> 'SUCCESS' THEN RETURN v_profile; END IF;
  IF p_field IS NULL OR p_field NOT IN ('full_name', 'university_id')
     OR (p_field = 'full_name' AND (char_length(v_value) NOT BETWEEN 1 AND 200 OR v_value ~ '[[:cntrl:]]'))
     OR (p_field = 'university_id' AND v_value !~ '^[0-9]{6,10}$') THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', p_field);
  END IF;
  SELECT * INTO v_member FROM public.members WHERE id = p_actor FOR UPDATE;
  IF (p_field = 'full_name' AND v_member.full_name = v_value)
     OR (p_field = 'university_id' AND v_member.university_id = v_value) THEN
    RETURN jsonb_build_object('code', 'UNCHANGED');
  END IF;
  IF EXISTS (SELECT 1 FROM private.member_change_requests WHERE member_id = p_actor AND field = p_field AND status = 'pending') THEN
    RETURN jsonb_build_object('code', 'ALREADY_PENDING');
  END IF;
  INSERT INTO private.member_change_requests (member_id, field, requested_value) VALUES (p_actor, p_field, v_value);
  INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
  VALUES (NULL, 'authenticated', p_actor, 'member.change_requested', jsonb_build_object('field', p_field));
  RETURN private.get_own_profile(p_actor);
END $$;

-- Reviewers: the membership reviewers of 0025 (Society Affairs, Board, Technical).
CREATE FUNCTION private.list_profile_change_requests(p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF private.membership_reviewer_kind(p_actor, false) IS NULL THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  RETURN jsonb_build_object('code', 'SUCCESS', 'requests', (SELECT coalesce(jsonb_agg(x ORDER BY x."requestedAt", x.id), '[]'::jsonb) FROM (
    SELECT r.id, r.field, r.requested_value AS "requestedValue", r.requested_at AS "requestedAt",
      CASE r.field WHEN 'full_name' THEN m.full_name ELSE m.university_id END AS "currentValue",
      m.full_name AS "memberName", m.email AS "memberEmail", r.member_id = p_actor AS "isOwn"
    FROM private.member_change_requests r JOIN public.members m ON m.id = r.member_id
    WHERE r.status = 'pending' ORDER BY r.requested_at, r.id LIMIT 100) x));
END $$;

CREATE FUNCTION private.decide_profile_change(p_actor uuid, p_request uuid, p_decision text, p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_request private.member_change_requests%ROWTYPE;
BEGIN
  IF private.membership_reviewer_kind(p_actor, true) IS NULL THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  IF p_decision IS NULL OR p_decision NOT IN ('approve', 'reject')
     OR (p_note IS NOT NULL AND char_length(p_note) > 500) THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR'); END IF;
  SELECT * INTO v_request FROM private.member_change_requests WHERE id = p_request FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  IF v_request.status <> 'pending' THEN RETURN jsonb_build_object('code', 'INVALID_TRANSITION'); END IF;
  IF v_request.member_id = p_actor THEN RETURN jsonb_build_object('code', 'SELF_REVIEW'); END IF;
  IF p_decision = 'approve' THEN
    BEGIN
      IF v_request.field = 'full_name' THEN
        UPDATE public.members SET full_name = v_request.requested_value, updated_at = clock_timestamp() WHERE id = v_request.member_id;
      ELSE
        UPDATE public.members SET university_id = v_request.requested_value, updated_at = clock_timestamp() WHERE id = v_request.member_id;
      END IF;
    EXCEPTION WHEN unique_violation THEN
      RETURN jsonb_build_object('code', 'CONFLICT');
    END;
  END IF;
  UPDATE private.member_change_requests SET status = CASE WHEN p_decision = 'approve' THEN 'approved' ELSE 'rejected' END,
    decided_by = p_actor, decided_at = clock_timestamp(), decision_note = nullif(btrim(p_note), '')
  WHERE id = p_request;
  INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
  VALUES (NULL, 'authenticated', p_actor, 'member.change_decided',
    jsonb_build_object('field', v_request.field, 'decision', p_decision, 'requestId', p_request));
  RETURN jsonb_build_object('code', 'SUCCESS');
END $$;

DO $$ DECLARE v_fn regprocedure; BEGIN
  FOR v_fn IN SELECT oid::regprocedure FROM pg_proc WHERE pronamespace = 'private'::regnamespace
    AND proname IN ('member_discipline_ids', 'member_interest_ids', 'get_own_profile', 'update_own_profile',
      'set_own_photo', 'get_own_photo_key', 'list_own_registrations', 'request_profile_change',
      'list_profile_change_requests', 'decide_profile_change') LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO uc02_routine_owner', v_fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, app_runtime, app_maintenance, service_role', v_fn);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION private.get_own_profile(uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.update_own_profile(uuid, text, integer, text, text[]) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.set_own_photo(uuid, text) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.get_own_photo_key(uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.list_own_registrations(uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.request_profile_change(uuid, text, text) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.list_profile_change_requests(uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.decide_profile_change(uuid, uuid, text, text) TO app_runtime;

DO $$ BEGIN
  IF private.core_schema_version() <> 31
     OR NOT has_function_privilege('app_runtime', 'private.get_own_profile(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'private.update_own_profile(uuid,text,integer,text,text[])', 'EXECUTE')
     OR has_function_privilege('anon', 'private.decide_profile_change(uuid,uuid,text,text)', 'EXECUTE')
     OR has_table_privilege('app_runtime', 'private.member_change_requests', 'SELECT')
     OR NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'private.member_change_requests'::regclass) THEN
    RAISE EXCEPTION '0031 self-check failed';
  END IF;
END $$;
