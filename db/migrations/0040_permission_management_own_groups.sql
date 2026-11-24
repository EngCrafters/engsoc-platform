-- 0040: permission management reaches the groups you lead (ADR 0031, owner decision 2026-11-24).
-- Requires 0039.
--
-- 0035's set_group_permissions refused SELF_CHANGE when the actor held access through the group
-- (an active appointment in it, or Committee Manager access to the committee). The owner removes
-- that restriction: whoever holds permissions.manage society-wide may change any committee's or
-- team's configuration, including those they lead, up to and including full access.
--
-- Everything else in the routine is unchanged: permissions.manage is still required and re-checked
-- under the organization lock; every item must be a known key with a supported scope; a stale
-- editor is refused; full access or a change to permissions.manage needs explicit confirmation; a
-- change that would leave no account able to manage both permissions and administrator access is
-- refused (LAST_RECOVERY_ACCOUNT); and every change is audited. The audit row now also records
-- ownGroup: true when the actor held access through the group they changed.

CREATE OR REPLACE FUNCTION private.core_schema_version() RETURNS integer
LANGUAGE sql IMMUTABLE AS $$ SELECT 40 $$;

CREATE OR REPLACE FUNCTION private.set_group_permissions(p_actor uuid, p_committee uuid, p_team uuid,
  p_permissions jsonb, p_previous jsonb, p_confirmed boolean, p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_committee uuid; v_prev jsonb; v_next jsonb; v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_before integer; v_items integer; v_manage_changed boolean; v_own boolean;
BEGIN
  IF (p_committee IS NULL) = (p_team IS NULL) OR p_permissions IS NULL OR jsonb_typeof(p_permissions) <> 'array'
     OR jsonb_array_length(p_permissions) > 100 OR NOT private.note_text_valid(v_note, 500) THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR'); END IF;
  v_next := private.permission_set_json(p_permissions);
  v_items := jsonb_array_length(p_permissions);
  -- Every item a known key, given once, with a scope the permission supports.
  IF jsonb_array_length(v_next) <> v_items OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_permissions) e LEFT JOIN private.permission_catalog pc ON pc.key = e ->> 'key'
      WHERE pc.key IS NULL OR coalesce(e ->> 'scope', 'all') NOT IN ('all', 'own')
        OR (e ->> 'scope' = 'own' AND NOT pc.scopable)) THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'permissions'); END IF;
  IF NOT private.lock_permission(p_actor, 'permissions.manage', NULL, true) THEN
    RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  IF p_team IS NOT NULL THEN
    SELECT committee_id INTO v_committee FROM private.committee_teams WHERE id = p_team AND status <> 'archived' FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
    v_own := EXISTS (SELECT 1 FROM private.leadership_appointments
      WHERE member_id = p_actor AND ended_at IS NULL AND team_id = p_team);
  ELSE
    PERFORM 1 FROM public.committees WHERE id = p_committee AND slug IS NOT NULL FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
    v_committee := p_committee;
    v_own := EXISTS (SELECT 1 FROM private.leadership_appointments
        WHERE member_id = p_actor AND ended_at IS NULL AND committee_id = p_committee)
      OR EXISTS (SELECT 1 FROM public.administrative_access WHERE user_id = p_actor AND revoked_at IS NULL
        AND access_level = 'COMMITTEE_MANAGER' AND committee_id = p_committee);
  END IF;
  v_prev := private.group_permissions_json(p_committee, p_team);
  IF p_previous IS NOT NULL AND private.permission_set_json(p_previous) <> v_prev THEN
    RETURN jsonb_build_object('code', 'STALE_REVISION', 'permissions', v_prev); END IF;
  IF v_prev = v_next THEN RETURN jsonb_build_object('code', 'UNCHANGED'); END IF;
  v_manage_changed := (v_prev @> '[{"key": "permissions.manage"}]') <> (v_next @> '[{"key": "permissions.manage"}]');
  IF (private.is_full_access(v_next) OR v_manage_changed) AND NOT coalesce(p_confirmed, false) THEN
    RETURN jsonb_build_object('code', 'CONFIRMATION_REQUIRED', 'fullAccess', private.is_full_access(v_next),
      'permissionManagement', v_manage_changed); END IF;
  v_before := private.recovery_account_count();
  BEGIN
    DELETE FROM private.group_permissions g
      WHERE CASE WHEN p_team IS NULL THEN g.committee_id = p_committee ELSE g.team_id = p_team END
        AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_next) n WHERE n ->> 'key' = g.permission);
    UPDATE private.group_permissions g SET scope = n ->> 'scope', granted_by = p_actor, granted_at = clock_timestamp()
      FROM jsonb_array_elements(v_next) n
      WHERE CASE WHEN p_team IS NULL THEN g.committee_id = p_committee ELSE g.team_id = p_team END
        AND g.permission = n ->> 'key' AND g.scope <> n ->> 'scope';
    INSERT INTO private.group_permissions (committee_id, team_id, permission, scope, granted_by)
      SELECT CASE WHEN p_team IS NULL THEN p_committee END, p_team, n ->> 'key', n ->> 'scope', p_actor
      FROM jsonb_array_elements(v_next) n
      WHERE NOT EXISTS (SELECT 1 FROM private.group_permissions g
        WHERE CASE WHEN p_team IS NULL THEN g.committee_id = p_committee ELSE g.team_id = p_team END
          AND g.permission = n ->> 'key');
    IF v_before > 0 AND private.recovery_account_count() = 0 THEN
      RAISE EXCEPTION 'LAST_RECOVERY_ACCOUNT' USING ERRCODE = 'P0001'; END IF;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'LAST_RECOVERY_ACCOUNT' THEN RETURN jsonb_build_object('code', 'LAST_RECOVERY_ACCOUNT'); END IF;
    RAISE;
  END;
  INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
  VALUES (v_committee, 'authenticated', p_actor, 'permissions.changed', jsonb_build_object(
    'groupKind', CASE WHEN p_team IS NULL THEN 'committee' ELSE 'team' END,
    'committeeId', v_committee, 'teamId', p_team, 'previous', v_prev, 'next', v_next,
    'fullAccess', private.is_full_access(v_next), 'ownGroup', v_own, 'note', v_note));
  RETURN jsonb_build_object('code', 'SUCCESS', 'permissions', v_next);
END $$;

-- Checks: same owner and grants as 0035, and the restriction is gone.
DO $$
DECLARE v_fn text := 'private.set_group_permissions(uuid, uuid, uuid, jsonb, jsonb, boolean, text)';
BEGIN
  IF (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid = v_fn::regprocedure) <> 'uc02_routine_owner' THEN
    RAISE EXCEPTION '0040: % must stay owned by uc02_routine_owner', v_fn; END IF;
  IF NOT has_function_privilege('app_runtime', v_fn, 'EXECUTE')
     OR has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION '0040: grants on % changed', v_fn; END IF;
  IF (SELECT prosrc FROM pg_proc WHERE oid = v_fn::regprocedure) LIKE '%SELF_CHANGE%' THEN
    RAISE EXCEPTION '0040: the self-change restriction is still present'; END IF;
END $$;
