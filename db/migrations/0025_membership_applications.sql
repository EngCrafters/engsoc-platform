-- 0025: UC-01 membership applications, SQU ID verification and review (ADR 0017).
--
-- Additive. New private objects only, plus SELECT/INSERT on public.members for the routine owner
-- and new audit actions. No existing row is modified and no existing routine is replaced.
--
-- Shape of the boundary (same as every UC-02 surface):
--   * every new table lives in `private`, is owned by uc02_routine_owner, has FORCE RLS with
--     owner-only policies, and grants nothing to anon, authenticated, service_role or app_runtime;
--   * app_runtime may only EXECUTE the fixed routines below;
--   * each review routine re-reads live administrative_access at call time (FOR SHARE, so a
--     concurrent revocation is serialised), and never trusts a role, scope or status from a caller;
--   * audit rows name the application by id only, never the applicant's name, email, student ID
--     or document.

CREATE TYPE private.membership_application_status AS ENUM
  ('pending_review', 'verified', 'approved', 'rejected');

CREATE TABLE private.membership_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  email text NOT NULL,
  university_id text NOT NULL,
  academic_year smallint NOT NULL,
  discipline text NOT NULL,
  interests text[] NOT NULL DEFAULT '{}',
  consent_version text NOT NULL,
  consent_accepted_at timestamptz NOT NULL DEFAULT now(),
  status private.membership_application_status NOT NULL DEFAULT 'pending_review',
  -- SHA-256 of the applicant's status token. The token itself is returned once and never stored.
  status_token_hash text NOT NULL UNIQUE,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  verified_by uuid REFERENCES auth.users (id),
  verified_at timestamptz,
  decided_by uuid REFERENCES auth.users (id),
  decided_at timestamptz,
  -- Internal reviewer note. Never returned to the applicant and never copied into audit.
  decision_note text,
  member_id uuid REFERENCES public.members (id),
  activated_at timestamptz,
  document_deleted_at timestamptz,
  revision integer NOT NULL DEFAULT 1,
  CONSTRAINT membership_full_name_bounds CHECK (
    full_name = btrim(full_name) AND char_length(full_name) BETWEEN 1 AND 200
    AND full_name !~ '[[:cntrl:]]'),
  CONSTRAINT membership_email_shape CHECK (
    email = lower(btrim(email)) AND char_length(email) <= 254
    AND email ~ '^[^[:space:]@]+@([a-z0-9-]+\.)*squ\.edu\.om$'),
  CONSTRAINT membership_university_id_shape CHECK (university_id ~ '^[0-9]{6,10}$'),
  CONSTRAINT membership_academic_year_bounds CHECK (academic_year BETWEEN 1 AND 5),
  CONSTRAINT membership_discipline_shape CHECK (discipline ~ '^[a-z][a-z-]{1,40}$'),
  CONSTRAINT membership_interests_bounds CHECK (cardinality(interests) <= 4),
  CONSTRAINT membership_consent_version_shape CHECK (consent_version ~ '^[a-z0-9.-]{1,40}$'),
  CONSTRAINT membership_status_token_shape CHECK (status_token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT membership_note_bounds CHECK (decision_note IS NULL OR char_length(decision_note) <= 500),
  CONSTRAINT membership_revision_positive CHECK (revision > 0),
  CONSTRAINT membership_verification_consistency CHECK ((verified_by IS NULL) = (verified_at IS NULL)),
  CONSTRAINT membership_verified_has_verifier CHECK (status <> 'verified' OR verified_by IS NOT NULL),
  CONSTRAINT membership_decision_consistency CHECK (
    (status IN ('approved', 'rejected')) = (decided_by IS NOT NULL AND decided_at IS NOT NULL)),
  CONSTRAINT membership_activation_consistency CHECK (
    (activated_at IS NULL) = (member_id IS NULL)
    AND (activated_at IS NULL OR status = 'approved'))
);

COMMENT ON TABLE private.membership_applications IS
  'UC-01 membership applications (ADR 0017). Reachable only through private membership routines; '
  'no browser or runtime role has table privileges.';

-- One open (pending, verified) or approved application per email and per student ID. A rejected
-- application does not block a new one. Concurrent duplicates fail here, not in application code.
CREATE UNIQUE INDEX membership_open_email_idx ON private.membership_applications (email)
  WHERE status IN ('pending_review', 'verified', 'approved');
