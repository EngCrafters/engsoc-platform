-- Technical user administration. An Auth user is an identity; application
-- access (administrative_access) is a separate grant. This migration adds only
-- what the Technical-only directory needs:
--   * a safe read of identity state (confirmed, created, last sign-in, invited);
--   * a per-user audit read that merges access changes and Auth admin actions;
--   * an audit writer for Auth admin operations that carries NO secrets.
-- Passwords, tokens and hashes are never selected, stored or audited.

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
  'technical.granted','technical.revoked','legacy.smoke_archived',
  'user.created','user.invited','user.invitation_resent',
  'user.password_reset_sent','user.password_admin_reset',
  'registrations.exported','history.imported'
));

-- Append identity-state columns. Existing columns keep their position, so the
-- routines that already read (id, email) are unaffected.
CREATE OR REPLACE VIEW private.access_auth_users WITH (security_barrier = true) AS
  SELECT id, email, email_confirmed_at, created_at, last_sign_in_at, invited_at
  FROM auth.users;
REVOKE ALL ON private.access_auth_users FROM PUBLIC;
GRANT SELECT ON private.access_auth_users TO uc02_routine_owner;

CREATE FUNCTION private.list_auth_directory(p_actor uuid)
RETURNS TABLE (user_id uuid, email text, email_confirmed boolean,
  created_at timestamptz, last_sign_in_at timestamptz, invited boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.id, u.email::text, u.email_confirmed_at IS NOT NULL, u.created_at,
    u.last_sign_in_at, u.invited_at IS NOT NULL
  FROM private.access_auth_users u
  WHERE u.email IS NOT NULL AND EXISTS (SELECT 1 FROM public.administrative_access actor
      WHERE actor.user_id = p_actor AND actor.access_level = 'TECHNICAL'
        AND actor.revoked_at IS NULL)
  ORDER BY u.email, u.id;
$$;
ALTER FUNCTION private.list_auth_directory(uuid) OWNER TO uc02_routine_owner;
REVOKE ALL ON FUNCTION private.list_auth_directory(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.list_auth_directory(uuid) TO app_runtime;

-- History for one user: access changes plus Auth administration, newest first.
CREATE FUNCTION private.list_user_audit(p_actor uuid, p_target uuid)
RETURNS TABLE (id uuid, occurred_at timestamptz, actor_user_id uuid,
  action text, committee_id uuid, previous_state jsonb, new_state jsonb, note text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT audit.id, audit.occurred_at, audit.actor_user_id, audit.action,
    audit.committee_id, audit.changes->'previous', audit.changes->'next',
    COALESCE(audit.changes->>'note', audit.changes->>'detail')
  FROM private.uc02_audit audit
  WHERE (audit.changes->>'userId')::uuid = p_target
    AND audit.action IN ('access.granted','access.reassigned','access.revoked',
      'access.technical_changed','manager.assigned','manager.reassigned',
      'manager.revoked','board_admin.granted','board_admin.revoked',
      'technical.granted','technical.revoked','user.created','user.invited',
      'user.invitation_resent','user.password_reset_sent',
      'user.password_admin_reset')
    AND EXISTS (SELECT 1 FROM public.administrative_access actor
      WHERE actor.user_id = p_actor AND actor.access_level = 'TECHNICAL'
        AND actor.revoked_at IS NULL)
  ORDER BY audit.occurred_at DESC, audit.id DESC LIMIT 50;
$$;
ALTER FUNCTION private.list_user_audit(uuid, uuid) OWNER TO uc02_routine_owner;
REVOKE ALL ON FUNCTION private.list_user_audit(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.list_user_audit(uuid, uuid) TO app_runtime;

-- Records that a Technical user performed an Auth administration action on an
-- account. The detail is a short fixed label (for example 'invitation'), never
-- a password, token or link; the routine rejects anything that looks long.
CREATE FUNCTION private.record_auth_admin_action(
  p_actor uuid, p_target uuid, p_action text, p_detail text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_detail text := NULLIF(btrim(p_detail), '');
BEGIN
  IF p_actor IS NULL OR p_target IS NULL
    OR p_action NOT IN ('user.created','user.invited','user.invitation_resent',
      'user.password_reset_sent','user.password_admin_reset')
    OR (v_detail IS NOT NULL AND (char_length(v_detail) > 60
      OR v_detail !~ '^[a-z0-9_ .-]+$')) THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.administrative_access
      WHERE user_id = p_actor AND access_level = 'TECHNICAL' AND revoked_at IS NULL) THEN
    RETURN jsonb_build_object('code', 'FORBIDDEN');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM private.access_auth_users WHERE id = p_target) THEN
    RETURN jsonb_build_object('code', 'USER_NOT_FOUND');
  END IF;
  INSERT INTO private.uc02_audit
    (committee_id, actor_kind, actor_user_id, action, changes)
  VALUES (NULL, 'authenticated', p_actor, p_action,
    jsonb_build_object('userId', p_target, 'detail', v_detail));
  RETURN jsonb_build_object('code', 'SUCCESS');
END;
$$;
ALTER FUNCTION private.record_auth_admin_action(uuid, uuid, text, text) OWNER TO uc02_routine_owner;
REVOKE ALL ON FUNCTION private.record_auth_admin_action(uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.record_auth_admin_action(uuid, uuid, text, text) TO app_runtime;
