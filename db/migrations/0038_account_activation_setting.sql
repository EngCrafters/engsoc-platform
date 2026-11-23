-- 0038: the account activation setting (ADR 0030). Requires 0037.
--
-- How a registrant's sign-in account is created, separate from the approval policy (ADR 0029):
--
--   'email_confirmation' (default, as before): the website's Supabase sign-up sends a confirmation
--     email; the account works, and the membership activates, once the mailbox owner confirms.
--   'immediate': no confirmation email. Core creates the account through the Supabase Auth Admin
--     API (server-side, service-role key), and the registering browser signs in with a one-time
--     token and sets its own password with Supabase. The email address is NOT verified; this
--     application records that, and the dashboard shows it.
--
-- The mode in force at submission is stored on the application, so a registrant always gets the
-- flow the website announced. An immediate account is created only for an address with no Auth
-- account, only for the browser holding the application's 256-bit status token, only within an
-- hour of submission, and only until that account first signs in. An existing account is never
-- touched. Nothing here grants a role, permission, committee place or leadership.

CREATE OR REPLACE FUNCTION private.core_schema_version() RETURNS integer
LANGUAGE sql IMMUTABLE AS $$ SELECT 38 $$;

-- =============================================================================================
-- Columns
-- =============================================================================================
ALTER TABLE private.membership_settings
  ADD COLUMN account_activation text NOT NULL DEFAULT 'email_confirmation'
    CONSTRAINT membership_settings_account_activation_check
    CHECK (account_activation IN ('email_confirmation', 'immediate'));
COMMENT ON COLUMN private.membership_settings.account_activation IS
  'How registrants'' accounts are created (ADR 0030): email_confirmation (Supabase sign-up and '
  'confirmation email) or immediate (created by Core without email verification).';

ALTER TABLE private.membership_applications
  ADD COLUMN account_activation text
    CONSTRAINT membership_account_activation_check
    CHECK (account_activation IS NULL OR account_activation IN ('email_confirmation', 'immediate')),
  -- The Auth user ID Core reserves for an immediate account before creating it, so a retry can
  -- recognise its own account and never adopt someone else's.
  ADD COLUMN immediate_account_id uuid,
  ADD CONSTRAINT membership_immediate_account_mode
    CHECK (immediate_account_id IS NULL OR account_activation = 'immediate');
COMMENT ON COLUMN private.membership_applications.account_activation IS
  'The account activation mode in force at submission (ADR 0030); NULL before 0038.';
COMMENT ON COLUMN private.membership_applications.immediate_account_id IS
  'The Auth account Core created for this application without email verification (ADR 0030).';
CREATE UNIQUE INDEX membership_immediate_account_idx
  ON private.membership_applications (immediate_account_id) WHERE immediate_account_id IS NOT NULL;

