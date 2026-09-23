-- M6 manager-scoped event list. The restricted runtime role has no direct
-- table grants, so this fixed read capability returns a minimal DTO with
-- aggregate registration counts and never attendee identity.
CREATE OR REPLACE FUNCTION private.list_admin_events(
  p_actor uuid,
  p_committee_id uuid DEFAULT NULL,
  p_status text DEFAULT 'all',
  p_cursor_event_date timestamptz DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 21
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
  WITH scoped_events AS (
    SELECT
      e.id,
      e.title,
      e.description,
      e.event_date,
      e.location,
      e.committee_id,
      c.name AS committee_name,
      e.status,
      e.capacity,
      e.revision,
      e.archived_at,
      e.review_required,
      e.flagged_by,
      e.approved_by
    FROM public.events e
    JOIN public.committees c ON c.id = e.committee_id
    WHERE EXISTS (
      SELECT 1
      FROM public.committee_managers cm
      WHERE cm.user_id = p_actor
        AND cm.committee_id = e.committee_id
        AND cm.revoked_at IS NULL
    )
      AND (p_committee_id IS NULL OR e.committee_id = p_committee_id)
      AND (
        (p_status = 'all' AND e.archived_at IS NULL)
        OR (p_status = 'archived' AND e.archived_at IS NOT NULL)
        OR (p_status = 'past' AND e.archived_at IS NULL AND e.event_date <= statement_timestamp())
        OR (p_status = 'draft' AND e.archived_at IS NULL AND e.event_date > statement_timestamp() AND e.status = 'draft')
        OR (p_status = 'published' AND e.archived_at IS NULL AND e.event_date > statement_timestamp() AND e.status = 'published')
        OR (p_status = 'full' AND e.archived_at IS NULL AND e.event_date > statement_timestamp() AND e.status = 'full')
      )
      AND (
        p_cursor_event_date IS NULL
        OR p_cursor_id IS NULL
        OR (e.event_date, e.id) > (p_cursor_event_date, p_cursor_id)
      )
    ORDER BY e.event_date ASC, e.id ASC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 21), 1), 21)
  )
  SELECT
    e.*,
    (SELECT count(*)::integer FROM public.registrations r WHERE r.event_id = e.id AND r.status = 'confirmed'),
    (SELECT count(*)::integer FROM public.registrations r WHERE r.event_id = e.id AND r.status = 'waitlisted')
  FROM scoped_events e
  ORDER BY e.event_date ASC, e.id ASC;
$$;

ALTER FUNCTION private.list_admin_events(uuid, uuid, text, timestamptz, uuid, integer)
  OWNER TO uc02_routine_owner;
REVOKE ALL ON FUNCTION private.list_admin_events(uuid, uuid, text, timestamptz, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.list_admin_events(uuid, uuid, text, timestamptz, uuid, integer) TO app_runtime;
