-- Treat malformed status input as an empty result instead of relying on an
-- enum cast error from an application caller.
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
    AND r.status::text = p_status
    AND EXISTS (
      SELECT 1 FROM public.committee_managers cm
      WHERE cm.user_id = p_actor AND cm.committee_id = e.committee_id AND cm.revoked_at IS NULL
    )
    AND (p_cursor_registered_at IS NULL OR p_cursor_id IS NULL OR (r.registered_at, r.id) > (p_cursor_registered_at, p_cursor_id))
  ORDER BY r.registered_at ASC, r.id ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 51), 1), 51);
$$;
ALTER FUNCTION private.list_admin_registrations(uuid, uuid, text, timestamptz, uuid, integer) OWNER TO uc02_routine_owner;
REVOKE ALL ON FUNCTION private.list_admin_registrations(uuid, uuid, text, timestamptz, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.list_admin_registrations(uuid, uuid, text, timestamptz, uuid, integer) TO app_runtime;
