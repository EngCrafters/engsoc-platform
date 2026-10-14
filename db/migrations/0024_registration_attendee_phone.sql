-- 0024: capture an attendee phone number on event registration.
--
-- WHAT THIS ADDS
-- --------------
-- Registrations now record name, email AND phone. The column is nullable, and
-- that is deliberate: every registration captured before this migration keeps
-- its NULL phone and stays valid. No phone number is fabricated for a
-- historical row, and none is backfilled here.
--
-- Every NEW registration must supply one. That is enforced in two places so a
-- caller cannot bypass it:
--   * private.register_for_event normalizes the value and returns INVALID_PHONE
--     when it is missing or malformed, and
--   * the registrations_phone_canonical CHECK permits only NULL or the exact
--     canonical shape, so even a direct table writer cannot store a
--     half-formatted number.
--
-- The column is TEXT, never numeric. A phone number is an identifier, not a
-- quantity: leading zeros and a leading "+" have to survive, and a numeric type
-- would destroy both (and cannot represent "+" at all).
--
-- Deliberately NOT unique and deliberately NOT indexed. Email remains the
-- registration identity and the deduplication key (docs/adr/0004,
-- docs/UC-02_Data_and_Security.md section 3); nothing in the product searches,
-- joins or deduplicates by phone, so an index would be cost without benefit.
--
-- This is a purely additive migration: one nullable column, one CHECK, one new
-- pure helper function, and three routines replaced. No row is updated, deleted
-- or rewritten, and no authorization rule changes.

-- ---------------------------------------------------------------------------
-- 1. The column.
-- ---------------------------------------------------------------------------

ALTER TABLE public.registrations ADD COLUMN attendee_phone text;

-- NULL is allowed only for rows captured before this migration. Anything else
-- must already be canonical, so the stored value cannot disagree with what
-- private.normalize_phone produces. Keep this pattern identical to the one in
-- private.normalize_phone below; they are two expressions of one contract.
ALTER TABLE public.registrations
  ADD CONSTRAINT registrations_phone_canonical
  CHECK (attendee_phone IS NULL OR attendee_phone ~ '^[+]?[0-9]{7,15}$');

COMMENT ON COLUMN public.registrations.attendee_phone IS
  'Canonical attendee contact number: optional leading + then 7-15 digits. NULL only on registrations captured before this field existed. Required for every new registration through private.register_for_event. Text, not numeric, so leading zeros and + survive. Not unique, not indexed. Private attendee PII: never returned on a public path.';

