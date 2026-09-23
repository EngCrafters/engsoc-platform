-- M7 manager-scoped registration operations. Registration identity stays
-- private and is exposed only through fixed routines that re-check event scope.

CREATE OR REPLACE FUNCTION private.list_admin_registrations(
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
  status public.registration_status,
  registered_at timestamptz
)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT r.id, r.attendee_name, r.attendee_email, r.status, r.registered_at
  FROM public.registrations r
  JOIN public.events e ON e.id = r.event_id
  WHERE r.event_id = p_event_id
    AND p_status IN ('confirmed', 'waitlisted')
    AND r.status = p_status::public.registration_status
    AND EXISTS (
      SELECT 1 FROM public.committee_managers cm
      WHERE cm.user_id = p_actor
        AND cm.committee_id = e.committee_id
        AND cm.revoked_at IS NULL
    )
    AND (
      p_cursor_registered_at IS NULL OR p_cursor_id IS NULL
      OR (r.registered_at, r.id) > (p_cursor_registered_at, p_cursor_id)
    )
  ORDER BY r.registered_at ASC, r.id ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 51), 1), 51);
$$;

CREATE OR REPLACE FUNCTION private.count_admin_registrations(
  p_actor uuid,
  p_event_id uuid
) RETURNS TABLE (confirmed_count integer, waitlisted_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.events e
    JOIN public.committee_managers cm ON cm.committee_id = e.committee_id
    WHERE e.id = p_event_id AND cm.user_id = p_actor AND cm.revoked_at IS NULL
  ) THEN RETURN; END IF;
  RETURN QUERY SELECT
    count(*) FILTER (WHERE r.status = 'confirmed')::integer,
    count(*) FILTER (WHERE r.status = 'waitlisted')::integer
  FROM public.registrations r WHERE r.event_id = p_event_id;
END;
$$;

CREATE OR REPLACE FUNCTION private.export_admin_registrations(
  p_actor uuid,
  p_event_id uuid,
  p_status text
) RETURNS TABLE (
  id uuid,
  attendee_name text,
  attendee_email text,
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
    AND EXISTS (
      SELECT 1 FROM public.committee_managers cm
      WHERE cm.user_id = p_actor
        AND cm.committee_id = e.committee_id
        AND cm.revoked_at IS NULL
    );
  IF v_committee_id IS NULL THEN RETURN; END IF;

  SELECT count(*)::integer,
         coalesce(sum(length(r.attendee_name) + length(r.attendee_email) + 80), 0)::bigint
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
    SELECT r.id, r.attendee_name, r.attendee_email, r.status, r.registered_at
    FROM public.registrations r
    WHERE r.event_id = p_event_id AND r.status = p_status::public.registration_status
    ORDER BY r.registered_at ASC, r.id ASC;
END;
$$;

ALTER FUNCTION private.list_admin_registrations(uuid, uuid, text, timestamptz, uuid, integer) OWNER TO uc02_routine_owner;
ALTER FUNCTION private.count_admin_registrations(uuid, uuid) OWNER TO uc02_routine_owner;
ALTER FUNCTION private.export_admin_registrations(uuid, uuid, text) OWNER TO uc02_routine_owner;

REVOKE ALL ON FUNCTION private.list_admin_registrations(uuid, uuid, text, timestamptz, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.count_admin_registrations(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.export_admin_registrations(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.list_admin_registrations(uuid, uuid, text, timestamptz, uuid, integer) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.count_admin_registrations(uuid, uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.export_admin_registrations(uuid, uuid, text) TO app_runtime;
