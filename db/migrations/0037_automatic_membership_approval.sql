-- 0037: automatic membership approval (ADR 0029). Requires 0036.
--
-- A third approval policy, 'automatic': a valid registration is approved in the same transaction
-- that stores it, with no reviewer. Everything else stays: the same validation, per-address limit
-- and duplicate checks; no Auth identity, role, committee or access is created here; and the member
-- record is still written only once the applicant proves the email address (a confirmed Supabase
-- sign-in, private.get_my_membership) or accepts Core's invitation (private.activate_membership).
-- 'single_step' and 'two_step' keep working and the Technical Team can switch back at any time.
--
-- The owner chose automatic approval on 2026-11-22; this migration records that decision as the
-- active policy (audited as a migration). Existing applications are not changed: anything already
-- pending stays with the reviewers, who approve it in one step under this policy.

CREATE OR REPLACE FUNCTION private.core_schema_version() RETURNS integer
LANGUAGE sql IMMUTABLE AS $$ SELECT 37 $$;

-- =============================================================================================
-- The policy value
-- =============================================================================================
DO $$
DECLARE v_name text;
BEGIN
  SELECT conname INTO v_name FROM pg_constraint
  WHERE conrelid = 'private.membership_settings'::regclass AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%approval_policy%';
  IF v_name IS NULL THEN RAISE EXCEPTION 'the approval policy check constraint was not found'; END IF;
  EXECUTE format('ALTER TABLE private.membership_settings DROP CONSTRAINT %I', v_name);
END $$;
ALTER TABLE private.membership_settings ADD CONSTRAINT membership_settings_approval_policy_check
  CHECK (approval_policy IN ('two_step', 'single_step', 'automatic'));

-- =============================================================================================
-- Applications the policy approved
-- =============================================================================================
-- An automatic approval has a decision time and no reviewer. Every other decision keeps its
-- reviewer, exactly as 0025 required.
ALTER TABLE private.membership_applications
  ADD COLUMN auto_approved boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN private.membership_applications.auto_approved IS
  'True when the automatic policy approved the application at submission (ADR 0029): decided_at '
  'is set and decided_by is NULL. Reviewer decisions always name the reviewer.';
ALTER TABLE private.membership_applications DROP CONSTRAINT membership_decision_consistency;
ALTER TABLE private.membership_applications ADD CONSTRAINT membership_decision_consistency CHECK (
  (status IN ('approved', 'rejected')) = (decided_at IS NOT NULL)
  AND (decided_at IS NULL OR (decided_by IS NULL) = auto_approved)
  AND (NOT auto_approved OR status = 'approved'));

-- =============================================================================================
-- Submission: 0033's routine, approving at once under the automatic policy
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
  v_field text; v_recent integer; v_id uuid; v_automatic boolean;
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

  -- FOR SHARE: a concurrent policy change waits for this submission, and this submission sees the
  -- policy that was in force when it was decided.
  SELECT approval_policy = 'automatic' INTO v_automatic FROM private.membership_settings FOR SHARE;
  v_automatic := coalesce(v_automatic, false);
  v_status := CASE WHEN v_automatic THEN 'approved' ELSE 'pending_review' END;

  BEGIN
    INSERT INTO private.membership_applications (full_name, email, university_id, academic_year,
      discipline, interests, consent_version, status_token_hash, category, institution_id,
      institution_name, status, decided_at, auto_approved)
    VALUES (v_name, v_email, NULL, p_academic_year, p_discipline, v_interests, p_consent_version,
      p_status_token_hash, p_category, p_institution_id, v_institution_name,
      v_status, CASE WHEN v_automatic THEN now() END, v_automatic)
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
  RETURN jsonb_build_object('code', 'SUCCESS', 'applicationId', v_id, 'status', v_status::text);
END $$;

-- =============================================================================================
-- The registration form learns whether membership starts at once (wording only)
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
      FROM private.membership_settings))
$$;

-- =============================================================================================
-- The policy routine (0035's, permission-checked) accepts 'automatic'
-- =============================================================================================
CREATE OR REPLACE FUNCTION private.set_membership_approval_policy(p_actor uuid, p_policy text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_previous text; v_next text;
BEGIN
  IF p_policy IS NULL OR p_policy NOT IN ('two_step', 'single_step', 'automatic', 'unset') THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR');
  END IF;
  PERFORM 1 WHERE private.lock_permission(p_actor, 'settings.membership_policy');
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  v_next := NULLIF(p_policy, 'unset');
  SELECT approval_policy INTO v_previous FROM private.membership_settings FOR UPDATE;
  IF v_previous IS NOT DISTINCT FROM v_next THEN RETURN jsonb_build_object('code', 'SUCCESS', 'policy', v_next); END IF;
  UPDATE private.membership_settings SET approval_policy = v_next, updated_by = p_actor, updated_at = now();
  INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
  VALUES (NULL, 'authenticated', p_actor, 'membership.policy_changed',
    jsonb_build_object('previous', v_previous, 'next', v_next));
  RETURN jsonb_build_object('code', 'SUCCESS', 'policy', v_next);
END $$;

-- =============================================================================================
-- The dashboard's application view says when the policy, not a reviewer, approved it
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
      'decisionNote', v_app.decision_note, 'memberId', v_app.member_id,
      'activatedAt', v_app.activated_at, 'documentDeletedAt', v_app.document_deleted_at,
      'revision', v_app.revision, 'document', v_document)
      || private.membership_details_json(v_app.category, v_app.institution_id, v_app.institution_name));
END $$;

-- =============================================================================================
-- The owner's decision (2026-11-22) becomes the active policy
-- =============================================================================================
DO $$
DECLARE v_previous text;
BEGIN
  SELECT approval_policy INTO v_previous FROM private.membership_settings FOR UPDATE;
  IF v_previous IS DISTINCT FROM 'automatic' THEN
    UPDATE private.membership_settings SET approval_policy = 'automatic', updated_by = NULL, updated_at = now();
    INSERT INTO private.uc02_audit (committee_id, actor_kind, action, changes)
    VALUES (NULL, 'migration', 'membership.policy_changed',
      jsonb_build_object('previous', v_previous, 'next', 'automatic', 'migration', '0037'));
  END IF;
END $$;

-- =============================================================================================
-- Checks: the routines kept their owner and grants; no browser role reaches them
-- =============================================================================================
DO $$
DECLARE v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'private.submit_membership_application_v2(text, text, text, text, text, integer, text, text[], text, text, inet)',
    'private.get_membership_options()',
    'private.set_membership_approval_policy(uuid, text)',
    'private.get_membership_application(uuid, uuid)'
  ] LOOP
    IF (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid = v_fn::regprocedure) <> 'uc02_routine_owner' THEN
      RAISE EXCEPTION '% must stay owned by uc02_routine_owner', v_fn;
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
