-- Technical ownership is transferable through the application. A single
-- advisory lock serializes all Technical membership changes, including the
-- external bootstrap/recovery routine, so the final active owner is retained.
ALTER TABLE private.uc02_audit DROP CONSTRAINT uc02_audit_action_check;
ALTER TABLE private.uc02_audit ADD CONSTRAINT uc02_audit_action_check CHECK (action IN (
  'event.created','event.updated','event.published','event.held',
  'event.reopened','event.archived','event.restored',
  'event.review_flagged','event.review_unflagged','event.approved','event.review_rejected',
  'registration.created','registration.waitlisted','registration.promoted',
  'registration.superseded','grant.activated','grant.revoked',
  'access.granted','access.reassigned','access.revoked','access.technical_changed',
  'manager.assigned','manager.reassigned','manager.revoked',
  'board_admin.granted','board_admin.revoked',
  'technical.granted','technical.revoked',
  'registrations.exported','history.imported'
));

CREATE FUNCTION private.change_technical_access(
  p_actor uuid, p_user uuid, p_operation text, p_note text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_old public.administrative_access%ROWTYPE;
  v_previous jsonb; v_next jsonb; v_exists boolean;
  v_note text := NULLIF(btrim(p_note), '');
BEGIN
  IF p_actor IS NULL OR p_user IS NULL OR p_operation NOT IN ('grant','revoke')
    OR p_operation IS NULL OR (v_note IS NOT NULL AND char_length(v_note) > 200) THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('technical-ownership', 0));
  PERFORM 1 FROM public.administrative_access
    WHERE user_id = p_actor AND access_level = 'TECHNICAL' AND revoked_at IS NULL
    FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  IF NOT EXISTS (SELECT 1 FROM private.access_auth_users WHERE id = p_user) THEN
    RETURN jsonb_build_object('code', 'USER_NOT_FOUND');
  END IF;
  SELECT * INTO v_old FROM public.administrative_access WHERE user_id = p_user FOR UPDATE;
  v_exists := FOUND;
  v_previous := CASE WHEN v_exists THEN jsonb_build_object(
    'accessLevel', v_old.access_level, 'committeeId', v_old.committee_id,
    'active', v_old.revoked_at IS NULL) ELSE NULL END;
  IF p_operation = 'grant' THEN
    IF p_actor = p_user THEN RETURN jsonb_build_object('code', 'SELF_ESCALATION'); END IF;
    IF v_exists AND v_old.revoked_at IS NULL THEN
      RETURN jsonb_build_object('code', CASE WHEN v_old.access_level = 'TECHNICAL'
        THEN 'ALREADY_ACTIVE' ELSE 'CONFLICT' END);
    END IF;
    INSERT INTO public.administrative_access
      (user_id, committee_id, access_level, granted_by)
    VALUES (p_user, NULL, 'TECHNICAL', p_actor)
    ON CONFLICT (user_id) DO UPDATE SET committee_id = NULL,
      access_level = 'TECHNICAL', granted_at = now(), granted_by = p_actor,
      revoked_at = NULL, revoked_by = NULL;
    v_next := jsonb_build_object('accessLevel', 'TECHNICAL', 'committeeId', NULL, 'active', true);
  ELSE
    IF NOT v_exists OR v_old.revoked_at IS NOT NULL OR v_old.access_level <> 'TECHNICAL' THEN
      RETURN jsonb_build_object('code', 'NOT_FOUND');
    END IF;
    IF (SELECT count(*) FROM public.administrative_access
      WHERE access_level = 'TECHNICAL' AND revoked_at IS NULL) <= 1 THEN
      RETURN jsonb_build_object('code', 'LAST_TECHNICAL_ADMIN');
    END IF;
    UPDATE public.administrative_access SET revoked_at = now(), revoked_by = p_actor
      WHERE user_id = p_user;
    v_next := jsonb_build_object('accessLevel', 'TECHNICAL', 'committeeId', NULL, 'active', false);
  END IF;
  INSERT INTO private.uc02_audit
    (committee_id, actor_kind, actor_user_id, action, changes)
  VALUES (NULL, 'authenticated', p_actor,
    CASE WHEN p_operation = 'grant' THEN 'technical.granted' ELSE 'technical.revoked' END,
    jsonb_build_object('userId', p_user, 'previous', v_previous,
      'next', v_next, 'note', v_note));
  RETURN jsonb_build_object('code', 'SUCCESS');
