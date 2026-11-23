-- ADR 0025 (Development Cycle 2). Forward-only; apply after 0032, with approval.
--
-- Additive: reference tables for membership categories and institutions, nullable student fields,
-- SQU student verification, committee teams, organizational positions, leadership requests and
-- appointments, and one settings row. Existing rows keep their values: legacy SQU records gain a
-- category (see the backfill below), and no member is marked SQU-verified. The 0025/0026
-- submission routines stay unchanged so the previous Core keeps working until the new one is
-- deployed. Every new table is private, owned by uc02_routine_owner, under forced RLS, and
-- reachable only through the routines below.

CREATE OR REPLACE FUNCTION private.core_schema_version() RETURNS integer
LANGUAGE sql IMMUTABLE AS $$ SELECT 33 $$;

-- =============================================================================================
-- Reference data: membership categories and institutions
-- =============================================================================================

-- The category row decides which details apply: an institution (required, optional or none) and
-- the academic year. Routines read it; the website renders its form from it.
CREATE TABLE private.membership_categories (
  id text PRIMARY KEY CHECK (id ~ '^[a-z][a-z_]{1,39}$'),
  label_en text NOT NULL CHECK (char_length(label_en) BETWEEN 1 AND 80),
  label_ar text NOT NULL CHECK (char_length(label_ar) BETWEEN 1 AND 80),
  institution_mode text NOT NULL CHECK (institution_mode IN ('required', 'optional', 'none')),
  academic_year_required boolean NOT NULL DEFAULT false,
  sort_order smallint NOT NULL,
  active boolean NOT NULL DEFAULT true
);
INSERT INTO private.membership_categories
  (id, label_en, label_ar, institution_mode, academic_year_required, sort_order) VALUES
  ('university_student', 'University Student', 'طالب جامعي', 'required', true, 1),
  ('graduate', 'Graduate / Alumni', 'خرّيج', 'optional', false, 2),
  ('academic', 'Academic / Researcher', 'أكاديمي / باحث', 'none', false, 3),
  ('industry_professional', 'Industry Professional', 'مهني في القطاع الصناعي', 'none', false, 4),
  ('other', 'Other', 'أخرى', 'none', false, 5);

-- Listed institutions. "Other university" is not a row: the applicant types the name instead.
CREATE TABLE private.institutions (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 2 AND 40 AND id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name_en text NOT NULL CHECK (char_length(name_en) BETWEEN 2 AND 120),
  name_ar text NOT NULL CHECK (char_length(name_ar) BETWEEN 2 AND 120),
  country_code text NOT NULL DEFAULT 'OM' CHECK (country_code ~ '^[A-Z]{2}$'),
  sort_order smallint NOT NULL,
  active boolean NOT NULL DEFAULT true
);
INSERT INTO private.institutions (id, name_en, name_ar, sort_order) VALUES
  ('squ', 'Sultan Qaboos University (SQU)', 'جامعة السلطان قابوس', 1),
  ('utas', 'University of Technology and Applied Sciences (UTAS)', 'جامعة التقنية والعلوم التطبيقية', 2),
  ('unizwa', 'University of Nizwa', 'جامعة نزوى', 3),
  ('gutech', 'German University of Technology in Oman (GUtech)', 'الجامعة الألمانية للتكنولوجيا في عُمان', 4),
  ('sohar-university', 'Sohar University', 'جامعة صحار', 5),
  ('dhofar-university', 'Dhofar University', 'جامعة ظفار', 6),
  ('asharqiyah-university', 'A''Sharqiyah University', 'جامعة الشرقية', 7),
  ('university-of-buraimi', 'University of Buraimi', 'جامعة البريمي', 8),
  ('national-university', 'National University of Science and Technology', 'الجامعة الوطنية للعلوم والتكنولوجيا', 9),
  ('middle-east-college', 'Middle East College', 'كلية الشرق الأوسط', 10),
  ('muscat-university', 'Muscat University', 'جامعة مسقط', 11);

-- =============================================================================================
-- Membership details on applications and members
-- =============================================================================================

-- A record holds a listed institution or a typed name, never both. The student ID and academic
-- year become optional: new applications do not collect a student ID, and only students give a year.
ALTER TABLE private.membership_applications
  ADD COLUMN category text REFERENCES private.membership_categories (id),
  ADD COLUMN institution_id text REFERENCES private.institutions (id),
  ADD COLUMN institution_name text CHECK (institution_name IS NULL OR (institution_name = btrim(institution_name)
    AND char_length(institution_name) BETWEEN 2 AND 120 AND institution_name !~ '[[:cntrl:]]')),
  ALTER COLUMN university_id DROP NOT NULL,
  ALTER COLUMN academic_year DROP NOT NULL;
ALTER TABLE private.membership_applications
  ADD CONSTRAINT membership_institution_choice CHECK (institution_id IS NULL OR institution_name IS NULL);
-- Any valid address, personal or institutional (the SQU-only rule of 0025 is lifted).
ALTER TABLE private.membership_applications DROP CONSTRAINT membership_email_shape;
ALTER TABLE private.membership_applications ADD CONSTRAINT membership_email_shape CHECK (
  email = lower(btrim(email)) AND char_length(email) <= 254
  AND email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$');

ALTER TABLE public.members
  ADD COLUMN category text REFERENCES private.membership_categories (id),
  ADD COLUMN institution_id text REFERENCES private.institutions (id),
  ADD COLUMN institution_name text CHECK (institution_name IS NULL OR (institution_name = btrim(institution_name)
    AND char_length(institution_name) BETWEEN 2 AND 120 AND institution_name !~ '[[:cntrl:]]')),
  ALTER COLUMN university_id DROP NOT NULL;
ALTER TABLE public.members
  ADD CONSTRAINT members_institution_choice CHECK (institution_id IS NULL OR institution_name IS NULL);
GRANT UPDATE (category, institution_id, institution_name) ON public.members TO uc02_routine_owner;

-- =============================================================================================
-- SQU student verification
-- =============================================================================================

-- Every submission and its decision. History is never rewritten: a rejected or revoked
-- verification is followed by a new request, not an edited one.
CREATE TABLE private.squ_verification_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.members (id),
  student_number text NOT NULL CHECK (student_number ~ '^[0-9]{6,10}$'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  submitted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  decided_by uuid REFERENCES auth.users (id),
  decided_at timestamptz,
  -- Shown to the member.
  rejection_reason text CHECK (rejection_reason IS NULL OR (char_length(rejection_reason) BETWEEN 1 AND 500
    AND rejection_reason !~ '[\x01-\x09\x0b\x0c\x0e-\x1f\x7f]')),
  -- Reviewers only; never returned to the member.
  reviewer_note text CHECK (reviewer_note IS NULL OR (char_length(reviewer_note) BETWEEN 1 AND 1000
    AND reviewer_note !~ '[\x01-\x09\x0b\x0c\x0e-\x1f\x7f]')),
  document_deleted_at timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  CHECK ((status = 'pending') = (decided_at IS NULL)),
  CHECK ((decided_at IS NULL) = (decided_by IS NULL)),
  CHECK ((status = 'rejected') = (rejection_reason IS NOT NULL))
);
CREATE UNIQUE INDEX squ_verification_requests_one_pending
  ON private.squ_verification_requests (member_id) WHERE status = 'pending';
CREATE INDEX squ_verification_requests_member_idx
  ON private.squ_verification_requests (member_id, submitted_at DESC, id);
CREATE INDEX squ_verification_requests_queue_idx
  ON private.squ_verification_requests (status, submitted_at, id);

-- The evidence, kept after the decision (ADR 0025); removed only by the retention cleanup, member
-- deletion or erasure. Bytes in PostgreSQL or a Storage reference, never both (as in 0026).
CREATE TABLE private.squ_verification_documents (
  request_id uuid PRIMARY KEY REFERENCES private.squ_verification_requests (id) ON DELETE CASCADE,
  media_type text NOT NULL CHECK (media_type IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 4194304),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  content bytea,
  storage_bucket text CHECK (storage_bucket IS NULL OR storage_bucket ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$'),
  storage_key text CHECK (storage_key IS NULL OR storage_key ~
    '^squ-verification/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp|pdf)$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((content IS NOT NULL AND storage_bucket IS NULL AND storage_key IS NULL)
    OR (content IS NULL AND storage_bucket IS NOT NULL AND storage_key IS NOT NULL)),
  CHECK (content IS NULL OR octet_length(content) = byte_size),
  CHECK (storage_key IS NULL OR storage_key LIKE ('%.' || (CASE media_type
    WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/png' THEN 'png'
    WHEN 'image/webp' THEN 'webp' WHEN 'application/pdf' THEN 'pdf' END)))
);
CREATE UNIQUE INDEX squ_verification_documents_object_unique
  ON private.squ_verification_documents (storage_bucket, storage_key) WHERE storage_key IS NOT NULL;
-- 0026's trigger function only reads OLD.storage_bucket and OLD.storage_key, so it queues these
-- objects too, in the same transaction as the deletion.
CREATE TRIGGER squ_verification_document_removed
  AFTER DELETE ON private.squ_verification_documents
  FOR EACH ROW EXECUTE FUNCTION private.queue_removed_membership_document();

-- A confirmed verification. Revocation marks the row; it is never deleted while the member exists.
CREATE TABLE private.squ_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.members (id),
  request_id uuid NOT NULL UNIQUE REFERENCES private.squ_verification_requests (id),
  student_number text NOT NULL CHECK (student_number ~ '^[0-9]{6,10}$'),
  verified_by uuid NOT NULL REFERENCES auth.users (id),
  verified_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES auth.users (id),
  revocation_reason text CHECK (revocation_reason IS NULL OR (char_length(revocation_reason) BETWEEN 1 AND 500
    AND revocation_reason !~ '[\x01-\x09\x0b\x0c\x0e-\x1f\x7f]')),
  revocation_note text CHECK (revocation_note IS NULL OR (char_length(revocation_note) BETWEEN 1 AND 1000
    AND revocation_note !~ '[\x01-\x09\x0b\x0c\x0e-\x1f\x7f]')),
  CHECK ((revoked_at IS NULL) = (revoked_by IS NULL)),
  CHECK ((revoked_at IS NULL) = (revocation_reason IS NULL)),
  CHECK (revoked_at IS NOT NULL OR revocation_note IS NULL)
);
CREATE UNIQUE INDEX squ_verifications_active_member
  ON private.squ_verifications (member_id) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX squ_verifications_active_student_number
  ON private.squ_verifications (student_number) WHERE revoked_at IS NULL;

-- =============================================================================================
-- Committees → teams → positions → appointments
-- =============================================================================================

CREATE TABLE private.committee_teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  committee_id uuid NOT NULL REFERENCES public.committees (id),
  name_en text NOT NULL CHECK (name_en = btrim(name_en) AND char_length(name_en) BETWEEN 2 AND 80
    AND name_en !~ '[[:cntrl:]]'),
  name_ar text CHECK (name_ar IS NULL OR (name_ar = btrim(name_ar) AND char_length(name_ar) BETWEEN 2 AND 80
    AND name_ar !~ '[[:cntrl:]]')),
  description_en text CHECK (description_en IS NULL OR (char_length(description_en) <= 1000
    AND description_en !~ '[\x01-\x09\x0b\x0c\x0e-\x1f\x7f]')),
  description_ar text CHECK (description_ar IS NULL OR (char_length(description_ar) <= 1000
    AND description_ar !~ '[\x01-\x09\x0b\x0c\x0e-\x1f\x7f]')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz,
  archived_at timestamptz,
  CHECK ((status = 'archived') = (archived_at IS NOT NULL))
);
-- Team names are unique within a committee among teams still in use.
CREATE UNIQUE INDEX committee_teams_name_unique
  ON private.committee_teams (committee_id, lower(name_en)) WHERE status <> 'archived';
CREATE INDEX committee_teams_committee_idx ON private.committee_teams (committee_id, status);

-- Positions are data, so a later "member" position is one row. NULL max holders means no limit.
CREATE TABLE private.organizational_positions (
  id text PRIMARY KEY CHECK (id ~ '^[a-z][a-z_]{1,39}$'),
  label_en text NOT NULL CHECK (char_length(label_en) BETWEEN 1 AND 80),
  label_ar text NOT NULL CHECK (char_length(label_ar) BETWEEN 1 AND 80),
  rank smallint NOT NULL,
  max_holders_per_team smallint CHECK (max_holders_per_team IS NULL OR max_holders_per_team BETWEEN 1 AND 50),
  requestable boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true
);
-- One active Chief and one active Assistant Chief per team (ADR 0025, policy review 2026-11-19).
INSERT INTO private.organizational_positions (id, label_en, label_ar, rank, max_holders_per_team) VALUES
  ('chief', 'Chief', 'رئيس', 1, 1),
  ('assistant_chief', 'Assistant Chief', 'مساعد الرئيس', 2, 1);

-- An appointment. Ending it (revocation) marks the row; changes of position are audited.
CREATE TABLE private.leadership_appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.members (id),
  team_id uuid NOT NULL REFERENCES private.committee_teams (id),
  position_id text NOT NULL REFERENCES private.organizational_positions (id),
  source text NOT NULL CHECK (source IN ('request', 'direct')),
  appointed_by uuid NOT NULL REFERENCES auth.users (id),
  appointed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  appointment_note text CHECK (appointment_note IS NULL OR (char_length(appointment_note) BETWEEN 1 AND 1000
    AND appointment_note !~ '[\x01-\x09\x0b\x0c\x0e-\x1f\x7f]')),
  updated_by uuid REFERENCES auth.users (id),
  updated_at timestamptz,
  ended_by uuid REFERENCES auth.users (id),
  ended_at timestamptz,
  -- Shown to the member.
  end_reason text CHECK (end_reason IS NULL OR (char_length(end_reason) BETWEEN 1 AND 500
    AND end_reason !~ '[\x01-\x09\x0b\x0c\x0e-\x1f\x7f]')),
  end_note text CHECK (end_note IS NULL OR (char_length(end_note) BETWEEN 1 AND 1000
    AND end_note !~ '[\x01-\x09\x0b\x0c\x0e-\x1f\x7f]')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  CHECK ((ended_at IS NULL) = (ended_by IS NULL)),
  CHECK ((ended_at IS NULL) = (end_reason IS NULL)),
  CHECK (ended_at IS NOT NULL OR end_note IS NULL),
  CHECK ((updated_at IS NULL) = (updated_by IS NULL))
);
-- One active position per member in a team.
CREATE UNIQUE INDEX leadership_appointments_one_per_team
  ON private.leadership_appointments (member_id, team_id) WHERE ended_at IS NULL;
CREATE INDEX leadership_appointments_team_idx
  ON private.leadership_appointments (team_id, position_id) WHERE ended_at IS NULL;
CREATE INDEX leadership_appointments_member_idx ON private.leadership_appointments (member_id);

-- A member's request. committee_id records the committee the member chose, so an approval can
-- tell when the team has since moved.
CREATE TABLE private.leadership_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.members (id),
  committee_id uuid NOT NULL REFERENCES public.committees (id),
  team_id uuid NOT NULL REFERENCES private.committee_teams (id),
  position_id text NOT NULL REFERENCES private.organizational_positions (id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  submitted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  decided_by uuid REFERENCES auth.users (id),
  decided_at timestamptz,
  rejection_reason text CHECK (rejection_reason IS NULL OR (char_length(rejection_reason) BETWEEN 1 AND 500
    AND rejection_reason !~ '[\x01-\x09\x0b\x0c\x0e-\x1f\x7f]')),
  -- Why the structure closed the request; shown to the member.
  cancellation_reason text CHECK (cancellation_reason IS NULL
    OR cancellation_reason IN ('team_moved', 'team_inactive', 'team_archived', 'committee_archived')),
  reviewer_note text CHECK (reviewer_note IS NULL OR (char_length(reviewer_note) BETWEEN 1 AND 1000
    AND reviewer_note !~ '[\x01-\x09\x0b\x0c\x0e-\x1f\x7f]')),
  appointment_id uuid REFERENCES private.leadership_appointments (id),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  CHECK ((status = 'pending') = (decided_at IS NULL)),
  CHECK (status NOT IN ('approved', 'rejected') OR decided_by IS NOT NULL),
  CHECK ((status = 'rejected') = (rejection_reason IS NOT NULL)),
  CHECK ((status = 'cancelled') = (cancellation_reason IS NOT NULL)),
  CHECK ((status = 'approved') = (appointment_id IS NOT NULL))
);
-- One open request per member and team; decided requests stay as history.
CREATE UNIQUE INDEX leadership_requests_one_pending
  ON private.leadership_requests (member_id, team_id) WHERE status = 'pending';
CREATE INDEX leadership_requests_queue_idx ON private.leadership_requests (status, submitted_at, id);
CREATE INDEX leadership_requests_member_idx ON private.leadership_requests (member_id, submitted_at DESC);
CREATE INDEX leadership_requests_team_idx ON private.leadership_requests (team_id, status);

-- =============================================================================================
-- Settings: defaults that only Technical changes, through audited routines (ADR 0025)
-- =============================================================================================
CREATE TABLE private.verification_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  squ_submissions_per_30_days smallint NOT NULL DEFAULT 3 CHECK (squ_submissions_per_30_days BETWEEN 1 AND 20),
  -- NULL: no retention period decided, so evidence is kept and the cleanup does nothing.
  document_retention_days integer CHECK (document_retention_days IS NULL
    OR document_retention_days BETWEEN 30 AND 3650),
  leadership_requests_per_30_days smallint NOT NULL DEFAULT 5
    CHECK (leadership_requests_per_30_days BETWEEN 1 AND 50),
  -- NULL (the default): a member may hold appointments in several teams. One position per team
  -- is enforced separately (leadership_appointments_one_per_team). A number caps the total.
  max_active_appointments_per_member smallint CHECK (max_active_appointments_per_member IS NULL
    OR max_active_appointments_per_member BETWEEN 1 AND 20),
  updated_by uuid REFERENCES auth.users (id),
  updated_at timestamptz
);
INSERT INTO private.verification_settings (singleton) VALUES (true);

