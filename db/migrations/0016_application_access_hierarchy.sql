-- ADR 0012. This migration is atomic: the access source, catalog, RLS and
-- private routines change together. The legacy Events committee is retained
-- with a null slug and excluded from all application scope.

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM public.committee_managers
    GROUP BY user_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Multiple historical committee grants for one user require reconciliation before access migration';
  END IF;
END $$;

CREATE TYPE public.administrative_access_level AS ENUM
  ('COMMITTEE_MANAGER', 'BOARD_ADMIN', 'TECHNICAL');

ALTER TABLE public.committees ADD COLUMN slug text;
ALTER TABLE public.committees ADD CONSTRAINT committees_slug_format
  CHECK (slug IS NULL OR slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
CREATE UNIQUE INDEX committees_slug_unique ON public.committees (slug);

-- Match only explicit equivalent names. The generic Events row is never mapped.
DO $$
DECLARE v record; v_id uuid; v_count integer;
BEGIN
  FOR v IN SELECT * FROM (VALUES
    ('support-logistics', 'Support & Logistics Committee', 'لجنة الدعم والخدمات اللوجستية'),
    ('relations', 'Relations Committee', 'لجنة العلاقات'),
    ('society-affairs', 'Society Affairs Committee', 'لجنة شؤون الجمعية'),
    ('finance', 'Finance Committee', 'اللجنة المالية'),
    ('forum', 'Forum Committee', 'لجنة المنتدى'),
    ('evening', 'Evening Committee', 'اللجنة المسائية'),
    ('media', 'Media Committee', 'اللجنة الإعلامية'),
    ('technical-team', 'Technical Team', 'الفريق التقني')
  ) AS names(slug, name, arabic_name) LOOP
    SELECT count(*) INTO v_count
    FROM public.committees
    WHERE slug = v.slug OR name IN (v.name, v.arabic_name);
    IF v_count > 1 THEN
      RAISE EXCEPTION 'Ambiguous committee mapping for slug %', v.slug;
    ELSIF v_count = 1 THEN
      SELECT id INTO v_id FROM public.committees
      WHERE slug = v.slug OR name IN (v.name, v.arabic_name) LIMIT 1;
      UPDATE public.committees SET name = v.name, slug = v.slug WHERE id = v_id;
    ELSE
      INSERT INTO public.committees (name, slug) VALUES (v.name, v.slug);
    END IF;
  END LOOP;
END $$;

ALTER TABLE public.committee_managers RENAME TO administrative_access;
ALTER TABLE public.administrative_access
  DROP CONSTRAINT committee_managers_user_id_committee_id_pk;
ALTER TABLE public.administrative_access ALTER COLUMN committee_id DROP NOT NULL;
ALTER TABLE public.administrative_access
  ADD COLUMN access_level public.administrative_access_level NOT NULL
  DEFAULT 'COMMITTEE_MANAGER';
ALTER TABLE public.administrative_access ADD PRIMARY KEY (user_id);
ALTER INDEX public.committee_managers_committee_user_idx
  RENAME TO administrative_access_committee_user_idx;
ALTER TABLE public.administrative_access
  DROP CONSTRAINT committee_managers_revocation_consistency;
-- A migration revocation has no fictional Auth actor in revoked_by; the
-- append-only audit identifies the migration honestly.
ALTER TABLE public.administrative_access ADD CONSTRAINT administrative_access_revocation_consistency
  CHECK (revoked_at IS NOT NULL OR revoked_by IS NULL);
ALTER TABLE public.administrative_access ADD CONSTRAINT administrative_access_scope_check
  CHECK ((access_level = 'COMMITTEE_MANAGER') = (committee_id IS NOT NULL));

ALTER TABLE private.uc02_audit ALTER COLUMN committee_id DROP NOT NULL;
ALTER TABLE private.uc02_audit DROP CONSTRAINT uc02_audit_action_check;
ALTER TABLE private.uc02_audit ADD CONSTRAINT uc02_audit_action_check CHECK (action IN (
  'event.created','event.updated','event.published','event.held',
  'event.reopened','event.archived','event.restored',
  'event.review_flagged','event.review_unflagged','event.approved','event.review_rejected',
  'registration.created','registration.waitlisted','registration.promoted',
  'registration.superseded','grant.activated','grant.revoked',
  'access.granted','access.reassigned','access.revoked','access.technical_changed',
  'registrations.exported','history.imported'
));

WITH revoked AS (
  UPDATE public.administrative_access a
  SET revoked_at = now(), revoked_by = NULL
  FROM public.committees c
  WHERE a.committee_id = c.id AND c.name = 'Events' AND c.slug IS NULL
    AND a.revoked_at IS NULL
  RETURNING a.user_id, a.committee_id
)
INSERT INTO private.uc02_audit
  (committee_id, actor_kind, action, changes)
SELECT committee_id, 'migration', 'access.revoked',
  jsonb_build_object('userId', user_id,
    'previous', jsonb_build_object('accessLevel', 'COMMITTEE_MANAGER', 'committeeId', committee_id, 'active', true),
    'next', jsonb_build_object('accessLevel', 'COMMITTEE_MANAGER', 'committeeId', committee_id, 'active', false),
    'reason', 'legacy Events smoke committee isolated')
FROM revoked;

-- One policy helper is used by authenticated RLS and every admin routine.
-- The caller identity supplied to private routines is verified by the server;
-- browser RLS always supplies auth.uid(), never a client-controlled user id.
CREATE OR REPLACE FUNCTION private.can_access_committee(p_actor uuid, p_committee uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.administrative_access a
    JOIN public.committees c ON c.id = p_committee AND c.slug IS NOT NULL
    WHERE a.user_id = p_actor AND a.revoked_at IS NULL
      AND (a.access_level IN ('BOARD_ADMIN','TECHNICAL')
           OR (a.access_level = 'COMMITTEE_MANAGER' AND a.committee_id = p_committee))
  );
$$;
ALTER FUNCTION private.can_access_committee(uuid, uuid) OWNER TO uc02_routine_owner;
REVOKE ALL ON FUNCTION private.can_access_committee(uuid, uuid) FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated;

CREATE OR REPLACE FUNCTION private.can_access_own_committee(p_committee uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT private.can_access_committee(auth.uid(), p_committee);
$$;
ALTER FUNCTION private.can_access_own_committee(uuid) OWNER TO uc02_routine_owner;
REVOKE ALL ON FUNCTION private.can_access_own_committee(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.can_access_own_committee(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION private.lock_committee_access(p_actor uuid, p_committee uuid)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.committees WHERE id = p_committee AND slug IS NOT NULL) THEN
    RETURN false;
  END IF;
  PERFORM 1 FROM public.administrative_access
  WHERE user_id = p_actor AND revoked_at IS NULL
    AND (access_level IN ('BOARD_ADMIN','TECHNICAL')
      OR (access_level = 'COMMITTEE_MANAGER' AND committee_id = p_committee))
  FOR SHARE;
  RETURN FOUND;
END;
$$;
ALTER FUNCTION private.lock_committee_access(uuid, uuid) OWNER TO uc02_routine_owner;
REVOKE ALL ON FUNCTION private.lock_committee_access(uuid, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.can_review_event(p_actor uuid, p_event uuid)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.events e JOIN public.committees c
      ON c.id = e.committee_id WHERE e.id = p_event AND c.slug IS NOT NULL) THEN
    RETURN false;
  END IF;
  PERFORM 1 FROM public.administrative_access
  WHERE user_id = p_actor AND revoked_at IS NULL
    AND access_level IN ('BOARD_ADMIN','TECHNICAL') FOR SHARE;
  RETURN FOUND;
END;
$$;
ALTER FUNCTION private.can_review_event(uuid, uuid) OWNER TO uc02_routine_owner;
REVOKE ALL ON FUNCTION private.can_review_event(uuid, uuid) FROM PUBLIC;

DROP POLICY authenticated_select_own_committee_events ON public.events;
CREATE POLICY authenticated_select_admin_events ON public.events FOR SELECT TO authenticated
  USING (private.can_access_own_committee(committee_id));
DROP POLICY authenticated_select_own_committee_registrations ON public.registrations;
CREATE POLICY authenticated_select_admin_registrations ON public.registrations FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.events e WHERE e.id = event_id
    AND private.can_access_own_committee(e.committee_id)));
DROP POLICY authenticated_select_own_committees ON public.committees;
CREATE POLICY authenticated_select_admin_committees ON public.committees FOR SELECT TO authenticated
  USING (slug IS NOT NULL AND private.can_access_own_committee(id));
-- The own-access policy remains on the renamed table. It exposes only the
-- caller's row; Technical list and user lookup use narrow private routines.

REVOKE ALL ON FUNCTION private.grant_committee_manager(uuid, uuid, uuid, text)
  FROM PUBLIC, app_maintenance;
REVOKE ALL ON FUNCTION private.revoke_committee_manager(uuid, uuid, uuid, text)
  FROM PUBLIC, app_maintenance;
DROP FUNCTION private.grant_committee_manager(uuid, uuid, uuid, text);
DROP FUNCTION private.revoke_committee_manager(uuid, uuid, uuid, text);

-- Replaced routines apply the same live scope predicate as RLS.
CREATE OR REPLACE FUNCTION private.flag_review(
  p_actor uuid, p_event_id uuid, p_expected_revision integer, p_required boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_event record;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.id = p_event_id
      AND private.lock_committee_access(p_actor, e.committee_id)
  ) THEN
    RETURN jsonb_build_object('code', 'NOT_FOUND');
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF p_expected_revision IS NULL OR v_event.revision != p_expected_revision THEN
    RETURN jsonb_build_object('code', 'CONFLICT', 'currentRevision', v_event.revision);
  END IF;

  UPDATE public.events SET
    review_required = p_required,
    flagged_by = CASE WHEN p_required THEN p_actor ELSE NULL END,
    approved_by = NULL, approved_at = NULL, approved_revision = NULL,
    revision = revision + 1
  WHERE id = p_event_id;

  INSERT INTO private.uc02_audit (committee_id, event_id, actor_kind, actor_user_id, action, changes)
  VALUES (v_event.committee_id, p_event_id, 'authenticated', p_actor,
    CASE WHEN p_required THEN 'event.review_flagged' ELSE 'event.review_unflagged' END,
    jsonb_build_object('reviewRequired', p_required));

  RETURN jsonb_build_object('code', 'SUCCESS', 'revision', v_event.revision + 1);
END;
$$;

CREATE OR REPLACE FUNCTION private.approve_event(
  p_actor uuid, p_event_id uuid, p_expected_revision integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_event record;
BEGIN
  IF NOT private.can_review_event(p_actor, p_event_id) THEN
    RETURN jsonb_build_object('code', 'NOT_FOUND');
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF v_event.archived_at IS NOT NULL OR v_event.status <> 'draft' OR NOT v_event.review_required THEN
    RETURN jsonb_build_object('code', 'INVALID_TRANSITION');
  END IF;
  IF v_event.flagged_by = p_actor THEN
    RETURN jsonb_build_object('code', 'SELF_APPROVAL_DENIED');
  END IF;
  IF p_expected_revision IS NULL OR v_event.revision != p_expected_revision THEN
    RETURN jsonb_build_object('code', 'CONFLICT', 'currentRevision', v_event.revision);
  END IF;
  IF v_event.approved_by = p_actor AND v_event.approved_revision = v_event.revision THEN
    RETURN jsonb_build_object('code', 'SUCCESS', 'revision', v_event.revision); -- idempotent, no second audit row
  END IF;

  UPDATE public.events SET
    approved_by = p_actor, approved_at = now(), approved_revision = v_event.revision
  WHERE id = p_event_id;

  INSERT INTO private.uc02_audit (committee_id, event_id, actor_kind, actor_user_id, action, changes)
  VALUES (v_event.committee_id, p_event_id, 'authenticated', p_actor, 'event.approved',
    jsonb_build_object(
      'previous', jsonb_build_object('approvedBy', v_event.approved_by,
        'approvedRevision', v_event.approved_revision, 'revision', v_event.revision),
      'next', jsonb_build_object('approvedBy', p_actor,
        'approvedRevision', v_event.revision, 'revision', v_event.revision)
    ));

  RETURN jsonb_build_object('code', 'SUCCESS', 'revision', v_event.revision);
END;
$$;

CREATE OR REPLACE FUNCTION private.publish_event(
  p_actor uuid, p_event_id uuid, p_expected_revision integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_event record;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.id = p_event_id
      AND private.lock_committee_access(p_actor, e.committee_id)
  ) THEN
    RETURN jsonb_build_object('code', 'NOT_FOUND');
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF v_event.archived_at IS NOT NULL OR v_event.status NOT IN ('draft', 'full') THEN
    RETURN jsonb_build_object('code', 'INVALID_TRANSITION');
  END IF;
  IF v_event.event_date <= clock_timestamp() THEN
    RETURN jsonb_build_object('code', 'INVALID_TRANSITION');
  END IF;
  IF v_event.description IS NULL OR char_length(btrim(v_event.description)) = 0 THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR');
  END IF;
  IF v_event.revision != p_expected_revision THEN
    RETURN jsonb_build_object('code', 'CONFLICT', 'currentRevision', v_event.revision);
  END IF;
  IF v_event.review_required AND (v_event.approved_by IS NULL OR v_event.approved_revision != v_event.revision) THEN
    RETURN jsonb_build_object('code', 'APPROVAL_REQUIRED');
  END IF;

  UPDATE public.events SET status = 'published', revision = revision + 1 WHERE id = p_event_id;

  INSERT INTO private.uc02_audit (committee_id, event_id, actor_kind, actor_user_id, action, changes)
  VALUES (v_event.committee_id, p_event_id, 'authenticated', p_actor, 'event.published',
    jsonb_build_object('fromStatus', v_event.status));

  RETURN jsonb_build_object('code', 'SUCCESS', 'revision', v_event.revision + 1);
END;
$$;

CREATE OR REPLACE FUNCTION private.hold_event_full(
  p_actor uuid, p_event_id uuid, p_expected_revision integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_event record;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.id = p_event_id
      AND private.lock_committee_access(p_actor, e.committee_id)
  ) THEN
    RETURN jsonb_build_object('code', 'NOT_FOUND');
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF v_event.status != 'published' OR v_event.event_date <= clock_timestamp() THEN
    RETURN jsonb_build_object('code', 'INVALID_TRANSITION');
  END IF;
  IF v_event.revision != p_expected_revision THEN
    RETURN jsonb_build_object('code', 'CONFLICT', 'currentRevision', v_event.revision);
  END IF;

  UPDATE public.events SET status = 'full', revision = revision + 1 WHERE id = p_event_id;

  INSERT INTO private.uc02_audit (committee_id, event_id, actor_kind, actor_user_id, action, changes)
  VALUES (v_event.committee_id, p_event_id, 'authenticated', p_actor, 'event.held', '{}'::jsonb);

  RETURN jsonb_build_object('code', 'SUCCESS', 'revision', v_event.revision + 1);
END;
$$;

CREATE OR REPLACE FUNCTION private.archive_event(
  p_actor uuid, p_event_id uuid, p_expected_revision integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_event record;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.id = p_event_id
      AND private.lock_committee_access(p_actor, e.committee_id)
  ) THEN
    RETURN jsonb_build_object('code', 'NOT_FOUND');
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF v_event.archived_at IS NOT NULL
     OR (v_event.status NOT IN ('draft') AND v_event.event_date > clock_timestamp()) THEN
    RETURN jsonb_build_object('code', 'INVALID_TRANSITION');
  END IF;
  IF v_event.revision != p_expected_revision THEN
    RETURN jsonb_build_object('code', 'CONFLICT', 'currentRevision', v_event.revision);
  END IF;

  UPDATE public.events SET archived_at = now(), revision = revision + 1 WHERE id = p_event_id;

  INSERT INTO private.uc02_audit (committee_id, event_id, actor_kind, actor_user_id, action, changes)
  VALUES (v_event.committee_id, p_event_id, 'authenticated', p_actor, 'event.archived', '{}'::jsonb);

  RETURN jsonb_build_object('code', 'SUCCESS', 'revision', v_event.revision + 1);
END;
$$;

CREATE OR REPLACE FUNCTION private.restore_event(
  p_actor uuid, p_event_id uuid, p_expected_revision integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_event record;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.id = p_event_id
      AND private.lock_committee_access(p_actor, e.committee_id)
  ) THEN
    RETURN jsonb_build_object('code', 'NOT_FOUND');
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF v_event.archived_at IS NULL THEN
    RETURN jsonb_build_object('code', 'INVALID_TRANSITION');
  END IF;
  IF v_event.revision != p_expected_revision THEN
    RETURN jsonb_build_object('code', 'CONFLICT', 'currentRevision', v_event.revision);
  END IF;

  UPDATE public.events SET archived_at = NULL, revision = revision + 1 WHERE id = p_event_id;

  INSERT INTO private.uc02_audit (committee_id, event_id, actor_kind, actor_user_id, action, changes)
  VALUES (v_event.committee_id, p_event_id, 'authenticated', p_actor, 'event.restored', '{}'::jsonb);

  RETURN jsonb_build_object('code', 'SUCCESS', 'revision', v_event.revision + 1);
END;
$$;

CREATE OR REPLACE FUNCTION private.promote_waitlist(
  p_actor uuid, p_event_id uuid, p_registration_id uuid, p_contact_confirmed boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_event record;
  v_reg record;
  v_first record;
  v_confirmed_count integer;
BEGIN
  IF NOT p_contact_confirmed THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.id = p_event_id
      AND private.lock_committee_access(p_actor, e.committee_id)
  ) THEN
    RETURN jsonb_build_object('code', 'NOT_FOUND');
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF v_event.status = 'full' AND v_event.event_date <= clock_timestamp() THEN
    RETURN jsonb_build_object('code', 'REGISTRATION_CLOSED');
  END IF;

  SELECT * INTO v_reg FROM public.registrations
    WHERE id = p_registration_id AND event_id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('code', 'NOT_FOUND');
  END IF;
  IF v_reg.status = 'confirmed' THEN
    RETURN jsonb_build_object('code', 'SUCCESS'); -- idempotent retry of an already-promoted row
  END IF;
  IF v_reg.status != 'waitlisted' THEN
    RETURN jsonb_build_object('code', 'INVALID_TRANSITION');
  END IF;

  SELECT * INTO v_first FROM public.registrations
    WHERE event_id = p_event_id AND status = 'waitlisted'
    ORDER BY registered_at, id LIMIT 1;
  IF v_first.id != p_registration_id THEN
    RETURN jsonb_build_object('code', 'QUEUE_ORDER_CONFLICT');
  END IF;

  SELECT count(*) INTO v_confirmed_count FROM public.registrations
    WHERE event_id = p_event_id AND status = 'confirmed';
  IF v_event.capacity IS NOT NULL AND v_confirmed_count >= v_event.capacity THEN
    RETURN jsonb_build_object('code', 'CAPACITY_BELOW_COUNT');
  END IF;

  UPDATE public.registrations SET status = 'confirmed' WHERE id = p_registration_id;

  INSERT INTO private.uc02_audit (committee_id, event_id, registration_id, actor_kind, actor_user_id, action, changes)
  VALUES (v_event.committee_id, p_event_id, p_registration_id, 'authenticated', p_actor, 'registration.promoted',
    jsonb_build_object('contactConfirmed', true));

  RETURN jsonb_build_object('code', 'SUCCESS');
END;
$$;

CREATE OR REPLACE FUNCTION private.create_event(
  p_actor uuid,
  p_committee_id uuid,
  p_title text,
  p_description text,
  p_event_date timestamptz,
  p_location text,
  p_capacity integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event_id uuid;
BEGIN
  -- Lock the live grant before changing the committee's data. A concurrent
  -- revocation waits for this short transaction and blocks later operations.
  IF NOT private.lock_committee_access(p_actor, p_committee_id) THEN
    RETURN jsonb_build_object('code', 'NOT_FOUND');
  END IF;

  IF p_title IS NULL OR char_length(btrim(p_title)) NOT BETWEEN 1 AND 200
     OR p_description IS NOT NULL AND char_length(p_description) > 10000
     OR p_location IS NOT NULL AND char_length(p_location) > 500
     OR p_event_date IS NULL OR p_event_date <= clock_timestamp()
     OR p_capacity IS NOT NULL AND p_capacity < 1 THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR');
  END IF;

  INSERT INTO public.events (
    id, title, description, event_date, location, committee_id, capacity, status
  ) VALUES (
    gen_random_uuid(), btrim(p_title), NULLIF(btrim(p_description), ''), p_event_date,
    NULLIF(btrim(p_location), ''), p_committee_id, p_capacity, 'draft'
  ) RETURNING id INTO v_event_id;

  INSERT INTO private.uc02_audit (
    committee_id, event_id, actor_kind, actor_user_id, action, changes
  ) VALUES (
    p_committee_id, v_event_id, 'authenticated', p_actor, 'event.created',
    jsonb_build_object(
      'after', jsonb_build_object(
        'title', btrim(p_title), 'description', NULLIF(btrim(p_description), ''),
        'eventDate', p_event_date, 'location', NULLIF(btrim(p_location), ''),
        'capacity', p_capacity, 'status', 'draft', 'revision', 1
      )
    )
  );

  RETURN jsonb_build_object('code', 'SUCCESS', 'eventId', v_event_id, 'revision', 1);
END;
$$;

CREATE OR REPLACE FUNCTION private.edit_event(
  p_actor uuid,
  p_event_id uuid,
  p_expected_revision integer,
  p_title text,
  p_description text,
  p_event_date timestamptz,
  p_location text,
  p_capacity integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event public.events%ROWTYPE;
  v_confirmed_count integer;
  v_has_history boolean;
  v_changed boolean;
BEGIN
  SELECT committee_id INTO v_event.committee_id
  FROM public.events WHERE id = p_event_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('code', 'NOT_FOUND');
  END IF;

  IF NOT private.lock_committee_access(p_actor, v_event.committee_id) THEN
    RETURN jsonb_build_object('code', 'NOT_FOUND');
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF p_expected_revision IS NULL OR v_event.revision <> p_expected_revision THEN
    RETURN jsonb_build_object('code', 'CONFLICT', 'currentRevision', v_event.revision);
  END IF;
  IF v_event.archived_at IS NOT NULL THEN
    RETURN jsonb_build_object('code', 'INVALID_TRANSITION');
  END IF;
  IF p_title IS NULL OR char_length(btrim(p_title)) NOT BETWEEN 1 AND 200
     OR p_description IS NOT NULL AND char_length(p_description) > 10000
     OR p_location IS NOT NULL AND char_length(p_location) > 500
     OR p_event_date IS NULL OR p_capacity IS NOT NULL AND p_capacity < 1
     OR v_event.status <> 'draft' AND (p_description IS NULL OR char_length(btrim(p_description)) = 0) THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR');
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.registrations WHERE event_id = p_event_id)
  INTO v_has_history;
  IF v_has_history AND p_event_date IS DISTINCT FROM v_event.event_date THEN
    RETURN jsonb_build_object('code', 'INVALID_TRANSITION');
  END IF;

  IF v_event.event_date <= clock_timestamp() THEN
    IF p_event_date IS DISTINCT FROM v_event.event_date
       OR p_capacity IS DISTINCT FROM v_event.capacity THEN
      RETURN jsonb_build_object('code', 'INVALID_TRANSITION');
    END IF;
  ELSIF p_event_date <= clock_timestamp() THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR');
  END IF;

  SELECT count(*) INTO v_confirmed_count
  FROM public.registrations WHERE event_id = p_event_id AND status = 'confirmed';
  IF p_capacity IS NOT NULL AND p_capacity < v_confirmed_count THEN
    RETURN jsonb_build_object('code', 'CAPACITY_BELOW_COUNT');
  END IF;

  v_changed := btrim(p_title) IS DISTINCT FROM v_event.title
    OR NULLIF(btrim(p_description), '') IS DISTINCT FROM v_event.description
    OR p_event_date IS DISTINCT FROM v_event.event_date
    OR NULLIF(p_location, '') IS DISTINCT FROM v_event.location
    OR p_capacity IS DISTINCT FROM v_event.capacity;
  IF NOT v_changed THEN
    RETURN jsonb_build_object('code', 'SUCCESS', 'revision', v_event.revision);
  END IF;

  UPDATE public.events SET
    title = btrim(p_title), description = NULLIF(btrim(p_description), ''),
    event_date = p_event_date, location = NULLIF(btrim(p_location), ''), capacity = p_capacity,
    flagged_by = CASE WHEN review_required THEN p_actor ELSE flagged_by END,
    approved_by = CASE WHEN review_required THEN NULL ELSE approved_by END,
    approved_at = CASE WHEN review_required THEN NULL ELSE approved_at END,
    approved_revision = CASE WHEN review_required THEN NULL ELSE approved_revision END,
    revision = revision + 1
  WHERE id = p_event_id;

  INSERT INTO private.uc02_audit (
    committee_id, event_id, actor_kind, actor_user_id, action, changes
  ) VALUES (
    v_event.committee_id, p_event_id, 'authenticated', p_actor, 'event.updated',
    jsonb_build_object(
      'before', jsonb_build_object(
        'title', v_event.title, 'description', v_event.description,
        'eventDate', v_event.event_date, 'location', v_event.location,
        'capacity', v_event.capacity, 'revision', v_event.revision
      ),
      'after', jsonb_build_object(
        'title', btrim(p_title), 'description', NULLIF(btrim(p_description), ''),
        'eventDate', p_event_date, 'location', NULLIF(btrim(p_location), ''),
        'capacity', p_capacity, 'revision', v_event.revision + 1
      )
    )
  );

  RETURN jsonb_build_object('code', 'SUCCESS', 'revision', v_event.revision + 1);
END;
$$;

CREATE OR REPLACE FUNCTION private.list_admin_events(
  p_actor uuid,
  p_committee_id uuid DEFAULT NULL,
  p_status text DEFAULT 'all',
  p_cursor_event_date timestamptz DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 21
) RETURNS TABLE (
  id uuid,
  title text,
  description text,
  event_date timestamptz,
  location text,
  committee_id uuid,
  committee_name text,
  status public.event_status,
  capacity integer,
  revision integer,
  archived_at timestamptz,
  review_required boolean,
  flagged_by uuid,
  approved_by uuid,
  confirmed_count integer,
  waitlisted_count integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH scoped_events AS (
    SELECT
      e.id,
      e.title,
      e.description,
      e.event_date,
      e.location,
      e.committee_id,
      c.name AS committee_name,
      e.status,
      e.capacity,
      e.revision,
      e.archived_at,
      e.review_required,
      e.flagged_by,
      e.approved_by
    FROM public.events e
    JOIN public.committees c ON c.id = e.committee_id
    WHERE private.can_access_committee(p_actor, e.committee_id)
      AND (p_committee_id IS NULL OR e.committee_id = p_committee_id)
      AND (
        (p_status = 'all' AND e.archived_at IS NULL)
        OR (p_status = 'archived' AND e.archived_at IS NOT NULL)
        OR (p_status = 'past' AND e.archived_at IS NULL AND e.event_date <= statement_timestamp())
        OR (p_status = 'draft' AND e.archived_at IS NULL AND e.event_date > statement_timestamp() AND e.status = 'draft')
        OR (p_status = 'published' AND e.archived_at IS NULL AND e.event_date > statement_timestamp() AND e.status = 'published')
        OR (p_status = 'full' AND e.archived_at IS NULL AND e.event_date > statement_timestamp() AND e.status = 'full')
      )
      AND (
        p_cursor_event_date IS NULL
        OR p_cursor_id IS NULL
        OR (e.event_date, e.id) > (p_cursor_event_date, p_cursor_id)
      )
    ORDER BY e.event_date ASC, e.id ASC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 21), 1), 21)
  )
  SELECT
    e.*,
    (SELECT count(*)::integer FROM public.registrations r WHERE r.event_id = e.id AND r.status = 'confirmed'),
    (SELECT count(*)::integer FROM public.registrations r WHERE r.event_id = e.id AND r.status = 'waitlisted')
  FROM scoped_events e
  ORDER BY e.event_date ASC, e.id ASC;
$$;

CREATE OR REPLACE FUNCTION private.get_admin_event(
  p_actor uuid,
  p_event_id uuid
) RETURNS TABLE (
  id uuid,
  title text,
  description text,
  event_date timestamptz,
  location text,
  committee_id uuid,
  committee_name text,
  status public.event_status,
  capacity integer,
  revision integer,
  archived_at timestamptz,
  review_required boolean,
  flagged_by uuid,
  approved_by uuid,
  confirmed_count integer,
  waitlisted_count integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    e.id,
    e.title,
    e.description,
    e.event_date,
    e.location,
    e.committee_id,
    c.name,
    e.status,
    e.capacity,
    e.revision,
    e.archived_at,
    e.review_required,
    e.flagged_by,
    e.approved_by,
    (SELECT count(*)::integer FROM public.registrations r WHERE r.event_id = e.id AND r.status = 'confirmed'),
    (SELECT count(*)::integer FROM public.registrations r WHERE r.event_id = e.id AND r.status = 'waitlisted')
  FROM public.events e
  JOIN public.committees c ON c.id = e.committee_id
  WHERE e.id = p_event_id
    AND private.can_access_committee(p_actor, e.committee_id);
$$;

CREATE OR REPLACE FUNCTION private.list_admin_registrations(
  p_actor uuid,
  p_event_id uuid,
  p_status text DEFAULT 'confirmed',
  p_cursor_registered_at timestamptz DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 51
) RETURNS TABLE (
  id uuid,
  attendee_name text,
  attendee_email text,
  status public.registration_status,
  registered_at timestamptz
)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT r.id, r.attendee_name, r.attendee_email, r.status, r.registered_at
  FROM public.registrations r
  JOIN public.events e ON e.id = r.event_id
  WHERE r.event_id = p_event_id
    AND p_status IN ('confirmed', 'waitlisted')
    AND r.status::text = p_status
    AND private.can_access_committee(p_actor, e.committee_id)
    AND (p_cursor_registered_at IS NULL OR p_cursor_id IS NULL OR (r.registered_at, r.id) > (p_cursor_registered_at, p_cursor_id))
  ORDER BY r.registered_at ASC, r.id ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 51), 1), 51);
