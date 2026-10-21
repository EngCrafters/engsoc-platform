-- ADR 0022. Forward-only repair of 0026/0028 after the October 21 system audit. Apply after 0029.
-- Changes no existing record except: purging rate-limit attempts older than an hour (technical
-- records, UC-02 data design section 5) and closing any check-in session left open without a code
-- secret (none exist on hosted environments, where 0028 is not applied).

-- ---------------------------------------------------------------------------------------------
-- 1. Schema version. Every later migration redefines this to its own number; Core refuses a
--    release whose database is older than the code (scripts/check-schema-compat.mjs).
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION private.core_schema_version() RETURNS integer
LANGUAGE sql IMMUTABLE AS $$ SELECT 30 $$;

-- ---------------------------------------------------------------------------------------------
-- 2. Rate limits. Anonymous registrations stay limited per address, with room for a shared campus
--    or carrier address; signed-in members are limited per member instead. Attempts older than an
--    hour are purged as they age (the limiter only ever reads the last ten minutes).
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION private.guest_registration_limit() RETURNS integer
LANGUAGE sql IMMUTABLE AS $$ SELECT 20 $$; -- per address, per ten minutes
CREATE FUNCTION private.member_registration_limit() RETURNS integer
LANGUAGE sql IMMUTABLE AS $$ SELECT 10 $$; -- per member, per ten minutes
CREATE FUNCTION private.membership_submission_limit() RETURNS integer
LANGUAGE sql IMMUTABLE AS $$ SELECT 20 $$; -- per address, per hour

CREATE TABLE private.member_registration_attempts (
  member_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX member_registration_attempts_member_idx
  ON private.member_registration_attempts (member_id, created_at);
CREATE INDEX member_registration_attempts_created_idx
  ON private.member_registration_attempts (created_at);
ALTER TABLE private.member_registration_attempts OWNER TO uc02_routine_owner;
ALTER TABLE private.member_registration_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.member_registration_attempts FORCE ROW LEVEL SECURITY;
CREATE POLICY routine_owner ON private.member_registration_attempts
  TO uc02_routine_owner USING (true) WITH CHECK (true);
REVOKE ALL ON private.member_registration_attempts FROM PUBLIC, anon, authenticated,
  app_runtime, app_maintenance, service_role;

CREATE INDEX registration_attempts_created_idx ON public.registration_attempts (created_at);
GRANT DELETE ON public.registration_attempts TO uc02_routine_owner;

-- One purger at a time; everyone else skips, so registrations never queue behind a purge.
CREATE FUNCTION private.purge_rate_limit_attempts() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF pg_try_advisory_xact_lock(30, 1) THEN
    DELETE FROM public.registration_attempts WHERE created_at < clock_timestamp() - interval '1 hour';
    DELETE FROM private.member_registration_attempts WHERE created_at < clock_timestamp() - interval '1 hour';
  END IF;
END $$;

-- The canonical seat algorithm of 0005: validation, event lock, duplicate check, capacity and FIFO
-- waitlist, audit. Unchanged except that its callers now apply the limiter and a missing intent is
-- refused (callers always send one).
CREATE FUNCTION private.register_for_event_seat(
  p_event_id uuid, p_attendee_name text, p_attendee_email text, p_intent text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_event record;
  v_norm_email text := lower(btrim(p_attendee_email));
  v_confirmed_count integer;
  v_waitlist_pending boolean;
  v_event_full boolean;
  v_existing record;
  v_new_id uuid;
  v_status public.registration_status;
BEGIN
  IF p_intent IS NULL OR p_intent NOT IN ('register', 'join_waitlist')
     OR p_attendee_name IS NULL
     OR char_length(btrim(p_attendee_name)) NOT BETWEEN 1 AND 200
     OR p_attendee_name ~ '[[:cntrl:]]'
     OR p_attendee_email IS NULL
     OR char_length(v_norm_email) > 254
     OR v_norm_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     OR v_norm_email ~ '[[:cntrl:]]' THEN
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

  v_event_full := v_event.status = 'full'
    OR (v_event.capacity IS NOT NULL AND v_confirmed_count >= v_event.capacity)
    OR v_waitlist_pending;

  IF p_intent = 'register' THEN
    IF v_event_full THEN
      RETURN jsonb_build_object('code', 'EVENT_FULL');
    END IF;
    v_status := 'confirmed';
  ELSE
    IF NOT v_event_full THEN
      RETURN jsonb_build_object('code', 'REGISTRATION_AVAILABLE');
    END IF;
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

-- Anonymous registrations: the per-address limiter, then the seat algorithm. Same signature and
-- lock order (address, event, registration) as before; register_event_guest still calls this.
CREATE OR REPLACE FUNCTION private.register_for_event_base(
  p_event_id uuid, p_attendee_name text, p_attendee_email text, p_intent text, p_ip inet
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_recent integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_ip::text));
  PERFORM private.purge_rate_limit_attempts();
  SELECT count(*) INTO v_recent FROM public.registration_attempts
  WHERE ip_address = p_ip AND created_at > clock_timestamp() - interval '10 minutes';
  INSERT INTO public.registration_attempts (ip_address) VALUES (p_ip);
  IF v_recent >= private.guest_registration_limit() THEN
    RETURN jsonb_build_object('code', 'RATE_LIMITED');
  END IF;
  RETURN private.register_for_event_seat(p_event_id, p_attendee_name, p_attendee_email, p_intent);
END $$;

-- ---------------------------------------------------------------------------------------------
-- 3. Guest registrations and verified members. A guest row is linked to a member only when the
--    member's Supabase Auth email is confirmed and is exactly the attendee email: proving that
--    address is proving the registration was made for them. Nothing else is merged or changed;
--    the seat, status and timestamps stay as they were.
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION private.link_member_registration(p_actor uuid, p_event uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_email text; v_registration uuid; v_committee uuid;
BEGIN
  SELECT lower(email) INTO v_email FROM private.access_auth_users
  WHERE id = p_actor AND email_confirmed_at IS NOT NULL;
  IF v_email IS NULL THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.registrations WHERE event_id = p_event AND member_id IS NULL
      AND attendee_email = v_email AND status IN ('confirmed', 'waitlisted')) THEN
    RETURN false;
  END IF;
  -- Canonical lock order: event, then registration.
  SELECT committee_id INTO v_committee FROM public.events WHERE id = p_event FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.registrations WHERE event_id = p_event AND member_id = p_actor
      AND status IN ('confirmed', 'waitlisted')) THEN
    RETURN false;
  END IF;
  SELECT id INTO v_registration FROM public.registrations
  WHERE event_id = p_event AND member_id IS NULL AND attendee_email = v_email
    AND status IN ('confirmed', 'waitlisted')
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.registrations SET member_id = p_actor WHERE id = v_registration;
  INSERT INTO private.uc02_audit (committee_id, event_id, registration_id, actor_kind, actor_user_id, action, changes)
  VALUES (v_committee, p_event, v_registration, 'authenticated', p_actor, 'registration.member_linked',
    jsonb_build_object('via', 'confirmed_email'));
  RETURN true;