-- ---------------------------------------------------------------------------
-- 2. One canonical normalizer.
--
-- A pure function so the rule has exactly one definition on the database side,
-- is testable on its own, and cannot drift between the routine and its tests.
-- No grants: only the routine owner executes it, and it is reachable from
-- app_runtime solely through private.register_for_event.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.normalize_phone(p_value text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v text;
BEGIN
  IF p_value IS NULL THEN RETURN NULL; END IF;

  -- Arabic-Indic (U+0660..U+0669) and Eastern Arabic-Indic (U+06F0..U+06F9)
  -- digits become ASCII, so a number typed on an Arabic keyboard is accepted
  -- rather than silently rejected.
  v := translate(p_value, '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789');
  v := btrim(v);

  IF v = '' THEN RETURN NULL; END IF;

  -- Refuse letters and control characters rather than stripping them: reading
  -- "call me on 968..." as a phone number would be worse than saying no.
  IF v ~ '[[:alpha:]]' OR v ~ '[[:cntrl:]]' THEN RETURN NULL; END IF;

  -- Anything left that is not a digit or a plus is presentation formatting —
  -- spaces, non-breaking spaces, hyphens, parentheses, dots, slashes. Dropping
  -- it means a human can type the number the way they write it.
  v := regexp_replace(v, '[^0-9+]', '', 'g');

  -- At most one leading plus, then 7 to 15 digits. 15 is the E.164 maximum;
  -- 7 is the shortest national number in common use.
  IF v !~ '^[+]?[0-9]{7,15}$' THEN RETURN NULL; END IF;

  RETURN v;
END;
$$;

ALTER FUNCTION private.normalize_phone(text) OWNER TO uc02_routine_owner;
REVOKE ALL ON FUNCTION private.normalize_phone(text) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 3. The registration write path gains the phone argument.
--
-- The OLD FIVE-ARGUMENT SIGNATURE IS DROPPED EXPLICITLY. CREATE OR REPLACE
-- cannot replace a function with a different argument list — it would create a
-- second, overloaded function, and the old one would remain EXECUTE-able by
-- app_runtime as a live write path that accepts no phone at all. That is
-- exactly the accident this DROP exists to prevent.
-- ---------------------------------------------------------------------------

DROP FUNCTION private.register_for_event(uuid, text, text, text, inet);

CREATE FUNCTION private.register_for_event(
  p_event_id uuid,
  p_attendee_name text,
  p_attendee_email text,
  p_attendee_phone text,
  p_intent text,
  p_ip inet
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event record;
  v_norm_email text := lower(btrim(p_attendee_email));
  v_norm_phone text := private.normalize_phone(p_attendee_phone);
  v_recent_attempts integer;
  v_confirmed_count integer;
  v_waitlist_pending boolean;
  v_event_full boolean;
  v_existing record;
  v_new_id uuid;
  v_status public.registration_status;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_ip::text));

  SELECT count(*) INTO v_recent_attempts
  FROM public.registration_attempts
  WHERE ip_address = p_ip
    AND created_at > clock_timestamp() - interval '10 minutes';

  INSERT INTO public.registration_attempts (ip_address) VALUES (p_ip);
  IF v_recent_attempts >= 5 THEN
    RETURN jsonb_build_object('code', 'RATE_LIMITED');
  END IF;

  IF p_intent NOT IN ('register', 'join_waitlist')
     OR p_attendee_name IS NULL
     OR char_length(btrim(p_attendee_name)) NOT BETWEEN 1 AND 200
     OR p_attendee_name ~ '[[:cntrl:]]'
     OR p_attendee_email IS NULL
     OR char_length(v_norm_email) > 254
     OR v_norm_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     OR v_norm_email ~ '[[:cntrl:]]' THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR');
  END IF;

  -- A distinct code, not VALIDATION_ERROR: the form can then point at the
  -- phone field specifically instead of saying "check the form".
  IF v_norm_phone IS NULL THEN
    RETURN jsonb_build_object('code', 'INVALID_PHONE');
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

  INSERT INTO public.registrations
    (id, event_id, attendee_name, attendee_email, attendee_phone, status)
  VALUES
    (gen_random_uuid(), p_event_id, btrim(p_attendee_name), v_norm_email, v_norm_phone, v_status)
  RETURNING id INTO v_new_id;

  -- The audit row records the action and its target, never attendee PII:
  -- the phone lives on the registration, and is not duplicated here.
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

ALTER FUNCTION private.register_for_event(uuid, text, text, text, text, inet)
  OWNER TO uc02_routine_owner;
REVOKE ALL ON FUNCTION private.register_for_event(uuid, text, text, text, text, inet) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.register_for_event(uuid, text, text, text, text, inet) TO app_runtime;

-- ---------------------------------------------------------------------------
-- 4. The admin registration reads gain the phone.
--
-- Both return TABLE(...), and CREATE OR REPLACE cannot change a function's
-- output columns, so both are dropped and recreated. Their authorization guard
-- is copied across unchanged: the same can_access_committee predicate, the same
-- pagination and cursor semantics, the same export ceiling and audit row.
-- Nothing about who may read registrations changes; only the returned shape
-- gains a column that was already on the row.
-- ---------------------------------------------------------------------------

DROP FUNCTION private.list_admin_registrations(uuid, uuid, text, timestamptz, uuid, integer);

CREATE FUNCTION private.list_admin_registrations(
  p_actor uuid,
  p_event_id uuid,
  p_status text DEFAULT 'confirmed',
  p_cursor_registered_at timestamptz DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 51
) RETURNS TABLE (
  id uuid,
  attendee_name text,
  attendee_email text,
  attendee_phone text,
  status public.registration_status,
  registered_at timestamptz
)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT r.id, r.attendee_name, r.attendee_email, r.attendee_phone, r.status, r.registered_at
  FROM public.registrations r
  JOIN public.events e ON e.id = r.event_id
  WHERE r.event_id = p_event_id
    AND p_status IN ('confirmed', 'waitlisted')
    AND r.status::text = p_status
    AND private.can_access_committee(p_actor, e.committee_id)
    AND (p_cursor_registered_at IS NULL OR p_cursor_id IS NULL OR (r.registered_at, r.id) > (p_cursor_registered_at, p_cursor_id))
  ORDER BY r.registered_at ASC, r.id ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 51), 1), 51);