DO $$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['membership_categories', 'institutions', 'squ_verification_requests',
      'squ_verification_documents', 'squ_verifications', 'committee_teams', 'organizational_positions',
      'leadership_appointments', 'leadership_requests', 'verification_settings'] LOOP
    EXECUTE format('ALTER TABLE private.%I OWNER TO uc02_routine_owner', v_table);
    EXECUTE format('ALTER TABLE private.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('ALTER TABLE private.%I FORCE ROW LEVEL SECURITY', v_table);
    EXECUTE format('REVOKE ALL ON TABLE private.%I FROM PUBLIC, anon, authenticated, service_role, app_runtime, app_maintenance', v_table);
    EXECUTE format('CREATE POLICY routine_owner ON private.%I TO uc02_routine_owner USING (true) WITH CHECK (true)', v_table);
  END LOOP;
END $$;

-- The Storage deletion queue also takes SQU verification evidence.
ALTER TABLE private.membership_storage_deletions DROP CONSTRAINT membership_storage_deletion_key_shape;
ALTER TABLE private.membership_storage_deletions ADD CONSTRAINT membership_storage_deletion_key_shape CHECK (
  storage_key ~ '^membership-id-cards/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp|pdf)$'
  OR storage_key ~ '^squ-verification/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp|pdf)$'
  OR storage_key ~ '^event-covers/[0-9a-f-]{36}\.(jpg|png)$'
  OR storage_key ~ '^project-images/[0-9a-f-]{36}\.(jpg|png)$'
  OR storage_key ~ '^member-photos/[0-9a-f-]{36}\.jpg$');

-- =============================================================================================
-- Audit
-- =============================================================================================
DO $$ DECLARE v_check text; BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_check FROM pg_constraint
    WHERE conrelid = 'private.uc02_audit'::regclass AND conname = 'uc02_audit_action_check';
  EXECUTE 'ALTER TABLE private.uc02_audit DROP CONSTRAINT uc02_audit_action_check';
  EXECUTE 'ALTER TABLE private.uc02_audit ADD CONSTRAINT uc02_audit_action_check CHECK (' ||
    substring(v_check from 8 for char_length(v_check) - 8) ||
    ' OR action IN (''verification.submitted'',''verification.document_viewed'',''verification.approved'',' ||
    '''verification.rejected'',''verification.revoked'',''verification.documents_purged'',' ||
    '''verification.settings_changed'',''leadership.requested'',''leadership.approved'',' ||
    '''leadership.rejected'',''leadership.cancelled'',''appointment.created'',''appointment.updated'',' ||
    '''appointment.revoked'',''team.created'',''team.updated'',''team.moved'',''team.status_changed'',' ||
    '''team.deleted'',''position.limit_changed''))';
END $$;
CREATE INDEX uc02_audit_request_idx ON private.uc02_audit ((changes ->> 'requestId'))
  WHERE action LIKE 'verification.%' OR action LIKE 'leadership.%';
CREATE INDEX uc02_audit_appointment_idx ON private.uc02_audit ((changes ->> 'appointmentId'))
  WHERE action LIKE 'appointment.%' OR action = 'leadership.approved';

-- =============================================================================================
-- Legacy backfill (ADR 0025): every existing record came through the SQU-only form, so SQU
-- addresses are SQU students (or SQU graduates). Nothing else is guessed, and nobody becomes
-- SQU-verified. It runs as the routine owner so forced RLS cannot hide rows from it.
-- =============================================================================================
CREATE FUNCTION private.backfill_0033() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE private.membership_applications SET category = 'university_student', institution_id = 'squ'
  WHERE category IS NULL AND email ~ '@([a-z0-9-]+\.)*squ\.edu\.om$';
  UPDATE public.members
  SET category = CASE WHEN status = 'graduate' THEN 'graduate' ELSE 'university_student' END,
      institution_id = 'squ'
  WHERE category IS NULL AND lower(email) ~ '@([a-z0-9-]+\.)*squ\.edu\.om$';
  IF EXISTS (SELECT 1 FROM private.membership_applications
        WHERE category IS NULL AND email ~ '@([a-z0-9-]+\.)*squ\.edu\.om$')
     OR EXISTS (SELECT 1 FROM public.members
        WHERE category IS NULL AND lower(email) ~ '@([a-z0-9-]+\.)*squ\.edu\.om$') THEN
    RAISE EXCEPTION '0033 backfill left an SQU record without a category';
  END IF;
END $$;
ALTER FUNCTION private.backfill_0033() OWNER TO uc02_routine_owner;
REVOKE ALL ON FUNCTION private.backfill_0033() FROM PUBLIC;
SELECT private.backfill_0033();
DROP FUNCTION private.backfill_0033();

-- =============================================================================================
-- Helpers (internal: no login role executes them)
-- =============================================================================================

-- A member-facing reason or an internal note: NULL, or 1..max characters where line breaks are
-- the only control characters allowed.
CREATE FUNCTION private.note_text_valid(p_value text, p_max integer) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT p_value IS NULL OR (char_length(p_value) BETWEEN 1 AND p_max
    AND p_value !~ '[\x01-\x09\x0b\x0c\x0e-\x1f\x7f]')
$$;

-- The first category-dependent detail that is wrong, or NULL. The category row decides.
CREATE FUNCTION private.membership_details_invalid_field(p_category text, p_institution_id text,
  p_institution_name text, p_academic_year integer) RETURNS text
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE c private.membership_categories%ROWTYPE;
BEGIN
  SELECT * INTO c FROM private.membership_categories WHERE id = p_category AND active;
  IF NOT FOUND THEN RETURN 'category'; END IF;
  IF (p_institution_id IS NOT NULL AND p_institution_name IS NOT NULL)
     OR (c.institution_mode = 'none' AND (p_institution_id IS NOT NULL OR p_institution_name IS NOT NULL))
     OR (c.institution_mode = 'required' AND p_institution_id IS NULL AND p_institution_name IS NULL)
     OR (p_institution_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM private.institutions WHERE id = p_institution_id AND active)) THEN
    RETURN 'institution';
  END IF;
  IF p_institution_name IS NOT NULL AND (p_institution_name <> btrim(p_institution_name)
     OR char_length(p_institution_name) NOT BETWEEN 2 AND 120 OR p_institution_name ~ '[[:cntrl:]]') THEN
    RETURN 'institutionName';
  END IF;
  IF (c.academic_year_required AND (p_academic_year IS NULL OR p_academic_year NOT BETWEEN 1 AND 5))
     OR (NOT c.academic_year_required AND p_academic_year IS NOT NULL) THEN
    RETURN 'academicYear';
  END IF;
  RETURN NULL;
END $$;

-- Category and institution labels for display.
CREATE FUNCTION private.membership_details_json(p_category text, p_institution_id text, p_institution_name text)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object('category', p_category,
    'categoryLabel', (SELECT jsonb_build_object('en', label_en, 'ar', label_ar)
      FROM private.membership_categories WHERE id = p_category),
    'institution', (SELECT jsonb_build_object('id', id, 'en', name_en, 'ar', name_ar)
      FROM private.institutions WHERE id = p_institution_id),
    'institutionName', p_institution_name)
$$;

-- Who reviews SQU verification evidence and decides appointments (ADR 0025, policy review of
-- 2026-11-19): Board Administration ('senior') and Society Affairs committee managers.
-- Technical access alone grants no review authority, unlike 0025's membership_reviewer_kind for
-- applications. The row lock, when asked for, makes a decision wait for a concurrent revocation.
CREATE FUNCTION private.verification_reviewer_kind(p_actor uuid, p_lock boolean) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
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
  IF v_level = 'BOARD_ADMIN' THEN RETURN 'senior'; END IF;
  IF v_level = 'COMMITTEE_MANAGER' AND v_slug = 'society-affairs' THEN RETURN 'society_affairs'; END IF;
  RETURN NULL;
END $$;

-- Leadership requests and appointments are decided by the same reviewers. This is the one place
-- that rule lives.
CREATE FUNCTION private.leadership_reviewer_kind(p_actor uuid, p_lock boolean) RETURNS text
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT private.verification_reviewer_kind(p_actor, p_lock)
$$;

-- Structure changes and appointment decisions take this lock exclusively, member requests share
-- it, so occupancy checks and team moves never interleave. Volumes are small; simplicity wins.
CREATE FUNCTION private.lock_organization(p_exclusive boolean) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = public, pg_temp AS $$
BEGIN
  IF p_exclusive THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('organization-structure', 0));
  ELSE
    PERFORM pg_advisory_xact_lock_shared(hashtextextended('organization-structure', 0));
  END IF;
END $$;

CREATE FUNCTION private.team_json(t private.committee_teams) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object('id', t.id, 'name', jsonb_build_object('en', t.name_en, 'ar', t.name_ar),
    'description', jsonb_build_object('en', t.description_en, 'ar', t.description_ar), 'status', t.status)
$$;

CREATE FUNCTION private.position_json(p_position text) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object('id', id, 'label', jsonb_build_object('en', label_en, 'ar', label_ar))
  FROM private.organizational_positions WHERE id = p_position
$$;

-- Why a member cannot submit SQU evidence now, or NULL.
CREATE FUNCTION private.squ_submission_block(p_member uuid) RETURNS text
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE v_limit integer; v_recent integer;
BEGIN
  IF EXISTS (SELECT 1 FROM private.squ_verifications WHERE member_id = p_member AND revoked_at IS NULL) THEN
    RETURN 'ALREADY_VERIFIED'; END IF;
  IF EXISTS (SELECT 1 FROM private.squ_verification_requests WHERE member_id = p_member AND status = 'pending') THEN
    RETURN 'ALREADY_PENDING'; END IF;
  SELECT squ_submissions_per_30_days INTO v_limit FROM private.verification_settings;
  SELECT count(*) INTO v_recent FROM private.squ_verification_requests
  WHERE member_id = p_member AND submitted_at > clock_timestamp() - interval '30 days';
  IF v_recent >= v_limit THEN RETURN 'RATE_LIMITED'; END IF;
  RETURN NULL;
END $$;

-- The member's own SQU verification state. Never a reviewer note, reviewer or full number.
CREATE FUNCTION private.squ_state(p_member uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE v private.squ_verifications%ROWTYPE; r private.squ_verification_requests%ROWTYPE;
  past private.squ_verifications%ROWTYPE; v_active boolean; v_any boolean; v_status text;
  v_limit integer; v_recent integer; v_oldest timestamptz; v_number text;
BEGIN
  SELECT squ_submissions_per_30_days INTO v_limit FROM private.verification_settings;
  SELECT * INTO v FROM private.squ_verifications WHERE member_id = p_member AND revoked_at IS NULL;
  v_active := FOUND;
  SELECT * INTO r FROM private.squ_verification_requests WHERE member_id = p_member
  ORDER BY submitted_at DESC, id DESC LIMIT 1;
  v_any := FOUND;
  SELECT count(*), min(submitted_at) INTO v_recent, v_oldest FROM private.squ_verification_requests
  WHERE member_id = p_member AND submitted_at > clock_timestamp() - interval '30 days';
  IF v_active THEN v_status := 'verified';
  ELSIF NOT v_any THEN v_status := 'not_verified';
  ELSIF r.status IN ('pending', 'rejected') THEN v_status := r.status;
  ELSE
    SELECT * INTO past FROM private.squ_verifications WHERE request_id = r.id;
    v_status := CASE WHEN past.revoked_at IS NOT NULL THEN 'revoked' ELSE 'not_verified' END;
  END IF;
  v_number := CASE WHEN v_active THEN v.student_number WHEN v_any THEN r.student_number END;
  RETURN jsonb_build_object('status', v_status,
    'studentNumber', CASE WHEN v_number IS NOT NULL THEN '•••' || right(v_number, 3) END,
    'submittedAt', CASE WHEN v_any THEN r.submitted_at END,
    'decidedAt', CASE WHEN v_any THEN r.decided_at END,
    'verifiedAt', CASE WHEN v_active THEN v.verified_at END,
    'rejectionReason', CASE WHEN v_status = 'rejected' THEN r.rejection_reason END,
    'revokedAt', CASE WHEN v_status = 'revoked' THEN past.revoked_at END,
    'revocationReason', CASE WHEN v_status = 'revoked' THEN past.revocation_reason END,
    'submissionsPer30Days', v_limit, 'recentSubmissions', v_recent,
    'canSubmit', v_status IN ('not_verified', 'rejected', 'revoked') AND v_recent < v_limit,
    'nextSubmissionAt', CASE WHEN v_recent >= v_limit THEN v_oldest + interval '30 days' END);
END $$;

-- Writes an appointment when the team, position and member limits allow it. The caller holds the
-- exclusive organization lock and has checked the structure is live.
CREATE FUNCTION private.leadership_appoint(p_member uuid, p_team uuid, p_position text, p_actor uuid,
  p_source text, p_note text) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_max integer; v_member_max integer; v_id uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM private.leadership_appointments
      WHERE member_id = p_member AND team_id = p_team AND ended_at IS NULL) THEN
    RETURN jsonb_build_object('code', 'ALREADY_APPOINTED'); END IF;
  SELECT max_holders_per_team INTO v_max FROM private.organizational_positions WHERE id = p_position;
  IF v_max IS NOT NULL AND (SELECT count(*) FROM private.leadership_appointments
      WHERE team_id = p_team AND position_id = p_position AND ended_at IS NULL) >= v_max THEN
    RETURN jsonb_build_object('code', 'POSITION_FULL'); END IF;
  SELECT max_active_appointments_per_member INTO v_member_max FROM private.verification_settings;
  IF v_member_max IS NOT NULL AND (SELECT count(*) FROM private.leadership_appointments
      WHERE member_id = p_member AND ended_at IS NULL) >= v_member_max THEN
    RETURN jsonb_build_object('code', 'MEMBER_LIMIT_REACHED'); END IF;
  INSERT INTO private.leadership_appointments (member_id, team_id, position_id, source, appointed_by, appointment_note)
  VALUES (p_member, p_team, p_position, p_source, p_actor, p_note) RETURNING id INTO v_id;
  RETURN jsonb_build_object('code', 'SUCCESS', 'appointmentId', v_id);
END $$;

-- Closes a team's pending requests when the structure changes, keeping them as history.
CREATE FUNCTION private.cancel_team_requests(p_team uuid, p_reason text, p_actor uuid) RETURNS integer
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE r record; v_count integer := 0;
BEGIN
  FOR r IN SELECT id, member_id, committee_id FROM private.leadership_requests
      WHERE team_id = p_team AND status = 'pending' FOR UPDATE LOOP
    UPDATE private.leadership_requests SET status = 'cancelled', cancellation_reason = p_reason,
      decided_at = clock_timestamp(), decided_by = p_actor, revision = revision + 1
    WHERE id = r.id;
    INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
    VALUES (r.committee_id, 'authenticated', p_actor, 'leadership.cancelled', jsonb_build_object(
      'requestId', r.id, 'memberId', r.member_id, 'teamId', p_team, 'reason', p_reason));
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $$;

-- =============================================================================================
-- Public: membership options and the expanded application (no document)
-- =============================================================================================
CREATE FUNCTION private.get_membership_options() RETURNS jsonb
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
    'consentVersion', '2026-11-v2')
$$;

-- The 0025 rules, by category instead of SQU only. No student ID, no document. Consent 2026-10-v1
-- is the previous website's wording, accepted during the release.
CREATE FUNCTION private.submit_membership_application_v2(
  p_full_name text, p_email text, p_category text, p_institution_id text, p_institution_name text,
  p_academic_year integer, p_discipline text, p_interests text[], p_consent_version text,
  p_status_token_hash text, p_ip inet
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_name text := btrim(coalesce(p_full_name, ''));
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_institution_name text := nullif(btrim(coalesce(p_institution_name, '')), '');
  v_interests text[] := coalesce(p_interests, '{}');
  v_field text; v_recent integer; v_id uuid;
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

  BEGIN
    INSERT INTO private.membership_applications (full_name, email, university_id, academic_year,
      discipline, interests, consent_version, status_token_hash, category, institution_id, institution_name)
    VALUES (v_name, v_email, NULL, p_academic_year, p_discipline, v_interests, p_consent_version,
      p_status_token_hash, p_category, p_institution_id, v_institution_name)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    -- A concurrent duplicate lost the race on the open-application index.
    RETURN jsonb_build_object('code', 'ALREADY_APPLIED');
  END;
  INSERT INTO private.uc02_audit (committee_id, actor_kind, action, changes)
  VALUES (NULL, 'anonymous', 'membership.submitted',
    jsonb_build_object('applicationId', v_id, 'category', p_category));
  RETURN jsonb_build_object('code', 'SUCCESS', 'applicationId', v_id);
END $$;

-- =============================================================================================
-- Membership review and activation: the same checks, now carrying the category details
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
      'decisionNote', v_app.decision_note, 'memberId', v_app.member_id,
      'activatedAt', v_app.activated_at, 'documentDeletedAt', v_app.document_deleted_at,
      'revision', v_app.revision, 'document', v_document)
      || private.membership_details_json(v_app.category, v_app.institution_id, v_app.institution_name));
END $$;

-- The list gains the category and institution; its result shape changes, so it is recreated.
DROP FUNCTION private.list_membership_applications(uuid, text, text, timestamptz, uuid, integer);
CREATE FUNCTION private.list_membership_applications(
  p_actor uuid, p_status text, p_query text, p_cursor_submitted_at timestamptz,
  p_cursor_id uuid, p_limit integer
) RETURNS TABLE (
  id uuid, full_name text, email text, university_id text, academic_year smallint,
  discipline text, status text, submitted_at timestamptz, decided_at timestamptz,
  activated boolean, has_document boolean, cursor_at text, category text, category_label text,
  institution text
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
  v_query := replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_');
  RETURN QUERY
  SELECT a.id, a.full_name, a.email, a.university_id, a.academic_year, a.discipline,
    a.status::text, a.submitted_at, a.decided_at, a.activated_at IS NOT NULL,
    EXISTS (SELECT 1 FROM private.membership_documents d WHERE d.application_id = a.id),
    to_char(a.submitted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    a.category, k.label_en, coalesce(i.name_en, a.institution_name)
  FROM private.membership_applications a
  LEFT JOIN private.membership_categories k ON k.id = a.category
  LEFT JOIN private.institutions i ON i.id = a.institution_id
  WHERE (p_status = 'all' OR a.status::text = p_status)
    AND (v_query IS NULL OR a.full_name ILIKE '%' || v_query || '%' ESCAPE '\'
      OR a.email ILIKE '%' || v_query || '%' ESCAPE '\'
      OR a.university_id LIKE '%' || v_query || '%' ESCAPE '\')
    AND (p_cursor_id IS NULL OR (a.submitted_at, a.id) > (p_cursor_submitted_at, p_cursor_id))
  ORDER BY a.submitted_at, a.id
  LIMIT p_limit;
END $$;

-- The overview also counts the two new queues.
CREATE OR REPLACE FUNCTION private.get_membership_review_overview(p_actor uuid)
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
  v_counts := v_counts || jsonb_build_object(
    'squPending', (SELECT count(*) FROM private.squ_verification_requests WHERE status = 'pending'),
    'leadershipPending', (SELECT count(*) FROM private.leadership_requests WHERE status = 'pending'));
  -- verificationReviewer: NULL for Technical, who reviews applications but not SQU evidence or
  -- leadership (private.verification_reviewer_kind).
  RETURN jsonb_build_object('code', 'SUCCESS', 'reviewer', v_kind,
    'verificationReviewer', private.verification_reviewer_kind(p_actor, false),
    'policy', (SELECT approval_policy FROM private.membership_settings), 'counts', v_counts);
END $$;

-- 0027's activation, copying the category details into the member record.
CREATE OR REPLACE FUNCTION private.membership_complete_activation(
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
    INSERT INTO public.members (id, full_name, email, university_id, year, major, status,
      category, institution_id, institution_name)
    VALUES (p_user, v_app.full_name, v_app.email, v_app.university_id, v_app.academic_year,
      v_app.discipline, 'member', v_app.category, v_app.institution_id, v_app.institution_name);
  END IF;
  UPDATE private.membership_applications
  SET member_id = p_user, auth_user_id = p_user, activated_at = now(), revision = revision + 1
  WHERE id = v_app.id;
  INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
  VALUES (NULL, 'authenticated', p_actor, 'membership.activated', jsonb_build_object(
    'applicationId', v_app.id, 'memberId', p_user, 'invitation', p_invitation,
    'reviewer', p_completed_by));
  RETURN jsonb_build_object('code', 'SUCCESS', 'memberId', p_user);
END $$;

-- =============================================================================================
-- The member's own profile and roles
-- =============================================================================================

-- 0031's profile, with the category details and the SQU badge. A sign-in email changed through
-- Supabase Auth's confirmation now becomes the member's email whatever its domain.
CREATE OR REPLACE FUNCTION private.get_own_profile(p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_email text; v_confirmed boolean; v_member public.members%ROWTYPE;
  v_app private.membership_applications%ROWTYPE; v_has_app boolean;
BEGIN
  SELECT lower(email), email_confirmed_at IS NOT NULL INTO v_email, v_confirmed
  FROM private.access_auth_users WHERE id = p_actor;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  IF NOT v_confirmed THEN RETURN jsonb_build_object('code', 'EMAIL_UNCONFIRMED'); END IF;
  SELECT * INTO v_member FROM public.members WHERE id = p_actor FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'MEMBER_REQUIRED'); END IF;
  IF v_email <> lower(v_member.email)
     AND v_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' AND char_length(v_email) <= 254
     AND NOT EXISTS (SELECT 1 FROM public.members WHERE lower(email) = v_email AND id <> p_actor) THEN
    UPDATE public.members SET email = v_email, updated_at = clock_timestamp() WHERE id = p_actor;
    INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
    VALUES (NULL, 'authenticated', p_actor, 'member.email_synced', '{}'::jsonb);
    v_member.email := v_email;
  END IF;
  SELECT * INTO v_app FROM private.membership_applications
  WHERE member_id = p_actor OR auth_user_id = p_actor ORDER BY submitted_at DESC LIMIT 1;
  v_has_app := FOUND;
  RETURN jsonb_build_object('code', 'SUCCESS',
    'name', v_member.full_name, 'email', v_member.email, 'signInEmail', v_email,
    'universityId', v_member.university_id, 'academicYear', v_member.year,
    'discipline', v_member.major,
    'interests', to_jsonb(coalesce(v_member.interests, CASE WHEN v_has_app THEN v_app.interests END, '{}'::text[])),
    'phone', v_member.phone, 'hasPhoto', v_member.photo_key IS NOT NULL,
    'photoVersion', split_part(split_part(v_member.photo_key, '/', 2), '.', 1),
    'status', v_member.status, 'memberSince', v_member.created_at, 'updatedAt', v_member.updated_at,
    'squVerified', EXISTS (SELECT 1 FROM private.squ_verifications
      WHERE member_id = p_actor AND revoked_at IS NULL),
    'application', CASE WHEN v_has_app THEN jsonb_build_object('status', v_app.status,
      'submittedAt', v_app.submitted_at, 'verifiedAt', v_app.verified_at,
      'decidedAt', v_app.decided_at, 'activatedAt', v_app.activated_at) END,
    'changeRequests', (SELECT coalesce(jsonb_agg(jsonb_build_object('field', field, 'status', status,
        'requestedValue', requested_value, 'requestedAt', requested_at, 'decidedAt', decided_at)
        ORDER BY requested_at DESC), '[]'::jsonb)
      FROM (SELECT * FROM private.member_change_requests WHERE member_id = p_actor
        AND (status = 'pending' OR decided_at > clock_timestamp() - interval '30 days')
        ORDER BY requested_at DESC LIMIT 10) r))
    || private.membership_details_json(v_member.category, v_member.institution_id, v_member.institution_name);
END $$;

-- Self-service details, by category. 0031's routine stays for the previous Core.
CREATE FUNCTION private.update_own_profile_v2(p_actor uuid, p_phone text, p_category text,
  p_institution_id text, p_institution_name text, p_year integer, p_discipline text, p_interests text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_profile jsonb; v_member public.members%ROWTYPE; v_current text[]; v_changed text[] := '{}';
  v_name text := nullif(btrim(coalesce(p_institution_name, '')), ''); v_field text;
BEGIN
  v_profile := private.get_member_profile(p_actor);
  IF v_profile->>'code' <> 'SUCCESS' THEN RETURN v_profile; END IF;
  IF p_phone IS NOT NULL AND p_phone !~ '^\+[1-9][0-9]{6,14}$' THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'phone'); END IF;
  v_field := private.membership_details_invalid_field(p_category, p_institution_id, v_name, p_year);
  IF v_field IS NOT NULL THEN RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', v_field); END IF;
  IF p_discipline IS NULL OR NOT (p_discipline = ANY (private.member_discipline_ids())) THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'discipline'); END IF;
  IF p_interests IS NULL OR cardinality(p_interests) > 4 OR array_position(p_interests, NULL) IS NOT NULL
     OR NOT (p_interests <@ private.member_interest_ids())
     OR (SELECT count(DISTINCT x) FROM unnest(p_interests) x) <> cardinality(p_interests) THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'interests'); END IF;
  SELECT * INTO v_member FROM public.members WHERE id = p_actor FOR UPDATE;
  v_current := coalesce(v_member.interests, (SELECT interests FROM private.membership_applications
    WHERE member_id = p_actor OR auth_user_id = p_actor ORDER BY submitted_at DESC LIMIT 1), '{}');
  IF v_member.phone IS DISTINCT FROM p_phone THEN v_changed := array_append(v_changed, 'phone'); END IF;
  IF v_member.category IS DISTINCT FROM p_category THEN v_changed := array_append(v_changed, 'category'); END IF;
  IF (v_member.institution_id, v_member.institution_name) IS DISTINCT FROM (p_institution_id, v_name) THEN
    v_changed := array_append(v_changed, 'institution'); END IF;
  IF v_member.year IS DISTINCT FROM p_year THEN v_changed := array_append(v_changed, 'academicYear'); END IF;
  IF v_member.major IS DISTINCT FROM p_discipline THEN v_changed := array_append(v_changed, 'discipline'); END IF;
  IF v_current IS DISTINCT FROM p_interests THEN v_changed := array_append(v_changed, 'interests'); END IF;
  IF cardinality(v_changed) > 0 THEN
    UPDATE public.members SET phone = p_phone, category = p_category, institution_id = p_institution_id,
      institution_name = v_name, year = p_year, major = p_discipline, interests = p_interests,
      updated_at = clock_timestamp()
    WHERE id = p_actor;
    INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
    VALUES (NULL, 'authenticated', p_actor, 'member.profile_updated', jsonb_build_object('fields', to_jsonb(v_changed)));
  END IF;
  RETURN private.get_own_profile(p_actor);
END $$;

-- Requests that count towards the member's limit: the ones the member made and that the structure
-- did not close (a team moved, made inactive or archived is not the member's attempt).
CREATE FUNCTION private.leadership_recent_requests(p_member uuid) RETURNS integer
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT count(*)::integer FROM private.leadership_requests
  WHERE member_id = p_member AND status <> 'cancelled'
    AND submitted_at > clock_timestamp() - interval '30 days'
$$;

-- The member's own SQU student verification, on its own: the profile's verification card loads
-- it independently of committee leadership.
CREATE FUNCTION private.get_own_squ_verification(p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_profile jsonb;
BEGIN
  v_profile := private.get_member_profile(p_actor);
  IF v_profile->>'code' <> 'SUCCESS' THEN RETURN jsonb_build_object('code', v_profile->>'code'); END IF;
  RETURN jsonb_build_object('code', 'SUCCESS') || private.squ_state(p_actor);
END $$;

-- The member's own committee leadership: appointments, requests and limits, plus whether they
-- have dashboard access (read-only, shown so the member sees that appointments never grant it).
CREATE FUNCTION private.get_own_leadership(p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_profile jsonb; s private.verification_settings%ROWTYPE;
BEGIN
  v_profile := private.get_member_profile(p_actor);
  IF v_profile->>'code' <> 'SUCCESS' THEN RETURN jsonb_build_object('code', v_profile->>'code'); END IF;
  SELECT * INTO s FROM private.verification_settings;
  RETURN jsonb_build_object('code', 'SUCCESS',
    'appointments', (SELECT coalesce(jsonb_agg(x ORDER BY x."active" DESC, x."appointedAt" DESC), '[]'::jsonb) FROM (
      SELECT a.id, a.ended_at IS NULL AS "active", a.appointed_at AS "appointedAt", a.ended_at AS "endedAt",
        a.end_reason AS "endReason",
        jsonb_build_object('id', c.id, 'name', c.name, 'archived', c.archived_at IS NOT NULL) AS committee,
        private.team_json(t) AS team, private.position_json(a.position_id) AS "position"
      FROM private.leadership_appointments a
      JOIN private.committee_teams t ON t.id = a.team_id JOIN public.committees c ON c.id = t.committee_id
      WHERE a.member_id = p_actor AND (a.ended_at IS NULL OR a.ended_at > clock_timestamp() - interval '180 days')
      ORDER BY a.ended_at IS NULL DESC, a.appointed_at DESC LIMIT 20) x),
    'requests', (SELECT coalesce(jsonb_agg(x ORDER BY x."submittedAt" DESC), '[]'::jsonb) FROM (
      SELECT r.id, r.status, r.submitted_at AS "submittedAt", r.decided_at AS "decidedAt",
        r.rejection_reason AS "rejectionReason", r.cancellation_reason AS "cancellationReason",
        jsonb_build_object('id', c.id, 'name', c.name) AS committee,
        private.team_json(t) AS team, private.position_json(r.position_id) AS "position"
      FROM private.leadership_requests r
      JOIN private.committee_teams t ON t.id = r.team_id JOIN public.committees c ON c.id = r.committee_id
      WHERE r.member_id = p_actor ORDER BY r.submitted_at DESC LIMIT 20) x),
    'limits', jsonb_build_object(
      'requestsPer30Days', s.leadership_requests_per_30_days,
      'recentRequests', private.leadership_recent_requests(p_actor),
      'maxActiveAppointments', s.max_active_appointments_per_member,
      'activeAppointments', (SELECT count(*) FROM private.leadership_appointments
        WHERE member_id = p_actor AND ended_at IS NULL)),
    'dashboardAccess', EXISTS (SELECT 1 FROM public.administrative_access
      WHERE user_id = p_actor AND revoked_at IS NULL));
END $$;

-- =============================================================================================
-- SQU student verification
-- =============================================================================================

-- Before anything is uploaded: a refused member uploads nothing (ADR 0018's order).
CREATE FUNCTION private.begin_squ_verification(p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_profile jsonb; v_block text;
BEGIN
  v_profile := private.get_member_profile(p_actor);
  IF v_profile->>'code' <> 'SUCCESS' THEN RETURN jsonb_build_object('code', v_profile->>'code'); END IF;
  v_block := private.squ_submission_block(p_actor);
  IF v_block IS NOT NULL THEN RETURN jsonb_build_object('code', v_block); END IF;
  RETURN jsonb_build_object('code', 'SUCCESS');
END $$;

-- The request and its evidence, in one transaction. Exactly one of the bytes or the Storage
-- reference Core uploaded beforehand.
CREATE FUNCTION private.submit_squ_verification(p_actor uuid, p_student_number text, p_media_type text,
  p_sha256 text, p_byte_size integer, p_content bytea, p_storage_bucket text, p_storage_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_profile jsonb; v_block text; v_number text := btrim(coalesce(p_student_number, '')); v_id uuid;
BEGIN
  v_profile := private.get_member_profile(p_actor);
  IF v_profile->>'code' <> 'SUCCESS' THEN RETURN jsonb_build_object('code', v_profile->>'code'); END IF;
  IF v_number !~ '^[0-9]{6,10}$' THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'studentNumber'); END IF;
  IF p_media_type IS NULL OR p_media_type NOT IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')
     OR p_byte_size IS NULL OR p_byte_size NOT BETWEEN 1 AND 4194304
     OR p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$'
     OR (p_content IS NULL) = (p_storage_key IS NULL)
     OR (p_content IS NOT NULL AND (p_storage_bucket IS NOT NULL OR octet_length(p_content) <> p_byte_size
       OR encode(sha256(p_content), 'hex') <> p_sha256))
     OR (p_storage_key IS NOT NULL AND (NOT coalesce(private.storage_bucket_valid(p_storage_bucket), false)
       OR p_storage_key !~ '^squ-verification/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp|pdf)$'
       OR p_storage_key NOT LIKE ('%.' || (CASE p_media_type
         WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/png' THEN 'png'
         WHEN 'image/webp' THEN 'webp' WHEN 'application/pdf' THEN 'pdf' END)))) THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'document');
  END IF;
  -- One submission at a time per member, so the pending and limit checks cannot race.
  PERFORM pg_advisory_xact_lock(hashtextextended('squ-verification:' || p_actor, 0));
  v_block := private.squ_submission_block(p_actor);
  IF v_block IS NOT NULL THEN RETURN jsonb_build_object('code', v_block); END IF;
  BEGIN
    INSERT INTO private.squ_verification_requests (member_id, student_number)
    VALUES (p_actor, v_number) RETURNING id INTO v_id;
    INSERT INTO private.squ_verification_documents
      (request_id, media_type, byte_size, sha256, content, storage_bucket, storage_key)
    VALUES (v_id, p_media_type, p_byte_size, p_sha256, p_content, p_storage_bucket, p_storage_key);
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('code', 'ALREADY_PENDING');
  END;
  INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
  VALUES (NULL, 'authenticated', p_actor, 'verification.submitted',
    jsonb_build_object('requestId', v_id, 'memberId', p_actor));
  RETURN private.get_own_squ_verification(p_actor) || jsonb_build_object('requestId', v_id);
END $$;

-- An uploaded object no request references (a refused or failed submission). Never a referenced one.
CREATE FUNCTION private.queue_abandoned_verification_upload(p_storage_bucket text, p_storage_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT coalesce(private.storage_bucket_valid(p_storage_bucket), false) OR p_storage_key IS NULL
     OR p_storage_key !~ '^squ-verification/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp|pdf)$' THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR');
  END IF;
  IF EXISTS (SELECT 1 FROM private.squ_verification_documents d
      WHERE d.storage_bucket = p_storage_bucket AND d.storage_key = p_storage_key) THEN
    RETURN jsonb_build_object('code', 'REFERENCED');
  END IF;
  INSERT INTO private.membership_storage_deletions (storage_bucket, storage_key, reason)
  VALUES (p_storage_bucket, p_storage_key, 'upload_abandoned')
  ON CONFLICT (storage_bucket, storage_key) DO NOTHING;
  RETURN jsonb_build_object('code', 'SUCCESS');
END $$;

-- Reviewer queue: 25 a page, the pending ones oldest first.
CREATE FUNCTION private.list_squ_verifications(p_actor uuid, p_state text, p_query text,
  p_from timestamptz, p_to timestamptz, p_offset integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_query text := nullif(btrim(coalesce(p_query, '')), ''); v_pattern text;
BEGIN
  IF private.verification_reviewer_kind(p_actor, false) IS NULL THEN
    RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  IF p_state IS NULL OR p_state NOT IN ('pending', 'verified', 'rejected', 'revoked', 'all')
     OR p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 100000 OR char_length(coalesce(v_query, '')) > 100 THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR'); END IF;
  v_pattern := '%' || replace(replace(replace(coalesce(v_query, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  RETURN (WITH q AS (
    SELECT r.id, r.member_id, r.student_number, r.submitted_at, r.decided_at, m.full_name, m.email,
      CASE WHEN r.status = 'approved' THEN CASE WHEN v.revoked_at IS NULL THEN 'verified' ELSE 'revoked' END
        ELSE r.status END AS state
    FROM private.squ_verification_requests r
    JOIN public.members m ON m.id = r.member_id
    LEFT JOIN private.squ_verifications v ON v.request_id = r.id
  ), matched AS (
    SELECT * FROM q WHERE (p_state = 'all' OR state = p_state)
      AND (v_query IS NULL OR full_name ILIKE v_pattern ESCAPE '\' OR email ILIKE v_pattern ESCAPE '\'
        OR student_number LIKE v_pattern ESCAPE '\')
      AND (p_from IS NULL OR submitted_at >= p_from) AND (p_to IS NULL OR submitted_at < p_to)
  ), page AS (
    SELECT matched.*, row_number() OVER (ORDER BY (state = 'pending') DESC,
      CASE WHEN state = 'pending' THEN submitted_at END ASC, submitted_at DESC, id) AS ord
    FROM matched
  )
  SELECT jsonb_build_object('code', 'SUCCESS', 'total', (SELECT count(*) FROM matched),
    'items', coalesce((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'memberId', p.member_id,
        'name', p.full_name, 'email', p.email, 'state', p.state, 'submittedAt', p.submitted_at,
        'decidedAt', p.decided_at, 'own', p.member_id = p_actor,
        'hasDocument', EXISTS (SELECT 1 FROM private.squ_verification_documents d WHERE d.request_id = p.id))
        ORDER BY p.ord)
      FROM page p WHERE p.ord > p_offset AND p.ord <= p_offset + 25), '[]'::jsonb)));
END $$;

CREATE FUNCTION private.get_squ_verification(p_actor uuid, p_request uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_kind text := private.verification_reviewer_kind(p_actor, false);
  r private.squ_verification_requests%ROWTYPE; v private.squ_verifications%ROWTYPE; v_has boolean;
  m public.members%ROWTYPE;
BEGIN
  IF v_kind IS NULL THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  SELECT * INTO r FROM private.squ_verification_requests WHERE id = p_request;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  SELECT * INTO v FROM private.squ_verifications WHERE request_id = r.id;
  v_has := FOUND;
  SELECT * INTO m FROM public.members WHERE id = r.member_id;
  RETURN jsonb_build_object('code', 'SUCCESS', 'reviewer', v_kind, 'own', r.member_id = p_actor,
    'request', jsonb_build_object('id', r.id, 'studentNumber', r.student_number, 'status', r.status,
      'state', CASE WHEN r.status = 'approved' THEN CASE WHEN v.revoked_at IS NULL THEN 'verified' ELSE 'revoked' END
        ELSE r.status END,
      'submittedAt', r.submitted_at, 'decidedAt', r.decided_at,
      'decidedByEmail', private.membership_actor_email(r.decided_by),
      'rejectionReason', r.rejection_reason, 'reviewerNote', r.reviewer_note, 'revision', r.revision,
      'documentDeletedAt', r.document_deleted_at,
      'document', (SELECT jsonb_build_object('mediaType', media_type, 'byteSize', byte_size)
        FROM private.squ_verification_documents WHERE request_id = r.id)),
    'verification', CASE WHEN v_has THEN jsonb_build_object('id', v.id, 'verifiedAt', v.verified_at,
      'verifiedByEmail', private.membership_actor_email(v.verified_by), 'revokedAt', v.revoked_at,
      'revokedByEmail', private.membership_actor_email(v.revoked_by),
      'revocationReason', v.revocation_reason, 'revocationNote', v.revocation_note) END,
    'member', jsonb_build_object('id', m.id, 'name', m.full_name, 'email', m.email,
        'memberSince', m.created_at, 'universityId', m.university_id)
      || private.membership_details_json(m.category, m.institution_id, m.institution_name),
    'otherRequests', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'status', o.status,
        'submittedAt', o.submitted_at, 'decidedAt', o.decided_at) ORDER BY o.submitted_at DESC), '[]'::jsonb)
      FROM (SELECT * FROM private.squ_verification_requests
        WHERE member_id = r.member_id AND id <> r.id ORDER BY submitted_at DESC LIMIT 10) o),
    'history', (SELECT coalesce(jsonb_agg(jsonb_build_object('occurredAt', a.occurred_at, 'action', a.action,
        'actorKind', a.actor_kind, 'actorEmail', private.membership_actor_email(a.actor_user_id))
        ORDER BY a.occurred_at, a.id), '[]'::jsonb)
      FROM private.uc02_audit a
      WHERE (a.action LIKE 'verification.%') AND a.changes ->> 'requestId' = r.id::text));
END $$;

-- The evidence for a reviewer who is not its owner; every view is audited.
CREATE FUNCTION private.get_squ_verification_document(p_actor uuid, p_request uuid)
RETURNS TABLE (media_type text, byte_size integer, sha256 text, content bytea,
  storage_bucket text, storage_key text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_member uuid;
BEGIN
  IF private.verification_reviewer_kind(p_actor, false) IS NULL OR p_request IS NULL THEN RETURN; END IF;
  SELECT r.member_id INTO v_member FROM private.squ_verification_requests r WHERE r.id = p_request;
  IF NOT FOUND OR v_member = p_actor THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM private.squ_verification_documents d WHERE d.request_id = p_request) THEN
    RETURN; END IF;
  INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
  VALUES (NULL, 'authenticated', p_actor, 'verification.document_viewed',
    jsonb_build_object('requestId', p_request, 'memberId', v_member));
  RETURN QUERY SELECT d.media_type, d.byte_size, d.sha256, d.content, d.storage_bucket, d.storage_key
  FROM private.squ_verification_documents d WHERE d.request_id = p_request;
END $$;

-- Approve or reject a pending request. Approval writes the verification in the same transaction.
CREATE FUNCTION private.decide_squ_verification(p_actor uuid, p_request uuid, p_revision integer,
  p_decision text, p_reason text, p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_kind text; r private.squ_verification_requests%ROWTYPE;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), ''); v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_id uuid; v_constraint text;
BEGIN
  IF p_request IS NULL OR p_revision IS NULL OR p_decision IS NULL OR p_decision NOT IN ('approve', 'reject')
     OR NOT private.note_text_valid(v_note, 1000) THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'note'); END IF;
  IF p_decision = 'reject' AND (v_reason IS NULL OR NOT private.note_text_valid(v_reason, 500)) THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'rejectionReason'); END IF;
  v_kind := private.verification_reviewer_kind(p_actor, true);
  IF v_kind IS NULL THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  SELECT * INTO r FROM private.squ_verification_requests WHERE id = p_request FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  IF r.member_id = p_actor THEN RETURN jsonb_build_object('code', 'SELF_REVIEW'); END IF;
  IF r.revision <> p_revision THEN RETURN jsonb_build_object('code', 'STALE_REVISION'); END IF;
  IF r.status <> 'pending' THEN RETURN jsonb_build_object('code', 'INVALID_TRANSITION'); END IF;
  IF p_decision = 'approve' THEN
    BEGIN
      INSERT INTO private.squ_verifications (member_id, request_id, student_number, verified_by)
      VALUES (r.member_id, r.id, r.student_number, p_actor) RETURNING id INTO v_id;
    EXCEPTION WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
      RETURN jsonb_build_object('code', CASE WHEN v_constraint = 'squ_verifications_active_student_number'
        THEN 'STUDENT_NUMBER_IN_USE' ELSE 'ALREADY_VERIFIED' END);
    END;
    UPDATE private.squ_verification_requests SET status = 'approved', decided_by = p_actor,
      decided_at = clock_timestamp(), reviewer_note = v_note, revision = revision + 1
    WHERE id = r.id;
    INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
    VALUES (NULL, 'authenticated', p_actor, 'verification.approved', jsonb_build_object('requestId', r.id,
      'memberId', r.member_id, 'verificationId', v_id, 'reviewer', v_kind, 'hasNote', v_note IS NOT NULL));
    RETURN jsonb_build_object('code', 'SUCCESS', 'state', 'verified', 'revision', r.revision + 1);
  END IF;
  UPDATE private.squ_verification_requests SET status = 'rejected', decided_by = p_actor,
    decided_at = clock_timestamp(), rejection_reason = v_reason, reviewer_note = v_note, revision = revision + 1
  WHERE id = r.id;
  INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
  VALUES (NULL, 'authenticated', p_actor, 'verification.rejected', jsonb_build_object('requestId', r.id,
    'memberId', r.member_id, 'reviewer', v_kind, 'hasNote', v_note IS NOT NULL));
  RETURN jsonb_build_object('code', 'SUCCESS', 'state', 'rejected', 'revision', r.revision + 1);
END $$;

-- Revocation keeps the verification as history; the member may then submit again.
CREATE FUNCTION private.revoke_squ_verification(p_actor uuid, p_verification uuid, p_reason text, p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_kind text; v private.squ_verifications%ROWTYPE;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), ''); v_note text := nullif(btrim(coalesce(p_note, '')), '');
BEGIN
  IF v_reason IS NULL OR NOT private.note_text_valid(v_reason, 500) THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'reason'); END IF;
  IF NOT private.note_text_valid(v_note, 1000) THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'note'); END IF;
  v_kind := private.verification_reviewer_kind(p_actor, true);
  IF v_kind IS NULL THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  SELECT * INTO v FROM private.squ_verifications WHERE id = p_verification FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  IF v.member_id = p_actor THEN RETURN jsonb_build_object('code', 'SELF_REVIEW'); END IF;
  IF v.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('code', 'INVALID_TRANSITION'); END IF;
  UPDATE private.squ_verifications SET revoked_at = clock_timestamp(), revoked_by = p_actor,
    revocation_reason = v_reason, revocation_note = v_note
  WHERE id = v.id;
  INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
  VALUES (NULL, 'authenticated', p_actor, 'verification.revoked', jsonb_build_object('requestId', v.request_id,
    'memberId', v.member_id, 'verificationId', v.id, 'reviewer', v_kind, 'hasNote', v_note IS NOT NULL));
  RETURN jsonb_build_object('code', 'SUCCESS', 'state', 'revoked');
END $$;

-- Retention cleanup (ADR 0025): does nothing until a period is set. Then removes the evidence of
-- decided requests older than it, a batch at a time; the Storage objects are queued by the
-- document trigger in the same transaction. Pending requests are never touched.
CREATE FUNCTION private.purge_expired_verification_documents(p_actor uuid, p_limit integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_days integer; v_ids uuid[]; v_count integer;
BEGIN
  IF private.verification_reviewer_kind(p_actor, false) IS NULL THEN
    RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR'); END IF;
  SELECT document_retention_days INTO v_days FROM private.verification_settings;
  IF v_days IS NULL THEN RETURN jsonb_build_object('code', 'DISABLED', 'purged', 0); END IF;
  SELECT array_agg(request_id) INTO v_ids FROM (
    SELECT d.request_id FROM private.squ_verification_documents d
    JOIN private.squ_verification_requests r ON r.id = d.request_id
    WHERE r.status <> 'pending' AND r.decided_at < clock_timestamp() - make_interval(days => v_days)
    ORDER BY r.decided_at LIMIT p_limit FOR UPDATE OF d SKIP LOCKED) x;
  IF v_ids IS NULL THEN RETURN jsonb_build_object('code', 'SUCCESS', 'purged', 0); END IF;
  DELETE FROM private.squ_verification_documents WHERE request_id = ANY (v_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  UPDATE private.squ_verification_requests SET document_deleted_at = clock_timestamp() WHERE id = ANY (v_ids);
  INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
  VALUES (NULL, 'authenticated', p_actor, 'verification.documents_purged',
    jsonb_build_object('count', v_count, 'retentionDays', v_days));
  RETURN jsonb_build_object('code', 'SUCCESS', 'purged', v_count);
END $$;

-- =============================================================================================
-- Teams (senior administrators: Board Administration and Technical)
-- =============================================================================================
CREATE FUNCTION private.team_names_invalid(p_name_en text, p_name_ar text, p_description_en text,
  p_description_ar text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_name_en IS NULL OR char_length(p_name_en) NOT BETWEEN 2 AND 80 OR p_name_en ~ '[[:cntrl:]]' THEN 'nameEn'
    WHEN p_name_ar IS NOT NULL AND (char_length(p_name_ar) NOT BETWEEN 2 AND 80 OR p_name_ar ~ '[[:cntrl:]]') THEN 'nameAr'
    WHEN NOT private.committee_description_valid(p_description_en) THEN 'descriptionEn'
    WHEN NOT private.committee_description_valid(p_description_ar) THEN 'descriptionAr'
  END
$$;

CREATE FUNCTION private.admin_create_team(p_actor uuid, p_committee uuid, p_name_en text, p_name_ar text,
  p_description_en text, p_description_ar text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_en text := btrim(coalesce(p_name_en, '')); v_ar text := nullif(btrim(coalesce(p_name_ar, '')), '');
  v_den text := nullif(btrim(coalesce(p_description_en, '')), ''); v_dar text := nullif(btrim(coalesce(p_description_ar, '')), '');
  v_field text; c public.committees%ROWTYPE; v_id uuid;
BEGIN
  IF private.senior_admin_level(p_actor) IS NULL THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  v_field := private.team_names_invalid(v_en, v_ar, v_den, v_dar);
  IF v_field IS NOT NULL THEN RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', v_field); END IF;
  PERFORM private.lock_organization(true);
  SELECT * INTO c FROM public.committees WHERE id = p_committee AND slug IS NOT NULL FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  IF c.archived_at IS NOT NULL THEN RETURN jsonb_build_object('code', 'COMMITTEE_ARCHIVED'); END IF;
  IF EXISTS (SELECT 1 FROM private.committee_teams WHERE committee_id = p_committee
      AND status <> 'archived' AND lower(name_en) = lower(v_en)) THEN
    RETURN jsonb_build_object('code', 'NAME_TAKEN'); END IF;
  INSERT INTO private.committee_teams (committee_id, name_en, name_ar, description_en, description_ar)
  VALUES (p_committee, v_en, v_ar, v_den, v_dar) RETURNING id INTO v_id;
  INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
  VALUES (p_committee, 'authenticated', p_actor, 'team.created', jsonb_build_object('teamId', v_id, 'name', v_en));
  RETURN jsonb_build_object('code', 'SUCCESS', 'id', v_id);
END $$;

CREATE FUNCTION private.admin_update_team(p_actor uuid, p_team uuid, p_name_en text, p_name_ar text,
  p_description_en text, p_description_ar text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_en text := btrim(coalesce(p_name_en, '')); v_ar text := nullif(btrim(coalesce(p_name_ar, '')), '');
  v_den text := nullif(btrim(coalesce(p_description_en, '')), ''); v_dar text := nullif(btrim(coalesce(p_description_ar, '')), '');
  v_field text; t private.committee_teams%ROWTYPE;
BEGIN
  IF private.senior_admin_level(p_actor) IS NULL THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  v_field := private.team_names_invalid(v_en, v_ar, v_den, v_dar);
  IF v_field IS NOT NULL THEN RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', v_field); END IF;
  PERFORM private.lock_organization(true);
  SELECT * INTO t FROM private.committee_teams WHERE id = p_team FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  IF t.status = 'archived' THEN RETURN jsonb_build_object('code', 'TEAM_ARCHIVED'); END IF;
  IF EXISTS (SELECT 1 FROM private.committee_teams WHERE committee_id = t.committee_id AND id <> t.id
      AND status <> 'archived' AND lower(name_en) = lower(v_en)) THEN
    RETURN jsonb_build_object('code', 'NAME_TAKEN'); END IF;
  IF (t.name_en, t.name_ar, t.description_en, t.description_ar) IS NOT DISTINCT FROM (v_en, v_ar, v_den, v_dar) THEN
    RETURN jsonb_build_object('code', 'UNCHANGED'); END IF;
  UPDATE private.committee_teams SET name_en = v_en, name_ar = v_ar, description_en = v_den,
    description_ar = v_dar, updated_at = clock_timestamp()
  WHERE id = t.id;
  INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
  VALUES (t.committee_id, 'authenticated', p_actor, 'team.updated', jsonb_build_object('teamId', t.id,
    'previousName', t.name_en, 'name', v_en));
  RETURN jsonb_build_object('code', 'SUCCESS');
END $$;

-- Moving a team keeps its appointments (they now read under the new committee) and closes its
-- pending requests. It touches no administrative access.
CREATE FUNCTION private.admin_move_team(p_actor uuid, p_team uuid, p_committee uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE t private.committee_teams%ROWTYPE; c public.committees%ROWTYPE; v_cancelled integer;
BEGIN
  IF private.senior_admin_level(p_actor) IS NULL THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  PERFORM private.lock_organization(true);
  SELECT * INTO t FROM private.committee_teams WHERE id = p_team FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  IF t.status = 'archived' THEN RETURN jsonb_build_object('code', 'TEAM_ARCHIVED'); END IF;
  IF t.committee_id = p_committee THEN RETURN jsonb_build_object('code', 'UNCHANGED'); END IF;
  SELECT * INTO c FROM public.committees WHERE id = p_committee AND slug IS NOT NULL FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'COMMITTEE_NOT_FOUND'); END IF;
  IF c.archived_at IS NOT NULL THEN RETURN jsonb_build_object('code', 'COMMITTEE_ARCHIVED'); END IF;
  IF EXISTS (SELECT 1 FROM private.committee_teams WHERE committee_id = p_committee
      AND status <> 'archived' AND lower(name_en) = lower(t.name_en)) THEN
    RETURN jsonb_build_object('code', 'NAME_TAKEN'); END IF;
  v_cancelled := private.cancel_team_requests(t.id, 'team_moved', p_actor);
  UPDATE private.committee_teams SET committee_id = p_committee, updated_at = clock_timestamp() WHERE id = t.id;
  INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes) VALUES
    (t.committee_id, 'authenticated', p_actor, 'team.moved', jsonb_build_object('teamId', t.id, 'name', t.name_en,
      'direction', 'out', 'toCommitteeId', p_committee, 'cancelledRequests', v_cancelled)),
    (p_committee, 'authenticated', p_actor, 'team.moved', jsonb_build_object('teamId', t.id, 'name', t.name_en,
      'direction', 'in', 'fromCommitteeId', t.committee_id, 'cancelledRequests', v_cancelled));
  RETURN jsonb_build_object('code', 'SUCCESS', 'cancelledRequests', v_cancelled);
END $$;

-- active ↔ inactive, either → archived (refused while appointments are active), archived →
-- inactive or active (restore). Leaving "active" closes pending requests.
CREATE FUNCTION private.admin_set_team_status(p_actor uuid, p_team uuid, p_status text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE t private.committee_teams%ROWTYPE; v_appointments integer; v_cancelled integer := 0;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('active', 'inactive', 'archived') THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR'); END IF;
  IF private.senior_admin_level(p_actor) IS NULL THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  PERFORM private.lock_organization(true);
  SELECT * INTO t FROM private.committee_teams WHERE id = p_team FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  IF t.status = p_status THEN RETURN jsonb_build_object('code', 'UNCHANGED'); END IF;
  IF p_status = 'archived' THEN
    SELECT count(*) INTO v_appointments FROM private.leadership_appointments
    WHERE team_id = t.id AND ended_at IS NULL;
    IF v_appointments > 0 THEN
      RETURN jsonb_build_object('code', 'BLOCKED', 'appointments', v_appointments); END IF;
  END IF;
  IF p_status = 'active' AND EXISTS (SELECT 1 FROM public.committees
      WHERE id = t.committee_id AND archived_at IS NOT NULL) THEN
    RETURN jsonb_build_object('code', 'COMMITTEE_ARCHIVED'); END IF;
  IF t.status = 'archived' AND EXISTS (SELECT 1 FROM private.committee_teams WHERE committee_id = t.committee_id
      AND id <> t.id AND status <> 'archived' AND lower(name_en) = lower(t.name_en)) THEN
    RETURN jsonb_build_object('code', 'NAME_TAKEN'); END IF;
  IF t.status = 'active' THEN
    v_cancelled := private.cancel_team_requests(t.id,
      CASE WHEN p_status = 'archived' THEN 'team_archived' ELSE 'team_inactive' END, p_actor);
  END IF;
  UPDATE private.committee_teams SET status = p_status, updated_at = clock_timestamp(),
    archived_at = CASE WHEN p_status = 'archived' THEN clock_timestamp() END
  WHERE id = t.id;
  INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
  VALUES (t.committee_id, 'authenticated', p_actor, 'team.status_changed', jsonb_build_object('teamId', t.id,
    'name', t.name_en, 'previous', t.status, 'next', p_status, 'cancelledRequests', v_cancelled));
  RETURN jsonb_build_object('code', 'SUCCESS', 'cancelledRequests', v_cancelled);
END $$;

-- Only a team nothing has referenced may be deleted; otherwise it is archived.
CREATE FUNCTION private.admin_delete_team(p_actor uuid, p_team uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE t private.committee_teams%ROWTYPE;
BEGIN
  IF private.senior_admin_level(p_actor) IS NULL THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  PERFORM private.lock_organization(true);
  SELECT * INTO t FROM private.committee_teams WHERE id = p_team FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  IF EXISTS (SELECT 1 FROM private.leadership_requests WHERE team_id = t.id)
     OR EXISTS (SELECT 1 FROM private.leadership_appointments WHERE team_id = t.id) THEN
    RETURN jsonb_build_object('code', 'IN_USE'); END IF;
  DELETE FROM private.committee_teams WHERE id = t.id;
  INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
  VALUES (t.committee_id, 'authenticated', p_actor, 'team.deleted', jsonb_build_object('teamId', t.id, 'name', t.name_en));
  RETURN jsonb_build_object('code', 'SUCCESS');
END $$;

-- A committee's teams with their current leaders, for the committee page.
CREATE FUNCTION private.admin_list_committee_teams(p_actor uuid, p_committee uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF private.senior_admin_level(p_actor) IS NULL THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.committees WHERE id = p_committee AND slug IS NOT NULL) THEN
    RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  RETURN jsonb_build_object('code', 'SUCCESS',
    'teams', (SELECT coalesce(jsonb_agg(private.team_json(t) || jsonb_build_object(
        'createdAt', t.created_at, 'updatedAt', t.updated_at, 'archivedAt', t.archived_at,
        'pendingRequests', (SELECT count(*) FROM private.leadership_requests r WHERE r.team_id = t.id AND r.status = 'pending'),
        'inUse', EXISTS (SELECT 1 FROM private.leadership_requests r WHERE r.team_id = t.id)
          OR EXISTS (SELECT 1 FROM private.leadership_appointments a WHERE a.team_id = t.id),
        'leaders', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'memberId', m.id, 'name', m.full_name,
            'email', m.email, 'position', private.position_json(a.position_id), 'appointedAt', a.appointed_at,
            'source', a.source, 'revision', a.revision) ORDER BY p.rank, m.full_name), '[]'::jsonb)
          FROM private.leadership_appointments a JOIN public.members m ON m.id = a.member_id
          JOIN private.organizational_positions p ON p.id = a.position_id
          WHERE a.team_id = t.id AND a.ended_at IS NULL))
        ORDER BY t.status = 'archived', t.status = 'inactive', t.name_en), '[]'::jsonb)
      FROM private.committee_teams t WHERE t.committee_id = p_committee),
    'positions', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', id,
        'label', jsonb_build_object('en', label_en, 'ar', label_ar), 'maxHolders', max_holders_per_team,
        'requestable', requestable) ORDER BY rank), '[]'::jsonb)
      FROM private.organizational_positions WHERE active));
END $$;

-- =============================================================================================
-- Leadership requests and appointments
-- =============================================================================================

-- What a member may request: active committees with active teams, and requestable positions.
CREATE FUNCTION private.get_leadership_options(p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_profile jsonb;
BEGIN
  v_profile := private.get_member_profile(p_actor);
  IF v_profile->>'code' <> 'SUCCESS' THEN RETURN jsonb_build_object('code', v_profile->>'code'); END IF;
  RETURN jsonb_build_object('code', 'SUCCESS',
    'committees', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name,
        'teams', (SELECT jsonb_agg(private.team_json(t) ORDER BY t.name_en)
          FROM private.committee_teams t WHERE t.committee_id = c.id AND t.status = 'active'))
        ORDER BY c.name), '[]'::jsonb)
      FROM public.committees c WHERE c.slug IS NOT NULL AND c.archived_at IS NULL
        AND EXISTS (SELECT 1 FROM private.committee_teams t WHERE t.committee_id = c.id AND t.status = 'active')),
    'positions', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', id,
        'label', jsonb_build_object('en', label_en, 'ar', label_ar)) ORDER BY rank), '[]'::jsonb)
      FROM private.organizational_positions WHERE active AND requestable));
END $$;

CREATE FUNCTION private.request_leadership(p_actor uuid, p_committee uuid, p_team uuid, p_position text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_profile jsonb; c public.committees%ROWTYPE; t private.committee_teams%ROWTYPE;
  v_limit integer; v_id uuid;
BEGIN
  v_profile := private.get_member_profile(p_actor);
  IF v_profile->>'code' <> 'SUCCESS' THEN RETURN jsonb_build_object('code', v_profile->>'code'); END IF;
  IF p_committee IS NULL OR p_team IS NULL OR p_position IS NULL THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'team'); END IF;
  -- Shared: structure changes wait for this request, and this request sees a settled structure.
  PERFORM private.lock_organization(false);
  PERFORM pg_advisory_xact_lock(hashtextextended('leadership-member:' || p_actor, 0));
  SELECT * INTO c FROM public.committees WHERE id = p_committee AND slug IS NOT NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND', 'field', 'committee'); END IF;
  IF c.archived_at IS NOT NULL THEN RETURN jsonb_build_object('code', 'COMMITTEE_ARCHIVED', 'field', 'committee'); END IF;
  SELECT * INTO t FROM private.committee_teams WHERE id = p_team;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND', 'field', 'team'); END IF;
  IF t.committee_id <> p_committee THEN RETURN jsonb_build_object('code', 'HIERARCHY_MISMATCH', 'field', 'team'); END IF;
  IF t.status <> 'active' THEN RETURN jsonb_build_object('code', 'TEAM_INACTIVE', 'field', 'team'); END IF;
  IF NOT EXISTS (SELECT 1 FROM private.organizational_positions WHERE id = p_position AND active AND requestable) THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'position'); END IF;
  IF EXISTS (SELECT 1 FROM private.leadership_appointments WHERE member_id = p_actor AND team_id = p_team
      AND ended_at IS NULL) THEN
    RETURN jsonb_build_object('code', 'ALREADY_APPOINTED'); END IF;
  IF EXISTS (SELECT 1 FROM private.leadership_requests WHERE member_id = p_actor AND team_id = p_team
      AND status = 'pending') THEN
    RETURN jsonb_build_object('code', 'ALREADY_PENDING'); END IF;
  SELECT leadership_requests_per_30_days INTO v_limit FROM private.verification_settings;
  IF private.leadership_recent_requests(p_actor) >= v_limit THEN
    RETURN jsonb_build_object('code', 'RATE_LIMITED'); END IF;
  BEGIN
    INSERT INTO private.leadership_requests (member_id, committee_id, team_id, position_id)
    VALUES (p_actor, p_committee, p_team, p_position) RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('code', 'ALREADY_PENDING');
  END;
  INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
  VALUES (p_committee, 'authenticated', p_actor, 'leadership.requested', jsonb_build_object('requestId', v_id,
    'memberId', p_actor, 'teamId', p_team, 'position', p_position));
  RETURN private.get_own_leadership(p_actor) || jsonb_build_object('requestId', v_id);
END $$;

-- Reviewer queue: 25 a page, the pending ones oldest first.
CREATE FUNCTION private.list_leadership_requests(p_actor uuid, p_status text, p_committee uuid, p_team uuid,
  p_query text, p_from timestamptz, p_to timestamptz, p_offset integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_query text := nullif(btrim(coalesce(p_query, '')), ''); v_pattern text;
BEGIN
  IF private.leadership_reviewer_kind(p_actor, false) IS NULL THEN
    RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  IF p_status IS NULL OR p_status NOT IN ('pending', 'approved', 'rejected', 'cancelled', 'all')
     OR p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 100000 OR char_length(coalesce(v_query, '')) > 100 THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR'); END IF;
  v_pattern := '%' || replace(replace(replace(coalesce(v_query, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  RETURN (WITH matched AS (
    SELECT r.*, m.full_name, m.email, t.name_en, t.name_ar, t.status AS team_status, c.name AS committee_name
    FROM private.leadership_requests r
    JOIN public.members m ON m.id = r.member_id
    JOIN private.committee_teams t ON t.id = r.team_id
    JOIN public.committees c ON c.id = r.committee_id
    WHERE (p_status = 'all' OR r.status = p_status)
      AND (p_committee IS NULL OR r.committee_id = p_committee OR t.committee_id = p_committee)
      AND (p_team IS NULL OR r.team_id = p_team)
      AND (v_query IS NULL OR m.full_name ILIKE v_pattern ESCAPE '\' OR m.email ILIKE v_pattern ESCAPE '\')
      AND (p_from IS NULL OR r.submitted_at >= p_from) AND (p_to IS NULL OR r.submitted_at < p_to)
  ), page AS (
    SELECT matched.*, row_number() OVER (ORDER BY (status = 'pending') DESC,
      CASE WHEN status = 'pending' THEN submitted_at END ASC, submitted_at DESC, id) AS ord
    FROM matched
  )
  SELECT jsonb_build_object('code', 'SUCCESS', 'total', (SELECT count(*) FROM matched),
    'items', coalesce((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'memberId', p.member_id,
        'name', p.full_name, 'email', p.email, 'status', p.status, 'submittedAt', p.submitted_at,
        'decidedAt', p.decided_at, 'own', p.member_id = p_actor,
        'committee', jsonb_build_object('id', p.committee_id, 'name', p.committee_name),
        'team', jsonb_build_object('id', p.team_id, 'name', jsonb_build_object('en', p.name_en, 'ar', p.name_ar),
          'status', p.team_status),
        'position', private.position_json(p.position_id)) ORDER BY p.ord)
      FROM page p WHERE p.ord > p_offset AND p.ord <= p_offset + 25), '[]'::jsonb)));
END $$;

-- Committees and their teams for the reviewers' filters, in every status so history stays
-- filterable. Names only.
CREATE FUNCTION private.leadership_filter_options(p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF private.leadership_reviewer_kind(p_actor, false) IS NULL THEN
    RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  RETURN jsonb_build_object('code', 'SUCCESS', 'committees', (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'name', c.name, 'archived', c.archived_at IS NOT NULL,
      'teams', (SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name_en, 'status', t.status)
        ORDER BY t.name_en) FROM private.committee_teams t WHERE t.committee_id = c.id))
      ORDER BY c.name), '[]'::jsonb)
    FROM public.committees c
    WHERE c.slug IS NOT NULL AND EXISTS (SELECT 1 FROM private.committee_teams t WHERE t.committee_id = c.id)));
END $$;

CREATE FUNCTION private.get_leadership_request(p_actor uuid, p_request uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_kind text := private.leadership_reviewer_kind(p_actor, false);
  r private.leadership_requests%ROWTYPE; t private.committee_teams%ROWTYPE; m public.members%ROWTYPE;
  a private.leadership_appointments%ROWTYPE; v_has boolean;
BEGIN
  IF v_kind IS NULL THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  SELECT * INTO r FROM private.leadership_requests WHERE id = p_request;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  SELECT * INTO t FROM private.committee_teams WHERE id = r.team_id;
  SELECT * INTO m FROM public.members WHERE id = r.member_id;
  SELECT * INTO a FROM private.leadership_appointments WHERE id = r.appointment_id;
  v_has := FOUND;
  RETURN jsonb_build_object('code', 'SUCCESS', 'reviewer', v_kind, 'own', r.member_id = p_actor,
    'request', jsonb_build_object('id', r.id, 'status', r.status, 'submittedAt', r.submitted_at,
      'decidedAt', r.decided_at, 'decidedByEmail', private.membership_actor_email(r.decided_by),
      'rejectionReason', r.rejection_reason, 'cancellationReason', r.cancellation_reason,
      'reviewerNote', r.reviewer_note, 'revision', r.revision,
      'committee', (SELECT jsonb_build_object('id', id, 'name', name, 'archived', archived_at IS NOT NULL)
        FROM public.committees WHERE id = r.committee_id),
      'position', private.position_json(r.position_id)),
    'team', private.team_json(t) || jsonb_build_object('committee', (SELECT jsonb_build_object('id', id,
      'name', name, 'archived', archived_at IS NOT NULL) FROM public.committees WHERE id = t.committee_id)),
    'stale', r.status = 'pending' AND (t.committee_id <> r.committee_id OR t.status <> 'active'
      OR EXISTS (SELECT 1 FROM public.committees WHERE id = t.committee_id AND archived_at IS NOT NULL)),
    'holders', (SELECT coalesce(jsonb_agg(jsonb_build_object('appointmentId', x.id, 'memberId', x.member_id,
        'name', xm.full_name) ORDER BY xm.full_name), '[]'::jsonb)
      FROM private.leadership_appointments x JOIN public.members xm ON xm.id = x.member_id
      WHERE x.team_id = r.team_id AND x.position_id = r.position_id AND x.ended_at IS NULL),
    'maxHolders', (SELECT max_holders_per_team FROM private.organizational_positions WHERE id = r.position_id),
    'appointment', CASE WHEN v_has THEN jsonb_build_object('id', a.id, 'active', a.ended_at IS NULL,
      'position', private.position_json(a.position_id), 'revision', a.revision, 'endedAt', a.ended_at,
      'endedByEmail', private.membership_actor_email(a.ended_by), 'endReason', a.end_reason,
      'endNote', a.end_note) END,
    'member', jsonb_build_object('id', m.id, 'name', m.full_name, 'email', m.email, 'memberSince', m.created_at)
      || private.membership_details_json(m.category, m.institution_id, m.institution_name),
    'memberAppointments', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', x.id,
        'committee', c.name, 'team', private.team_json(xt), 'position', private.position_json(x.position_id))
        ORDER BY x.appointed_at), '[]'::jsonb)
      FROM private.leadership_appointments x JOIN private.committee_teams xt ON xt.id = x.team_id
      JOIN public.committees c ON c.id = xt.committee_id
      WHERE x.member_id = r.member_id AND x.ended_at IS NULL),
    'history', (SELECT coalesce(jsonb_agg(jsonb_build_object('occurredAt', h.occurred_at, 'action', h.action,
        'actorKind', h.actor_kind, 'actorEmail', private.membership_actor_email(h.actor_user_id),
        'changes', h.changes - 'memberId') ORDER BY h.occurred_at, h.id), '[]'::jsonb)
      FROM private.uc02_audit h
      WHERE (h.action LIKE 'leadership.%' AND h.changes ->> 'requestId' = r.id::text)
        OR (r.appointment_id IS NOT NULL AND h.action LIKE 'appointment.%'
          AND h.changes ->> 'appointmentId' = r.appointment_id::text)));
END $$;

CREATE FUNCTION private.decide_leadership_request(p_actor uuid, p_request uuid, p_revision integer,
  p_decision text, p_reason text, p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_kind text; r private.leadership_requests%ROWTYPE; t private.committee_teams%ROWTYPE;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), ''); v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_result jsonb;
BEGIN
  IF p_request IS NULL OR p_revision IS NULL OR p_decision IS NULL OR p_decision NOT IN ('approve', 'reject')
     OR NOT private.note_text_valid(v_note, 1000) THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'note'); END IF;
  IF p_decision = 'reject' AND (v_reason IS NULL OR NOT private.note_text_valid(v_reason, 500)) THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'rejectionReason'); END IF;
  v_kind := private.leadership_reviewer_kind(p_actor, true);
  IF v_kind IS NULL THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  PERFORM private.lock_organization(true);
  SELECT * INTO r FROM private.leadership_requests WHERE id = p_request FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  IF r.member_id = p_actor THEN RETURN jsonb_build_object('code', 'SELF_REVIEW'); END IF;
  IF r.revision <> p_revision THEN RETURN jsonb_build_object('code', 'STALE_REVISION'); END IF;
  IF r.status <> 'pending' THEN RETURN jsonb_build_object('code', 'INVALID_TRANSITION'); END IF;
  IF p_decision = 'reject' THEN
    UPDATE private.leadership_requests SET status = 'rejected', decided_by = p_actor, decided_at = clock_timestamp(),
      rejection_reason = v_reason, reviewer_note = v_note, revision = revision + 1
    WHERE id = r.id;
    INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
    VALUES (r.committee_id, 'authenticated', p_actor, 'leadership.rejected', jsonb_build_object('requestId', r.id,
      'memberId', r.member_id, 'teamId', r.team_id, 'position', r.position_id, 'reviewer', v_kind,
      'hasNote', v_note IS NOT NULL));
    RETURN jsonb_build_object('code', 'SUCCESS', 'status', 'rejected', 'revision', r.revision + 1);
  END IF;
  -- Approval only against the structure the member chose, still live.
  SELECT * INTO t FROM private.committee_teams WHERE id = r.team_id FOR UPDATE;
  IF t.committee_id <> r.committee_id OR t.status <> 'active'
     OR EXISTS (SELECT 1 FROM public.committees WHERE id = t.committee_id AND (archived_at IS NOT NULL OR slug IS NULL))
     OR NOT EXISTS (SELECT 1 FROM private.organizational_positions WHERE id = r.position_id AND active) THEN
    RETURN jsonb_build_object('code', 'STALE_STRUCTURE'); END IF;
  v_result := private.leadership_appoint(r.member_id, r.team_id, r.position_id, p_actor, 'request', v_note);
  IF v_result->>'code' <> 'SUCCESS' THEN RETURN v_result; END IF;
  UPDATE private.leadership_requests SET status = 'approved', decided_by = p_actor, decided_at = clock_timestamp(),
    reviewer_note = v_note, appointment_id = (v_result->>'appointmentId')::uuid, revision = revision + 1
  WHERE id = r.id;
  INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
  VALUES (t.committee_id, 'authenticated', p_actor, 'leadership.approved', jsonb_build_object('requestId', r.id,
    'memberId', r.member_id, 'appointmentId', v_result->>'appointmentId', 'teamId', r.team_id,
    'position', r.position_id, 'reviewer', v_kind, 'hasNote', v_note IS NOT NULL));
  RETURN jsonb_build_object('code', 'SUCCESS', 'status', 'approved', 'revision', r.revision + 1,
    'appointmentId', v_result->>'appointmentId');
END $$;

-- Direct appointment, without a request, by a leadership reviewer (Board Administration on the
-- committee page). Technical access alone does not appoint.
CREATE FUNCTION private.assign_leadership(p_actor uuid, p_member uuid, p_team uuid, p_position text, p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE t private.committee_teams%ROWTYPE; v_note text := nullif(btrim(coalesce(p_note, '')), ''); v_result jsonb;
BEGIN
  IF NOT private.note_text_valid(v_note, 1000) THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'note'); END IF;
  IF private.leadership_reviewer_kind(p_actor, true) IS NULL THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  IF p_member = p_actor THEN RETURN jsonb_build_object('code', 'SELF_REVIEW'); END IF;
  PERFORM private.lock_organization(true);
  SELECT * INTO t FROM private.committee_teams WHERE id = p_team FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  IF t.status <> 'active' THEN RETURN jsonb_build_object('code', 'TEAM_INACTIVE'); END IF;
  IF EXISTS (SELECT 1 FROM public.committees WHERE id = t.committee_id AND archived_at IS NOT NULL) THEN
    RETURN jsonb_build_object('code', 'COMMITTEE_ARCHIVED'); END IF;
  IF NOT EXISTS (SELECT 1 FROM private.organizational_positions WHERE id = p_position AND active) THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'position'); END IF;
  PERFORM 1 FROM public.members WHERE id = p_member FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'MEMBER_NOT_FOUND'); END IF;
  IF EXISTS (SELECT 1 FROM private.leadership_requests WHERE member_id = p_member AND team_id = p_team
      AND status = 'pending') THEN
    RETURN jsonb_build_object('code', 'PENDING_REQUEST'); END IF;
  v_result := private.leadership_appoint(p_member, p_team, p_position, p_actor, 'direct', v_note);
  IF v_result->>'code' <> 'SUCCESS' THEN RETURN v_result; END IF;
  INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
  VALUES (t.committee_id, 'authenticated', p_actor, 'appointment.created', jsonb_build_object(
    'appointmentId', v_result->>'appointmentId', 'memberId', p_member, 'teamId', p_team,
    'position', p_position, 'source', 'direct', 'hasNote', v_note IS NOT NULL));
  RETURN v_result;
END $$;

-- A leadership reviewer changes an active appointment's position, within the position limits.
CREATE FUNCTION private.update_leadership_appointment(p_actor uuid, p_appointment uuid, p_revision integer,
  p_position text, p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a private.leadership_appointments%ROWTYPE; t private.committee_teams%ROWTYPE; v_max integer;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
BEGIN
  IF p_revision IS NULL OR NOT private.note_text_valid(v_note, 1000) THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'note'); END IF;
  IF private.leadership_reviewer_kind(p_actor, true) IS NULL THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  PERFORM private.lock_organization(true);
  SELECT * INTO a FROM private.leadership_appointments WHERE id = p_appointment FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  IF a.member_id = p_actor THEN RETURN jsonb_build_object('code', 'SELF_REVIEW'); END IF;
  IF a.revision <> p_revision THEN RETURN jsonb_build_object('code', 'STALE_REVISION'); END IF;
  IF a.ended_at IS NOT NULL THEN RETURN jsonb_build_object('code', 'INVALID_TRANSITION'); END IF;
  IF a.position_id = p_position THEN RETURN jsonb_build_object('code', 'UNCHANGED'); END IF;
  IF NOT EXISTS (SELECT 1 FROM private.organizational_positions WHERE id = p_position AND active) THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'position'); END IF;
  SELECT * INTO t FROM private.committee_teams WHERE id = a.team_id FOR UPDATE;
  IF t.status <> 'active' THEN RETURN jsonb_build_object('code', 'TEAM_INACTIVE'); END IF;
  SELECT max_holders_per_team INTO v_max FROM private.organizational_positions WHERE id = p_position;
  IF v_max IS NOT NULL AND (SELECT count(*) FROM private.leadership_appointments
      WHERE team_id = a.team_id AND position_id = p_position AND ended_at IS NULL) >= v_max THEN
    RETURN jsonb_build_object('code', 'POSITION_FULL'); END IF;
  UPDATE private.leadership_appointments SET position_id = p_position, updated_by = p_actor,
    updated_at = clock_timestamp(), revision = revision + 1
  WHERE id = a.id;
  INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
  VALUES (t.committee_id, 'authenticated', p_actor, 'appointment.updated', jsonb_build_object(
    'appointmentId', a.id, 'memberId', a.member_id, 'teamId', a.team_id, 'previousPosition', a.position_id,
    'position', p_position, 'hasNote', v_note IS NOT NULL, 'note', v_note));
  RETURN jsonb_build_object('code', 'SUCCESS', 'revision', a.revision + 1);
END $$;

-- A leadership reviewer (Board Administration or Society Affairs) ends an appointment with a reason.
CREATE FUNCTION private.revoke_leadership_appointment(p_actor uuid, p_appointment uuid, p_revision integer,
  p_reason text, p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_kind text; a private.leadership_appointments%ROWTYPE; v_committee uuid;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), ''); v_note text := nullif(btrim(coalesce(p_note, '')), '');
BEGIN
  IF p_revision IS NULL OR v_reason IS NULL OR NOT private.note_text_valid(v_reason, 500) THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'reason'); END IF;
  IF NOT private.note_text_valid(v_note, 1000) THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'note'); END IF;
  v_kind := private.leadership_reviewer_kind(p_actor, true);
  IF v_kind IS NULL THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  PERFORM private.lock_organization(true);
  SELECT * INTO a FROM private.leadership_appointments WHERE id = p_appointment FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  IF a.member_id = p_actor THEN RETURN jsonb_build_object('code', 'SELF_REVIEW'); END IF;
  IF a.revision <> p_revision THEN RETURN jsonb_build_object('code', 'STALE_REVISION'); END IF;
  IF a.ended_at IS NOT NULL THEN RETURN jsonb_build_object('code', 'INVALID_TRANSITION'); END IF;
  UPDATE private.leadership_appointments SET ended_at = clock_timestamp(), ended_by = p_actor,
    end_reason = v_reason, end_note = v_note, revision = revision + 1
  WHERE id = a.id;
  SELECT committee_id INTO v_committee FROM private.committee_teams WHERE id = a.team_id;
  INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
  VALUES (v_committee, 'authenticated', p_actor, 'appointment.revoked', jsonb_build_object(
    'appointmentId', a.id, 'memberId', a.member_id, 'teamId', a.team_id, 'position', a.position_id,
    'reviewer', v_kind, 'hasNote', v_note IS NOT NULL));
  RETURN jsonb_build_object('code', 'SUCCESS', 'revision', a.revision + 1);
END $$;

-- =============================================================================================
-- Settings (Technical only; readable by reviewers and senior administrators)
-- =============================================================================================
CREATE FUNCTION private.get_verification_settings(p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s private.verification_settings%ROWTYPE;
BEGIN
  IF private.membership_reviewer_kind(p_actor, false) IS NULL AND private.senior_admin_level(p_actor) IS NULL THEN
    RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  SELECT * INTO s FROM private.verification_settings;
  RETURN jsonb_build_object('code', 'SUCCESS',
    'squSubmissionsPer30Days', s.squ_submissions_per_30_days,
    'documentRetentionDays', s.document_retention_days,
    'leadershipRequestsPer30Days', s.leadership_requests_per_30_days,
    'maxActiveAppointmentsPerMember', s.max_active_appointments_per_member,
    'updatedAt', s.updated_at, 'updatedByEmail', private.membership_actor_email(s.updated_by),
    'positions', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', id,
        'label', jsonb_build_object('en', label_en, 'ar', label_ar), 'maxHolders', max_holders_per_team)
        ORDER BY rank), '[]'::jsonb) FROM private.organizational_positions WHERE active));
END $$;

CREATE FUNCTION private.set_verification_settings(p_actor uuid, p_squ_per_30_days integer,
  p_retention_days integer, p_leadership_per_30_days integer, p_max_active_appointments integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s private.verification_settings%ROWTYPE;
BEGIN
  IF p_squ_per_30_days IS NULL OR p_squ_per_30_days NOT BETWEEN 1 AND 20 THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'squSubmissionsPer30Days'); END IF;
  IF p_retention_days IS NOT NULL AND p_retention_days NOT BETWEEN 30 AND 3650 THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'documentRetentionDays'); END IF;
  IF p_leadership_per_30_days IS NULL OR p_leadership_per_30_days NOT BETWEEN 1 AND 50 THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'leadershipRequestsPer30Days'); END IF;
  IF p_max_active_appointments IS NOT NULL AND p_max_active_appointments NOT BETWEEN 1 AND 20 THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'maxActiveAppointmentsPerMember'); END IF;
  IF private.senior_admin_level(p_actor) IS DISTINCT FROM 'TECHNICAL' THEN
    RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  SELECT * INTO s FROM private.verification_settings FOR UPDATE;
  IF (s.squ_submissions_per_30_days, s.document_retention_days, s.leadership_requests_per_30_days,
      s.max_active_appointments_per_member) IS NOT DISTINCT FROM
     (p_squ_per_30_days::smallint, p_retention_days, p_leadership_per_30_days::smallint, p_max_active_appointments::smallint) THEN
    RETURN jsonb_build_object('code', 'UNCHANGED'); END IF;
  UPDATE private.verification_settings SET squ_submissions_per_30_days = p_squ_per_30_days,
    document_retention_days = p_retention_days, leadership_requests_per_30_days = p_leadership_per_30_days,
    max_active_appointments_per_member = p_max_active_appointments, updated_by = p_actor,
    updated_at = clock_timestamp();
  INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
  VALUES (NULL, 'authenticated', p_actor, 'verification.settings_changed', jsonb_build_object(
    'previous', jsonb_build_object('squSubmissionsPer30Days', s.squ_submissions_per_30_days,
      'documentRetentionDays', s.document_retention_days,
      'leadershipRequestsPer30Days', s.leadership_requests_per_30_days,
      'maxActiveAppointmentsPerMember', s.max_active_appointments_per_member),
    'next', jsonb_build_object('squSubmissionsPer30Days', p_squ_per_30_days,
      'documentRetentionDays', p_retention_days, 'leadershipRequestsPer30Days', p_leadership_per_30_days,
      'maxActiveAppointmentsPerMember', p_max_active_appointments)));
  RETURN jsonb_build_object('code', 'SUCCESS');
END $$;

-- A lower limit never ends existing appointments; it only refuses new ones until under it.
CREATE FUNCTION private.set_position_limit(p_actor uuid, p_position text, p_max integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_previous integer;
BEGIN
  IF p_max IS NOT NULL AND p_max NOT BETWEEN 1 AND 50 THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'maxHolders'); END IF;
  IF private.senior_admin_level(p_actor) IS DISTINCT FROM 'TECHNICAL' THEN
    RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  PERFORM private.lock_organization(true);
  SELECT max_holders_per_team INTO v_previous FROM private.organizational_positions WHERE id = p_position FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  IF v_previous IS NOT DISTINCT FROM p_max THEN RETURN jsonb_build_object('code', 'UNCHANGED'); END IF;
  UPDATE private.organizational_positions SET max_holders_per_team = p_max WHERE id = p_position;
  INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
  VALUES (NULL, 'authenticated', p_actor, 'position.limit_changed', jsonb_build_object(
    'position', p_position, 'previous', v_previous, 'next', p_max));
  RETURN jsonb_build_object('code', 'SUCCESS');
END $$;

-- =============================================================================================
-- Administration routines of 0032, extended for teams, verification and appointments
-- =============================================================================================

-- Archiving a committee is also refused while its teams have active appointments, and closes
-- their pending requests. Everything else is 0032's routine.
CREATE OR REPLACE FUNCTION private.admin_set_committee_archived(p_actor uuid, p_committee uuid, p_archived boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_old public.committees%ROWTYPE; v_managers integer; v_upcoming integer; v_appointments integer;
  v_team uuid; v_cancelled integer := 0;
BEGIN
  IF p_archived IS NULL THEN RETURN jsonb_build_object('code', 'VALIDATION_ERROR'); END IF;
  -- The ownership lock orders this against concurrent manager grants into the committee.
  PERFORM pg_advisory_xact_lock(hashtextextended('technical-ownership', 0));
  IF private.senior_admin_level(p_actor) IS NULL THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  PERFORM private.lock_organization(true);
  SELECT * INTO v_old FROM public.committees WHERE id = p_committee AND slug IS NOT NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  IF p_archived THEN
    IF v_old.archived_at IS NOT NULL THEN RETURN jsonb_build_object('code', 'ALREADY_ARCHIVED'); END IF;
    IF v_old.slug IN ('society-affairs', 'technical-team') THEN
      RETURN jsonb_build_object('code', 'PROTECTED_COMMITTEE'); END IF;
    SELECT count(*) INTO v_managers FROM public.administrative_access
      WHERE committee_id = p_committee AND revoked_at IS NULL;
    SELECT count(*) INTO v_upcoming FROM public.events
      WHERE committee_id = p_committee AND archived_at IS NULL
        AND status IN ('published', 'full') AND event_date > clock_timestamp();
    SELECT count(*) INTO v_appointments FROM private.leadership_appointments a
      JOIN private.committee_teams t ON t.id = a.team_id
      WHERE t.committee_id = p_committee AND a.ended_at IS NULL;
    IF v_managers > 0 OR v_upcoming > 0 OR v_appointments > 0 THEN
      RETURN jsonb_build_object('code', 'BLOCKED', 'managers', v_managers, 'upcomingEvents', v_upcoming,
        'appointments', v_appointments); END IF;
    FOR v_team IN SELECT id FROM private.committee_teams WHERE committee_id = p_committee LOOP
      v_cancelled := v_cancelled + private.cancel_team_requests(v_team, 'committee_archived', p_actor);
    END LOOP;
    UPDATE public.committees SET archived_at = clock_timestamp(), updated_at = clock_timestamp() WHERE id = p_committee;
  ELSE
    IF v_old.archived_at IS NULL THEN RETURN jsonb_build_object('code', 'NOT_ARCHIVED'); END IF;
    UPDATE public.committees SET archived_at = NULL, updated_at = clock_timestamp() WHERE id = p_committee;
  END IF;
  INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
  VALUES (p_committee, 'authenticated', p_actor,
    CASE WHEN p_archived THEN 'committee.archived' ELSE 'committee.restored' END,
    jsonb_build_object('name', v_old.name) || CASE WHEN v_cancelled > 0
      THEN jsonb_build_object('cancelledRequests', v_cancelled) ELSE '{}'::jsonb END);
  RETURN jsonb_build_object('code', 'SUCCESS');
END $$;

-- The committee page's activity includes teams and appointments.
CREATE OR REPLACE FUNCTION private.admin_activity_actions() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['committee.created', 'committee.updated', 'committee.archived', 'committee.restored',
    'committee.member_added', 'committee.member_updated', 'committee.member_removed',
    'manager.assigned', 'manager.reassigned', 'manager.revoked', 'board_admin.granted',
    'board_admin.revoked', 'technical.granted', 'technical.revoked', 'access.suspended',
    'access.reactivated', 'user.created', 'user.invited', 'event.deleted', 'project.deleted',
    'member.deleted', 'account.erasure_started', 'account.erased',
    'team.created', 'team.updated', 'team.moved', 'team.status_changed', 'team.deleted',
    'leadership.approved', 'appointment.created', 'appointment.updated', 'appointment.revoked']
$$;

-- 0032's member view, with category details, SQU verification and appointments.
CREATE OR REPLACE FUNCTION private.admin_get_member(p_actor uuid, p_member uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE m public.members%ROWTYPE;
BEGIN
  IF private.senior_admin_level(p_actor) IS NULL THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  SELECT * INTO m FROM public.members WHERE id = p_member;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  RETURN jsonb_build_object('code', 'SUCCESS',
    'member', jsonb_build_object('id', m.id, 'name', m.full_name, 'email', m.email,
      'universityId', m.university_id, 'year', m.year, 'discipline', m.major, 'status', m.status,
      'interests', to_jsonb(coalesce(m.interests, '{}'::text[])), 'hasPhoto', m.photo_key IS NOT NULL,
      'createdAt', m.created_at, 'updatedAt', m.updated_at)
      || private.membership_details_json(m.category, m.institution_id, m.institution_name),
    'account', (SELECT jsonb_build_object('email', u.email, 'confirmed', u.email_confirmed_at IS NOT NULL,
        'createdAt', u.created_at, 'lastSignInAt', u.last_sign_in_at)
      FROM private.access_auth_users u WHERE u.id = m.id),
    'access', (SELECT jsonb_build_object('level', a.access_level, 'committee', c.name, 'active', a.revoked_at IS NULL,
        'revocationKind', CASE WHEN a.revoked_at IS NULL THEN NULL ELSE coalesce(a.revocation_kind, 'revoked') END)
      FROM public.administrative_access a LEFT JOIN public.committees c ON c.id = a.committee_id
      WHERE a.user_id = m.id),
    'applications', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', ap.id, 'status', ap.status,
        'submittedAt', ap.submitted_at, 'decidedAt', ap.decided_at, 'activatedAt', ap.activated_at)
        ORDER BY ap.submitted_at DESC), '[]'::jsonb)
      FROM private.membership_applications ap WHERE ap.member_id = m.id OR ap.auth_user_id = m.id),
    'projects', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.id,
        'title', coalesce(nullif(btrim(p.content -> 'title' ->> 'en'), ''), nullif(btrim(p.content -> 'title' ->> 'ar'), '')),
        'status', p.status, 'published', p.published_revision IS NOT NULL, 'updatedAt', p.updated_at)
        ORDER BY p.updated_at DESC), '[]'::jsonb)
      FROM private.projects p WHERE p.member_id = m.id),
    'registrations', (SELECT coalesce(jsonb_agg(r ORDER BY r -> 'eventDate' DESC), '[]'::jsonb) FROM (
      SELECT jsonb_build_object('eventId', e.id, 'title', e.title, 'eventDate', e.event_date,
        'status', rg.status, 'attended', rg.attended) AS r
      FROM public.registrations rg JOIN public.events e ON e.id = rg.event_id
      WHERE rg.member_id = m.id ORDER BY e.event_date DESC LIMIT 50) x),
    'registrationCount', (SELECT count(*) FROM public.registrations WHERE member_id = m.id),
    'committees', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name,
        'responsibility', cm.responsibility, 'archived', c.archived_at IS NOT NULL) ORDER BY c.name), '[]'::jsonb)
      FROM private.committee_members cm JOIN public.committees c ON c.id = cm.committee_id
      WHERE cm.member_id = m.id),
    'changeRequests', (SELECT coalesce(jsonb_agg(jsonb_build_object('field', cr.field, 'status', cr.status,
        'requestedAt', cr.requested_at) ORDER BY cr.requested_at DESC), '[]'::jsonb)
      FROM private.member_change_requests cr WHERE cr.member_id = m.id),
    'squVerification', (SELECT jsonb_build_object('status', s ->> 'status', 'verifiedAt', s -> 'verifiedAt')
      FROM private.squ_state(m.id) s),
    'appointments', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'committee', c.name,
        'team', private.team_json(t), 'position', private.position_json(a.position_id), 'appointedAt', a.appointed_at)
        ORDER BY a.appointed_at), '[]'::jsonb)
      FROM private.leadership_appointments a JOIN private.committee_teams t ON t.id = a.team_id
      JOIN public.committees c ON c.id = t.committee_id
      WHERE a.member_id = m.id AND a.ended_at IS NULL));
END $$;

-- 0032's deletion summary. Decisions about other people's verification and appointments are
-- accountability records too, and the preview counts the person's own new records.
CREATE OR REPLACE FUNCTION private.member_deletion_summary(p_user uuid, p_mode text) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE m public.members%ROWTYPE; v_member boolean; v_email text; v_auth boolean;
  v_emails text[] := private.person_emails(p_user); v_projects integer; v_legacy integer;
  v_active text; v_accountability integer := 0; v_blockers text[] := '{}';
BEGIN
  SELECT * INTO m FROM public.members WHERE id = p_user; v_member := FOUND;
  SELECT email::text INTO v_email FROM private.access_auth_users WHERE id = p_user; v_auth := FOUND;
  IF (p_mode = 'membership' AND NOT v_member) OR (p_mode = 'account' AND NOT v_auth) THEN RETURN NULL; END IF;
  SELECT count(*) INTO v_projects FROM private.projects WHERE member_id = p_user;
  SELECT (SELECT count(*) FROM public.archive_items WHERE uploaded_by = p_user)
    + (SELECT count(*) FROM public.mentorship_connections WHERE graduate_id = p_user OR member_id = p_user)
    INTO v_legacy;
  IF v_projects > 0 THEN v_blockers := array_append(v_blockers, 'MEMBER_HAS_PROJECTS'); END IF;
  IF v_legacy > 0 THEN v_blockers := array_append(v_blockers, 'LEGACY_RECORDS'); END IF;
  IF p_mode = 'account' THEN
    SELECT access_level::text INTO v_active FROM public.administrative_access WHERE user_id = p_user AND revoked_at IS NULL;
    IF v_active IS NOT NULL THEN v_blockers := array_append(v_blockers, 'ACTIVE_ACCESS'); END IF;
    SELECT (SELECT count(*) FROM public.administrative_access WHERE user_id <> p_user
          AND (granted_by = p_user OR revoked_by = p_user))
      + (SELECT count(*) FROM public.events WHERE flagged_by = p_user OR approved_by = p_user)
      + (SELECT count(*) FROM private.membership_applications WHERE (verified_by = p_user OR decided_by = p_user)
          AND coalesce(member_id, auth_user_id) IS DISTINCT FROM p_user AND NOT (lower(email) = ANY (v_emails)))
      + (SELECT count(*) FROM private.member_change_requests WHERE decided_by = p_user AND member_id <> p_user)
      + (SELECT count(*) FROM private.membership_settings WHERE updated_by = p_user)
      + (SELECT count(*) FROM private.project_history h JOIN private.projects pr ON pr.id = h.project_id
          WHERE h.actor_id = p_user AND pr.member_id <> p_user)
      + (SELECT count(*) FROM private.squ_verification_requests WHERE decided_by = p_user AND member_id <> p_user)
      + (SELECT count(*) FROM private.squ_verifications WHERE (verified_by = p_user OR revoked_by = p_user)
          AND member_id <> p_user)
      + (SELECT count(*) FROM private.leadership_requests WHERE decided_by = p_user AND member_id <> p_user)
      + (SELECT count(*) FROM private.leadership_appointments WHERE member_id <> p_user
          AND (appointed_by = p_user OR updated_by = p_user OR ended_by = p_user))
      + (SELECT count(*) FROM private.verification_settings WHERE updated_by = p_user)
      INTO v_accountability;
    IF v_accountability > 0 THEN v_blockers := array_append(v_blockers, 'ACCOUNTABILITY_RECORDS'); END IF;
  END IF;
  RETURN jsonb_build_object('userId', p_user, 'mode', p_mode,
    'name', CASE WHEN v_member THEN m.full_name END,
    'membershipEmail', CASE WHEN v_member THEN m.email END,
    'signInEmail', v_email, 'hasMember', v_member, 'hasAccount', v_auth,
    'confirmation', CASE WHEN p_mode = 'account' THEN v_email ELSE m.email END,
    'registrations', (SELECT count(*) FROM public.registrations
      WHERE member_id = p_user OR attendee_email = ANY (v_emails)),
    'applications', (SELECT count(*) FROM private.membership_applications
      WHERE member_id = p_user OR auth_user_id = p_user OR lower(email) = ANY (v_emails)),
    'storedIdCards', (SELECT count(*) FROM private.membership_documents d JOIN private.membership_applications a
      ON a.id = d.application_id WHERE (a.member_id = p_user OR a.auth_user_id = p_user OR lower(a.email) = ANY (v_emails))
        AND d.storage_key IS NOT NULL)
      + (SELECT count(*) FROM private.squ_verification_documents d JOIN private.squ_verification_requests r
          ON r.id = d.request_id WHERE r.member_id = p_user AND d.storage_key IS NOT NULL),
    'changeRequests', (SELECT count(*) FROM private.member_change_requests WHERE member_id = p_user),
    'committees', (SELECT count(*) FROM private.committee_members WHERE member_id = p_user),
    'verificationRequests', (SELECT count(*) FROM private.squ_verification_requests WHERE member_id = p_user),
    'leadershipRequests', (SELECT count(*) FROM private.leadership_requests WHERE member_id = p_user),
    'appointments', (SELECT count(*) FROM private.leadership_appointments WHERE member_id = p_user),
    'photo', v_member AND m.photo_key IS NOT NULL,
    'projects', v_projects, 'legacyRecords', v_legacy,
    'activeAccess', v_active,
    'formerAccess', EXISTS (SELECT 1 FROM public.administrative_access WHERE user_id = p_user AND revoked_at IS NOT NULL),
    'accountabilityRecords', v_accountability,
    'auditAsActor', (SELECT count(*) FROM private.uc02_audit WHERE actor_user_id = p_user),
    'pendingErasure', EXISTS (SELECT 1 FROM private.account_erasures WHERE user_id = p_user),
    'blockers', to_jsonb(v_blockers));
END $$;

-- 0032's purge, which also removes the person's verification and leadership records. Evidence
-- objects are queued by the document trigger in the same transaction.
CREATE OR REPLACE FUNCTION private.purge_member_data(p_user uuid, p_photo_bucket text) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_emails text[] := private.person_emails(p_user); v_photo text;
  v_registrations integer; v_applications integer; v_requests integer; v_roster integer;
  v_verifications integer; v_leadership integer; v_appointments integer;
BEGIN
  SELECT photo_key INTO v_photo FROM public.members WHERE id = p_user;
  IF v_photo IS NOT NULL THEN
    INSERT INTO private.membership_storage_deletions (storage_bucket, storage_key, reason)
    VALUES (p_photo_bucket, v_photo, 'record_deleted') ON CONFLICT (storage_bucket, storage_key) DO NOTHING;
  END IF;
  UPDATE public.registrations SET member_id = NULL, attendee_name = 'Deleted member',
    attendee_email = 'deleted-' || id || '@erased.invalid', attendee_phone = NULL
  WHERE member_id = p_user OR attendee_email = ANY (v_emails);
  GET DIAGNOSTICS v_registrations = ROW_COUNT;
  DELETE FROM private.member_registration_attempts WHERE member_id = p_user;
  DELETE FROM private.committee_members WHERE member_id = p_user;
  GET DIAGNOSTICS v_roster = ROW_COUNT;
  DELETE FROM private.member_change_requests WHERE member_id = p_user;
  GET DIAGNOSTICS v_requests = ROW_COUNT;
  DELETE FROM private.leadership_requests WHERE member_id = p_user;
  GET DIAGNOSTICS v_leadership = ROW_COUNT;
  DELETE FROM private.leadership_appointments WHERE member_id = p_user;
  GET DIAGNOSTICS v_appointments = ROW_COUNT;
  DELETE FROM private.squ_verifications WHERE member_id = p_user;
  DELETE FROM private.squ_verification_requests WHERE member_id = p_user;
  GET DIAGNOSTICS v_verifications = ROW_COUNT;
  DELETE FROM private.membership_applications
  WHERE member_id = p_user OR auth_user_id = p_user OR lower(email) = ANY (v_emails);
  GET DIAGNOSTICS v_applications = ROW_COUNT;
  DELETE FROM public.members WHERE id = p_user;
  RETURN jsonb_build_object('registrationsAnonymized', v_registrations, 'applicationsDeleted', v_applications,
    'changeRequestsDeleted', v_requests, 'rosterRemoved', v_roster, 'photoQueued', v_photo IS NOT NULL,
    'verificationRequestsDeleted', v_verifications, 'leadershipRequestsDeleted', v_leadership,
    'appointmentsDeleted', v_appointments);
END $$;

-- The deletion worker also skips an object a verification document still references.
CREATE OR REPLACE FUNCTION private.claim_membership_storage_deletions(p_limit integer)
RETURNS TABLE (deletion_id uuid, bucket text, object_key text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN RETURN; END IF;
  RETURN QUERY
  WITH picked AS (
    SELECT q.id FROM private.membership_storage_deletions q
    WHERE q.completed_at IS NULL
      AND (q.last_attempt_at IS NULL OR q.last_attempt_at < clock_timestamp() - interval '1 minute')
      AND NOT EXISTS (SELECT 1 FROM private.membership_documents d
        WHERE d.storage_bucket = q.storage_bucket AND d.storage_key = q.storage_key)
      AND NOT EXISTS (SELECT 1 FROM private.squ_verification_documents s
        WHERE s.storage_bucket = q.storage_bucket AND s.storage_key = q.storage_key)
      AND NOT EXISTS (SELECT 1 FROM public.events e WHERE e.cover_image_key = q.storage_key)
      AND NOT EXISTS (SELECT 1 FROM private.project_media m WHERE m.object_key = q.storage_key)
      AND NOT EXISTS (SELECT 1 FROM public.members mb WHERE mb.photo_key = q.storage_key)
    ORDER BY q.requested_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE private.membership_storage_deletions q
  SET attempts = q.attempts + 1, last_attempt_at = clock_timestamp()
  FROM picked WHERE q.id = picked.id
  RETURNING q.id, q.storage_bucket, q.storage_key;
END;
$$;

-- =============================================================================================
-- Ownership and privileges: every new routine runs as uc02_routine_owner; app_runtime executes
-- only the entry points, and no browser role anything.
-- =============================================================================================
DO $$ DECLARE v_fn regprocedure; BEGIN
  FOR v_fn IN SELECT oid::regprocedure FROM pg_proc WHERE pronamespace = 'private'::regnamespace
    AND proname IN ('note_text_valid', 'membership_details_invalid_field', 'membership_details_json',
      'verification_reviewer_kind', 'leadership_reviewer_kind', 'lock_organization', 'team_json',
      'position_json', 'squ_submission_block', 'leadership_recent_requests',
      'squ_state', 'leadership_appoint', 'cancel_team_requests', 'get_membership_options',
      'submit_membership_application_v2', 'list_membership_applications', 'update_own_profile_v2',
      'get_own_squ_verification', 'get_own_leadership', 'begin_squ_verification', 'submit_squ_verification',
      'queue_abandoned_verification_upload',
      'list_squ_verifications', 'get_squ_verification', 'get_squ_verification_document', 'decide_squ_verification',
      'revoke_squ_verification', 'purge_expired_verification_documents', 'team_names_invalid',
      'admin_create_team', 'admin_update_team', 'admin_move_team', 'admin_set_team_status', 'admin_delete_team',
      'admin_list_committee_teams', 'get_leadership_options', 'request_leadership', 'list_leadership_requests',
      'leadership_filter_options',
      'get_leadership_request', 'decide_leadership_request', 'assign_leadership', 'update_leadership_appointment',
      'revoke_leadership_appointment', 'get_verification_settings', 'set_verification_settings',
      'set_position_limit') LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO uc02_routine_owner', v_fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, app_runtime, app_maintenance, service_role', v_fn);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION private.get_membership_options() TO app_runtime;
GRANT EXECUTE ON FUNCTION private.submit_membership_application_v2(text, text, text, text, text, integer, text, text[], text, text, inet) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.list_membership_applications(uuid, text, text, timestamptz, uuid, integer) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.update_own_profile_v2(uuid, text, text, text, text, integer, text, text[]) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.get_own_squ_verification(uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.get_own_leadership(uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.begin_squ_verification(uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.submit_squ_verification(uuid, text, text, text, integer, bytea, text, text) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.queue_abandoned_verification_upload(text, text) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.list_squ_verifications(uuid, text, text, timestamptz, timestamptz, integer) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.get_squ_verification(uuid, uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.get_squ_verification_document(uuid, uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.decide_squ_verification(uuid, uuid, integer, text, text, text) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.revoke_squ_verification(uuid, uuid, text, text) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.purge_expired_verification_documents(uuid, integer) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.admin_create_team(uuid, uuid, text, text, text, text) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.admin_update_team(uuid, uuid, text, text, text, text) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.admin_move_team(uuid, uuid, uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.admin_set_team_status(uuid, uuid, text) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.admin_delete_team(uuid, uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.admin_list_committee_teams(uuid, uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.get_leadership_options(uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.request_leadership(uuid, uuid, uuid, text) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.list_leadership_requests(uuid, text, uuid, uuid, text, timestamptz, timestamptz, integer) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.leadership_filter_options(uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.get_leadership_request(uuid, uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.decide_leadership_request(uuid, uuid, integer, text, text, text) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.assign_leadership(uuid, uuid, uuid, text, text) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.update_leadership_appointment(uuid, uuid, integer, text, text) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.revoke_leadership_appointment(uuid, uuid, integer, text, text) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.get_verification_settings(uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.set_verification_settings(uuid, integer, integer, integer, integer) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.set_position_limit(uuid, text, integer) TO app_runtime;

-- The migration proves its own boundary; any failure rolls the whole migration back.
DO $$
DECLARE v_table text;
BEGIN
  IF private.core_schema_version() <> 33 THEN RAISE EXCEPTION '0033 self-check failed: version'; END IF;
  FOREACH v_table IN ARRAY ARRAY['membership_categories', 'institutions', 'squ_verification_requests',
      'squ_verification_documents', 'squ_verifications', 'committee_teams', 'organizational_positions',
      'leadership_appointments', 'leadership_requests', 'verification_settings'] LOOP
    IF NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class
        WHERE oid = format('private.%I', v_table)::regclass) THEN
      RAISE EXCEPTION '0033 self-check failed: private.% must have forced row level security', v_table;
    END IF;
    IF has_table_privilege('app_runtime', format('private.%I', v_table), 'SELECT')
       OR has_table_privilege('app_maintenance', format('private.%I', v_table), 'SELECT')
       OR has_table_privilege('anon', format('private.%I', v_table), 'SELECT')
       OR has_table_privilege('authenticated', format('private.%I', v_table), 'SELECT') THEN
      RAISE EXCEPTION '0033 self-check failed: a login or browser role can read private.%', v_table;
    END IF;
  END LOOP;
  IF NOT has_function_privilege('app_runtime', 'private.decide_squ_verification(uuid,uuid,integer,text,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('app_runtime', 'private.decide_leadership_request(uuid,uuid,integer,text,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('app_runtime', 'private.list_membership_applications(uuid,text,text,timestamptz,uuid,integer)', 'EXECUTE')
     OR has_function_privilege('app_runtime', 'private.leadership_appoint(uuid,uuid,text,uuid,text,text)', 'EXECUTE')
     OR has_function_privilege('app_runtime', 'private.squ_state(uuid)', 'EXECUTE')
     OR has_function_privilege('app_runtime', 'private.cancel_team_requests(uuid,text,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'private.get_membership_options()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'private.get_own_squ_verification(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'private.get_own_leadership(uuid)', 'EXECUTE')
     OR has_function_privilege('app_runtime', 'private.verification_reviewer_kind(uuid,boolean)', 'EXECUTE')
     OR has_function_privilege('app_runtime', 'private.leadership_recent_requests(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'private.get_squ_verification_document(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '0033 self-check failed: routine privileges';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'squ_verification_document_removed'
      AND tgrelid = 'private.squ_verification_documents'::regclass AND tgenabled = 'O') THEN
    RAISE EXCEPTION '0033 self-check failed: the evidence removal trigger must be enabled';
  END IF;
  IF EXISTS (SELECT 1 FROM private.squ_verifications) THEN
    RAISE EXCEPTION '0033 self-check failed: no one may be SQU-verified by the migration';
  END IF;
END $$;