CREATE UNIQUE INDEX membership_open_university_id_idx ON private.membership_applications (university_id)
  WHERE status IN ('pending_review', 'verified', 'approved');
CREATE INDEX membership_queue_idx ON private.membership_applications (status, submitted_at, id);
CREATE INDEX membership_submitted_idx ON private.membership_applications (submitted_at, id);

-- The SQU ID card. Deleted in the same transaction as the final decision (approve or reject).
CREATE TABLE private.membership_documents (
  application_id uuid PRIMARY KEY REFERENCES private.membership_applications (id) ON DELETE CASCADE,
  media_type text NOT NULL,
  byte_size integer NOT NULL,
  sha256 text NOT NULL,
  content bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT membership_document_type CHECK (
    media_type IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  CONSTRAINT membership_document_size CHECK (byte_size BETWEEN 1 AND 4194304),
  CONSTRAINT membership_document_length CHECK (octet_length(content) = byte_size),
  CONSTRAINT membership_document_hash_shape CHECK (sha256 ~ '^[0-9a-f]{64}$')
);

COMMENT ON TABLE private.membership_documents IS
  'SQU ID card images/PDFs for membership review. Private; deleted at the final decision (ADR 0017).';

-- Per-IP submission attempts for the public endpoint's rate limit. Kept for one day only.
CREATE TABLE private.membership_submission_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_address inet NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX membership_attempts_ip_created_idx
  ON private.membership_submission_attempts (ip_address, created_at);

-- The owner-confirmed approval policy. NULL means "not confirmed": approval and activation are
-- refused until a Technical user records the owner's decision.
CREATE TABLE private.membership_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  approval_policy text CHECK (approval_policy IN ('two_step', 'single_step')),
  updated_by uuid REFERENCES auth.users (id),
  updated_at timestamptz
);
INSERT INTO private.membership_settings (singleton) VALUES (true);

DO $$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['membership_applications', 'membership_documents',
      'membership_submission_attempts', 'membership_settings'] LOOP
    EXECUTE format('ALTER TABLE private.%I OWNER TO uc02_routine_owner', v_table);
    EXECUTE format('ALTER TABLE private.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('ALTER TABLE private.%I FORCE ROW LEVEL SECURITY', v_table);
    EXECUTE format('REVOKE ALL ON TABLE private.%I FROM PUBLIC, anon, authenticated, service_role, app_runtime, app_maintenance', v_table);
    -- FORCE RLS applies to the owner too; without this policy the routines could not read their
    -- own tables (the failure 0024's rehearsal caught).
    EXECUTE format('CREATE POLICY routine_owner_full_access ON private.%I FOR ALL TO uc02_routine_owner USING (true) WITH CHECK (true)', v_table);
  END LOOP;
END;
$$;
ALTER TYPE private.membership_application_status OWNER TO uc02_routine_owner;

-- Activation writes the permanent member record. Members stay FORCE RLS with no browser access.
GRANT SELECT, INSERT ON public.members TO uc02_routine_owner;
CREATE POLICY routine_owner_select_members ON public.members FOR SELECT TO uc02_routine_owner USING (true);
CREATE POLICY routine_owner_insert_members ON public.members FOR INSERT TO uc02_routine_owner WITH CHECK (true);

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
  'membership.activated','membership.document_viewed','membership.policy_changed'
));
CREATE INDEX uc02_audit_membership_application_idx ON private.uc02_audit ((changes ->> 'applicationId'))
  WHERE action LIKE 'membership.%';

-- ---------------------------------------------------------------------------------------------
-- Authority. 'senior' = BOARD_ADMIN or TECHNICAL; 'society_affairs' = the manager of the committee
-- whose stable slug is 'society-affairs'. Anyone else: NULL. With p_lock the caller's access row is
-- held FOR SHARE until the transaction ends, so a revocation cannot interleave with a decision.
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION private.membership_reviewer_kind(p_actor uuid, p_lock boolean)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_level public.administrative_access_level; v_slug text;
BEGIN
  IF p_actor IS NULL THEN RETURN NULL; END IF;
  IF p_lock THEN
    SELECT a.access_level, c.slug INTO v_level, v_slug
    FROM public.administrative_access a LEFT JOIN public.committees c ON c.id = a.committee_id
    WHERE a.user_id = p_actor AND a.revoked_at IS NULL
    FOR SHARE OF a;
  ELSE
    SELECT a.access_level, c.slug INTO v_level, v_slug
    FROM public.administrative_access a LEFT JOIN public.committees c ON c.id = a.committee_id
    WHERE a.user_id = p_actor AND a.revoked_at IS NULL;
  END IF;
  IF v_level IN ('BOARD_ADMIN', 'TECHNICAL') THEN RETURN 'senior'; END IF;
  IF v_level = 'COMMITTEE_MANAGER' AND v_slug = 'society-affairs' THEN RETURN 'society_affairs'; END IF;
  RETURN NULL;