$$;

ALTER FUNCTION private.list_admin_registrations(uuid, uuid, text, timestamptz, uuid, integer)
  OWNER TO uc02_routine_owner;
REVOKE ALL ON FUNCTION private.list_admin_registrations(uuid, uuid, text, timestamptz, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.list_admin_registrations(uuid, uuid, text, timestamptz, uuid, integer) TO app_runtime;

DROP FUNCTION private.export_admin_registrations(uuid, uuid, text);

CREATE FUNCTION private.export_admin_registrations(
  p_actor uuid,
  p_event_id uuid,
  p_status text
) RETURNS TABLE (
  id uuid,
  attendee_name text,
  attendee_email text,
  attendee_phone text,
  status public.registration_status,
  registered_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_committee_id uuid;
  v_count integer;
  v_bytes bigint;
BEGIN
  IF p_status NOT IN ('confirmed', 'waitlisted') THEN
    RETURN;
  END IF;
  SELECT e.committee_id INTO v_committee_id
  FROM public.events e
  WHERE e.id = p_event_id
    AND private.can_access_committee(p_actor, e.committee_id);
  IF v_committee_id IS NULL THEN RETURN; END IF;

  -- The byte estimate now includes the phone so the size ceiling still
  -- measures the whole row that would be exported.
  SELECT count(*)::integer,
         coalesce(sum(length(r.attendee_name) + length(r.attendee_email)
                      + coalesce(length(r.attendee_phone), 0) + 80), 0)::bigint
    INTO v_count, v_bytes
  FROM public.registrations r
  WHERE r.event_id = p_event_id AND r.status = p_status::public.registration_status;
  IF v_count > 10000 OR v_bytes > 10485760 THEN RETURN; END IF;

  INSERT INTO private.uc02_audit
    (committee_id, event_id, actor_kind, actor_user_id, action, changes)
  VALUES
    (v_committee_id, p_event_id, 'authenticated', p_actor, 'registrations.exported',
     jsonb_build_object('status', p_status, 'rowCount', v_count, 'byteEstimate', v_bytes));

  RETURN QUERY
    SELECT r.id, r.attendee_name, r.attendee_email, r.attendee_phone, r.status, r.registered_at
    FROM public.registrations r
    WHERE r.event_id = p_event_id AND r.status = p_status::public.registration_status
    ORDER BY r.registered_at ASC, r.id ASC;
END;
$$;

ALTER FUNCTION private.export_admin_registrations(uuid, uuid, text)
  OWNER TO uc02_routine_owner;
REVOKE ALL ON FUNCTION private.export_admin_registrations(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.export_admin_registrations(uuid, uuid, text) TO app_runtime;

-- ---------------------------------------------------------------------------
-- 5. The migration proves its own contract.
--
-- Replacing a function's argument list is the one change in this file that can
-- silently leave a second live write path behind. Rather than trusting the DROP
-- above, assert the outcome: exactly one register_for_event, with the intended
-- signature, and no six-argument variant reachable by anyone but its owner.
-- If this fails, the migration aborts and nothing is left half-applied.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_total integer;
  v_signature text;
BEGIN
  SELECT count(*) INTO v_total
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'private' AND p.proname = 'register_for_event';

  IF v_total <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one private.register_for_event after migration 0024, found %', v_total;
  END IF;

  -- Compare argument TYPES, not pg_get_function_identity_arguments: the identity
  -- form includes the parameter names ("p_event_id uuid, ..."), which would make
  -- this assertion depend on how the parameters happen to be spelled.
  SELECT string_agg(format_type(a.t, NULL), ', ' ORDER BY a.ord)
    INTO v_signature
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN LATERAL unnest(string_to_array(p.proargtypes::text, ' ')::oid[])
    WITH ORDINALITY AS a(t, ord)
  WHERE n.nspname = 'private' AND p.proname = 'register_for_event';

  IF v_signature IS DISTINCT FROM 'uuid, text, text, text, text, inet' THEN
    RAISE EXCEPTION 'private.register_for_event has unexpected signature: %', v_signature;
  END IF;

  -- The two assertions above already prove the superseded five-argument form is
  -- gone: there is exactly one function with this name, and its argument types
  -- are the new six. A second, older overload could not satisfy both.
END;
$$;