END $$;

-- Signed-in registration: per-member limiter, the member's existing (or linkable) registration,
-- the phone requirement, then the canonical seat algorithm. The address is no longer a limit
-- for members; the parameter stays so the API contract is unchanged.
CREATE OR REPLACE FUNCTION private.register_event_member(p_actor uuid, p_event uuid, p_intent text, p_ip inet)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_profile jsonb; v_result jsonb; v_recent integer; v_required boolean; v_existing text;
BEGIN
  v_profile := private.get_member_profile(p_actor);
  IF v_profile->>'code' <> 'SUCCESS' THEN RETURN v_profile; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('member-registration:' || p_actor::text, 0));
  PERFORM private.purge_rate_limit_attempts();
  SELECT count(*) INTO v_recent FROM private.member_registration_attempts
  WHERE member_id = p_actor AND created_at > clock_timestamp() - interval '10 minutes';
  INSERT INTO private.member_registration_attempts (member_id) VALUES (p_actor);
  IF v_recent >= private.member_registration_limit() THEN
    RETURN jsonb_build_object('code', 'RATE_LIMITED');
  END IF;

  SELECT phone_required INTO v_required FROM public.events
  WHERE id = p_event AND archived_at IS NULL AND status IN ('published', 'full') FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'EVENT_NOT_FOUND'); END IF;
  PERFORM private.link_member_registration(p_actor, p_event);
  SELECT status::text INTO v_existing FROM public.registrations
  WHERE event_id = p_event AND member_id = p_actor AND status IN ('confirmed', 'waitlisted');
  IF FOUND THEN
    RETURN jsonb_build_object('code',
      CASE WHEN v_existing = 'confirmed' THEN 'ALREADY_REGISTERED' ELSE 'ALREADY_WAITLISTED' END);
  END IF;
  IF v_required AND v_profile->>'phone' IS NULL THEN
    RETURN jsonb_build_object('code', 'PHONE_REQUIRED');
  END IF;

  v_result := private.register_for_event_seat(p_event, v_profile->>'name', v_profile->>'email', p_intent);
  IF v_result->>'code' IN ('SUCCESS', 'WAITLISTED') THEN
    UPDATE public.registrations SET member_id = p_actor, attendee_phone = v_profile->>'phone'
    WHERE id = (v_result->>'registrationId')::uuid;
    -- The seat audit records the decision; this adds the verified attribution.
    INSERT INTO private.uc02_audit (committee_id, event_id, registration_id, actor_kind, actor_user_id, action, changes)
    SELECT committee_id, p_event, (v_result->>'registrationId')::uuid, 'authenticated', p_actor,
      'registration.member_linked', jsonb_build_object('via', 'member_registration')
    FROM public.events WHERE id = p_event;
  END IF;
  RETURN v_result;
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('code', 'ALREADY_REGISTERED');
END $$;

-- ---------------------------------------------------------------------------------------------
-- 4. Check-in codes. One secret per open session; the code shown is derived from it and the
--    current minute, so every organizer screen shows the same code and opening a screen changes
--    nothing. A code is accepted during its minute and the two after (three minutes from first
--    display). "Issue new code" replaces the secret, revoking every outstanding code at once.
-- ---------------------------------------------------------------------------------------------
UPDATE private.event_checkin_sessions SET is_open = false, closes_at = NULL WHERE is_open;
ALTER TABLE private.event_checkin_sessions
  DROP COLUMN challenge_hash,
  DROP COLUMN challenge_expires_at,
  ADD COLUMN code_secret text CHECK (code_secret IS NULL OR code_secret ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT event_checkin_sessions_open_check
    CHECK (NOT is_open OR (closes_at IS NOT NULL AND code_secret IS NOT NULL));

CREATE FUNCTION private.checkin_window(p_at timestamptz) RETURNS bigint
LANGUAGE sql IMMUTABLE AS $$ SELECT floor(extract(epoch FROM p_at) / 60)::bigint $$;
CREATE FUNCTION private.checkin_code(p_secret text, p_window bigint) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(p_secret || ':' || p_window::text, 'UTF8')), 'hex')
$$;

