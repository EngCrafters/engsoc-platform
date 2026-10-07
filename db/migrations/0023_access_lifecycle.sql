-- ADR 0014: atomic manager replacement and serialized access lifecycle.
-- Historical inactive grants retain their former scope for attribution only.
-- This is routine-only; no business data or prior audit row is rewritten.
CREATE OR REPLACE FUNCTION private.change_administrative_access(
  p_actor uuid, p_user uuid, p_level public.administrative_access_level,
  p_committee uuid, p_operation text, p_note text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_old public.administrative_access%ROWTYPE;
  v_previous jsonb; v_next jsonb; v_action text; v_exists boolean;
  v_note text := NULLIF(btrim(p_note), '');
BEGIN
  IF p_actor IS NULL OR p_user IS NULL OR p_actor = p_user
    OR p_operation IS NULL OR p_operation NOT IN ('grant','reassign','revoke')
    OR (v_note IS NOT NULL AND char_length(v_note) > 200) THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR');
  END IF;
  -- Share the ownership lock with Technical and maintenance changes.
  PERFORM pg_advisory_xact_lock(hashtextextended('technical-ownership', 0));
  PERFORM 1 FROM public.administrative_access
  WHERE user_id = p_actor AND access_level = 'TECHNICAL' AND revoked_at IS NULL
  FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  IF NOT EXISTS (SELECT 1 FROM private.access_auth_users WHERE id = p_user) THEN
    RETURN jsonb_build_object('code', 'USER_NOT_FOUND');
  END IF;
  IF p_operation IN ('grant','reassign') THEN
    IF p_level IS NULL OR p_level = 'TECHNICAL' OR
      (p_level = 'COMMITTEE_MANAGER') <> (p_committee IS NOT NULL) THEN
      RETURN jsonb_build_object('code', 'VALIDATION_ERROR');
    END IF;
    IF p_committee IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.committees WHERE id = p_committee AND slug IS NOT NULL
    ) THEN RETURN jsonb_build_object('code', 'COMMITTEE_NOT_FOUND'); END IF;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('access:' || p_user, 0));
  SELECT * INTO v_old FROM public.administrative_access WHERE user_id = p_user FOR UPDATE;
  v_exists := FOUND;
  v_previous := CASE WHEN v_exists THEN jsonb_build_object(
    'accessLevel', v_old.access_level, 'committeeId', v_old.committee_id,
    'active', v_old.revoked_at IS NULL) ELSE NULL END;
  IF v_exists AND v_old.access_level = 'TECHNICAL' AND v_old.revoked_at IS NULL THEN
    RETURN jsonb_build_object('code', 'FORBIDDEN');
  END IF;
  IF p_operation = 'grant' THEN
    IF v_exists AND v_old.revoked_at IS NULL THEN
      IF v_old.access_level = 'COMMITTEE_MANAGER' AND p_level = 'COMMITTEE_MANAGER'
        AND v_old.committee_id IS DISTINCT FROM p_committee THEN
        RETURN jsonb_build_object('code', 'SECOND_MANAGER_SCOPE');
      END IF;
      IF v_old.access_level = p_level AND v_old.committee_id IS NOT DISTINCT FROM p_committee THEN
        RETURN jsonb_build_object('code', 'ALREADY_ACTIVE');
      END IF;
      RETURN jsonb_build_object('code', 'CONFLICT');
    END IF;
    INSERT INTO public.administrative_access
      (user_id, committee_id, access_level, granted_by)
    VALUES (p_user, p_committee, p_level, p_actor)
    ON CONFLICT (user_id) DO UPDATE SET committee_id = EXCLUDED.committee_id,
      access_level = EXCLUDED.access_level, granted_at = now(),
      granted_by = p_actor, revoked_at = NULL, revoked_by = NULL;
    v_action := CASE WHEN p_level = 'BOARD_ADMIN' THEN 'board_admin.granted' ELSE 'manager.assigned' END;
    v_next := jsonb_build_object('accessLevel', p_level, 'committeeId', p_committee, 'active', true);
  ELSIF p_operation = 'reassign' THEN
    IF NOT v_exists OR v_old.revoked_at IS NOT NULL OR v_old.access_level <> 'COMMITTEE_MANAGER'
      OR p_level <> 'COMMITTEE_MANAGER' OR v_old.committee_id = p_committee THEN
      RETURN jsonb_build_object('code', 'INVALID_TRANSITION');
    END IF;
    UPDATE public.administrative_access SET committee_id = p_committee,
      granted_at = now(), granted_by = p_actor WHERE user_id = p_user;
    v_action := 'manager.reassigned';
    v_next := jsonb_build_object('accessLevel', 'COMMITTEE_MANAGER',
      'committeeId', p_committee, 'active', true);
  ELSE
    IF NOT v_exists OR v_old.revoked_at IS NOT NULL THEN
      RETURN jsonb_build_object('code', 'ACCESS_ALREADY_REVOKED');
    END IF;
    IF p_level IS DISTINCT FROM v_old.access_level
      OR p_committee IS DISTINCT FROM v_old.committee_id THEN
      RETURN jsonb_build_object('code', 'ACCESS_CHANGED');
    END IF;
    UPDATE public.administrative_access SET revoked_at = now(), revoked_by = p_actor
    WHERE user_id = p_user;
    v_action := CASE WHEN v_old.access_level = 'BOARD_ADMIN' THEN 'board_admin.revoked' ELSE 'manager.revoked' END;
    v_next := jsonb_build_object('accessLevel', v_old.access_level,
      'committeeId', v_old.committee_id, 'active', false);
  END IF;
  INSERT INTO private.uc02_audit
    (committee_id, actor_kind, actor_user_id, action, changes)
  VALUES (CASE WHEN p_operation = 'revoke' THEN v_old.committee_id ELSE p_committee END,
    'authenticated', p_actor, v_action, jsonb_build_object(
      'userId', p_user, 'previous', v_previous, 'next', v_next, 'note', v_note));
  RETURN jsonb_build_object('code', 'SUCCESS', 'action', v_action);
