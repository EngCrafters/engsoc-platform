-- Unauthorized registration count requests must return no row, so an export
-- route cannot turn a foreign event into an observable empty CSV.
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
ALTER FUNCTION private.count_admin_registrations(uuid, uuid) OWNER TO uc02_routine_owner;
REVOKE ALL ON FUNCTION private.count_admin_registrations(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.count_admin_registrations(uuid, uuid) TO app_runtime;