DROP FUNCTION private.manage_event_checkin(uuid, uuid, text, text, timestamptz);
CREATE FUNCTION private.manage_event_checkin(p_actor uuid, p_event uuid, p_operation text, p_secret text, p_closes timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_event public.events%ROWTYPE; v_session private.event_checkin_sessions%ROWTYPE;
  v_now timestamptz := clock_timestamp(); v_open boolean; v_window bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.events e WHERE e.id = p_event
      AND private.lock_committee_access(p_actor, e.committee_id)) THEN
    RETURN jsonb_build_object('code', 'NOT_FOUND');
  END IF;
  SELECT * INTO v_event FROM public.events WHERE id = p_event FOR UPDATE;
  SELECT * INTO v_session FROM private.event_checkin_sessions WHERE event_id = p_event;
  v_open := coalesce(v_session.is_open AND v_session.closes_at > v_now, false);

  IF p_operation = 'read' THEN
    v_window := private.checkin_window(v_now);
    RETURN jsonb_build_object('code', 'SUCCESS', 'isOpen', v_open, 'closesAt', v_session.closes_at,
      'checkinCode', CASE WHEN v_open THEN private.checkin_code(v_session.code_secret, v_window) END,
      'refreshAt', CASE WHEN v_open THEN least(v_session.closes_at, to_timestamp((v_window + 1) * 60)) END,
      'codeMinutes', 3);
  END IF;
  IF p_operation IS NULL OR p_operation NOT IN ('open', 'rotate', 'close') THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR');
  END IF;
  IF p_operation <> 'close' AND (v_event.archived_at IS NOT NULL OR v_event.status NOT IN ('published', 'full')) THEN
    RETURN jsonb_build_object('code', 'INVALID_TRANSITION');
  END IF;
  IF p_operation = 'rotate' AND NOT v_open THEN RETURN jsonb_build_object('code', 'CHECKIN_CLOSED'); END IF;
  IF p_operation = 'rotate' THEN p_closes := v_session.closes_at; END IF;
  IF p_operation <> 'close' AND (p_secret IS NULL OR p_secret !~ '^[0-9a-f]{64}$' OR p_closes IS NULL
      OR p_closes <= v_now OR p_closes > v_now + interval '12 hours') THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR');
  END IF;

  INSERT INTO private.event_checkin_sessions (event_id, is_open, closes_at, code_secret)
  VALUES (p_event, p_operation <> 'close',
    CASE WHEN p_operation <> 'close' THEN p_closes END,
    -- Opening an open session only changes its closing time: codes on screen stay valid.
    CASE WHEN p_operation = 'close' THEN NULL
         WHEN p_operation = 'open' AND v_open THEN v_session.code_secret
         ELSE p_secret END)
  ON CONFLICT (event_id) DO UPDATE SET is_open = excluded.is_open, closes_at = excluded.closes_at,
    code_secret = excluded.code_secret;
  INSERT INTO private.uc02_audit (committee_id, event_id, actor_kind, actor_user_id, action, changes)
  VALUES (v_event.committee_id, p_event, 'authenticated', p_actor, 'attendance.session_changed',
    jsonb_build_object('operation', p_operation, 'closesAt', CASE WHEN p_operation <> 'close' THEN p_closes END));
  RETURN private.manage_event_checkin(p_actor, p_event, 'read', NULL, NULL);
END $$;

