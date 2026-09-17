-- M6 admin event creation and editing. These are fixed capabilities for the
-- restricted runtime login; browser clients retain no event write privileges.

-- Row-level SHARE locks on grants require UPDATE privilege in PostgreSQL. This
-- remains reachable only through SECURITY DEFINER routines because the role is
-- NOLOGIN and app_runtime receives no table grants.
GRANT INSERT ON public.events TO uc02_routine_owner;
GRANT UPDATE ON public.committee_managers TO uc02_routine_owner;

CREATE OR REPLACE FUNCTION private.create_event(
  p_actor uuid,
  p_committee_id uuid,
  p_title text,
  p_description text,
  p_event_date timestamptz,
  p_location text,
  p_capacity integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event_id uuid;
BEGIN
  -- Lock the live grant before changing the committee's data. A concurrent
  -- revocation waits for this short transaction and blocks later operations.
  PERFORM 1 FROM public.committee_managers
  WHERE user_id = p_actor AND committee_id = p_committee_id AND revoked_at IS NULL
  FOR SHARE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('code', 'NOT_FOUND');
  END IF;

  IF p_title IS NULL OR char_length(btrim(p_title)) NOT BETWEEN 1 AND 200
     OR p_description IS NOT NULL AND char_length(p_description) > 10000
     OR p_location IS NOT NULL AND char_length(p_location) > 500
     OR p_event_date IS NULL OR p_event_date <= clock_timestamp()
     OR p_capacity IS NOT NULL AND p_capacity < 1 THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR');
  END IF;

  INSERT INTO public.events (
    id, title, description, event_date, location, committee_id, capacity, status
  ) VALUES (
    gen_random_uuid(), btrim(p_title), NULLIF(btrim(p_description), ''), p_event_date,
    NULLIF(btrim(p_location), ''), p_committee_id, p_capacity, 'draft'
  ) RETURNING id INTO v_event_id;

  INSERT INTO private.uc02_audit (
    committee_id, event_id, actor_kind, actor_user_id, action, changes
  ) VALUES (
    p_committee_id, v_event_id, 'authenticated', p_actor, 'event.created',
    jsonb_build_object(
      'after', jsonb_build_object(
        'title', btrim(p_title), 'description', NULLIF(btrim(p_description), ''),
        'eventDate', p_event_date, 'location', NULLIF(btrim(p_location), ''),
        'capacity', p_capacity, 'status', 'draft', 'revision', 1
      )
    )
  );

  RETURN jsonb_build_object('code', 'SUCCESS', 'eventId', v_event_id, 'revision', 1);
END;
$$;

CREATE OR REPLACE FUNCTION private.edit_event(
  p_actor uuid,
  p_event_id uuid,
  p_expected_revision integer,
  p_title text,
  p_description text,
  p_event_date timestamptz,
  p_location text,
  p_capacity integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event public.events%ROWTYPE;
  v_confirmed_count integer;
  v_has_history boolean;
  v_changed boolean;
BEGIN
  SELECT committee_id INTO v_event.committee_id
  FROM public.events WHERE id = p_event_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('code', 'NOT_FOUND');
  END IF;

  PERFORM 1 FROM public.committee_managers
  WHERE user_id = p_actor AND committee_id = v_event.committee_id AND revoked_at IS NULL
  FOR SHARE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('code', 'NOT_FOUND');
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF p_expected_revision IS NULL OR v_event.revision <> p_expected_revision THEN
    RETURN jsonb_build_object('code', 'CONFLICT', 'currentRevision', v_event.revision);
  END IF;
  IF v_event.archived_at IS NOT NULL THEN
    RETURN jsonb_build_object('code', 'INVALID_TRANSITION');
  END IF;
  IF p_title IS NULL OR char_length(btrim(p_title)) NOT BETWEEN 1 AND 200
     OR p_description IS NOT NULL AND char_length(p_description) > 10000
     OR p_location IS NOT NULL AND char_length(p_location) > 500
     OR p_event_date IS NULL OR p_capacity IS NOT NULL AND p_capacity < 1
     OR v_event.status <> 'draft' AND (p_description IS NULL OR char_length(btrim(p_description)) = 0) THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR');
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.registrations WHERE event_id = p_event_id)
  INTO v_has_history;
  IF v_has_history AND p_event_date IS DISTINCT FROM v_event.event_date THEN
    RETURN jsonb_build_object('code', 'INVALID_TRANSITION');
  END IF;

  IF v_event.event_date <= clock_timestamp() THEN
    IF p_event_date IS DISTINCT FROM v_event.event_date
       OR p_capacity IS DISTINCT FROM v_event.capacity THEN
      RETURN jsonb_build_object('code', 'INVALID_TRANSITION');
    END IF;
  ELSIF p_event_date <= clock_timestamp() THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR');
  END IF;

  SELECT count(*) INTO v_confirmed_count
  FROM public.registrations WHERE event_id = p_event_id AND status = 'confirmed';
  IF p_capacity IS NOT NULL AND p_capacity < v_confirmed_count THEN
    RETURN jsonb_build_object('code', 'CAPACITY_BELOW_COUNT');
  END IF;

  v_changed := btrim(p_title) IS DISTINCT FROM v_event.title
    OR NULLIF(btrim(p_description), '') IS DISTINCT FROM v_event.description
    OR p_event_date IS DISTINCT FROM v_event.event_date
    OR NULLIF(p_location, '') IS DISTINCT FROM v_event.location
    OR p_capacity IS DISTINCT FROM v_event.capacity;
  IF NOT v_changed THEN
    RETURN jsonb_build_object('code', 'SUCCESS', 'revision', v_event.revision);
  END IF;

  UPDATE public.events SET
    title = btrim(p_title), description = NULLIF(btrim(p_description), ''),
    event_date = p_event_date, location = NULLIF(btrim(p_location), ''), capacity = p_capacity,
    approved_by = CASE WHEN review_required THEN NULL ELSE approved_by END,
    approved_at = CASE WHEN review_required THEN NULL ELSE approved_at END,
    approved_revision = CASE WHEN review_required THEN NULL ELSE approved_revision END,
    revision = revision + 1
  WHERE id = p_event_id;

  INSERT INTO private.uc02_audit (
    committee_id, event_id, actor_kind, actor_user_id, action, changes
  ) VALUES (
    v_event.committee_id, p_event_id, 'authenticated', p_actor, 'event.updated',
    jsonb_build_object(
      'before', jsonb_build_object(
        'title', v_event.title, 'description', v_event.description,
        'eventDate', v_event.event_date, 'location', v_event.location,
        'capacity', v_event.capacity, 'revision', v_event.revision
      ),
      'after', jsonb_build_object(
        'title', btrim(p_title), 'description', NULLIF(btrim(p_description), ''),
        'eventDate', p_event_date, 'location', NULLIF(btrim(p_location), ''),
        'capacity', p_capacity, 'revision', v_event.revision + 1
      )
    )
  );

  RETURN jsonb_build_object('code', 'SUCCESS', 'revision', v_event.revision + 1);
END;
$$;

ALTER FUNCTION private.create_event(uuid, uuid, text, text, timestamptz, text, integer)
  OWNER TO uc02_routine_owner;
ALTER FUNCTION private.edit_event(uuid, uuid, integer, text, text, timestamptz, text, integer)
  OWNER TO uc02_routine_owner;
REVOKE ALL ON FUNCTION private.create_event(uuid, uuid, text, text, timestamptz, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.edit_event(uuid, uuid, integer, text, text, timestamptz, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.create_event(uuid, uuid, text, text, timestamptz, text, integer) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.edit_event(uuid, uuid, integer, text, text, timestamptz, text, integer) TO app_runtime;