-- =============================================================================================
-- Submission: 0037's routine, recording and reporting the account activation mode
-- =============================================================================================
CREATE OR REPLACE FUNCTION private.submit_membership_application_v2(
  p_full_name text, p_email text, p_category text, p_institution_id text, p_institution_name text,
  p_academic_year integer, p_discipline text, p_interests text[], p_consent_version text,
  p_status_token_hash text, p_ip inet
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_name text := btrim(coalesce(p_full_name, ''));
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_institution_name text := nullif(btrim(coalesce(p_institution_name, '')), '');
  v_interests text[] := coalesce(p_interests, '{}');
  v_field text; v_recent integer; v_id uuid; v_automatic boolean; v_activation text;
  v_status private.membership_application_status;
BEGIN
  IF p_ip IS NULL THEN RETURN jsonb_build_object('code', 'INVALID_IP'); END IF;
  IF char_length(v_name) NOT BETWEEN 1 AND 200 OR v_name ~ '[[:cntrl:]]' THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'fullName'); END IF;
  IF char_length(v_email) > 254 OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'email'); END IF;
  v_field := private.membership_details_invalid_field(p_category, p_institution_id, v_institution_name,
    p_academic_year);
  IF v_field IS NOT NULL THEN RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', v_field); END IF;
  IF p_discipline IS NULL OR NOT (p_discipline = ANY (private.member_discipline_ids())) THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'discipline'); END IF;
  IF cardinality(v_interests) > 4 OR array_position(v_interests, NULL) IS NOT NULL
     OR NOT (v_interests <@ private.member_interest_ids())
     OR (SELECT count(DISTINCT x) FROM unnest(v_interests) x) <> cardinality(v_interests) THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'interests'); END IF;
  IF p_consent_version IS NULL OR p_consent_version NOT IN ('2026-10-v1', '2026-11-v2') THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'consent'); END IF;
  IF p_status_token_hash IS NULL OR p_status_token_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'statusToken'); END IF;

  -- The same five an hour per address as 0025, in the same log.
  DELETE FROM private.membership_submission_attempts WHERE created_at < clock_timestamp() - interval '1 day';
  INSERT INTO private.membership_submission_attempts (ip_address) VALUES (p_ip);
  SELECT count(*) INTO v_recent FROM private.membership_submission_attempts
  WHERE ip_address = p_ip AND created_at > clock_timestamp() - interval '1 hour';
  IF v_recent > 5 THEN RETURN jsonb_build_object('code', 'RATE_LIMITED'); END IF;

  IF EXISTS (SELECT 1 FROM public.members WHERE lower(email) = v_email) THEN
    RETURN jsonb_build_object('code', 'ALREADY_MEMBER'); END IF;
  IF EXISTS (SELECT 1 FROM private.membership_applications
      WHERE status IN ('pending_review', 'verified', 'approved') AND email = v_email) THEN
    RETURN jsonb_build_object('code', 'ALREADY_APPLIED'); END IF;

  -- FOR SHARE: a concurrent settings change waits for this submission, and this submission uses
  -- the settings that were in force when it was decided.
  SELECT approval_policy = 'automatic', account_activation INTO v_automatic, v_activation
  FROM private.membership_settings FOR SHARE;
  v_automatic := coalesce(v_automatic, false);
  v_status := CASE WHEN v_automatic THEN 'approved' ELSE 'pending_review' END;

  BEGIN
    INSERT INTO private.membership_applications (full_name, email, university_id, academic_year,
      discipline, interests, consent_version, status_token_hash, category, institution_id,
      institution_name, status, decided_at, auto_approved, account_activation)
    VALUES (v_name, v_email, NULL, p_academic_year, p_discipline, v_interests, p_consent_version,
      p_status_token_hash, p_category, p_institution_id, v_institution_name,
      v_status, CASE WHEN v_automatic THEN now() END, v_automatic, v_activation)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    -- A concurrent duplicate lost the race on the open-application index.
    RETURN jsonb_build_object('code', 'ALREADY_APPLIED');
  END;
  INSERT INTO private.uc02_audit (committee_id, actor_kind, action, changes)
  VALUES (NULL, 'anonymous', 'membership.submitted',
    jsonb_build_object('applicationId', v_id, 'category', p_category));
  IF v_automatic THEN
    -- No reviewer: the policy decided. The member record follows the applicant's proven email.
    INSERT INTO private.uc02_audit (committee_id, actor_kind, action, changes)
    VALUES (NULL, 'anonymous', 'membership.approved', jsonb_build_object(
      'applicationId', v_id, 'previous', 'pending_review', 'next', 'approved',
      'reviewer', NULL, 'policy', 'automatic', 'documentDeleted', false, 'hasNote', false));
  END IF;
  RETURN jsonb_build_object('code', 'SUCCESS', 'applicationId', v_id, 'status', v_status::text,
    'accountActivation', v_activation);
END $$;

-- =============================================================================================
-- The registration form learns both settings (wording only; the submission decides)
-- =============================================================================================
CREATE OR REPLACE FUNCTION private.get_membership_options() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object('code', 'SUCCESS',
    'categories', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', id,
        'label', jsonb_build_object('en', label_en, 'ar', label_ar),
        'institution', institution_mode, 'academicYear', academic_year_required)
        ORDER BY sort_order, id), '[]'::jsonb)
      FROM private.membership_categories WHERE active),
    'institutions', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', id,
        'name', jsonb_build_object('en', name_en, 'ar', name_ar), 'country', country_code)
        ORDER BY sort_order, name_en), '[]'::jsonb)
      FROM private.institutions WHERE active),
    'consentVersion', '2026-11-v2',
    'approval', (SELECT CASE WHEN approval_policy = 'automatic' THEN 'automatic' ELSE 'review' END
      FROM private.membership_settings),
    'accountActivation', (SELECT account_activation FROM private.membership_settings))
$$;

