-- Public event DTOs are calculated inside fixed routines so the marketing
-- experience can show admission state without exposing capacity, counts,
-- registrations, committee IDs, or lifecycle/approval metadata.

CREATE OR REPLACE FUNCTION private.public_event_availability(p_event_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN e.event_date <= clock_timestamp() THEN 'closed'
    WHEN e.status = 'full'
      OR EXISTS (SELECT 1 FROM public.registrations r WHERE r.event_id = e.id AND r.status = 'waitlisted')
      OR (e.capacity IS NOT NULL AND (SELECT count(*) FROM public.registrations r WHERE r.event_id = e.id AND r.status = 'confirmed') >= e.capacity)
    THEN 'waitlist'
    ELSE 'open'
  END FROM public.events e WHERE e.id = p_event_id;
$$;

CREATE OR REPLACE FUNCTION private.list_public_events(
  p_period text, p_cursor_date timestamptz DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL, p_limit integer DEFAULT 20
) RETURNS TABLE (
  id uuid, title text, description text, event_date timestamptz, location text,
  committee_name text, availability text
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT e.id, e.title, e.description, e.event_date, e.location, c.name,
    private.public_event_availability(e.id)
  FROM public.events e JOIN public.committees c ON c.id = e.committee_id
  WHERE p_period IN ('upcoming', 'past') AND p_limit BETWEEN 1 AND 50
    AND e.archived_at IS NULL AND e.status IN ('published', 'full')
    AND (CASE WHEN p_period = 'upcoming' THEN e.event_date > clock_timestamp() ELSE e.event_date <= clock_timestamp() END)
    AND (p_cursor_date IS NULL OR p_cursor_id IS NULL
      OR (p_period = 'upcoming' AND (e.event_date, e.id) > (p_cursor_date, p_cursor_id))
      OR (p_period = 'past' AND (e.event_date, e.id) < (p_cursor_date, p_cursor_id)))
  ORDER BY CASE WHEN p_period = 'upcoming' THEN e.event_date END ASC,
    CASE WHEN p_period = 'upcoming' THEN e.id END ASC,
    CASE WHEN p_period = 'past' THEN e.event_date END DESC,
    CASE WHEN p_period = 'past' THEN e.id END DESC
  LIMIT p_limit;
$$;

CREATE OR REPLACE FUNCTION private.get_public_event(p_event_id uuid)
RETURNS TABLE (
  id uuid, title text, description text, event_date timestamptz, location text,
  committee_name text, availability text
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT e.id, e.title, e.description, e.event_date, e.location, c.name,
    private.public_event_availability(e.id)
  FROM public.events e JOIN public.committees c ON c.id = e.committee_id
  WHERE e.id = p_event_id AND e.archived_at IS NULL
    AND e.status IN ('published', 'full');
$$;

ALTER FUNCTION private.public_event_availability(uuid) OWNER TO uc02_routine_owner;
ALTER FUNCTION private.list_public_events(text, timestamptz, uuid, integer) OWNER TO uc02_routine_owner;
ALTER FUNCTION private.get_public_event(uuid) OWNER TO uc02_routine_owner;
REVOKE ALL ON FUNCTION private.public_event_availability(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.list_public_events(text, timestamptz, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.get_public_event(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.list_public_events(text, timestamptz, uuid, integer) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.get_public_event(uuid) TO app_runtime;