END;
$$;
ALTER FUNCTION private.change_administrative_access(uuid, uuid, public.administrative_access_level, uuid, text, text)
  OWNER TO uc02_routine_owner;
REVOKE ALL ON FUNCTION private.change_administrative_access(uuid, uuid, public.administrative_access_level, uuid, text, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.change_administrative_access(uuid, uuid, public.administrative_access_level, uuid, text, text)
  TO app_runtime;


CREATE FUNCTION private.replace_committee_manager(
  p_actor uuid, p_old_user uuid, p_new_user uuid, p_committee uuid,
  p_note text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_old public.administrative_access%ROWTYPE;
  v_new public.administrative_access%ROWTYPE;
  v_new_exists boolean;
  v_replacement uuid := gen_random_uuid();
  v_note text := NULLIF(btrim(p_note), '');
BEGIN
  IF p_actor IS NULL OR p_old_user IS NULL OR p_new_user IS NULL
    OR p_committee IS NULL OR p_old_user = p_new_user
    OR p_actor IN (p_old_user, p_new_user)
    OR (v_note IS NOT NULL AND char_length(v_note) > 200) THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR');
  END IF;
  -- Lock order shared by all access mutations, including owner transfer.
  PERFORM pg_advisory_xact_lock(hashtextextended('technical-ownership', 0));
  PERFORM 1 FROM public.administrative_access
    WHERE user_id = p_actor AND access_level = 'TECHNICAL' AND revoked_at IS NULL
    FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  IF NOT EXISTS (SELECT 1 FROM private.access_auth_users WHERE id = p_new_user) THEN
    RETURN jsonb_build_object('code', 'USER_NOT_FOUND');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.committees WHERE id = p_committee AND slug IS NOT NULL) THEN
    RETURN jsonb_build_object('code', 'COMMITTEE_NOT_FOUND');
  END IF;
  SELECT * INTO v_old FROM public.administrative_access WHERE user_id = p_old_user FOR UPDATE;
  IF NOT FOUND OR v_old.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('code', 'ACCESS_ALREADY_REVOKED');
  END IF;
  IF v_old.access_level <> 'COMMITTEE_MANAGER' OR v_old.committee_id <> p_committee THEN
    RETURN jsonb_build_object('code', 'ACCESS_CHANGED');
  END IF;
  SELECT * INTO v_new FROM public.administrative_access WHERE user_id = p_new_user FOR UPDATE;
  v_new_exists := FOUND;
  IF v_new_exists AND v_new.revoked_at IS NULL THEN
    RETURN jsonb_build_object('code', CASE
      WHEN v_new.access_level <> 'COMMITTEE_MANAGER' THEN 'CONFLICT'
      WHEN v_new.committee_id = p_committee THEN 'ALREADY_ACTIVE'
      ELSE 'SECOND_MANAGER_SCOPE' END);
  END IF;

  UPDATE public.administrative_access SET revoked_at = now(), revoked_by = p_actor
    WHERE user_id = p_old_user;
  INSERT INTO public.administrative_access
    (user_id, committee_id, access_level, granted_by)
  VALUES (p_new_user, p_committee, 'COMMITTEE_MANAGER', p_actor)
  ON CONFLICT (user_id) DO UPDATE SET committee_id = p_committee,
    access_level = 'COMMITTEE_MANAGER', granted_at = now(), granted_by = p_actor,
    revoked_at = NULL, revoked_by = NULL;

  -- Both authoritative target histories are written in this same transaction.
  -- Existing operational activity stays attributed to its original actor.
  INSERT INTO private.uc02_audit
    (committee_id, actor_kind, actor_user_id, action, changes)
  VALUES
    (p_committee, 'authenticated', p_actor, 'manager.revoked', jsonb_build_object(
      'userId', p_old_user, 'replacementId', v_replacement, 'replacedByUserId', p_new_user,
      'previous', jsonb_build_object('accessLevel', v_old.access_level,
        'committeeId', v_old.committee_id, 'active', true),
      'next', jsonb_build_object('accessLevel', v_old.access_level,
        'committeeId', v_old.committee_id, 'active', false),
      'note', v_note)),
    (p_committee, 'authenticated', p_actor, 'manager.assigned', jsonb_build_object(
      'userId', p_new_user, 'replacementId', v_replacement, 'replacesUserId', p_old_user,
      'previous', CASE WHEN v_new_exists THEN jsonb_build_object(
        'accessLevel', v_new.access_level, 'committeeId', v_new.committee_id,
        'active', false) ELSE NULL END,
      'next', jsonb_build_object('accessLevel', 'COMMITTEE_MANAGER',
        'committeeId', p_committee, 'active', true),
      'note', v_note));
  RETURN jsonb_build_object('code', 'SUCCESS');
END;
$$;
ALTER FUNCTION private.replace_committee_manager(uuid, uuid, uuid, uuid, text) OWNER TO uc02_routine_owner;
REVOKE ALL ON FUNCTION private.replace_committee_manager(uuid, uuid, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.replace_committee_manager(uuid, uuid, uuid, uuid, text) TO app_runtime;
