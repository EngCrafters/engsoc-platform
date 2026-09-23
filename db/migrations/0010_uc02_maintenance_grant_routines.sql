-- Maintenance-only committee-manager grant/revoke routines.
--
-- Until now the runbook had app_maintenance INSERT/UPDATE public.committee_managers
-- and hand-write the grant.activated/grant.revoked audit row. That made the audit
-- trail a convention. These fixed routines make it a property of the database:
-- the grant change and its audit row commit or roll back together, and the
-- maintenance role no longer has direct write access to either table.
--
-- Authorization is external: only app_maintenance (and the Supabase project
-- owner, who can assume the routine owner) may execute them. app_runtime, anon,
-- authenticated and service_role cannot. There is no application role and no
-- in-app path to these routines. p_actor is the maintainer's own Auth identity
-- (attribution only; it holds no grant and confers no application privilege).
-- No schema change: committee_managers and private.uc02_audit are unchanged.

-- The routine owner now performs the writes the maintenance role used to.
GRANT INSERT, UPDATE ON public.committee_managers TO uc02_routine_owner;

-- Close the manual bypass: grant state and its audit row are now written only by
-- the routines below. app_maintenance keeps SELECT on both for verification.
REVOKE INSERT, UPDATE ON public.committee_managers FROM app_maintenance;
REVOKE INSERT ON private.uc02_audit FROM app_maintenance;

CREATE OR REPLACE FUNCTION private.grant_committee_manager(
  p_actor uuid,
  p_user_id uuid,
  p_committee_id uuid,
  p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing public.committee_managers%ROWTYPE;
  v_exists boolean;
  v_bootstrap boolean;
  v_change text;
  v_previous jsonb;
  v_constraint text;
  v_note text := NULLIF(btrim(p_note), '');
BEGIN
  IF p_actor IS NULL OR p_user_id IS NULL OR p_committee_id IS NULL
     OR (v_note IS NOT NULL AND char_length(v_note) > 200) THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.committees WHERE id = p_committee_id) THEN
    RETURN jsonb_build_object('code', 'COMMITTEE_NOT_FOUND');
  END IF;

  -- Serialize concurrent changes to the same (user, committee) grant.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('committee_manager:' || p_user_id || ':' || p_committee_id, 0)
  );

  SELECT * INTO v_existing
  FROM public.committee_managers
  WHERE user_id = p_user_id AND committee_id = p_committee_id
  FOR UPDATE;
  v_exists := FOUND;

  IF v_exists AND v_existing.revoked_at IS NULL THEN
    -- Idempotent: nothing changed, so nothing is audited.
    RETURN jsonb_build_object('code', 'ALREADY_ACTIVE');
  END IF;

  -- Bootstrap = this committee had no active manager at all. It is derived from
  -- the data, not asserted by the caller, and is recorded in the audit row.
  v_bootstrap := NOT EXISTS (
    SELECT 1 FROM public.committee_managers
    WHERE committee_id = p_committee_id AND revoked_at IS NULL
  );

  BEGIN
    IF v_exists THEN
      v_change := 'reactivated';
      v_previous := jsonb_build_object(
        'grantedAt', v_existing.granted_at,
        'grantedBy', v_existing.granted_by,
        'revokedAt', v_existing.revoked_at,
        'revokedBy', v_existing.revoked_by
      );
      UPDATE public.committee_managers
      SET granted_at = now(), granted_by = p_actor,
          revoked_at = NULL, revoked_by = NULL
      WHERE user_id = p_user_id AND committee_id = p_committee_id;
    ELSE
      v_change := 'granted';
      INSERT INTO public.committee_managers (user_id, committee_id, granted_by)
      VALUES (p_user_id, p_committee_id, p_actor);
    END IF;

    INSERT INTO private.uc02_audit
      (committee_id, actor_kind, actor_user_id, action, changes)
    VALUES (
      p_committee_id, 'maintenance', p_actor, 'grant.activated',
      jsonb_strip_nulls(jsonb_build_object(
        'userId', p_user_id,
        'change', v_change,
        'bootstrap', v_bootstrap,
        'note', v_note,
        'previous', v_previous
      ))
    );
  EXCEPTION WHEN foreign_key_violation THEN
    -- The subtransaction rolls back the grant and the audit row together.
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    IF v_constraint = 'committee_managers_user_id_users_id_fk' THEN
      RETURN jsonb_build_object('code', 'USER_NOT_FOUND');
    END IF;
    RETURN jsonb_build_object('code', 'ACTOR_NOT_FOUND');
  END;

  RETURN jsonb_build_object(
    'code', 'SUCCESS', 'change', v_change, 'bootstrap', v_bootstrap
  );
END;
$$;

CREATE OR REPLACE FUNCTION private.revoke_committee_manager(
  p_actor uuid,
  p_user_id uuid,
  p_committee_id uuid,
  p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing public.committee_managers%ROWTYPE;
  v_note text := NULLIF(btrim(p_note), '');
BEGIN
  IF p_actor IS NULL OR p_user_id IS NULL OR p_committee_id IS NULL
     OR (v_note IS NOT NULL AND char_length(v_note) > 200) THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR');
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('committee_manager:' || p_user_id || ':' || p_committee_id, 0)
  );

  SELECT * INTO v_existing
  FROM public.committee_managers
  WHERE user_id = p_user_id AND committee_id = p_committee_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('code', 'NOT_FOUND');
  END IF;
  IF v_existing.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('code', 'ALREADY_REVOKED');
  END IF;

  BEGIN
    UPDATE public.committee_managers
    SET revoked_at = now(), revoked_by = p_actor
    WHERE user_id = p_user_id AND committee_id = p_committee_id;

    INSERT INTO private.uc02_audit
      (committee_id, actor_kind, actor_user_id, action, changes)
    VALUES (
      p_committee_id, 'maintenance', p_actor, 'grant.revoked',
      jsonb_strip_nulls(jsonb_build_object(
        'userId', p_user_id,
        'note', v_note,
        'previous', jsonb_build_object(
          'grantedAt', v_existing.granted_at,
          'grantedBy', v_existing.granted_by
        )
      ))
    );
  EXCEPTION WHEN foreign_key_violation THEN
    RETURN jsonb_build_object('code', 'ACTOR_NOT_FOUND');
  END;

  RETURN jsonb_build_object('code', 'SUCCESS', 'change', 'revoked');
END;
$$;

ALTER FUNCTION private.grant_committee_manager(uuid, uuid, uuid, text)
  OWNER TO uc02_routine_owner;
ALTER FUNCTION private.revoke_committee_manager(uuid, uuid, uuid, text)
  OWNER TO uc02_routine_owner;

-- Maintenance-only. Explicitly deny every role that could otherwise reach them.
REVOKE ALL ON FUNCTION private.grant_committee_manager(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role, app_runtime;
REVOKE ALL ON FUNCTION private.revoke_committee_manager(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role, app_runtime;
GRANT EXECUTE ON FUNCTION private.grant_committee_manager(uuid, uuid, uuid, text)
  TO app_maintenance;
GRANT EXECUTE ON FUNCTION private.revoke_committee_manager(uuid, uuid, uuid, text)
  TO app_maintenance;