END;
$$;
ALTER FUNCTION private.change_technical_access(uuid, uuid, text, text) OWNER TO uc02_routine_owner;
REVOKE ALL ON FUNCTION private.change_technical_access(uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.change_technical_access(uuid, uuid, text, text) TO app_runtime;

CREATE OR REPLACE FUNCTION private.set_technical_access(
  p_actor uuid, p_user uuid, p_enabled boolean, p_note text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_old public.administrative_access%ROWTYPE;
  v_previous jsonb; v_exists boolean; v_note text := NULLIF(btrim(p_note), '');
BEGIN
  IF p_actor IS NULL OR p_user IS NULL OR p_enabled IS NULL
    OR (v_note IS NOT NULL AND char_length(v_note) > 200) THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('technical-ownership', 0));
  IF NOT EXISTS (SELECT 1 FROM private.access_auth_users WHERE id = p_actor) THEN
    RETURN jsonb_build_object('code', 'ACTOR_NOT_FOUND');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM private.access_auth_users WHERE id = p_user) THEN
    RETURN jsonb_build_object('code', 'USER_NOT_FOUND');
  END IF;
  SELECT * INTO v_old FROM public.administrative_access WHERE user_id = p_user FOR UPDATE;
  v_exists := FOUND;
  v_previous := CASE WHEN v_exists THEN jsonb_build_object(
    'accessLevel', v_old.access_level, 'committeeId', v_old.committee_id,
    'active', v_old.revoked_at IS NULL) ELSE NULL END;
  IF p_enabled THEN
    IF v_exists AND v_old.revoked_at IS NULL THEN
      RETURN jsonb_build_object('code', CASE WHEN v_old.access_level = 'TECHNICAL'
        THEN 'ALREADY_ACTIVE' ELSE 'CONFLICT' END);
    END IF;
    INSERT INTO public.administrative_access
      (user_id, committee_id, access_level, granted_by)
    VALUES (p_user, NULL, 'TECHNICAL', p_actor)
    ON CONFLICT (user_id) DO UPDATE SET committee_id = NULL,
      access_level = 'TECHNICAL', granted_at = now(), granted_by = p_actor,
      revoked_at = NULL, revoked_by = NULL;
  ELSE
    IF NOT v_exists OR v_old.revoked_at IS NOT NULL OR v_old.access_level <> 'TECHNICAL' THEN
      RETURN jsonb_build_object('code', 'NOT_FOUND');
    END IF;
    IF (SELECT count(*) FROM public.administrative_access
      WHERE access_level = 'TECHNICAL' AND revoked_at IS NULL) <= 1 THEN
      RETURN jsonb_build_object('code', 'LAST_TECHNICAL_ADMIN');
    END IF;
    UPDATE public.administrative_access SET revoked_at = now(), revoked_by = p_actor
      WHERE user_id = p_user;
  END IF;
  INSERT INTO private.uc02_audit
    (committee_id, actor_kind, actor_user_id, action, changes)
  VALUES (NULL, 'maintenance', p_actor,
    CASE WHEN p_enabled THEN 'technical.granted' ELSE 'technical.revoked' END,
    jsonb_build_object('userId', p_user, 'previous', v_previous,
      'next', jsonb_build_object('accessLevel', 'TECHNICAL',
        'committeeId', NULL, 'active', p_enabled), 'note', v_note));
  RETURN jsonb_build_object('code', 'SUCCESS');
END;
$$;
ALTER FUNCTION private.set_technical_access(uuid, uuid, boolean, text) OWNER TO uc02_routine_owner;
REVOKE ALL ON FUNCTION private.set_technical_access(uuid, uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.set_technical_access(uuid, uuid, boolean, text) TO app_maintenance;

CREATE OR REPLACE FUNCTION private.list_access_audit(p_actor uuid)
RETURNS TABLE (id uuid, occurred_at timestamptz, actor_user_id uuid,
  target_user_id uuid, action text, committee_id uuid,
  previous_state jsonb, new_state jsonb, note text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT audit.id, audit.occurred_at, audit.actor_user_id,
    (audit.changes->>'userId')::uuid, audit.action, audit.committee_id,
    audit.changes->'previous', audit.changes->'next',
    audit.changes->>'note'
  FROM private.uc02_audit audit
  WHERE audit.action IN ('access.granted','access.reassigned','access.revoked',
    'access.technical_changed','manager.assigned','manager.reassigned',
    'manager.revoked','board_admin.granted','board_admin.revoked',
    'technical.granted','technical.revoked')
    AND EXISTS (SELECT 1 FROM public.administrative_access actor
      WHERE actor.user_id = p_actor AND actor.access_level = 'TECHNICAL'
        AND actor.revoked_at IS NULL)
  ORDER BY audit.occurred_at DESC, audit.id DESC LIMIT 100;
$$;
ALTER FUNCTION private.list_access_audit(uuid) OWNER TO uc02_routine_owner;
REVOKE ALL ON FUNCTION private.list_access_audit(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.list_access_audit(uuid) TO app_runtime;
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
        RETURN jsonb_build_object('code', 'REASSIGN_REQUIRED');
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
      RETURN jsonb_build_object('code', 'NOT_FOUND');
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
