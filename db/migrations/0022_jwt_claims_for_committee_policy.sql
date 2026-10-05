-- The committee RLS policy resolves the caller through
-- private.can_access_own_committee(). It read only the legacy GUC
-- `request.jwt.claim.sub`, which Supabase's PostgREST no longer sets: it
-- provides the claims as JSON in `request.jwt.claims`. Result: an authenticated
-- Technical, Board or Manager user could read their own grant but saw ZERO
-- committees, so the app treated them as having no administrative access.
--
-- Read the subject from the JSON claims first and fall back to the legacy GUC
-- (used by the local test harness). No new privilege is granted: the function
-- is unchanged in ownership, volatility and grants, and still returns false
-- when no subject is present.
CREATE OR REPLACE FUNCTION private.can_access_own_committee(p_committee uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT private.can_access_committee(
    COALESCE(
      NULLIF(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', ''),
      NULLIF(current_setting('request.jwt.claim.sub', true), '')
    )::uuid,
    p_committee);
$$;
ALTER FUNCTION private.can_access_own_committee(uuid) OWNER TO uc02_routine_owner;
REVOKE ALL ON FUNCTION private.can_access_own_committee(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.can_access_own_committee(uuid) TO authenticated;
