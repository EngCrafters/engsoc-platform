-- M6 manager-scoped event detail. The list (0009) and the detail read now share
-- one source and one authorization predicate: the restricted runtime role calls a
-- fixed private routine that rechecks the caller's active committee grant. This
-- guarantees an event the list shows a manager can also be opened by that manager,
-- and an out-of-scope or nonexistent event returns no row (the page renders 404).
-- Read-only; no schema change.
CREATE OR REPLACE FUNCTION private.get_admin_event(
  p_actor uuid,
  p_event_id uuid
) RETURNS TABLE (
  id uuid,
  title text,
  description text,
  event_date timestamptz,
  location text,
  committee_id uuid,
  committee_name text,
  status public.event_status,
  capacity integer,
  revision integer,
  archived_at timestamptz,
  review_required boolean,
  flagged_by uuid,
  approved_by uuid,
  confirmed_count integer,
  waitlisted_count integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    e.id,
    e.title,
    e.description,
    e.event_date,
    e.location,
    e.committee_id,
    c.name,
    e.status,
    e.capacity,
    e.revision,
    e.archived_at,
    e.review_required,
    e.flagged_by,
    e.approved_by,
    (SELECT count(*)::integer FROM public.registrations r WHERE r.event_id = e.id AND r.status = 'confirmed'),
    (SELECT count(*)::integer FROM public.registrations r WHERE r.event_id = e.id AND r.status = 'waitlisted')
  FROM public.events e
  JOIN public.committees c ON c.id = e.committee_id
  WHERE e.id = p_event_id
    AND EXISTS (
      SELECT 1
      FROM public.committee_managers cm
      WHERE cm.user_id = p_actor
        AND cm.committee_id = e.committee_id
        AND cm.revoked_at IS NULL
    );
$$;

ALTER FUNCTION private.get_admin_event(uuid, uuid)
  OWNER TO uc02_routine_owner;
REVOKE ALL ON FUNCTION private.get_admin_event(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.get_admin_event(uuid, uuid) TO app_runtime;
