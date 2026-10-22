-- UC-01 member accounts (ADR 0019): applicants choose their password at registration through
-- Supabase Auth's own sign-up, and sign in to follow their application.
--
-- Forward-only; 0025 and 0026 stay unchanged. Passwords never reach these tables: Supabase Auth
-- owns credentials, and Core links an application to an Auth identity only when that identity's
-- email is confirmed (or Core itself invited it), so an account someone else pre-registered with
-- an applicant's address can never be attached to the application. Signing in grants nothing:
-- membership still needs the existing review, approval policy and activation.

-- ---------------------------------------------------------------------------------------------
-- The application's Auth identity, once proven.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE private.membership_applications
  ADD COLUMN auth_user_id uuid REFERENCES auth.users (id);
CREATE INDEX membership_applications_auth_user_idx
  ON private.membership_applications (auth_user_id) WHERE auth_user_id IS NOT NULL;

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
  'registrations.exported','history.imported',
  'membership.submitted','membership.verified','membership.approved','membership.rejected',
  'membership.activated','membership.document_viewed','membership.policy_changed',
  'membership.account_linked'
));

-- ---------------------------------------------------------------------------------------------
-- Activation, shared by the reviewer path and the applicant's own sign-in.
-- ---------------------------------------------------------------------------------------------

