-- Count the full manager scope, independently of a list page or cursor.
-- The same active committee grant predicate as list_admin_events applies.
CREATE OR REPLACE FUNCTION private.count_admin_events(
  p_actor uuid,
  p_committee_id uuid DEFAULT NULL
) RETURNS TABLE (
  total_count integer,
  draft_count integer,
  review_count integer,
  approved_count integer,
  published_count integer,
  full_count integer,
  past_count integer,
  archived_count integer
)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH scoped AS (
    SELECT e.status, e.event_date, e.archived_at, e.review_required, e.approved_by
    FROM public.events e
    WHERE (p_committee_id IS NULL OR e.committee_id = p_committee_id)
      AND EXISTS (
        SELECT 1 FROM public.committee_managers cm
        WHERE cm.user_id = p_actor
          AND cm.committee_id = e.committee_id
          AND cm.revoked_at IS NULL
      )
  ), classified AS (
    SELECT
      archived_at IS NOT NULL AS archived,
      archived_at IS NULL AND event_date <= statement_timestamp() AS past,
      archived_at IS NULL AND event_date > statement_timestamp() AS future,
      status, review_required, approved_by
    FROM scoped
  )
  SELECT
    count(*)::integer,
    count(*) FILTER (WHERE future AND status = 'draft' AND NOT review_required)::integer,
    count(*) FILTER (WHERE future AND status = 'draft' AND review_required AND approved_by IS NULL)::integer,
    count(*) FILTER (WHERE future AND status = 'draft' AND review_required AND approved_by IS NOT NULL)::integer,
    count(*) FILTER (WHERE future AND status = 'published')::integer,
    count(*) FILTER (WHERE future AND status = 'full')::integer,
    count(*) FILTER (WHERE past)::integer,
    count(*) FILTER (WHERE archived)::integer
  FROM classified;
$$;

ALTER FUNCTION private.count_admin_events(uuid, uuid) OWNER TO uc02_routine_owner;
REVOKE ALL ON FUNCTION private.count_admin_events(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.count_admin_events(uuid, uuid) TO app_runtime;