END;
$$;

-- The reviewer's own Auth email: nobody reviews their own application.
CREATE FUNCTION private.membership_actor_email(p_actor uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT lower(email) FROM private.access_auth_users WHERE id = p_actor;
$$;

-- ---------------------------------------------------------------------------------------------
-- Public: submission (anonymous) and the applicant's own status (by token).
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION private.submit_membership_application(
  p_full_name text, p_email text, p_university_id text, p_academic_year integer,
  p_discipline text, p_interests text[], p_consent_version text, p_status_token_hash text,
  p_media_type text, p_sha256 text, p_content bytea, p_ip inet
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_name text := btrim(coalesce(p_full_name, ''));
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_university_id text := btrim(coalesce(p_university_id, ''));
  v_interests text[] := coalesce(p_interests, '{}');
  v_size integer := coalesce(octet_length(p_content), 0);
  v_recent integer;
  v_id uuid;
BEGIN
  IF p_ip IS NULL THEN RETURN jsonb_build_object('code', 'INVALID_IP'); END IF;
  IF char_length(v_name) NOT BETWEEN 1 AND 200 OR v_name ~ '[[:cntrl:]]' THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'fullName');
  END IF;
  IF char_length(v_email) > 254 OR v_email !~ '^[^[:space:]@]+@([a-z0-9-]+\.)*squ\.edu\.om$' THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'email');
  END IF;
  IF v_university_id !~ '^[0-9]{6,10}$' THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'universityId');
  END IF;
  IF p_academic_year IS NULL OR p_academic_year NOT BETWEEN 1 AND 5 THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'academicYear');
  END IF;
  IF p_discipline IS NULL OR p_discipline NOT IN
      ('mechanical', 'electrical', 'civil', 'petroleum', 'chemical', 'mechatronics', 'industrial') THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'discipline');
  END IF;
  IF cardinality(v_interests) > 4 OR array_position(v_interests, NULL) IS NOT NULL
      OR NOT (v_interests <@ ARRAY['cad', 'simulation', 'embedded', 'robotics', 'structures',
        'process', 'data', 'programming', 'power', 'reservoir', 'quality', 'management',
        'sustainability', 'hse'])
      OR (SELECT count(DISTINCT x) FROM unnest(v_interests) x) <> cardinality(v_interests) THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'interests');
  END IF;
  IF p_consent_version IS NULL OR p_consent_version NOT IN ('2026-10-v1') THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'consent');
  END IF;
  IF p_status_token_hash IS NULL OR p_status_token_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'statusToken');
  END IF;
  IF p_media_type IS NULL OR p_media_type NOT IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')
      OR v_size NOT BETWEEN 1 AND 4194304 OR p_sha256 IS NULL
      OR p_sha256 <> encode(sha256(p_content), 'hex') THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'idDocument');
  END IF;

  -- Rate limit per client address: five submissions an hour. The attempt is recorded even when it
  -- is refused, and attempts older than a day are discarded.
  DELETE FROM private.membership_submission_attempts WHERE created_at < clock_timestamp() - interval '1 day';
  INSERT INTO private.membership_submission_attempts (ip_address) VALUES (p_ip);
  SELECT count(*) INTO v_recent FROM private.membership_submission_attempts
  WHERE ip_address = p_ip AND created_at > clock_timestamp() - interval '1 hour';
  IF v_recent > 5 THEN RETURN jsonb_build_object('code', 'RATE_LIMITED'); END IF;

  -- UC-01: the same email or student ID is the same person, not a new one.
  IF EXISTS (SELECT 1 FROM public.members
      WHERE lower(email) = v_email OR university_id = v_university_id) THEN
    RETURN jsonb_build_object('code', 'ALREADY_MEMBER');
  END IF;
  IF EXISTS (SELECT 1 FROM private.membership_applications
      WHERE status IN ('pending_review', 'verified', 'approved')
        AND (email = v_email OR university_id = v_university_id)) THEN
    RETURN jsonb_build_object('code', 'ALREADY_APPLIED');
  END IF;

  BEGIN
    INSERT INTO private.membership_applications
      (full_name, email, university_id, academic_year, discipline, interests,
       consent_version, status_token_hash)
    VALUES (v_name, v_email, v_university_id, p_academic_year, p_discipline, v_interests,
       p_consent_version, p_status_token_hash)
    RETURNING id INTO v_id;
    INSERT INTO private.membership_documents (application_id, media_type, byte_size, sha256, content)
    VALUES (v_id, p_media_type, v_size, p_sha256, p_content);
  EXCEPTION WHEN unique_violation THEN
    -- A concurrent duplicate lost the race on the partial unique indexes.
    RETURN jsonb_build_object('code', 'ALREADY_APPLIED');
  END;

  INSERT INTO private.uc02_audit (committee_id, actor_kind, action, changes)
  VALUES (NULL, 'anonymous', 'membership.submitted', jsonb_build_object('applicationId', v_id));
  RETURN jsonb_build_object('code', 'SUCCESS', 'applicationId', v_id);