-- Writes the member for an approved, not yet activated application (locked by the caller) and
-- records who completed it. Internal: no login role may execute it.
CREATE FUNCTION private.membership_complete_activation(
  p_application_id uuid, p_user uuid, p_actor uuid, p_completed_by text, p_invitation text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_app private.membership_applications%ROWTYPE;
BEGIN
  SELECT * INTO v_app FROM private.membership_applications WHERE id = p_application_id;
  IF NOT FOUND OR v_app.status <> 'approved' THEN RETURN jsonb_build_object('code', 'INVALID_TRANSITION'); END IF;
  IF v_app.activated_at IS NOT NULL THEN
    RETURN jsonb_build_object('code', 'ALREADY_ACTIVE', 'memberId', v_app.member_id);
  END IF;
  IF EXISTS (SELECT 1 FROM public.members WHERE id = p_user) THEN
    -- Already a member under this identity (for example after an earlier application).
    NULL;
  ELSIF EXISTS (SELECT 1 FROM public.members
      WHERE lower(email) = v_app.email OR university_id = v_app.university_id) THEN
    RETURN jsonb_build_object('code', 'CONFLICT');
  ELSE
    INSERT INTO public.members (id, full_name, email, university_id, year, major, status)
    VALUES (p_user, v_app.full_name, v_app.email, v_app.university_id, v_app.academic_year,
      v_app.discipline, 'member');
  END IF;
  UPDATE private.membership_applications
  SET member_id = p_user, auth_user_id = p_user, activated_at = now(), revision = revision + 1
  WHERE id = v_app.id;
  INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
  VALUES (NULL, 'authenticated', p_actor, 'membership.activated', jsonb_build_object(
    'applicationId', v_app.id, 'memberId', p_user, 'invitation', p_invitation,
    'reviewer', p_completed_by));
  RETURN jsonb_build_object('code', 'SUCCESS', 'memberId', p_user);
END;
$$;

-- The reviewer path (0025's routine, same signature and checks). One change: an Auth identity is
-- used only when its email is confirmed or Core invited it; a self-registered identity whose
-- owner has not confirmed the email yet returns EMAIL_UNCONFIRMED, and the applicant's own
-- confirmed sign-in completes the activation later.
CREATE OR REPLACE FUNCTION private.activate_membership(p_actor uuid, p_application_id uuid, p_invitation text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_kind text;
  v_app private.membership_applications%ROWTYPE;
  v_policy text;
  v_users uuid[];
  v_user uuid;
  v_proven boolean;
BEGIN
  IF p_application_id IS NULL OR p_invitation IS NULL OR p_invitation NOT IN ('none', 'sent') THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR');
  END IF;
  v_kind := private.membership_reviewer_kind(p_actor, true);
  IF v_kind IS NULL THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  SELECT approval_policy INTO v_policy FROM private.membership_settings;
  IF v_policy IS NULL THEN RETURN jsonb_build_object('code', 'POLICY_NOT_CONFIRMED'); END IF;

  SELECT * INTO v_app FROM private.membership_applications WHERE id = p_application_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  IF v_app.email = private.membership_actor_email(p_actor) THEN
    RETURN jsonb_build_object('code', 'SELF_REVIEW');
  END IF;
  IF v_app.status <> 'approved' THEN RETURN jsonb_build_object('code', 'INVALID_TRANSITION'); END IF;
  IF v_app.activated_at IS NOT NULL THEN
    RETURN jsonb_build_object('code', 'ALREADY_ACTIVE', 'memberId', v_app.member_id);
  END IF;

  SELECT array_agg(id) INTO v_users FROM private.access_auth_users WHERE lower(email) = v_app.email;
  IF v_users IS NULL THEN RETURN jsonb_build_object('code', 'NEEDS_INVITATION'); END IF;
  IF cardinality(v_users) <> 1 THEN RETURN jsonb_build_object('code', 'CONFLICT'); END IF;
  v_user := v_users[1];
  SELECT email_confirmed_at IS NOT NULL OR invited_at IS NOT NULL INTO v_proven
  FROM private.access_auth_users WHERE id = v_user;
  IF NOT v_proven THEN RETURN jsonb_build_object('code', 'EMAIL_UNCONFIRMED'); END IF;

  RETURN private.membership_complete_activation(v_app.id, v_user, p_actor, v_kind, p_invitation);
END;
$$;

-- ---------------------------------------------------------------------------------------------
-- The signed-in applicant's own view (Core passes the identity Supabase Auth verified).
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION private.get_my_membership(p_user uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_email text;
  v_confirmed boolean;
  v_app private.membership_applications%ROWTYPE;
  v_found boolean;
  v_member public.members%ROWTYPE;
BEGIN
  IF p_user IS NULL THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  SELECT lower(email), email_confirmed_at IS NOT NULL INTO v_email, v_confirmed
  FROM private.access_auth_users WHERE id = p_user;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  -- An unproven address links nothing and shows nothing.
  IF NOT v_confirmed THEN RETURN jsonb_build_object('code', 'EMAIL_UNCONFIRMED'); END IF;

  -- The latest application already linked to this identity, or submitted with its confirmed email
  -- and not linked to anyone yet.
  SELECT * INTO v_app FROM private.membership_applications a
  WHERE a.auth_user_id = p_user OR (a.auth_user_id IS NULL AND a.email = v_email)
  ORDER BY a.submitted_at DESC, a.id DESC
  LIMIT 1
  FOR UPDATE;
  v_found := FOUND;

  IF v_found AND v_app.auth_user_id IS NULL THEN
    -- Linking does not change the review, so the revision reviewers hold stays valid.
    UPDATE private.membership_applications SET auth_user_id = p_user WHERE id = v_app.id;
    INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
    VALUES (NULL, 'authenticated', p_user, 'membership.account_linked',
      jsonb_build_object('applicationId', v_app.id));
  END IF;

  -- Reviewers approved it but activation was waiting for this confirmed sign-in.
  IF v_found AND v_app.status = 'approved' AND v_app.activated_at IS NULL THEN
    PERFORM private.membership_complete_activation(v_app.id, p_user, p_user, 'applicant', 'none');
    SELECT * INTO v_app FROM private.membership_applications WHERE id = v_app.id;
  END IF;

  SELECT * INTO v_member FROM public.members WHERE id = p_user;
  RETURN jsonb_build_object('code', 'SUCCESS',
    'member', CASE WHEN FOUND THEN jsonb_build_object(
      'status', v_member.status::text, 'since', v_member.created_at) END,
    -- The applicant's own stages; no note, reviewer or document.
    'application', CASE WHEN v_found THEN jsonb_build_object(
      'status', v_app.status::text, 'submittedAt', v_app.submitted_at,
      'decidedAt', v_app.decided_at, 'activated', v_app.activated_at IS NOT NULL) END);
END;
$$;

-- ---------------------------------------------------------------------------------------------
-- Ownership and execution grants.
-- ---------------------------------------------------------------------------------------------
ALTER FUNCTION private.membership_complete_activation(uuid, uuid, uuid, text, text) OWNER TO uc02_routine_owner;
ALTER FUNCTION private.activate_membership(uuid, uuid, text) OWNER TO uc02_routine_owner;
ALTER FUNCTION private.get_my_membership(uuid) OWNER TO uc02_routine_owner;
REVOKE ALL ON FUNCTION private.membership_complete_activation(uuid, uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.activate_membership(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.get_my_membership(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.activate_membership(uuid, uuid, text) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.get_my_membership(uuid) TO app_runtime;

DO $$
BEGIN
  IF NOT has_function_privilege('app_runtime', 'private.get_my_membership(uuid)', 'EXECUTE')
      OR NOT has_function_privilege('app_runtime', 'private.activate_membership(uuid, uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'app_runtime must be able to execute the member routines';
  END IF;
  IF has_function_privilege('app_runtime',
        'private.membership_complete_activation(uuid, uuid, uuid, text, text)', 'EXECUTE')
      OR has_function_privilege('anon', 'private.get_my_membership(uuid)', 'EXECUTE')
      OR has_function_privilege('authenticated', 'private.get_my_membership(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'an internal or browser-facing role can execute a member routine it must not';
  END IF;
  IF (SELECT count(*) FROM information_schema.role_table_grants
      WHERE grantee IN ('app_runtime', 'app_maintenance', 'anon', 'authenticated')
        AND table_schema = 'private' AND table_name LIKE 'membership%') <> 0 THEN
    RAISE EXCEPTION 'no login or browser role may hold privileges on membership tables';
  END IF;
END;
$$;
