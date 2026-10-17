-- 0024: API client registry for the public Core API (ADR 0016).
--
-- Additive only. One private table, one verification routine, one grant. No
-- existing table, policy, grant or routine is touched, and no row anywhere is
-- modified.
--
-- WHAT THIS IS FOR
-- ----------------
-- The landing site reads events server-to-server. It must not hold database
-- credentials, a Supabase service-role key, or admin session credentials. It
-- holds a scoped bearer token instead, and Core verifies a SHA-256 hash of it.
--
-- Raw tokens are never stored: only a prefix (for operator identification) and a
-- hash. A generated token carries 256 bits of entropy, so a plain cryptographic
-- hash is sufficient here — there is no low-entropy secret to attack, which is
-- why no password-stretching function is used. The comparison is not
-- constant-time and does not need to be: an attacker cannot profit by timing a
-- 256-bit random value they would have to guess first.

CREATE TABLE private.api_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  -- Non-secret prefix, unique so an operator can identify a client from a
  -- token without ever seeing the secret half.
  key_prefix text NOT NULL UNIQUE,
  -- SHA-256 of the full token, hex encoded. Never reversible.
  key_hash text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('staging', 'production')),
  -- Narrow scopes, e.g. events:read. A client with no scope can do nothing.
  scopes text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  note text,
  CONSTRAINT api_clients_prefix_shape CHECK (key_prefix ~ '^[a-z0-9_]{8,40}$'),
  CONSTRAINT api_clients_hash_shape CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT api_clients_revoked_is_inactive CHECK (revoked_at IS NULL OR active = false)
);

COMMENT ON TABLE private.api_clients IS
  'Registry of API clients for the public Core API. Raw tokens are never stored; only a non-secret prefix and a SHA-256 hash. app_runtime has no direct privileges: it may only call private.verify_api_client.';

-- This table lives in the private schema, is owned by the routine owner, and
-- must never be reachable from anon/authenticated/service_role or from
-- app_runtime directly.
ALTER TABLE private.api_clients OWNER TO uc02_routine_owner;
ALTER TABLE private.api_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.api_clients FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.api_clients FROM PUBLIC;
REVOKE ALL ON TABLE private.api_clients FROM anon;
REVOKE ALL ON TABLE private.api_clients FROM authenticated;
REVOKE ALL ON TABLE private.api_clients FROM service_role;

-- FORCE ROW LEVEL SECURITY applies RLS even to the table owner, and with no
-- policy at all that means default-deny for everyone — including the SECURITY
-- DEFINER routine, which runs as uc02_routine_owner. Without this policy the
-- registry is unreadable and every verification returns zero rows, so the whole
-- authentication path silently fails closed forever.
--
-- This is exactly the failure the production-equivalent rehearsal caught: the
-- migration applied cleanly, all the grant assertions passed, and the routine
-- returned nothing for a valid client.
--
-- The policy grants SELECT and nothing else: verification is a read. No role
-- other than the routine owner can reach this table, because the table GRANTs
-- above are revoked from everyone else.
CREATE POLICY api_clients_owner_read ON private.api_clients
  FOR SELECT
  TO uc02_routine_owner
  USING (true);

-- Verification is a single narrow read. Everything that can invalidate a client
-- is checked here rather than in application code, so a caller cannot skip it.
CREATE OR REPLACE FUNCTION private.verify_api_client(
  p_prefix text,
  p_hash text,
  p_scope text,
  p_environment text
) RETURNS TABLE (
  client_id uuid,
  client_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT c.id, c.name
  FROM private.api_clients c
  WHERE c.key_prefix = p_prefix
    AND c.key_hash = p_hash
    AND c.active
    AND c.revoked_at IS NULL
    AND (c.expires_at IS NULL OR c.expires_at > clock_timestamp())
    AND c.environment = p_environment
    AND p_scope = ANY (c.scopes)
  LIMIT 1;
$$;

ALTER FUNCTION private.verify_api_client(text, text, text, text)
  OWNER TO uc02_routine_owner;
REVOKE ALL ON FUNCTION private.verify_api_client(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.verify_api_client(text, text, text, text) TO app_runtime;

-- The migration proves its own invariants. If any of these fail the whole
-- transaction rolls back, so a half-applied registry is impossible.
DO $$
DECLARE
  v_table_privs integer;
  v_runtime_exec boolean;
  v_public_exec boolean;
BEGIN
  SELECT count(*) INTO v_table_privs
  FROM information_schema.role_table_grants
  WHERE grantee = 'app_runtime' AND table_schema = 'private' AND table_name = 'api_clients';

  IF v_table_privs <> 0 THEN
    RAISE EXCEPTION 'app_runtime must hold no direct privileges on private.api_clients, found %', v_table_privs;
  END IF;

  SELECT has_function_privilege('app_runtime', 'private.verify_api_client(text,text,text,text)', 'EXECUTE')
    INTO v_runtime_exec;
  IF NOT v_runtime_exec THEN
    RAISE EXCEPTION 'app_runtime must be able to execute private.verify_api_client';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL aclexplode(p.proacl) a
    WHERE n.nspname = 'private'
      AND p.proname = 'verify_api_client'
      AND a.grantee = 0
  ) INTO v_public_exec;
  IF v_public_exec THEN
    RAISE EXCEPTION 'PUBLIC must not be able to execute private.verify_api_client';
  END IF;
END;
$$;
