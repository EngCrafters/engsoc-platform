-- Harden the public registration routine after M2 rehearsal.
-- The routine owns the limiter transaction so callers cannot bypass it by
-- racing a count and insert in application code.

CREATE OR REPLACE FUNCTION private.register_for_event(
  p_event_id uuid,
  p_attendee_name text,
  p_attendee_email text,
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
  v_recent_attempts integer;
  v_confirmed_count integer;
  v_waitlist_pending boolean;
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

ALTER FUNCTION private.register_for_event(uuid, text, text, text, inet)
  OWNER TO uc02_routine_owner;
REVOKE EXECUTE ON FUNCTION private.register_for_event(uuid, text, text, text, inet) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.register_for_event(uuid, text, text, text, inet) TO app_runtime;