DROP FUNCTION private.confirm_member_attendance(uuid, uuid, text);
CREATE FUNCTION private.confirm_member_attendance(p_actor uuid, p_event uuid, p_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_profile jsonb; v_event public.events%ROWTYPE; v_registration public.registrations%ROWTYPE;
  v_session private.event_checkin_sessions%ROWTYPE; v_now timestamptz := clock_timestamp(); v_window bigint;
BEGIN
  v_profile := private.get_member_profile(p_actor);
  IF v_profile->>'code' <> 'SUCCESS' THEN RETURN v_profile; END IF;
  SELECT * INTO v_event FROM public.events WHERE id = p_event FOR UPDATE;
  IF NOT FOUND OR v_event.archived_at IS NOT NULL OR v_event.status NOT IN ('published', 'full') THEN
    RETURN jsonb_build_object('code', 'NOT_FOUND');
  END IF;
  PERFORM private.link_member_registration(p_actor, p_event);
  SELECT * INTO v_registration FROM public.registrations
  WHERE event_id = p_event AND member_id = p_actor AND status IN ('confirmed', 'waitlisted') FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_REGISTERED'); END IF;
  IF v_registration.status <> 'confirmed' THEN RETURN jsonb_build_object('code', 'WAITLISTED'); END IF;
  -- A retry is a read of the original successful result, never another write.
  IF v_registration.attended THEN
    RETURN jsonb_build_object('code', 'SUCCESS', 'checkedInAt', v_registration.checked_in_at, 'alreadyAttended', true);
  END IF;
  SELECT * INTO v_session FROM private.event_checkin_sessions WHERE event_id = p_event;
  IF NOT coalesce(v_session.is_open AND v_session.closes_at > v_now, false) THEN
    RETURN jsonb_build_object('code', 'CHECKIN_CLOSED');
  END IF;
  v_window := private.checkin_window(v_now);
  IF p_code IS NULL OR p_code !~ '^[0-9a-f]{64}$' THEN RETURN jsonb_build_object('code', 'INVALID_CHALLENGE'); END IF;
  IF p_code NOT IN (private.checkin_code(v_session.code_secret, v_window),
                    private.checkin_code(v_session.code_secret, v_window - 1),
                    private.checkin_code(v_session.code_secret, v_window - 2)) THEN
    -- A code from this session's last half hour is expired, anything else is not a code at all.
    IF EXISTS (SELECT 1 FROM generate_series(3, 30) k
        WHERE private.checkin_code(v_session.code_secret, v_window - k) = p_code) THEN
      RETURN jsonb_build_object('code', 'CHALLENGE_EXPIRED');
    END IF;
    RETURN jsonb_build_object('code', 'INVALID_CHALLENGE');
  END IF;
  UPDATE public.registrations SET attended = true, checked_in_at = v_now, checkin_method = 'qr'
  WHERE id = v_registration.id;
  INSERT INTO private.uc02_audit (committee_id, event_id, registration_id, actor_kind, actor_user_id, action, changes)
  VALUES (v_event.committee_id, p_event, v_registration.id, 'authenticated', p_actor, 'attendance.confirmed',
    jsonb_build_object('checkedInAt', v_now, 'method', 'qr'));
  RETURN jsonb_build_object('code', 'SUCCESS', 'checkedInAt', v_now, 'alreadyAttended', false);
END $$;

-- The member's own view now also links their verified guest registration, so it writes.
CREATE OR REPLACE FUNCTION private.get_member_event(p_actor uuid, p_event uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_profile jsonb; v_registration public.registrations%ROWTYPE; v_session private.event_checkin_sessions%ROWTYPE;
BEGIN
  v_profile := private.get_member_profile(p_actor);
  IF v_profile->>'code' <> 'SUCCESS' THEN RETURN v_profile; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.events WHERE id = p_event AND archived_at IS NULL AND status IN ('published', 'full')) THEN
    RETURN jsonb_build_object('code', 'NOT_FOUND');
  END IF;
  PERFORM private.link_member_registration(p_actor, p_event);
  SELECT * INTO v_registration FROM public.registrations
  WHERE event_id = p_event AND member_id = p_actor AND status IN ('confirmed', 'waitlisted');
  SELECT * INTO v_session FROM private.event_checkin_sessions WHERE event_id = p_event;
  RETURN jsonb_build_object('code', 'SUCCESS', 'profile', v_profile,
    'registration', CASE WHEN v_registration.id IS NOT NULL THEN jsonb_build_object(
      'status', v_registration.status, 'attended', v_registration.attended, 'checkedInAt', v_registration.checked_in_at) END,
    'checkinOpen', coalesce(v_session.is_open AND v_session.closes_at > clock_timestamp(), false),
    'closesAt', v_session.closes_at);
END $$;

-- ---------------------------------------------------------------------------------------------
-- 5. Organizer-assisted attendance: for guests, members without a phone, or a failed scan. Only
--    confirmed registrations; reasons are a fixed list so audit rows carry no free text; an
--    organizer cannot mark their own registration; every change is audited and reversible.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE public.registrations
  ADD COLUMN checkin_method text CHECK (checkin_method IS NULL OR checkin_method IN ('qr', 'manual')),
  ADD CONSTRAINT registrations_checkin_method_attended_check CHECK (checkin_method IS NULL OR attended);

DO $$ DECLARE v_check text; BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_check FROM pg_constraint
    WHERE conrelid = 'private.uc02_audit'::regclass AND conname = 'uc02_audit_action_check';
  EXECUTE 'ALTER TABLE private.uc02_audit DROP CONSTRAINT uc02_audit_action_check';
  EXECUTE 'ALTER TABLE private.uc02_audit ADD CONSTRAINT uc02_audit_action_check CHECK (' ||
    substring(v_check from 8 for char_length(v_check) - 8) ||
    ' OR action IN (''attendance.manual_confirmed'',''attendance.manual_reverted''))';
END $$;

CREATE FUNCTION private.record_manual_attendance(p_actor uuid, p_event uuid, p_registration uuid, p_attended boolean, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_event public.events%ROWTYPE; v_registration public.registrations%ROWTYPE; v_now timestamptz := clock_timestamp();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.events e WHERE e.id = p_event
      AND private.lock_committee_access(p_actor, e.committee_id)) THEN
    RETURN jsonb_build_object('code', 'NOT_FOUND');
  END IF;
  IF p_attended IS NULL OR p_reason IS NULL
     OR (p_attended AND p_reason NOT IN ('qr_unavailable', 'no_account', 'organizer_verified'))
     OR (NOT p_attended AND p_reason NOT IN ('recorded_in_error', 'not_present')) THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR');
  END IF;
  SELECT * INTO v_event FROM public.events WHERE id = p_event FOR UPDATE;
  IF v_event.archived_at IS NOT NULL OR v_event.status NOT IN ('published', 'full') THEN
    RETURN jsonb_build_object('code', 'INVALID_TRANSITION');
  END IF;
  SELECT * INTO v_registration FROM public.registrations
  WHERE id = p_registration AND event_id = p_event AND status IN ('confirmed', 'waitlisted') FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  IF v_registration.status <> 'confirmed' THEN RETURN jsonb_build_object('code', 'WAITLISTED'); END IF;
  IF v_registration.member_id = p_actor THEN RETURN jsonb_build_object('code', 'SELF_CHECKIN'); END IF;
  IF v_registration.attended = p_attended THEN
    RETURN jsonb_build_object('code', 'SUCCESS', 'attended', p_attended,
      'checkedInAt', v_registration.checked_in_at, 'unchanged', true);
  END IF;
  UPDATE public.registrations SET attended = p_attended,
    checked_in_at = CASE WHEN p_attended THEN v_now END,
    checkin_method = CASE WHEN p_attended THEN 'manual' END
  WHERE id = v_registration.id;
  INSERT INTO private.uc02_audit (committee_id, event_id, registration_id, actor_kind, actor_user_id, action, changes)
  VALUES (v_event.committee_id, p_event, v_registration.id, 'authenticated', p_actor,
    CASE WHEN p_attended THEN 'attendance.manual_confirmed' ELSE 'attendance.manual_reverted' END,
    jsonb_build_object('reason', p_reason, 'previousMethod', v_registration.checkin_method));
  RETURN jsonb_build_object('code', 'SUCCESS', 'attended', p_attended,
    'checkedInAt', CASE WHEN p_attended THEN v_now END, 'unchanged', false);
END $$;

-- ---------------------------------------------------------------------------------------------
-- 6. Attendance list: alphabetical (offset pages), with the check-in method and whether the
--    registration belongs to a member account. Same scope, filters, bounds and export audit.
-- ---------------------------------------------------------------------------------------------
DROP FUNCTION private.list_event_attendance(uuid, uuid, text, text, uuid, integer, boolean);
CREATE FUNCTION private.list_event_attendance(p_actor uuid, p_event uuid, p_filter text, p_search text,
  p_offset integer, p_limit integer, p_export boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_committee uuid; v_rows jsonb; v_total integer; v_confirmed integer; v_attended integer; v_waitlisted integer;
BEGIN
  SELECT committee_id INTO v_committee FROM public.events WHERE id = p_event;
  IF NOT FOUND OR NOT private.lock_committee_access(p_actor, v_committee) THEN
    RETURN jsonb_build_object('code', 'NOT_FOUND');
  END IF;
  PERFORM 1 FROM public.events WHERE id = p_event FOR SHARE;
  IF p_filter IS NULL OR p_filter NOT IN ('all', 'attended', 'absent', 'waitlisted')
     OR p_search IS NULL OR char_length(p_search) > 200
     OR p_offset IS NULL OR p_offset < 0 OR p_offset > 100000
     OR p_limit IS NULL OR p_limit < 1 OR p_limit > (CASE WHEN p_export THEN 10000 ELSE 101 END) THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR');
  END IF;
  SELECT count(*) FILTER (WHERE status = 'confirmed'), count(*) FILTER (WHERE status = 'confirmed' AND attended),
    count(*) FILTER (WHERE status = 'waitlisted')
  INTO v_confirmed, v_attended, v_waitlisted FROM public.registrations WHERE event_id = p_event;
  SELECT count(*) INTO v_total FROM public.registrations r
  WHERE r.event_id = p_event AND r.status IN ('confirmed', 'waitlisted')
    AND (p_filter = 'all' OR p_filter = 'waitlisted' AND r.status = 'waitlisted'
      OR p_filter = 'attended' AND r.status = 'confirmed' AND r.attended
      OR p_filter = 'absent' AND r.status = 'confirmed' AND NOT r.attended)
    AND (p_search = '' OR position(lower(p_search) IN lower(r.attendee_name || ' ' || r.attendee_email)) > 0);
  IF p_export AND v_total > 10000 THEN RETURN jsonb_build_object('code', 'EXPORT_LIMIT'); END IF;
  SELECT coalesce(jsonb_agg(x ORDER BY lower(x.name), x.email, x.id), '[]') INTO v_rows FROM (
    SELECT r.id, r.attendee_name AS name, r.attendee_email AS email, r.status, r.attended,
      r.checked_in_at AS "checkedInAt", r.registered_at AS "registeredAt", r.checkin_method AS method,
      r.member_id IS NOT NULL AS "hasAccount"
    FROM public.registrations r
    WHERE r.event_id = p_event AND r.status IN ('confirmed', 'waitlisted')
      AND (p_filter = 'all' OR p_filter = 'waitlisted' AND r.status = 'waitlisted'
        OR p_filter = 'attended' AND r.status = 'confirmed' AND r.attended
        OR p_filter = 'absent' AND r.status = 'confirmed' AND NOT r.attended)
      AND (p_search = '' OR position(lower(p_search) IN lower(r.attendee_name || ' ' || r.attendee_email)) > 0)
    ORDER BY lower(r.attendee_name), r.attendee_email, r.id OFFSET p_offset LIMIT p_limit
  ) x;
  IF p_export THEN
    INSERT INTO private.uc02_audit (committee_id, event_id, actor_kind, actor_user_id, action, changes)
    VALUES (v_committee, p_event, 'authenticated', p_actor, 'attendance.exported',
      jsonb_build_object('rowCount', v_total, 'filter', p_filter));
  END IF;
  RETURN jsonb_build_object('code', 'SUCCESS', 'rows', v_rows, 'total', v_total,
    'confirmed', v_confirmed, 'attended', v_attended, 'waitlisted', v_waitlisted);
END $$;

-- ---------------------------------------------------------------------------------------------
-- 7. Event options audit: record what actually changed (0028 always claimed a new cover).
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.save_event_details(
  p_actor uuid, p_event uuid, p_committee uuid, p_revision integer,
  p_title text, p_description text, p_date timestamptz, p_location text,
  p_capacity integer, p_cover text, p_phone boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_result jsonb; v_event public.events%ROWTYPE; v_id uuid;
  v_cover_changed boolean; v_phone_changed boolean;
BEGIN
  IF p_phone IS NULL OR (p_cover IS NOT NULL AND p_cover !~ '^event-covers/[0-9a-f-]{36}\.(jpg|png)$') THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR');
  END IF;
  IF p_event IS NULL THEN
    v_result := private.create_event(p_actor, p_committee, p_title, p_description, p_date, p_location, p_capacity);
    IF v_result->>'code' <> 'SUCCESS' THEN RETURN v_result; END IF;
    v_id := (v_result->>'eventId')::uuid;
    UPDATE public.events SET cover_image_key = p_cover, phone_required = p_phone WHERE id = v_id;
    v_cover_changed := p_cover IS NOT NULL;
    v_phone_changed := p_phone;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.events e WHERE e.id = p_event
        AND private.lock_committee_access(p_actor, e.committee_id)) THEN
      RETURN jsonb_build_object('code', 'NOT_FOUND');
    END IF;
    SELECT * INTO v_event FROM public.events WHERE id = p_event FOR UPDATE;
    v_result := private.edit_event(p_actor, p_event, p_revision, p_title, p_description, p_date, p_location, p_capacity);
    IF v_result->>'code' <> 'SUCCESS' THEN RETURN v_result; END IF;
    v_id := p_event;
    v_cover_changed := v_event.cover_image_key IS DISTINCT FROM p_cover;
    v_phone_changed := v_event.phone_required IS DISTINCT FROM p_phone;
    IF v_cover_changed OR v_phone_changed THEN
      UPDATE public.events SET cover_image_key = p_cover, phone_required = p_phone,
        revision = CASE WHEN revision = v_event.revision THEN revision + 1 ELSE revision END,
        flagged_by = CASE WHEN review_required THEN p_actor ELSE flagged_by END,
        approved_by = CASE WHEN review_required THEN NULL ELSE approved_by END,
        approved_at = CASE WHEN review_required THEN NULL ELSE approved_at END,
        approved_revision = CASE WHEN review_required THEN NULL ELSE approved_revision END
      WHERE id = v_id;
    END IF;
  END IF;
  IF v_cover_changed OR v_phone_changed THEN
    INSERT INTO private.uc02_audit (committee_id, event_id, actor_kind, actor_user_id, action, changes)
    SELECT committee_id, id, 'authenticated', p_actor, 'event.updated',
      jsonb_build_object('coverChanged', v_cover_changed, 'phoneRequiredChanged', v_phone_changed,
        'phoneRequired', p_phone)
    FROM public.events WHERE id = v_id;
  END IF;
  RETURN (SELECT jsonb_build_object('code', 'SUCCESS', 'eventId', id, 'revision', revision) FROM public.events WHERE id = v_id);
END $$;

-- ---------------------------------------------------------------------------------------------
-- 8. Membership applications: the 0025/0026 routines, unchanged except the per-address hourly limit.
-- ---------------------------------------------------------------------------------------------
-- 0025 one-step submission (used when ID cards are not in Storage).
CREATE OR REPLACE FUNCTION private.submit_membership_application(
  p_full_name text, p_email text, p_university_id text, p_academic_year integer,
  p_discipline text, p_interests text[], p_consent_version text, p_status_token_hash text,
  p_media_type text, p_sha256 text, p_content bytea, p_ip inet
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_name text := btrim(coalesce(p_full_name, ''));
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_university_id text := btrim(coalesce(p_university_id, ''));
  v_interests text[] := coalesce(p_interests, '{}');
  v_size integer := coalesce(octet_length(p_content), 0);
  v_recent integer;
  v_id uuid;
BEGIN
  IF p_ip IS NULL THEN RETURN jsonb_build_object('code', 'INVALID_IP'); END IF;
  IF char_length(v_name) NOT BETWEEN 1 AND 200 OR v_name ~ '[[:cntrl:]]' THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'fullName');
  END IF;
  IF char_length(v_email) > 254 OR v_email !~ '^[^[:space:]@]+@([a-z0-9-]+\.)*squ\.edu\.om$' THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'email');
  END IF;
  IF v_university_id !~ '^[0-9]{6,10}$' THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'universityId');
  END IF;
  IF p_academic_year IS NULL OR p_academic_year NOT BETWEEN 1 AND 5 THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'academicYear');
  END IF;
  IF p_discipline IS NULL OR p_discipline NOT IN
      ('mechanical', 'electrical', 'civil', 'petroleum', 'chemical', 'mechatronics', 'industrial') THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'discipline');
  END IF;
  IF cardinality(v_interests) > 4 OR array_position(v_interests, NULL) IS NOT NULL
      OR NOT (v_interests <@ ARRAY['cad', 'simulation', 'embedded', 'robotics', 'structures',
        'process', 'data', 'programming', 'power', 'reservoir', 'quality', 'management',
        'sustainability', 'hse'])
      OR (SELECT count(DISTINCT x) FROM unnest(v_interests) x) <> cardinality(v_interests) THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'interests');
  END IF;
  IF p_consent_version IS NULL OR p_consent_version NOT IN ('2026-10-v1') THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'consent');
  END IF;
  IF p_status_token_hash IS NULL OR p_status_token_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'statusToken');
  END IF;
  IF p_media_type IS NULL OR p_media_type NOT IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')
      OR v_size NOT BETWEEN 1 AND 4194304 OR p_sha256 IS NULL
      OR p_sha256 <> encode(sha256(p_content), 'hex') THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'idDocument');
  END IF;

  -- Rate limit per client address: membership_submission_limit() submissions an hour. The attempt is recorded even when it
  -- is refused, and attempts older than a day are discarded.
  DELETE FROM private.membership_submission_attempts WHERE created_at < clock_timestamp() - interval '1 day';
  INSERT INTO private.membership_submission_attempts (ip_address) VALUES (p_ip);
  SELECT count(*) INTO v_recent FROM private.membership_submission_attempts
  WHERE ip_address = p_ip AND created_at > clock_timestamp() - interval '1 hour';
  IF v_recent > private.membership_submission_limit() THEN RETURN jsonb_build_object('code', 'RATE_LIMITED'); END IF;

  -- UC-01: the same email or student ID is the same person, not a new one.
  IF EXISTS (SELECT 1 FROM public.members
      WHERE lower(email) = v_email OR university_id = v_university_id) THEN
    RETURN jsonb_build_object('code', 'ALREADY_MEMBER');
  END IF;
  IF EXISTS (SELECT 1 FROM private.membership_applications
      WHERE status IN ('pending_review', 'verified', 'approved')
        AND (email = v_email OR university_id = v_university_id)) THEN
    RETURN jsonb_build_object('code', 'ALREADY_APPLIED');
  END IF;

  BEGIN
    INSERT INTO private.membership_applications
      (full_name, email, university_id, academic_year, discipline, interests,
       consent_version, status_token_hash)
    VALUES (v_name, v_email, v_university_id, p_academic_year, p_discipline, v_interests,
       p_consent_version, p_status_token_hash)
    RETURNING id INTO v_id;
    INSERT INTO private.membership_documents (application_id, media_type, byte_size, sha256, content)
    VALUES (v_id, p_media_type, v_size, p_sha256, p_content);
  EXCEPTION WHEN unique_violation THEN
    -- A concurrent duplicate lost the race on the partial unique indexes.
    RETURN jsonb_build_object('code', 'ALREADY_APPLIED');
  END;

  INSERT INTO private.uc02_audit (committee_id, actor_kind, action, changes)
  VALUES (NULL, 'anonymous', 'membership.submitted', jsonb_build_object('applicationId', v_id));
  RETURN jsonb_build_object('code', 'SUCCESS', 'applicationId', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION private.begin_membership_submission(p_email text, p_university_id text, p_ip inet)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_university_id text := btrim(coalesce(p_university_id, ''));
  v_recent integer;
BEGIN
  IF p_ip IS NULL THEN RETURN jsonb_build_object('code', 'INVALID_IP'); END IF;
  IF char_length(v_email) > 254 OR v_email !~ '^[^[:space:]@]+@([a-z0-9-]+\.)*squ\.edu\.om$' THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'email');
  END IF;
  IF v_university_id !~ '^[0-9]{6,10}$' THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'universityId');
  END IF;

  DELETE FROM private.membership_submission_attempts WHERE created_at < clock_timestamp() - interval '1 day';
  INSERT INTO private.membership_submission_attempts (ip_address) VALUES (p_ip);
  SELECT count(*) INTO v_recent FROM private.membership_submission_attempts
  WHERE ip_address = p_ip AND created_at > clock_timestamp() - interval '1 hour';
  IF v_recent > private.membership_submission_limit() THEN RETURN jsonb_build_object('code', 'RATE_LIMITED'); END IF;

  IF EXISTS (SELECT 1 FROM public.members
      WHERE lower(email) = v_email OR university_id = v_university_id) THEN
    RETURN jsonb_build_object('code', 'ALREADY_MEMBER');
  END IF;
  IF EXISTS (SELECT 1 FROM private.membership_applications
      WHERE status IN ('pending_review', 'verified', 'approved')
        AND (email = v_email OR university_id = v_university_id)) THEN
    RETURN jsonb_build_object('code', 'ALREADY_APPLIED');
  END IF;
  RETURN jsonb_build_object('code', 'SUCCESS');