END;
$$;

CREATE FUNCTION private.get_membership_application_status(p_status_token_hash text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_app private.membership_applications%ROWTYPE;
BEGIN
  IF p_status_token_hash IS NULL OR p_status_token_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('code', 'NOT_FOUND');
  END IF;
  SELECT * INTO v_app FROM private.membership_applications WHERE status_token_hash = p_status_token_hash;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  -- Verification is an internal stage: to the applicant it is still "under review".
  RETURN jsonb_build_object('code', 'SUCCESS',
    'status', CASE WHEN v_app.status = 'verified' THEN 'pending_review' ELSE v_app.status::text END,
    'submittedAt', v_app.submitted_at, 'decidedAt', v_app.decided_at,
    'activated', v_app.activated_at IS NOT NULL);
END;
$$;

-- ---------------------------------------------------------------------------------------------
-- Dashboard reads.
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION private.can_review_membership(p_actor uuid)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT private.membership_reviewer_kind(p_actor, false) IS NOT NULL;
$$;

CREATE FUNCTION private.get_membership_review_overview(p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_kind text := private.membership_reviewer_kind(p_actor, false); v_counts jsonb;
BEGIN
  IF v_kind IS NULL THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  SELECT jsonb_build_object(
      'pending_review', count(*) FILTER (WHERE status = 'pending_review'),
      'verified', count(*) FILTER (WHERE status = 'verified'),
      'approved', count(*) FILTER (WHERE status = 'approved'),
      'rejected', count(*) FILTER (WHERE status = 'rejected'),
      'activationPending', count(*) FILTER (WHERE status = 'approved' AND activated_at IS NULL))
    INTO v_counts FROM private.membership_applications;
  RETURN jsonb_build_object('code', 'SUCCESS', 'reviewer', v_kind,
    'policy', (SELECT approval_policy FROM private.membership_settings), 'counts', v_counts);
END;
$$;

CREATE FUNCTION private.list_membership_applications(
  p_actor uuid, p_status text, p_query text, p_cursor_submitted_at timestamptz,
  p_cursor_id uuid, p_limit integer
) RETURNS TABLE (
  id uuid, full_name text, email text, university_id text, academic_year smallint,
  discipline text, status text, submitted_at timestamptz, decided_at timestamptz,
  activated boolean, has_document boolean,
  -- The exact (microsecond) position for the next page. JavaScript dates keep milliseconds
  -- only, and a truncated cursor would repeat the boundary row.
  cursor_at text
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_query text := NULLIF(btrim(coalesce(p_query, '')), '');
BEGIN
  IF private.membership_reviewer_kind(p_actor, false) IS NULL
      OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 101
      OR p_status IS NULL OR p_status NOT IN ('all', 'pending_review', 'verified', 'approved', 'rejected')
      OR (v_query IS NOT NULL AND char_length(v_query) > 100)
      OR ((p_cursor_submitted_at IS NULL) <> (p_cursor_id IS NULL)) THEN
    RETURN;
  END IF;
  -- Escape LIKE wildcards so a search is always a literal substring.
  v_query := replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_');
  RETURN QUERY
  SELECT a.id, a.full_name, a.email, a.university_id, a.academic_year, a.discipline,
    a.status::text, a.submitted_at, a.decided_at, a.activated_at IS NOT NULL,
    EXISTS (SELECT 1 FROM private.membership_documents d WHERE d.application_id = a.id),
    to_char(a.submitted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  FROM private.membership_applications a
  WHERE (p_status = 'all' OR a.status::text = p_status)
    AND (v_query IS NULL OR a.full_name ILIKE '%' || v_query || '%' ESCAPE '\'
      OR a.email ILIKE '%' || v_query || '%' ESCAPE '\'
      OR a.university_id LIKE '%' || v_query || '%' ESCAPE '\')
    AND (p_cursor_id IS NULL OR (a.submitted_at, a.id) > (p_cursor_submitted_at, p_cursor_id))
  ORDER BY a.submitted_at, a.id
  LIMIT p_limit;
END;
$$;

CREATE FUNCTION private.get_membership_application(p_actor uuid, p_application_id uuid)
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
      'decisionNote', v_app.decision_note, 'memberId', v_app.member_id,
      'activatedAt', v_app.activated_at, 'documentDeletedAt', v_app.document_deleted_at,
      'revision', v_app.revision, 'document', v_document));
END;
$$;

CREATE FUNCTION private.list_membership_application_history(p_actor uuid, p_application_id uuid)
RETURNS TABLE (occurred_at timestamptz, action text, actor_kind text, actor_email text, changes jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF private.membership_reviewer_kind(p_actor, false) IS NULL OR p_application_id IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT a.occurred_at, a.action, a.actor_kind, private.membership_actor_email(a.actor_user_id), a.changes
  FROM private.uc02_audit a
  WHERE a.action LIKE 'membership.%' AND a.changes ->> 'applicationId' = p_application_id::text
  ORDER BY a.occurred_at, a.id;
END;
$$;

-- Returns the document only to a current reviewer who is not the applicant, and records the view.
CREATE FUNCTION private.get_membership_document(p_actor uuid, p_application_id uuid)
RETURNS TABLE (media_type text, byte_size integer, sha256 text, content bytea)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_kind text := private.membership_reviewer_kind(p_actor, false); v_email text;
BEGIN
  IF v_kind IS NULL OR p_application_id IS NULL THEN RETURN; END IF;
  SELECT a.email INTO v_email FROM private.membership_applications a WHERE a.id = p_application_id;
  IF NOT FOUND OR v_email = private.membership_actor_email(p_actor) THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM private.membership_documents d WHERE d.application_id = p_application_id) THEN
    RETURN;
  END IF;
  INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
  VALUES (NULL, 'authenticated', p_actor, 'membership.document_viewed',
    jsonb_build_object('applicationId', p_application_id));
  RETURN QUERY SELECT d.media_type, d.byte_size, d.sha256, d.content
  FROM private.membership_documents d WHERE d.application_id = p_application_id;
END;
$$;

-- ---------------------------------------------------------------------------------------------
-- Review decisions. One routine, one lock order: reviewer access row, then the application row.
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION private.review_membership_application(
  p_actor uuid, p_application_id uuid, p_revision integer, p_decision text, p_note text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_kind text;
  v_app private.membership_applications%ROWTYPE;
  v_policy text;
  v_note text := NULLIF(btrim(coalesce(p_note, '')), '');
  v_next private.membership_application_status;
  v_had_document boolean;
BEGIN
  IF p_application_id IS NULL OR p_revision IS NULL OR p_decision IS NULL
      OR p_decision NOT IN ('verify', 'approve', 'reject')
      -- Line breaks (LF, and the CR browsers add to textarea submissions) are allowed; other
      -- control characters are not.
      OR (v_note IS NOT NULL AND (char_length(v_note) > 500 OR v_note ~ '[\x01-\x09\x0b\x0c\x0e-\x1f\x7f]')) THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR');
  END IF;
  v_kind := private.membership_reviewer_kind(p_actor, true);
  IF v_kind IS NULL THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;

  SELECT * INTO v_app FROM private.membership_applications WHERE id = p_application_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  IF v_app.revision <> p_revision THEN RETURN jsonb_build_object('code', 'STALE_REVISION'); END IF;
  IF v_app.email = private.membership_actor_email(p_actor) THEN
    RETURN jsonb_build_object('code', 'SELF_REVIEW');
  END IF;

  IF p_decision = 'verify' THEN
    IF v_app.status <> 'pending_review' THEN RETURN jsonb_build_object('code', 'INVALID_TRANSITION'); END IF;
    v_next := 'verified';
    UPDATE private.membership_applications
    SET status = v_next, verified_by = p_actor, verified_at = now(), revision = revision + 1
    WHERE id = v_app.id;
    INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
    VALUES (NULL, 'authenticated', p_actor, 'membership.verified', jsonb_build_object(
      'applicationId', v_app.id, 'previous', v_app.status::text, 'next', v_next::text, 'reviewer', v_kind));
    RETURN jsonb_build_object('code', 'SUCCESS', 'status', v_next::text, 'revision', v_app.revision + 1);
  END IF;

  IF v_app.status NOT IN ('pending_review', 'verified') THEN
    RETURN jsonb_build_object('code', 'INVALID_TRANSITION');
  END IF;

  IF p_decision = 'approve' THEN
    SELECT approval_policy INTO v_policy FROM private.membership_settings;
    IF v_policy IS NULL THEN RETURN jsonb_build_object('code', 'POLICY_NOT_CONFIRMED'); END IF;
    IF v_policy = 'two_step' THEN
      IF v_app.status <> 'verified' THEN RETURN jsonb_build_object('code', 'VERIFICATION_REQUIRED'); END IF;
      IF v_kind <> 'senior' THEN RETURN jsonb_build_object('code', 'SENIOR_APPROVAL_REQUIRED'); END IF;
      IF v_app.verified_by = p_actor THEN RETURN jsonb_build_object('code', 'SECOND_REVIEWER_REQUIRED'); END IF;
    END IF;
    v_next := 'approved';
  ELSE
    v_next := 'rejected';
  END IF;

  DELETE FROM private.membership_documents WHERE application_id = v_app.id;
  v_had_document := FOUND;
  UPDATE private.membership_applications
  SET status = v_next, decided_by = p_actor, decided_at = now(), decision_note = v_note,
      document_deleted_at = CASE WHEN v_had_document THEN now() ELSE document_deleted_at END,
      revision = revision + 1
  WHERE id = v_app.id;
  INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
  VALUES (NULL, 'authenticated', p_actor,
    CASE WHEN v_next = 'approved' THEN 'membership.approved' ELSE 'membership.rejected' END,
    jsonb_build_object('applicationId', v_app.id, 'previous', v_app.status::text, 'next', v_next::text,
      'reviewer', v_kind, 'policy', v_policy, 'documentDeleted', v_had_document,
      'hasNote', v_note IS NOT NULL));
  RETURN jsonb_build_object('code', 'SUCCESS', 'status', v_next::text, 'revision', v_app.revision + 1);
END;
$$;

-- Activation: after approval, link the Auth identity for the application's email and write the
-- permanent member record. It grants no administrative access. NEEDS_INVITATION tells the server to
-- send the standard Supabase invitation and call again; the email is never taken from a caller.
CREATE FUNCTION private.activate_membership(p_actor uuid, p_application_id uuid, p_invitation text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_kind text;
  v_app private.membership_applications%ROWTYPE;
  v_policy text;
  v_users uuid[];
  v_user uuid;
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

  IF EXISTS (SELECT 1 FROM public.members WHERE id = v_user) THEN
    -- Already a member under this identity (for example after an earlier application).
    NULL;
  ELSIF EXISTS (SELECT 1 FROM public.members
      WHERE lower(email) = v_app.email OR university_id = v_app.university_id) THEN
    RETURN jsonb_build_object('code', 'CONFLICT');
  ELSE
    INSERT INTO public.members (id, full_name, email, university_id, year, major, status)
    VALUES (v_user, v_app.full_name, v_app.email, v_app.university_id, v_app.academic_year,
      v_app.discipline, 'member');
  END IF;

  UPDATE private.membership_applications
  SET member_id = v_user, activated_at = now(), revision = revision + 1
  WHERE id = v_app.id;
  INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
  VALUES (NULL, 'authenticated', p_actor, 'membership.activated', jsonb_build_object(
    'applicationId', v_app.id, 'memberId', v_user, 'invitation', p_invitation, 'reviewer', v_kind));
  RETURN jsonb_build_object('code', 'SUCCESS', 'memberId', v_user);
END;
$$;

-- Records the owner's approval-policy decision. Technical only; 'unset' disables approval again.
CREATE FUNCTION private.set_membership_approval_policy(p_actor uuid, p_policy text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_previous text; v_next text;
BEGIN
  IF p_policy IS NULL OR p_policy NOT IN ('two_step', 'single_step', 'unset') THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR');
  END IF;
  PERFORM 1 FROM public.administrative_access
  WHERE user_id = p_actor AND revoked_at IS NULL AND access_level = 'TECHNICAL' FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  v_next := NULLIF(p_policy, 'unset');
  SELECT approval_policy INTO v_previous FROM private.membership_settings FOR UPDATE;
  IF v_previous IS NOT DISTINCT FROM v_next THEN RETURN jsonb_build_object('code', 'SUCCESS', 'policy', v_next); END IF;
  UPDATE private.membership_settings SET approval_policy = v_next, updated_by = p_actor, updated_at = now();
  INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
  VALUES (NULL, 'authenticated', p_actor, 'membership.policy_changed',
    jsonb_build_object('previous', v_previous, 'next', v_next));
  RETURN jsonb_build_object('code', 'SUCCESS', 'policy', v_next);
END;
$$;

-- ---------------------------------------------------------------------------------------------
-- Ownership and execution grants.
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'private.membership_reviewer_kind(uuid, boolean)',
    'private.membership_actor_email(uuid)',
    'private.submit_membership_application(text, text, text, integer, text, text[], text, text, text, text, bytea, inet)',
    'private.get_membership_application_status(text)',
    'private.can_review_membership(uuid)',
    'private.get_membership_review_overview(uuid)',
    'private.list_membership_applications(uuid, text, text, timestamptz, uuid, integer)',
    'private.get_membership_application(uuid, uuid)',
    'private.list_membership_application_history(uuid, uuid)',
    'private.get_membership_document(uuid, uuid)',
    'private.review_membership_application(uuid, uuid, integer, text, text)',
    'private.activate_membership(uuid, uuid, text)',
    'private.set_membership_approval_policy(uuid, text)'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO uc02_routine_owner', v_fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', v_fn);
  END LOOP;
  -- Internal helpers stay unexecutable by every login role; the rest are the runtime surface.
  FOREACH v_fn IN ARRAY ARRAY[
    'private.submit_membership_application(text, text, text, integer, text, text[], text, text, text, text, bytea, inet)',
    'private.get_membership_application_status(text)',
    'private.can_review_membership(uuid)',
    'private.get_membership_review_overview(uuid)',
    'private.list_membership_applications(uuid, text, text, timestamptz, uuid, integer)',
    'private.get_membership_application(uuid, uuid)',
    'private.list_membership_application_history(uuid, uuid)',
    'private.get_membership_document(uuid, uuid)',
    'private.review_membership_application(uuid, uuid, integer, text, text)',
    'private.activate_membership(uuid, uuid, text)',
    'private.set_membership_approval_policy(uuid, text)'
  ] LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO app_runtime', v_fn);
  END LOOP;
END;
$$;

-- The migration proves its own boundary; any failure rolls the whole migration back.
DO $$
DECLARE v_count integer; v_table text;
BEGIN
  SELECT count(*) INTO v_count FROM information_schema.role_table_grants
  WHERE grantee IN ('app_runtime', 'app_maintenance', 'anon', 'authenticated')
    AND table_schema = 'private' AND table_name LIKE 'membership%';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'no login or browser role may hold privileges on membership tables, found %', v_count;
  END IF;
  FOREACH v_table IN ARRAY ARRAY['membership_applications', 'membership_documents',
      'membership_submission_attempts', 'membership_settings'] LOOP
    IF NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class
        WHERE oid = format('private.%I', v_table)::regclass) THEN
      RAISE EXCEPTION 'private.% must have forced row level security', v_table;
    END IF;
  END LOOP;
  IF NOT has_function_privilege('app_runtime',
      'private.review_membership_application(uuid, uuid, integer, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'app_runtime must be able to execute the review routine';
  END IF;
  IF has_function_privilege('app_runtime', 'private.membership_reviewer_kind(uuid, boolean)', 'EXECUTE')
      OR has_function_privilege('anon', 'private.submit_membership_application(text, text, text, integer, text, text[], text, text, text, text, bytea, inet)', 'EXECUTE')
      OR has_function_privilege('authenticated', 'private.get_membership_document(uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'an internal or browser-facing role can execute a membership routine it must not';
  END IF;
END;
$$;