$$;

CREATE OR REPLACE FUNCTION private.count_admin_registrations(
  p_actor uuid,
  p_event_id uuid
) RETURNS TABLE (confirmed_count integer, waitlisted_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.id = p_event_id
      AND private.can_access_committee(p_actor, e.committee_id)
  ) THEN RETURN; END IF;
  RETURN QUERY SELECT
    count(*) FILTER (WHERE r.status = 'confirmed')::integer,
    count(*) FILTER (WHERE r.status = 'waitlisted')::integer
  FROM public.registrations r WHERE r.event_id = p_event_id;
END;
$$;

CREATE OR REPLACE FUNCTION private.export_admin_registrations(
  p_actor uuid,
  p_event_id uuid,
  p_status text
) RETURNS TABLE (
  id uuid,
  attendee_name text,
  attendee_email text,
  status public.registration_status,
  registered_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_committee_id uuid;
  v_count integer;
  v_bytes bigint;
BEGIN
  IF p_status NOT IN ('confirmed', 'waitlisted') THEN
    RETURN;
  END IF;
  SELECT e.committee_id INTO v_committee_id
  FROM public.events e
  WHERE e.id = p_event_id
    AND private.can_access_committee(p_actor, e.committee_id);
  IF v_committee_id IS NULL THEN RETURN; END IF;

  SELECT count(*)::integer,
         coalesce(sum(length(r.attendee_name) + length(r.attendee_email) + 80), 0)::bigint
    INTO v_count, v_bytes
  FROM public.registrations r
  WHERE r.event_id = p_event_id AND r.status = p_status::public.registration_status;
  IF v_count > 10000 OR v_bytes > 10485760 THEN RETURN; END IF;

  INSERT INTO private.uc02_audit
    (committee_id, event_id, actor_kind, actor_user_id, action, changes)
  VALUES
    (v_committee_id, p_event_id, 'authenticated', p_actor, 'registrations.exported',
     jsonb_build_object('status', p_status, 'rowCount', v_count, 'byteEstimate', v_bytes));

  RETURN QUERY
    SELECT r.id, r.attendee_name, r.attendee_email, r.status, r.registered_at
    FROM public.registrations r
    WHERE r.event_id = p_event_id AND r.status = p_status::public.registration_status
    ORDER BY r.registered_at ASC, r.id ASC;
END;
$$;

CREATE OR REPLACE FUNCTION private.count_admin_events(
  p_actor uuid,
  p_committee_id uuid DEFAULT NULL
) RETURNS TABLE (
  total_count integer,
  draft_count integer,
  review_count integer,
  approved_count integer,
  published_count integer,
  full_count integer,
  past_count integer,
  archived_count integer
)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH scoped AS (
    SELECT e.status, e.event_date, e.archived_at, e.review_required, e.approved_by
    FROM public.events e
    WHERE (p_committee_id IS NULL OR e.committee_id = p_committee_id)
      AND private.can_access_committee(p_actor, e.committee_id)
  ), classified AS (
    SELECT
      archived_at IS NOT NULL AS archived,
      archived_at IS NULL AND event_date <= statement_timestamp() AS past,
      archived_at IS NULL AND event_date > statement_timestamp() AS future,
      status, review_required, approved_by
    FROM scoped
  )
  SELECT
    count(*)::integer,
    count(*) FILTER (WHERE future AND status = 'draft' AND NOT review_required)::integer,
    count(*) FILTER (WHERE future AND status = 'draft' AND review_required AND approved_by IS NULL)::integer,
    count(*) FILTER (WHERE future AND status = 'draft' AND review_required AND approved_by IS NOT NULL)::integer,
    count(*) FILTER (WHERE future AND status = 'published')::integer,
    count(*) FILTER (WHERE future AND status = 'full')::integer,
    count(*) FILTER (WHERE past)::integer,
    count(*) FILTER (WHERE archived)::integer
  FROM classified;
$$;

-- The reviewer decision leaves the event pending; it does not invent a new
-- lifecycle status or erase earlier audit history.
CREATE OR REPLACE FUNCTION private.reject_review(
  p_actor uuid, p_event_id uuid, p_expected_revision integer, p_note text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_event public.events%ROWTYPE; v_note text := NULLIF(btrim(p_note), '');
BEGIN
  IF v_note IS NOT NULL AND char_length(v_note) > 200 THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR');
  END IF;
  IF NOT private.can_review_event(p_actor, p_event_id) THEN
    RETURN jsonb_build_object('code', 'NOT_FOUND');
  END IF;
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF v_event.archived_at IS NOT NULL OR v_event.status <> 'draft' OR NOT v_event.review_required THEN
    RETURN jsonb_build_object('code', 'INVALID_TRANSITION');
  END IF;
  IF v_event.flagged_by = p_actor THEN
    RETURN jsonb_build_object('code', 'SELF_APPROVAL_DENIED');
  END IF;
  IF p_expected_revision IS NULL OR v_event.revision <> p_expected_revision THEN
    RETURN jsonb_build_object('code', 'CONFLICT', 'currentRevision', v_event.revision);
  END IF;
  UPDATE public.events SET approved_by = NULL, approved_at = NULL,
    approved_revision = NULL, revision = revision + 1 WHERE id = p_event_id;
  INSERT INTO private.uc02_audit
    (committee_id, event_id, actor_kind, actor_user_id, action, changes)
  VALUES (v_event.committee_id, p_event_id, 'authenticated', p_actor,
    'event.review_rejected', jsonb_strip_nulls(jsonb_build_object(
      'previous', jsonb_build_object('approvedBy', v_event.approved_by,
        'approvedRevision', v_event.approved_revision, 'revision', v_event.revision),
      'next', jsonb_build_object('approvedBy', NULL, 'approvedRevision', NULL,
        'revision', v_event.revision + 1), 'note', v_note)));
  RETURN jsonb_build_object('code', 'SUCCESS', 'revision', v_event.revision + 1);
END;
$$;
ALTER FUNCTION private.reject_review(uuid, uuid, integer, text) OWNER TO uc02_routine_owner;
REVOKE ALL ON FUNCTION private.reject_review(uuid, uuid, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.reject_review(uuid, uuid, integer, text) TO app_runtime;

GRANT USAGE ON SCHEMA auth TO uc02_routine_owner;
GRANT SELECT (id, email) ON auth.users TO uc02_routine_owner;

CREATE OR REPLACE FUNCTION private.list_administrative_access(p_actor uuid)
RETURNS TABLE (user_id uuid, email text, access_level text, committee_id uuid,
  committee_name text, active boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT a.user_id, u.email::text, a.access_level::text, a.committee_id,
    c.name, a.revoked_at IS NULL
  FROM public.administrative_access a
  JOIN auth.users u ON u.id = a.user_id
  LEFT JOIN public.committees c ON c.id = a.committee_id
  WHERE EXISTS (SELECT 1 FROM public.administrative_access actor
    WHERE actor.user_id = p_actor AND actor.access_level = 'TECHNICAL'
      AND actor.revoked_at IS NULL)
  ORDER BY u.email NULLS LAST, a.user_id;
$$;
ALTER FUNCTION private.list_administrative_access(uuid) OWNER TO uc02_routine_owner;
REVOKE ALL ON FUNCTION private.list_administrative_access(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.list_administrative_access(uuid) TO app_runtime;

CREATE OR REPLACE FUNCTION private.list_auth_users_for_access(p_actor uuid)
RETURNS TABLE (user_id uuid, email text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.id, u.email::text FROM auth.users u
  WHERE u.email IS NOT NULL AND EXISTS (SELECT 1 FROM public.administrative_access actor
      WHERE actor.user_id = p_actor AND actor.access_level = 'TECHNICAL'
        AND actor.revoked_at IS NULL)
  ORDER BY u.email, u.id;
$$;
ALTER FUNCTION private.list_auth_users_for_access(uuid) OWNER TO uc02_routine_owner;
REVOKE ALL ON FUNCTION private.list_auth_users_for_access(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.list_auth_users_for_access(uuid) TO app_runtime;

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
    'access.technical_changed')
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
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user) THEN
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
    v_action := 'access.granted';
    v_next := jsonb_build_object('accessLevel', p_level, 'committeeId', p_committee, 'active', true);
  ELSIF p_operation = 'reassign' THEN
    IF NOT v_exists OR v_old.revoked_at IS NOT NULL OR v_old.access_level <> 'COMMITTEE_MANAGER'
      OR p_level <> 'COMMITTEE_MANAGER' OR v_old.committee_id = p_committee THEN
      RETURN jsonb_build_object('code', 'INVALID_TRANSITION');
    END IF;
    UPDATE public.administrative_access SET committee_id = p_committee,
      granted_at = now(), granted_by = p_actor WHERE user_id = p_user;
    v_action := 'access.reassigned';
    v_next := jsonb_build_object('accessLevel', 'COMMITTEE_MANAGER',
      'committeeId', p_committee, 'active', true);
  ELSE
    IF NOT v_exists OR v_old.revoked_at IS NOT NULL THEN
      RETURN jsonb_build_object('code', 'NOT_FOUND');
    END IF;
    UPDATE public.administrative_access SET revoked_at = now(), revoked_by = p_actor
    WHERE user_id = p_user;
    v_action := 'access.revoked';
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
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_actor) THEN
    RETURN jsonb_build_object('code', 'ACTOR_NOT_FOUND');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user) THEN
    RETURN jsonb_build_object('code', 'USER_NOT_FOUND');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('access:' || p_user, 0));
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
    UPDATE public.administrative_access SET revoked_at = now(), revoked_by = p_actor
    WHERE user_id = p_user;
  END IF;
  INSERT INTO private.uc02_audit
    (committee_id, actor_kind, actor_user_id, action, changes)
  VALUES (NULL, 'maintenance', p_actor, 'access.technical_changed',
    jsonb_build_object('userId', p_user, 'previous', v_previous,
      'next', jsonb_build_object('accessLevel', 'TECHNICAL',
        'committeeId', NULL, 'active', p_enabled), 'note', v_note));
  RETURN jsonb_build_object('code', 'SUCCESS');
END;
$$;
ALTER FUNCTION private.set_technical_access(uuid, uuid, boolean, text) OWNER TO uc02_routine_owner;
REVOKE ALL ON FUNCTION private.set_technical_access(uuid, uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.set_technical_access(uuid, uuid, boolean, text) TO app_maintenance;