END;
$$;

CREATE OR REPLACE FUNCTION private.submit_stored_membership_application(
  p_full_name text, p_email text, p_university_id text, p_academic_year integer,
  p_discipline text, p_interests text[], p_consent_version text, p_status_token_hash text,
  p_media_type text, p_sha256 text, p_byte_size integer, p_storage_bucket text, p_storage_key text,
  p_ip inet
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_field text;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_university_id text := btrim(coalesce(p_university_id, ''));
  v_recent integer;
  v_started boolean;
  v_constraint text;
  v_id uuid;
BEGIN
  IF p_ip IS NULL THEN RETURN jsonb_build_object('code', 'INVALID_IP'); END IF;
  v_field := private.membership_invalid_field(p_full_name, p_email, p_university_id,
    p_academic_year, p_discipline, p_interests, p_consent_version, p_status_token_hash);
  IF v_field IS NOT NULL THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', v_field);
  END IF;
  IF p_media_type IS NULL OR p_media_type NOT IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')
      OR p_byte_size IS NULL OR p_byte_size NOT BETWEEN 1 AND 4194304
      OR p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$'
      OR p_storage_bucket IS NULL OR p_storage_bucket !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$'
      OR p_storage_key IS NULL OR p_storage_key !~
        '^membership-id-cards/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp|pdf)$'
      -- Parenthesised: PL/pgSQL would otherwise end the IF condition at the CASE's first THEN.
      OR p_storage_key NOT LIKE ('%.' || (CASE p_media_type
        WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/png' THEN 'png'
        WHEN 'image/webp' THEN 'webp' WHEN 'application/pdf' THEN 'pdf' END)) THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'idDocument');
  END IF;

  SELECT count(*), bool_or(created_at > clock_timestamp() - interval '10 minutes')
  INTO v_recent, v_started
  FROM private.membership_submission_attempts
  WHERE ip_address = p_ip AND created_at > clock_timestamp() - interval '1 hour';
  IF NOT coalesce(v_started, false) THEN RETURN jsonb_build_object('code', 'NOT_STARTED'); END IF;
  IF v_recent > private.membership_submission_limit() THEN RETURN jsonb_build_object('code', 'RATE_LIMITED'); END IF;

  IF EXISTS (SELECT 1 FROM public.members
      WHERE lower(email) = v_email OR university_id = v_university_id) THEN
    RETURN jsonb_build_object('code', 'ALREADY_MEMBER');
  END IF;
  IF EXISTS (SELECT 1 FROM private.membership_applications
      WHERE status IN ('pending_review', 'verified', 'approved')
        AND (email = v_email OR university_id = v_university_id)) THEN
    RETURN jsonb_build_object('code', 'ALREADY_APPLIED');
  END IF;

  BEGIN
    INSERT INTO private.membership_applications
      (full_name, email, university_id, academic_year, discipline, interests,
       consent_version, status_token_hash)
    VALUES (btrim(p_full_name), v_email, v_university_id, p_academic_year, p_discipline,
       coalesce(p_interests, '{}'), p_consent_version, p_status_token_hash)
    RETURNING id INTO v_id;
    INSERT INTO private.membership_documents
      (application_id, media_type, byte_size, sha256, content, storage_bucket, storage_key)
    VALUES (v_id, p_media_type, p_byte_size, p_sha256, NULL, p_storage_bucket, p_storage_key);
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    -- The object key is random; a clash means the request is not genuine, not a duplicate person.
    IF v_constraint = 'membership_documents_storage_object_unique' THEN
      RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'idDocument');
    END IF;
    RETURN jsonb_build_object('code', 'ALREADY_APPLIED');
  END;

  INSERT INTO private.uc02_audit (committee_id, actor_kind, action, changes)
  VALUES (NULL, 'anonymous', 'membership.submitted', jsonb_build_object('applicationId', v_id));
  RETURN jsonb_build_object('code', 'SUCCESS', 'applicationId', v_id);