-- =============================================================================================
-- Changing the setting: the same permission and audit as the approval policy
-- =============================================================================================
CREATE FUNCTION private.set_membership_account_activation(p_actor uuid, p_mode text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_previous text;
BEGIN
  IF p_mode IS NULL OR p_mode NOT IN ('email_confirmation', 'immediate') THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR');
  END IF;
  PERFORM 1 WHERE private.lock_permission(p_actor, 'settings.membership_policy');
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  SELECT account_activation INTO v_previous FROM private.membership_settings FOR UPDATE;
  IF v_previous = p_mode THEN
    RETURN jsonb_build_object('code', 'SUCCESS', 'accountActivation', p_mode);
  END IF;
  UPDATE private.membership_settings SET account_activation = p_mode, updated_by = p_actor, updated_at = now();
  INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
  VALUES (NULL, 'authenticated', p_actor, 'membership.policy_changed',
    jsonb_build_object('setting', 'account_activation', 'previous', v_previous, 'next', p_mode));
  RETURN jsonb_build_object('code', 'SUCCESS', 'accountActivation', p_mode);
END $$;

-- =============================================================================================
-- Immediate accounts, for Core's public account endpoint (the caller proves only that it holds
-- the application's status token; the email always comes from the database)
-- =============================================================================================

-- What Core may do for this application now: CREATE the account with the reserved ID, or LINK
-- (sign the registrant in to) the account it created earlier, if that account never signed in.
CREATE FUNCTION private.begin_immediate_account(p_status_token_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_app private.membership_applications%ROWTYPE;
  v_users uuid[];
  v_signed_in boolean;
BEGIN
  IF p_status_token_hash IS NULL OR p_status_token_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('code', 'NOT_FOUND');
  END IF;
  SELECT * INTO v_app FROM private.membership_applications
  WHERE status_token_hash = p_status_token_hash FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  IF v_app.account_activation IS DISTINCT FROM 'immediate' THEN
    RETURN jsonb_build_object('code', 'NOT_IMMEDIATE');
  END IF;
  IF v_app.status = 'rejected' THEN RETURN jsonb_build_object('code', 'NOT_AVAILABLE'); END IF;
  IF v_app.submitted_at < now() - interval '1 hour' THEN RETURN jsonb_build_object('code', 'EXPIRED'); END IF;

  SELECT array_agg(id) INTO v_users FROM private.access_auth_users WHERE lower(email) = v_app.email;
  IF v_users IS NULL THEN
    IF v_app.auth_user_id IS NOT NULL THEN RETURN jsonb_build_object('code', 'ALREADY_SET_UP'); END IF;
    IF v_app.immediate_account_id IS NULL THEN
      UPDATE private.membership_applications SET immediate_account_id = gen_random_uuid()
      WHERE id = v_app.id RETURNING immediate_account_id INTO v_app.immediate_account_id;
    END IF;
    RETURN jsonb_build_object('code', 'CREATE', 'userId', v_app.immediate_account_id,
      'email', v_app.email, 'applicationId', v_app.id);
  END IF;
  IF cardinality(v_users) = 1 AND v_users[1] = v_app.immediate_account_id THEN
    SELECT last_sign_in_at IS NOT NULL INTO v_signed_in FROM private.access_auth_users WHERE id = v_users[1];
    IF v_signed_in THEN RETURN jsonb_build_object('code', 'ALREADY_SET_UP'); END IF;
    RETURN jsonb_build_object('code', 'LINK', 'userId', v_app.immediate_account_id,
      'email', v_app.email, 'applicationId', v_app.id);
  END IF;
  -- Someone already has an account with this address: never adopted, never signed in to.
  RETURN jsonb_build_object('code', 'ACCOUNT_EXISTS');
END $$;

-- After Core created (or found) the reserved account: link it to the application and, if the
-- application is approved, write the member record. Re-checks everything begin checked.
CREATE FUNCTION private.complete_immediate_account(p_status_token_hash text, p_user uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_app private.membership_applications%ROWTYPE;
  v_email text; v_confirmed boolean; v_signed_in boolean;
BEGIN
  IF p_user IS NULL OR p_status_token_hash IS NULL OR p_status_token_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('code', 'NOT_FOUND');
  END IF;
  SELECT * INTO v_app FROM private.membership_applications
  WHERE status_token_hash = p_status_token_hash FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  IF v_app.account_activation IS DISTINCT FROM 'immediate' OR v_app.immediate_account_id IS DISTINCT FROM p_user
     OR v_app.status = 'rejected' THEN
    RETURN jsonb_build_object('code', 'INVALID');
  END IF;
  IF v_app.submitted_at < now() - interval '1 hour' THEN RETURN jsonb_build_object('code', 'EXPIRED'); END IF;
  SELECT lower(email), email_confirmed_at IS NOT NULL, last_sign_in_at IS NOT NULL
  INTO v_email, v_confirmed, v_signed_in FROM private.access_auth_users WHERE id = p_user;
  IF NOT FOUND OR v_email IS DISTINCT FROM v_app.email OR NOT v_confirmed THEN
    RETURN jsonb_build_object('code', 'INVALID');
  END IF;
  IF v_signed_in THEN RETURN jsonb_build_object('code', 'ALREADY_SET_UP'); END IF;
  IF v_app.auth_user_id IS NOT NULL AND v_app.auth_user_id <> p_user THEN
    RETURN jsonb_build_object('code', 'INVALID');
  END IF;

  IF v_app.auth_user_id IS NULL THEN
    UPDATE private.membership_applications SET auth_user_id = p_user WHERE id = v_app.id;
    INSERT INTO private.uc02_audit (committee_id, actor_kind, action, changes)
    VALUES (NULL, 'anonymous', 'membership.account_linked', jsonb_build_object(
      'applicationId', v_app.id, 'accountActivation', 'immediate', 'emailVerified', false));
  END IF;
  -- Approved (automatically or by a reviewer) and waiting: the member record now.
  IF v_app.status = 'approved' AND v_app.activated_at IS NULL THEN
    PERFORM private.membership_complete_activation(v_app.id, p_user, p_user, 'applicant', 'none');
  END IF;
  RETURN jsonb_build_object('code', 'SUCCESS',
    'member', EXISTS (SELECT 1 FROM public.members WHERE id = p_user));
END $$;

-- =============================================================================================
-- The dashboard's application view says how the account was created
-- =============================================================================================
CREATE OR REPLACE FUNCTION private.get_membership_application(p_actor uuid, p_application_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_kind text := private.membership_reviewer_kind(p_actor, false);
  v_app private.membership_applications%ROWTYPE;
  v_document jsonb;
BEGIN
  IF v_kind IS NULL THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  SELECT * INTO v_app FROM private.membership_applications WHERE id = p_application_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  SELECT jsonb_build_object('mediaType', media_type, 'byteSize', byte_size) INTO v_document
  FROM private.membership_documents WHERE application_id = v_app.id;
  RETURN jsonb_build_object('code', 'SUCCESS', 'reviewer', v_kind,
    'policy', (SELECT approval_policy FROM private.membership_settings),
    'ownApplication', coalesce(v_app.email = private.membership_actor_email(p_actor), false),
    'application', jsonb_build_object(
      'id', v_app.id, 'fullName', v_app.full_name, 'email', v_app.email,
      'universityId', v_app.university_id, 'academicYear', v_app.academic_year,
      'discipline', v_app.discipline, 'interests', to_jsonb(v_app.interests),
      'consentVersion', v_app.consent_version, 'consentAcceptedAt', v_app.consent_accepted_at,
      'status', v_app.status::text, 'submittedAt', v_app.submitted_at,
      'verifiedBy', v_app.verified_by, 'verifiedAt', v_app.verified_at,
      'verifiedByEmail', private.membership_actor_email(v_app.verified_by),
      'decidedBy', v_app.decided_by, 'decidedAt', v_app.decided_at,
      'decidedByEmail', private.membership_actor_email(v_app.decided_by),
      'autoApproved', v_app.auto_approved,
      'accountActivation', v_app.account_activation,
      'accountUnverified', v_app.immediate_account_id IS NOT NULL
        AND v_app.auth_user_id = v_app.immediate_account_id,
      'decisionNote', v_app.decision_note, 'memberId', v_app.member_id,
      'activatedAt', v_app.activated_at, 'documentDeletedAt', v_app.document_deleted_at,
      'revision', v_app.revision, 'document', v_document)
      || private.membership_details_json(v_app.category, v_app.institution_id, v_app.institution_name));
END $$;

-- =============================================================================================
-- Ownership, grants and checks
-- =============================================================================================
DO $$
DECLARE v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'private.set_membership_account_activation(uuid, text)',
    'private.begin_immediate_account(text)',
    'private.complete_immediate_account(text, uuid)'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO uc02_routine_owner', v_fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', v_fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO app_runtime', v_fn);
  END LOOP;
  FOREACH v_fn IN ARRAY ARRAY[
    'private.submit_membership_application_v2(text, text, text, text, text, integer, text, text[], text, text, inet)',
    'private.get_membership_options()',
    'private.set_membership_account_activation(uuid, text)',
    'private.begin_immediate_account(text)',
    'private.complete_immediate_account(text, uuid)',
    'private.get_membership_application(uuid, uuid)'
  ] LOOP
    IF (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid = v_fn::regprocedure) <> 'uc02_routine_owner' THEN
      RAISE EXCEPTION '% must be owned by uc02_routine_owner', v_fn;
    END IF;
    IF NOT has_function_privilege('app_runtime', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'app_runtime must be able to execute %', v_fn;
    END IF;
    IF has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'a browser role can execute %', v_fn;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM information_schema.role_table_grants
      WHERE grantee IN ('app_runtime', 'app_maintenance', 'anon', 'authenticated')
        AND table_schema = 'private' AND table_name LIKE 'membership%') <> 0 THEN
    RAISE EXCEPTION 'no login or browser role may hold privileges on membership tables';
  END IF;
END $$;