END;
$$;

-- ---------------------------------------------------------------------------------------------
-- 9. Ownership and grants: the NOLOGIN executor owns every routine; the runtime may call only
--    the API-facing ones; browser roles and maintenance get nothing.
-- ---------------------------------------------------------------------------------------------
DO $$ DECLARE v_fn regprocedure; BEGIN
  FOR v_fn IN SELECT oid::regprocedure FROM pg_proc WHERE pronamespace = 'private'::regnamespace
    AND proname IN ('guest_registration_limit', 'member_registration_limit', 'membership_submission_limit',
      'purge_rate_limit_attempts', 'register_for_event_seat', 'link_member_registration',
      'checkin_window', 'checkin_code', 'manage_event_checkin', 'confirm_member_attendance',
      'record_manual_attendance', 'list_event_attendance') LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO uc02_routine_owner', v_fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, app_runtime, app_maintenance, service_role', v_fn);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION private.manage_event_checkin(uuid, uuid, text, text, timestamptz) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.confirm_member_attendance(uuid, uuid, text) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.record_manual_attendance(uuid, uuid, uuid, boolean, text) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.list_event_attendance(uuid, uuid, text, text, integer, integer, boolean) TO app_runtime;
REVOKE ALL ON FUNCTION private.core_schema_version() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.core_schema_version() TO app_runtime, app_maintenance;

-- Self-check: the release fails here rather than shipping a wrong grant.
DO $$ BEGIN
  IF private.core_schema_version() <> 30
     OR NOT has_function_privilege('app_runtime', 'private.record_manual_attendance(uuid,uuid,uuid,boolean,text)', 'EXECUTE')
     OR has_function_privilege('app_runtime', 'private.register_for_event_seat(uuid,text,text,text)', 'EXECUTE')
     OR has_function_privilege('app_runtime', 'private.link_member_registration(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'private.confirm_member_attendance(uuid,uuid,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'private.record_manual_attendance(uuid,uuid,uuid,boolean,text)', 'EXECUTE')
     OR has_table_privilege('app_runtime', 'private.member_registration_attempts', 'SELECT')
     OR NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'private.member_registration_attempts'::regclass) THEN
    RAISE EXCEPTION '0030 self-check failed';
  END IF;
END $$;
