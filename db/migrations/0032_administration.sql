-- ADR 0024. Forward-only; apply after 0031, with approval. Changes no existing business row:
-- committees gain optional fields, grants gain an optional revocation kind (earlier revocations
-- read as ordinary ones), and every audit row is kept.

CREATE OR REPLACE FUNCTION private.core_schema_version() RETURNS integer
LANGUAGE sql IMMUTABLE AS $$ SELECT 32 $$;

-- =============================================================================================
-- Schema
-- =============================================================================================

-- Committees: an editable description and an archive marker. The slug stays the identifier.
ALTER TABLE public.committees
  ADD COLUMN description text CHECK (description IS NULL OR (char_length(description) <= 1000
    AND description !~ '[\x01-\x09\x0b\x0c\x0e-\x1f\x7f]')),
  ADD COLUMN archived_at timestamptz,
  ADD COLUMN updated_at timestamptz;

-- The society members who belong to a committee. Being listed grants nothing.
CREATE TABLE private.committee_members (
  committee_id uuid NOT NULL REFERENCES public.committees (id),
  member_id uuid NOT NULL REFERENCES public.members (id),
  responsibility text CHECK (responsibility IS NULL OR (char_length(responsibility) BETWEEN 1 AND 120
    AND responsibility !~ '[[:cntrl:]]')),
  added_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (committee_id, member_id)
);
CREATE INDEX committee_members_member_idx ON private.committee_members (member_id);
ALTER TABLE private.committee_members OWNER TO uc02_routine_owner;
ALTER TABLE private.committee_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.committee_members FORCE ROW LEVEL SECURITY;
CREATE POLICY routine_owner ON private.committee_members
  TO uc02_routine_owner USING (true) WITH CHECK (true);
REVOKE ALL ON private.committee_members FROM PUBLIC, anon, authenticated,
  app_runtime, app_maintenance, service_role;

-- Suspension is a revocation that remembers it is temporary. NULL on a revoked row means an
-- ordinary revocation, so no existing row needs rewriting.
ALTER TABLE public.administrative_access
  ADD COLUMN revocation_kind text CHECK (revocation_kind IS NULL OR revocation_kind IN ('revoked', 'suspended'));

-- Every grant path keeps the kind consistent, including the older routines that predate it:
-- an active row has no kind, and a revocation that did not name one is ordinary.
CREATE FUNCTION private.keep_revocation_kind() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.revoked_at IS NULL THEN
    NEW.revocation_kind := NULL;
  ELSIF OLD.revoked_at IS NULL AND NEW.revocation_kind IS NOT DISTINCT FROM OLD.revocation_kind THEN
    NEW.revocation_kind := 'revoked';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER administrative_access_revocation_kind BEFORE UPDATE ON public.administrative_access
  FOR EACH ROW EXECUTE FUNCTION private.keep_revocation_kind();

-- An account erasure whose Auth identity is not confirmed deleted yet. No foreign keys: the
-- identity it names is about to disappear. The row is removed once Auth confirms.
CREATE TABLE private.account_erasures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  requested_by uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0)
);
ALTER TABLE private.account_erasures OWNER TO uc02_routine_owner;
ALTER TABLE private.account_erasures ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.account_erasures FORCE ROW LEVEL SECURITY;
CREATE POLICY routine_owner ON private.account_erasures
  TO uc02_routine_owner USING (true) WITH CHECK (true);
REVOKE ALL ON private.account_erasures FROM PUBLIC, anon, authenticated,
  app_runtime, app_maintenance, service_role;

-- The Storage deletion queue (0026) also takes event covers, project images and member photos.
-- Its processor already deletes any queued object; the database still validates every key.
DO $$ DECLARE v_name text; BEGIN
  SELECT conname INTO v_name FROM pg_constraint
    WHERE conrelid = 'private.membership_storage_deletions'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%document_removed%';
  EXECUTE format('ALTER TABLE private.membership_storage_deletions DROP CONSTRAINT %I', v_name);
END $$;
ALTER TABLE private.membership_storage_deletions
  ADD CONSTRAINT membership_storage_deletion_reason CHECK (reason IN ('document_removed', 'upload_abandoned', 'record_deleted')),
  DROP CONSTRAINT membership_storage_deletion_key_shape,
  ADD CONSTRAINT membership_storage_deletion_key_shape CHECK (
    storage_key ~ '^membership-id-cards/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp|pdf)$'
    OR storage_key ~ '^event-covers/[0-9a-f-]{36}\.(jpg|png)$'
    OR storage_key ~ '^project-images/[0-9a-f-]{36}\.(jpg|png)$'
    OR storage_key ~ '^member-photos/[0-9a-f-]{36}\.jpg$');

-- No new event may join an archived committee (the dashboard does not offer one either).
CREATE FUNCTION private.reject_archived_committee() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.committees WHERE id = NEW.committee_id AND archived_at IS NOT NULL) THEN
    RAISE EXCEPTION 'committee % is archived', NEW.committee_id USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER events_committee_not_archived BEFORE INSERT OR UPDATE OF committee_id ON public.events
  FOR EACH ROW EXECUTE FUNCTION private.reject_archived_committee();

-- =============================================================================================
-- Audit: kept forever, pseudonymized only by account erasure
-- =============================================================================================

-- A deleted event or registration leaves its ID in the history as a non-personal reference.
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT conname FROM pg_constraint
    WHERE conrelid = 'private.uc02_audit'::regclass AND contype = 'f'
      AND confrelid IN ('public.events'::regclass, 'public.registrations'::regclass) LOOP
    EXECUTE format('ALTER TABLE private.uc02_audit DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE private.uc02_audit DROP CONSTRAINT uc02_audit_actor_kind_check,
  ADD CONSTRAINT uc02_audit_actor_kind_check
    CHECK (actor_kind IN ('anonymous', 'authenticated', 'maintenance', 'migration', 'erased'));

DO $$ DECLARE v_check text; BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_check FROM pg_constraint
    WHERE conrelid = 'private.uc02_audit'::regclass AND conname = 'uc02_audit_action_check';
  EXECUTE 'ALTER TABLE private.uc02_audit DROP CONSTRAINT uc02_audit_action_check';
  EXECUTE 'ALTER TABLE private.uc02_audit ADD CONSTRAINT uc02_audit_action_check CHECK (' ||
    substring(v_check from 8 for char_length(v_check) - 8) ||
    ' OR action IN (''committee.created'',''committee.updated'',''committee.archived'',''committee.restored'',' ||
    '''committee.member_added'',''committee.member_updated'',''committee.member_removed'',' ||
    '''access.suspended'',''access.reactivated'',''event.deleted'',''project.deleted'',' ||
    '''member.deleted'',''account.erasure_started'',''account.erased''))';
END $$;

-- The identity references audit JSON may hold, which erasure nulls.
CREATE FUNCTION private.audit_identity_keys() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['userId', 'memberId', 'replacesUserId', 'replacedByUserId']
$$;

-- Audit rows stay append-only. The one permitted update is erasure: an actor becoming the
-- 'erased' placeholder, identity references becoming null, and notes being removed.
CREATE FUNCTION private.guard_audit_update() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE k text; v_keys text[] := private.audit_identity_keys();
BEGIN
  IF NEW.id <> OLD.id OR NEW.occurred_at <> OLD.occurred_at OR NEW.action <> OLD.action
     OR NEW.committee_id IS DISTINCT FROM OLD.committee_id
     OR NEW.event_id IS DISTINCT FROM OLD.event_id
     OR NEW.registration_id IS DISTINCT FROM OLD.registration_id
     OR ((NEW.actor_kind, NEW.actor_user_id) IS DISTINCT FROM (OLD.actor_kind, OLD.actor_user_id)
       AND NOT (NEW.actor_kind = 'erased' AND NEW.actor_user_id IS NULL
         AND OLD.actor_kind IN ('authenticated', 'maintenance')))
     OR (NEW.changes - 'note' - 'detail' - v_keys) IS DISTINCT FROM (OLD.changes - 'note' - 'detail' - v_keys) THEN
    RAISE EXCEPTION 'audit rows are append-only' USING ERRCODE = '42501';
  END IF;
  FOREACH k IN ARRAY ARRAY['note', 'detail'] LOOP
    IF NEW.changes ? k AND NEW.changes -> k IS DISTINCT FROM OLD.changes -> k THEN
      RAISE EXCEPTION 'audit rows are append-only' USING ERRCODE = '42501';
    END IF;
  END LOOP;
  FOREACH k IN ARRAY v_keys LOOP
    IF (NEW.changes ? k) <> (OLD.changes ? k)
       OR (NEW.changes -> k IS DISTINCT FROM OLD.changes -> k AND NEW.changes -> k <> 'null'::jsonb) THEN
      RAISE EXCEPTION 'audit rows are append-only' USING ERRCODE = '42501';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER uc02_audit_update_guard BEFORE UPDATE ON private.uc02_audit
  FOR EACH ROW EXECUTE FUNCTION private.guard_audit_update();

-- Identity references to one account, nulled; notes removed.
CREATE FUNCTION private.audit_without_identity(p_changes jsonb, p_user uuid) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(jsonb_object_agg(e.k, CASE WHEN e.k = ANY (private.audit_identity_keys())
      AND e.v = to_jsonb(p_user::text) THEN 'null'::jsonb ELSE e.v END), '{}'::jsonb)
  FROM jsonb_each(p_changes - 'note' - 'detail') AS e(k, v)
$$;

-- =============================================================================================
-- Privileges the new routines need, and nothing more
-- =============================================================================================
GRANT INSERT ON public.committees TO uc02_routine_owner;
GRANT UPDATE (name, description, archived_at, updated_at) ON public.committees TO uc02_routine_owner;
GRANT DELETE ON public.events, public.registrations, public.members, public.administrative_access,
  private.project_history TO uc02_routine_owner;
GRANT UPDATE (actor_user_id, actor_kind, changes) ON private.uc02_audit TO uc02_routine_owner;
GRANT SELECT ON public.certificates, public.archive_items, public.mentorship_connections TO uc02_routine_owner;
-- Forced RLS without a policy would hide rows silently: these let the routines see blockers.
CREATE POLICY routine_owner_select_certificates ON public.certificates FOR SELECT TO uc02_routine_owner USING (true);
CREATE POLICY routine_owner_select_archive_items ON public.archive_items FOR SELECT TO uc02_routine_owner USING (true);
CREATE POLICY routine_owner_select_mentorships ON public.mentorship_connections FOR SELECT TO uc02_routine_owner USING (true);
CREATE POLICY routine_owner_delete_members ON public.members FOR DELETE TO uc02_routine_owner USING (true);

-- =============================================================================================
-- Who may administer: an active Board or Technical grant, locked like every other grant check
-- (ADR 0014) so a concurrent revocation either waits or is observed.
-- =============================================================================================
CREATE FUNCTION private.senior_admin_level(p_actor uuid) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_level text;
BEGIN
  SELECT access_level::text INTO v_level FROM public.administrative_access
  WHERE user_id = p_actor AND revoked_at IS NULL AND access_level IN ('BOARD_ADMIN', 'TECHNICAL')
  FOR SHARE;
  RETURN v_level;
END $$;

-- Names: 2–80 characters without control characters.
CREATE FUNCTION private.committee_name_valid(p_name text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT p_name IS NOT NULL AND char_length(p_name) BETWEEN 2 AND 80 AND p_name !~ '[[:cntrl:]]'
$$;

CREATE FUNCTION private.committee_description_valid(p_description text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT p_description IS NULL OR (char_length(p_description) <= 1000
    AND p_description !~ '[\x01-\x09\x0b\x0c\x0e-\x1f\x7f]')
$$;

-- =============================================================================================
-- Committees
-- =============================================================================================
CREATE FUNCTION private.admin_create_committee(p_actor uuid, p_name text, p_slug text, p_description text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_name text := btrim(coalesce(p_name, '')); v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_description text := nullif(btrim(coalesce(p_description, '')), ''); v_id uuid;
BEGIN
  IF private.senior_admin_level(p_actor) IS NULL THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  IF NOT private.committee_name_valid(v_name) THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'name'); END IF;
  IF char_length(v_slug) NOT BETWEEN 2 AND 40 OR v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'slug'); END IF;
  IF NOT private.committee_description_valid(v_description) THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'description'); END IF;
  -- One catalog change at a time, so two administrators cannot take the same name or slug.
  PERFORM pg_advisory_xact_lock(hashtextextended('committee-catalog', 0));
  IF EXISTS (SELECT 1 FROM public.committees WHERE lower(name) = lower(v_name)) THEN
    RETURN jsonb_build_object('code', 'NAME_TAKEN'); END IF;
  IF EXISTS (SELECT 1 FROM public.committees WHERE slug = v_slug) THEN
    RETURN jsonb_build_object('code', 'SLUG_TAKEN'); END IF;
  INSERT INTO public.committees (name, slug, description) VALUES (v_name, v_slug, v_description)
  RETURNING id INTO v_id;
  INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
  VALUES (v_id, 'authenticated', p_actor, 'committee.created',
    jsonb_build_object('name', v_name, 'slug', v_slug, 'described', v_description IS NOT NULL));
  RETURN jsonb_build_object('code', 'SUCCESS', 'id', v_id);
END $$;

CREATE FUNCTION private.admin_update_committee(p_actor uuid, p_committee uuid, p_name text, p_description text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_old public.committees%ROWTYPE; v_name text := btrim(coalesce(p_name, ''));
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
BEGIN
  IF private.senior_admin_level(p_actor) IS NULL THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  IF NOT private.committee_name_valid(v_name) THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'name'); END IF;
  IF NOT private.committee_description_valid(v_description) THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'description'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('committee-catalog', 0));
  -- Legacy rows without a slug stay outside administration (ADR 0012).
  SELECT * INTO v_old FROM public.committees WHERE id = p_committee AND slug IS NOT NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  IF EXISTS (SELECT 1 FROM public.committees WHERE lower(name) = lower(v_name) AND id <> p_committee) THEN
    RETURN jsonb_build_object('code', 'NAME_TAKEN'); END IF;
  IF v_old.name = v_name AND v_old.description IS NOT DISTINCT FROM v_description THEN
    RETURN jsonb_build_object('code', 'UNCHANGED'); END IF;
  UPDATE public.committees SET name = v_name, description = v_description, updated_at = clock_timestamp()
  WHERE id = p_committee;
  INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
  VALUES (p_committee, 'authenticated', p_actor, 'committee.updated', jsonb_build_object(
    'previousName', v_old.name, 'name', v_name,
    'descriptionChanged', v_old.description IS DISTINCT FROM v_description));
  RETURN jsonb_build_object('code', 'SUCCESS');
END $$;

-- Archiving keeps every record. It needs no active managers and no upcoming live events; the
-- committees other workflows name by slug cannot be archived.
CREATE FUNCTION private.admin_set_committee_archived(p_actor uuid, p_committee uuid, p_archived boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_old public.committees%ROWTYPE; v_managers integer; v_upcoming integer;
BEGIN
  IF p_archived IS NULL THEN RETURN jsonb_build_object('code', 'VALIDATION_ERROR'); END IF;
  -- The ownership lock orders this against concurrent manager grants into the committee.
  PERFORM pg_advisory_xact_lock(hashtextextended('technical-ownership', 0));
  IF private.senior_admin_level(p_actor) IS NULL THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
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
    IF v_managers > 0 OR v_upcoming > 0 THEN
      RETURN jsonb_build_object('code', 'BLOCKED', 'managers', v_managers, 'upcomingEvents', v_upcoming); END IF;
    UPDATE public.committees SET archived_at = clock_timestamp(), updated_at = clock_timestamp() WHERE id = p_committee;
  ELSE
    IF v_old.archived_at IS NULL THEN RETURN jsonb_build_object('code', 'NOT_ARCHIVED'); END IF;
    UPDATE public.committees SET archived_at = NULL, updated_at = clock_timestamp() WHERE id = p_committee;
  END IF;
  INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
  VALUES (p_committee, 'authenticated', p_actor,
    CASE WHEN p_archived THEN 'committee.archived' ELSE 'committee.restored' END,
    jsonb_build_object('name', v_old.name));
  RETURN jsonb_build_object('code', 'SUCCESS');
END $$;

-- The roster: add, update the responsibility of, or remove a society member.
CREATE FUNCTION private.admin_change_committee_member(p_actor uuid, p_committee uuid, p_member uuid,
  p_operation text, p_responsibility text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_committee public.committees%ROWTYPE; v_row private.committee_members%ROWTYPE;
  v_responsibility text := nullif(btrim(coalesce(p_responsibility, '')), '');
BEGIN
  IF p_operation IS NULL OR p_operation NOT IN ('add', 'update', 'remove') THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR'); END IF;
  IF v_responsibility IS NOT NULL AND (char_length(v_responsibility) > 120 OR v_responsibility ~ '[[:cntrl:]]') THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'responsibility'); END IF;
  IF private.senior_admin_level(p_actor) IS NULL THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  SELECT * INTO v_committee FROM public.committees WHERE id = p_committee AND slug IS NOT NULL FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  IF v_committee.archived_at IS NOT NULL THEN RETURN jsonb_build_object('code', 'COMMITTEE_ARCHIVED'); END IF;
  -- Ordered against a concurrent deletion of the member.
  PERFORM 1 FROM public.members WHERE id = p_member FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'MEMBER_NOT_FOUND'); END IF;
  SELECT * INTO v_row FROM private.committee_members
    WHERE committee_id = p_committee AND member_id = p_member FOR UPDATE;
  IF p_operation = 'add' THEN
    IF FOUND THEN RETURN jsonb_build_object('code', 'ALREADY_ADDED'); END IF;
    INSERT INTO private.committee_members (committee_id, member_id, responsibility)
    VALUES (p_committee, p_member, v_responsibility);
  ELSIF NOT FOUND THEN
    RETURN jsonb_build_object('code', 'NOT_FOUND');
  ELSIF p_operation = 'update' THEN
    IF v_row.responsibility IS NOT DISTINCT FROM v_responsibility THEN
      RETURN jsonb_build_object('code', 'UNCHANGED'); END IF;
    UPDATE private.committee_members SET responsibility = v_responsibility
    WHERE committee_id = p_committee AND member_id = p_member;
  ELSE
    DELETE FROM private.committee_members WHERE committee_id = p_committee AND member_id = p_member;
  END IF;
  INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
  VALUES (p_committee, 'authenticated', p_actor, 'committee.member_' ||
    CASE p_operation WHEN 'add' THEN 'added' WHEN 'update' THEN 'updated' ELSE 'removed' END,
    jsonb_build_object('memberId', p_member, 'responsibility', v_responsibility));
  RETURN jsonb_build_object('code', 'SUCCESS');
END $$;

-- =============================================================================================
-- Access (amends ADR 0012/0014): Board Administration manages Committee Manager grants, never
-- Board or Technical ones and never its own. Archived committees take no new grants.
-- =============================================================================================
CREATE OR REPLACE FUNCTION private.change_administrative_access(
  p_actor uuid, p_user uuid, p_level public.administrative_access_level,
  p_committee uuid, p_operation text, p_note text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_old public.administrative_access%ROWTYPE; v_actor_level text;
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
  v_actor_level := private.senior_admin_level(p_actor);
  IF v_actor_level IS NULL OR (v_actor_level = 'BOARD_ADMIN' AND p_level IS DISTINCT FROM 'COMMITTEE_MANAGER') THEN
    RETURN jsonb_build_object('code', 'FORBIDDEN');
  END IF;
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
    IF p_committee IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.committees WHERE id = p_committee AND archived_at IS NOT NULL
    ) THEN RETURN jsonb_build_object('code', 'COMMITTEE_ARCHIVED'); END IF;
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
  -- Board Administration never changes a Board or Technical account, active or suspended.
  IF v_actor_level = 'BOARD_ADMIN' AND v_exists AND v_old.access_level <> 'COMMITTEE_MANAGER'
     AND (v_old.revoked_at IS NULL OR v_old.revocation_kind = 'suspended') THEN
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

-- Leadership transfer (ADR 0014's atomic replacement), now also for Board Administration.
CREATE OR REPLACE FUNCTION private.replace_committee_manager(
  p_actor uuid, p_old_user uuid, p_new_user uuid, p_committee uuid,
  p_note text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_old public.administrative_access%ROWTYPE;
  v_new public.administrative_access%ROWTYPE;
  v_new_exists boolean;
  v_replacement uuid := gen_random_uuid();
  v_note text := NULLIF(btrim(p_note), '');
  v_actor_level text;
BEGIN
  IF p_actor IS NULL OR p_old_user IS NULL OR p_new_user IS NULL
    OR p_committee IS NULL OR p_old_user = p_new_user
    OR p_actor IN (p_old_user, p_new_user)
    OR (v_note IS NOT NULL AND char_length(v_note) > 200) THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR');
  END IF;
  -- Lock order shared by all access mutations, including owner transfer.
  PERFORM pg_advisory_xact_lock(hashtextextended('technical-ownership', 0));
  v_actor_level := private.senior_admin_level(p_actor);
  IF v_actor_level IS NULL THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  IF NOT EXISTS (SELECT 1 FROM private.access_auth_users WHERE id = p_new_user) THEN
    RETURN jsonb_build_object('code', 'USER_NOT_FOUND');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.committees WHERE id = p_committee AND slug IS NOT NULL) THEN
    RETURN jsonb_build_object('code', 'COMMITTEE_NOT_FOUND');
  END IF;
  IF EXISTS (SELECT 1 FROM public.committees WHERE id = p_committee AND archived_at IS NOT NULL) THEN
    RETURN jsonb_build_object('code', 'COMMITTEE_ARCHIVED');
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
  -- A suspended Board or Technical grant is not Board Administration's to overwrite.
  IF v_actor_level = 'BOARD_ADMIN' AND v_new_exists AND v_new.revoked_at IS NOT NULL
     AND v_new.revocation_kind = 'suspended' AND v_new.access_level <> 'COMMITTEE_MANAGER' THEN
    RETURN jsonb_build_object('code', 'FORBIDDEN');
  END IF;
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

-- Suspend: revoke now, remembering the role and committee. Reactivate: restore exactly them.
-- Board Administration only for Committee Manager grants; the last Technical account stays.
CREATE FUNCTION private.set_access_suspension(p_actor uuid, p_user uuid, p_suspend boolean, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_old public.administrative_access%ROWTYPE; v_actor_level text;
  v_note text := NULLIF(btrim(p_note), ''); v_state jsonb;
BEGIN
  IF p_actor IS NULL OR p_user IS NULL OR p_suspend IS NULL
     OR (v_note IS NOT NULL AND char_length(v_note) > 200) THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR'); END IF;
  IF p_actor = p_user THEN RETURN jsonb_build_object('code', 'SELF_CHANGE'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('technical-ownership', 0));
  v_actor_level := private.senior_admin_level(p_actor);
  IF v_actor_level IS NULL THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('access:' || p_user, 0));
  SELECT * INTO v_old FROM public.administrative_access WHERE user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  IF v_actor_level = 'BOARD_ADMIN' AND v_old.access_level <> 'COMMITTEE_MANAGER' THEN
    RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  v_state := jsonb_build_object('accessLevel', v_old.access_level, 'committeeId', v_old.committee_id);
  IF p_suspend THEN
    IF v_old.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('code', 'ALREADY_INACTIVE'); END IF;
    IF v_old.access_level = 'TECHNICAL' AND (SELECT count(*) FROM public.administrative_access
        WHERE access_level = 'TECHNICAL' AND revoked_at IS NULL) <= 1 THEN
      RETURN jsonb_build_object('code', 'LAST_TECHNICAL_ADMIN'); END IF;
    UPDATE public.administrative_access SET revoked_at = now(), revoked_by = p_actor,
      revocation_kind = 'suspended' WHERE user_id = p_user;
  ELSE
    IF v_old.revoked_at IS NULL THEN RETURN jsonb_build_object('code', 'ALREADY_ACTIVE'); END IF;
    IF v_old.revocation_kind IS DISTINCT FROM 'suspended' THEN
      RETURN jsonb_build_object('code', 'NOT_SUSPENDED'); END IF;
    IF v_old.committee_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.committees
        WHERE id = v_old.committee_id AND slug IS NOT NULL AND archived_at IS NULL) THEN
      RETURN jsonb_build_object('code', 'COMMITTEE_ARCHIVED'); END IF;
    UPDATE public.administrative_access SET revoked_at = NULL, revoked_by = NULL,
      granted_at = now(), granted_by = p_actor WHERE user_id = p_user;
  END IF;
  INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
  VALUES (v_old.committee_id, 'authenticated', p_actor,
    CASE WHEN p_suspend THEN 'access.suspended' ELSE 'access.reactivated' END,
    jsonb_build_object('userId', p_user,
      'previous', v_state || jsonb_build_object('active', p_suspend),
      'next', v_state || jsonb_build_object('active', NOT p_suspend),
      'note', v_note));
  RETURN jsonb_build_object('code', 'SUCCESS');
END $$;

-- Reads for the Administration section: Board Administration now sees accounts and history.
DROP FUNCTION private.list_administrative_access(uuid);
CREATE FUNCTION private.list_administrative_access(p_actor uuid)
RETURNS TABLE (user_id uuid, email text, access_level text, committee_id uuid,
  committee_name text, active boolean, revocation_kind text, granted_at timestamptz,
  revoked_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT a.user_id, u.email::text, a.access_level::text, a.committee_id,
    c.name, a.revoked_at IS NULL,
    CASE WHEN a.revoked_at IS NULL THEN NULL ELSE coalesce(a.revocation_kind, 'revoked') END,
    a.granted_at, a.revoked_at
  FROM public.administrative_access a
  JOIN private.access_auth_users u ON u.id = a.user_id
  LEFT JOIN public.committees c ON c.id = a.committee_id
  WHERE EXISTS (SELECT 1 FROM public.administrative_access actor
    WHERE actor.user_id = p_actor AND actor.access_level IN ('BOARD_ADMIN', 'TECHNICAL')
      AND actor.revoked_at IS NULL)
  ORDER BY u.email NULLS LAST, a.user_id;
$$;

CREATE OR REPLACE FUNCTION private.list_auth_users_for_access(p_actor uuid)
RETURNS TABLE (user_id uuid, email text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.id, u.email::text FROM private.access_auth_users u
  WHERE u.email IS NOT NULL AND EXISTS (SELECT 1 FROM public.administrative_access actor
      WHERE actor.user_id = p_actor AND actor.access_level IN ('BOARD_ADMIN', 'TECHNICAL')
        AND actor.revoked_at IS NULL)
  ORDER BY u.email, u.id;
$$;

CREATE OR REPLACE FUNCTION private.list_auth_directory(p_actor uuid)
RETURNS TABLE (user_id uuid, email text, email_confirmed boolean,
  created_at timestamptz, last_sign_in_at timestamptz, invited boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.id, u.email::text, u.email_confirmed_at IS NOT NULL, u.created_at,
    u.last_sign_in_at, u.invited_at IS NOT NULL
  FROM private.access_auth_users u
  WHERE u.email IS NOT NULL AND EXISTS (SELECT 1 FROM public.administrative_access actor
      WHERE actor.user_id = p_actor AND actor.access_level IN ('BOARD_ADMIN', 'TECHNICAL')
        AND actor.revoked_at IS NULL)
  ORDER BY u.email, u.id;
$$;

CREATE OR REPLACE FUNCTION private.list_user_audit(p_actor uuid, p_target uuid)
RETURNS TABLE (id uuid, occurred_at timestamptz, actor_user_id uuid,
  action text, committee_id uuid, previous_state jsonb, new_state jsonb, note text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT audit.id, audit.occurred_at, audit.actor_user_id, audit.action,
    audit.committee_id, audit.changes->'previous', audit.changes->'next',
    COALESCE(audit.changes->>'note', audit.changes->>'detail')
  FROM private.uc02_audit audit
  WHERE audit.changes->>'userId' = p_target::text
    AND audit.action IN ('access.granted','access.reassigned','access.revoked',
      'access.technical_changed','manager.assigned','manager.reassigned',
      'manager.revoked','board_admin.granted','board_admin.revoked',
      'technical.granted','technical.revoked','access.suspended','access.reactivated',
      'user.created','user.invited','user.invitation_resent','user.password_reset_sent',
      'user.password_admin_reset')
    AND EXISTS (SELECT 1 FROM public.administrative_access actor
      WHERE actor.user_id = p_actor AND actor.access_level IN ('BOARD_ADMIN', 'TECHNICAL')
        AND actor.revoked_at IS NULL)
  ORDER BY audit.occurred_at DESC, audit.id DESC LIMIT 50;
$$;

CREATE OR REPLACE FUNCTION private.list_access_audit(p_actor uuid)
RETURNS TABLE (id uuid, occurred_at timestamptz, actor_user_id uuid,
  target_user_id uuid, action text, committee_id uuid,
  previous_state jsonb, new_state jsonb, note text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT audit.id, audit.occurred_at, audit.actor_user_id,
    CASE WHEN audit.changes->>'userId' ~ '^[0-9a-f-]{36}$' THEN (audit.changes->>'userId')::uuid END,
    audit.action, audit.committee_id,
    audit.changes->'previous', audit.changes->'next',
    audit.changes->>'note'
  FROM private.uc02_audit audit
  WHERE audit.action IN ('access.granted','access.reassigned','access.revoked',
    'access.technical_changed','manager.assigned','manager.reassigned',
    'manager.revoked','board_admin.granted','board_admin.revoked',
    'technical.granted','technical.revoked','access.suspended','access.reactivated')
    AND EXISTS (SELECT 1 FROM public.administrative_access actor
      WHERE actor.user_id = p_actor AND actor.access_level IN ('BOARD_ADMIN', 'TECHNICAL')
        AND actor.revoked_at IS NULL)
  ORDER BY audit.occurred_at DESC, audit.id DESC LIMIT 100;
$$;

-- Board Administration may record only the invitations it is allowed to send.
CREATE OR REPLACE FUNCTION private.record_auth_admin_action(
  p_actor uuid, p_target uuid, p_action text, p_detail text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_detail text := NULLIF(btrim(p_detail), ''); v_level text;
BEGIN
  IF p_actor IS NULL OR p_target IS NULL
    OR p_action NOT IN ('user.created','user.invited','user.invitation_resent',
      'user.password_reset_sent','user.password_admin_reset')
    OR (v_detail IS NOT NULL AND (char_length(v_detail) > 60
      OR v_detail !~ '^[a-z0-9_ .-]+$')) THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR');
  END IF;
  SELECT access_level::text INTO v_level FROM public.administrative_access
    WHERE user_id = p_actor AND revoked_at IS NULL AND access_level IN ('BOARD_ADMIN', 'TECHNICAL');
  IF v_level IS NULL OR (v_level = 'BOARD_ADMIN' AND p_action NOT IN ('user.invited', 'user.invitation_resent')) THEN
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

-- =============================================================================================
-- Reads for the Administration section (Board Administration and Technical Team)
-- =============================================================================================
CREATE FUNCTION private.admin_activity_actions() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['committee.created', 'committee.updated', 'committee.archived', 'committee.restored',
    'committee.member_added', 'committee.member_updated', 'committee.member_removed',
    'manager.assigned', 'manager.reassigned', 'manager.revoked', 'board_admin.granted',
    'board_admin.revoked', 'technical.granted', 'technical.revoked', 'access.suspended',
    'access.reactivated', 'user.created', 'user.invited', 'event.deleted', 'project.deleted',
    'member.deleted', 'account.erasure_started', 'account.erased']
$$;

-- One audit row for display: who acted (or 'erased'), on whom or what, and where.
CREATE FUNCTION private.admin_activity_row(a private.uc02_audit) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object('id', a.id, 'occurredAt', a.occurred_at, 'action', a.action,
    'actorKind', a.actor_kind,
    'actor', (SELECT email FROM private.access_auth_users WHERE id = a.actor_user_id),
    'committee', (SELECT name FROM public.committees WHERE id = a.committee_id),
    'subject', coalesce(
      (SELECT full_name FROM public.members WHERE id::text = a.changes ->> 'memberId'),
      (SELECT email FROM private.access_auth_users WHERE id::text = a.changes ->> 'userId'),
      a.changes ->> 'title', a.changes ->> 'name'))
$$;

CREATE FUNCTION private.admin_overview(p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_level text := private.senior_admin_level(p_actor);
BEGIN
  IF v_level IS NULL THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  RETURN jsonb_build_object('code', 'SUCCESS', 'level', v_level,
    'committees', (SELECT jsonb_build_object('active', count(*) FILTER (WHERE archived_at IS NULL),
        'archived', count(*) FILTER (WHERE archived_at IS NOT NULL))
      FROM public.committees WHERE slug IS NOT NULL),
    'access', (SELECT jsonb_build_object(
        'technical', count(*) FILTER (WHERE access_level = 'TECHNICAL' AND revoked_at IS NULL),
        'board', count(*) FILTER (WHERE access_level = 'BOARD_ADMIN' AND revoked_at IS NULL),
        'managers', count(*) FILTER (WHERE access_level = 'COMMITTEE_MANAGER' AND revoked_at IS NULL),
        'suspended', count(*) FILTER (WHERE revoked_at IS NOT NULL AND revocation_kind = 'suspended'))
      FROM public.administrative_access),
    'members', (SELECT jsonb_build_object('total', count(*),
        'graduates', count(*) FILTER (WHERE status = 'graduate')) FROM public.members),
    'applications', (SELECT count(*) FROM private.membership_applications
      WHERE status IN ('pending_review', 'verified')),
    'corrections', (SELECT count(*) FROM private.member_change_requests WHERE status = 'pending'),
    'events', (SELECT jsonb_build_object(
        'draft', count(*) FILTER (WHERE archived_at IS NULL AND status = 'draft'),
        'live', count(*) FILTER (WHERE archived_at IS NULL AND status IN ('published', 'full')),
        'archived', count(*) FILTER (WHERE archived_at IS NOT NULL)) FROM public.events),
    'projects', (SELECT jsonb_build_object('total', count(*),
        'published', count(*) FILTER (WHERE published_revision IS NOT NULL),
        'inReview', count(*) FILTER (WHERE status IN ('submitted', 'under_review'))) FROM private.projects),
    'storageCleanup', (SELECT count(*) FROM private.membership_storage_deletions WHERE completed_at IS NULL),
    'pendingErasures', (SELECT count(*) FROM private.account_erasures),
    'recent', (SELECT coalesce(jsonb_agg(private.admin_activity_row(a) ORDER BY a.occurred_at DESC, a.id DESC), '[]'::jsonb)
      FROM (SELECT * FROM private.uc02_audit WHERE action = ANY (private.admin_activity_actions())
        ORDER BY occurred_at DESC, id DESC LIMIT 15) a));
END $$;

CREATE FUNCTION private.admin_list_committees(p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF private.senior_admin_level(p_actor) IS NULL THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  RETURN jsonb_build_object('code', 'SUCCESS', 'committees', coalesce((SELECT jsonb_agg(jsonb_build_object(
    'id', c.id, 'name', c.name, 'slug', c.slug, 'description', c.description, 'archivedAt', c.archived_at,
    'protected', c.slug IN ('society-affairs', 'technical-team'),
    'managers', (SELECT coalesce(jsonb_agg(jsonb_build_object('userId', a.user_id, 'email', u.email)
        ORDER BY u.email), '[]'::jsonb)
      FROM public.administrative_access a JOIN private.access_auth_users u ON u.id = a.user_id
      WHERE a.committee_id = c.id AND a.revoked_at IS NULL),
    'members', (SELECT count(*) FROM private.committee_members m WHERE m.committee_id = c.id),
    'events', (SELECT count(*) FROM public.events e WHERE e.committee_id = c.id),
    'upcomingEvents', (SELECT count(*) FROM public.events e WHERE e.committee_id = c.id
      AND e.archived_at IS NULL AND e.status IN ('published', 'full') AND e.event_date > clock_timestamp()),
    'projects', (SELECT count(*) FROM private.projects p WHERE p.committee_id = c.id))
    ORDER BY c.archived_at IS NOT NULL, c.name) FROM public.committees c WHERE c.slug IS NOT NULL), '[]'::jsonb));
END $$;

CREATE FUNCTION private.admin_get_committee(p_actor uuid, p_committee uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c public.committees%ROWTYPE;
BEGIN
  IF private.senior_admin_level(p_actor) IS NULL THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  SELECT * INTO c FROM public.committees WHERE id = p_committee AND slug IS NOT NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  RETURN jsonb_build_object('code', 'SUCCESS',
    'committee', jsonb_build_object('id', c.id, 'name', c.name, 'slug', c.slug, 'description', c.description,
      'archivedAt', c.archived_at, 'updatedAt', c.updated_at,
      'protected', c.slug IN ('society-affairs', 'technical-team')),
    'managers', (SELECT coalesce(jsonb_agg(jsonb_build_object('userId', a.user_id, 'email', u.email,
        'active', a.revoked_at IS NULL, 'grantedAt', a.granted_at, 'revokedAt', a.revoked_at,
        'revocationKind', CASE WHEN a.revoked_at IS NULL THEN NULL ELSE coalesce(a.revocation_kind, 'revoked') END)
        ORDER BY a.revoked_at IS NOT NULL, u.email), '[]'::jsonb)
      FROM public.administrative_access a JOIN private.access_auth_users u ON u.id = a.user_id
      WHERE a.committee_id = c.id AND a.access_level = 'COMMITTEE_MANAGER'),
    'members', (SELECT coalesce(jsonb_agg(jsonb_build_object('memberId', m.id, 'name', m.full_name,
        'email', m.email, 'universityId', m.university_id, 'discipline', m.major, 'year', m.year,
        'responsibility', cm.responsibility, 'addedAt', cm.added_at) ORDER BY m.full_name), '[]'::jsonb)
      FROM private.committee_members cm JOIN public.members m ON m.id = cm.member_id
      WHERE cm.committee_id = c.id),
    'stats', jsonb_build_object(
      'events', (SELECT count(*) FROM public.events WHERE committee_id = c.id),
      'liveEvents', (SELECT count(*) FROM public.events WHERE committee_id = c.id
        AND archived_at IS NULL AND status IN ('published', 'full')),
      'upcomingEvents', (SELECT count(*) FROM public.events WHERE committee_id = c.id AND archived_at IS NULL
        AND status IN ('published', 'full') AND event_date > clock_timestamp()),
      'projects', (SELECT count(*) FROM private.projects WHERE committee_id = c.id)),
    'activity', (SELECT coalesce(jsonb_agg(private.admin_activity_row(a) ORDER BY a.occurred_at DESC, a.id DESC), '[]'::jsonb)
      FROM (SELECT * FROM private.uc02_audit WHERE committee_id = c.id
        AND action = ANY (private.admin_activity_actions())
        ORDER BY occurred_at DESC, id DESC LIMIT 20) a));
END $$;

-- The member directory: 30 per page, searched by name, email or student ID.
CREATE FUNCTION private.admin_list_members(p_actor uuid, p_search text, p_filter text, p_offset integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_search text := nullif(btrim(coalesce(p_search, '')), ''); v_pattern text;
BEGIN
  IF private.senior_admin_level(p_actor) IS NULL THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  IF p_filter IS NULL OR p_filter NOT IN ('all', 'member', 'graduate', 'admin') OR p_offset IS NULL
     OR p_offset < 0 OR p_offset > 100000 OR char_length(coalesce(v_search, '')) > 100 THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR'); END IF;
  v_pattern := '%' || replace(replace(replace(coalesce(v_search, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  RETURN (WITH matched AS (
    SELECT m.* FROM public.members m
    WHERE (v_search IS NULL OR m.full_name ILIKE v_pattern ESCAPE '\' OR m.email ILIKE v_pattern ESCAPE '\'
        OR m.university_id ILIKE v_pattern ESCAPE '\')
      AND (p_filter = 'all' OR (p_filter IN ('member', 'graduate') AND m.status::text = p_filter)
        OR (p_filter = 'admin' AND EXISTS (SELECT 1 FROM public.administrative_access a
          WHERE a.user_id = m.id AND a.revoked_at IS NULL)))
  ), page AS (
    SELECT * FROM matched ORDER BY full_name, id OFFSET p_offset LIMIT 30
  )
  SELECT jsonb_build_object('code', 'SUCCESS', 'total', (SELECT count(*) FROM matched),
    'members', coalesce((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'email', p.email,
      'universityId', p.university_id, 'year', p.year, 'discipline', p.major, 'status', p.status,
      'createdAt', p.created_at, 'hasPhoto', p.photo_key IS NOT NULL,
      'registrations', (SELECT count(*) FROM public.registrations r WHERE r.member_id = p.id),
      'projects', (SELECT count(*) FROM private.projects pr WHERE pr.member_id = p.id),
      'committees', (SELECT coalesce(jsonb_agg(c.name ORDER BY c.name), '[]'::jsonb)
        FROM private.committee_members cm JOIN public.committees c ON c.id = cm.committee_id
        WHERE cm.member_id = p.id),
      'adminLevel', (SELECT a.access_level FROM public.administrative_access a
        WHERE a.user_id = p.id AND a.revoked_at IS NULL)) ORDER BY p.full_name, p.id) FROM page p), '[]'::jsonb)));
END $$;

-- One member, with what an administrator needs to decide anything about them. No phone: it is
-- for event organizers only (ADR 0020).
CREATE FUNCTION private.admin_get_member(p_actor uuid, p_member uuid) RETURNS jsonb
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
      'createdAt', m.created_at, 'updatedAt', m.updated_at),
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
      FROM private.member_change_requests cr WHERE cr.member_id = m.id));
END $$;

-- =============================================================================================
-- Permanent deletion. Each routine shows its preview first (the same summary the deletion
-- re-checks under lock), refuses while anything blocks it, and deletes in one transaction.
-- Storage files are queued for the existing deletion worker, never deleted inline.
-- =============================================================================================
CREATE FUNCTION private.storage_bucket_valid(p_bucket text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$ SELECT p_bucket ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$' $$;

-- Events: only archived events or never-published drafts; certificates block.
CREATE FUNCTION private.event_deletion_summary(p_event uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  WITH e AS (SELECT * FROM public.events WHERE id = p_event),
  r AS (SELECT count(*) AS total,
      count(*) FILTER (WHERE status = 'confirmed') AS confirmed,
      count(*) FILTER (WHERE status = 'waitlisted') AS waitlisted,
      count(*) FILTER (WHERE attended) AS attended,
      count(*) FILTER (WHERE member_id IS NOT NULL) AS members
    FROM public.registrations WHERE event_id = p_event),
  cert AS (SELECT count(*) AS n FROM public.certificates ct
    JOIN public.registrations rg ON rg.id = ct.registration_id WHERE rg.event_id = p_event)
  SELECT jsonb_build_object('id', e.id, 'title', e.title, 'confirmation', e.title,
    'committeeId', e.committee_id, 'committee', (SELECT name FROM public.committees WHERE id = e.committee_id),
    'status', e.status, 'archived', e.archived_at IS NOT NULL, 'eventDate', e.event_date,
    'registrations', r.total, 'confirmed', r.confirmed, 'waitlisted', r.waitlisted,
    'attended', r.attended, 'memberRegistrations', r.members,
    'checkinSessions', (SELECT count(*) FROM private.event_checkin_sessions WHERE event_id = p_event),
    'coverImage', e.cover_image_key IS NOT NULL, 'certificates', cert.n,
    'auditEntries', (SELECT count(*) FROM private.uc02_audit WHERE event_id = p_event),
    'blockers', to_jsonb(array_remove(ARRAY[
      CASE WHEN e.archived_at IS NULL AND e.status <> 'draft' THEN 'EVENT_ACTIVE' END,
      CASE WHEN e.archived_at IS NULL AND e.status = 'draft' AND r.total > 0 THEN 'EVENT_HAS_REGISTRATIONS' END,
      CASE WHEN cert.n > 0 THEN 'CERTIFICATES_EXIST' END], NULL)))
  FROM e, r, cert
$$;

CREATE FUNCTION private.preview_event_deletion(p_actor uuid, p_event uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v jsonb;
BEGIN
  IF private.senior_admin_level(p_actor) IS NULL THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  v := private.event_deletion_summary(p_event);
  IF v IS NULL THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  RETURN jsonb_build_object('code', 'SUCCESS', 'preview', v);
END $$;

CREATE FUNCTION private.delete_event_permanently(p_actor uuid, p_event uuid, p_confirmation text, p_cover_bucket text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE e public.events%ROWTYPE; v jsonb;
BEGIN
  IF private.senior_admin_level(p_actor) IS NULL THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  -- Registration, check-in and lifecycle routines all lock the event row, so they finish first.
  SELECT * INTO e FROM public.events WHERE id = p_event FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  IF btrim(coalesce(p_confirmation, '')) <> btrim(e.title) THEN
    RETURN jsonb_build_object('code', 'CONFIRMATION_MISMATCH'); END IF;
  v := private.event_deletion_summary(p_event);
  IF jsonb_array_length(v -> 'blockers') > 0 THEN
    RETURN jsonb_build_object('code', 'BLOCKED', 'blockers', v -> 'blockers'); END IF;
  IF e.cover_image_key IS NOT NULL THEN
    IF NOT coalesce(private.storage_bucket_valid(p_cover_bucket), false) THEN
      RETURN jsonb_build_object('code', 'STORAGE_UNAVAILABLE'); END IF;
    INSERT INTO private.membership_storage_deletions (storage_bucket, storage_key, reason)
    VALUES (p_cover_bucket, e.cover_image_key, 'record_deleted') ON CONFLICT (storage_bucket, storage_key) DO NOTHING;
  END IF;
  DELETE FROM private.event_checkin_sessions WHERE event_id = p_event;
  DELETE FROM public.registrations WHERE event_id = p_event;
  DELETE FROM public.events WHERE id = p_event;
  INSERT INTO private.uc02_audit (committee_id, event_id, actor_kind, actor_user_id, action, changes)
  VALUES (e.committee_id, p_event, 'authenticated', p_actor, 'event.deleted', jsonb_build_object(
    'title', e.title, 'status', e.status, 'archived', e.archived_at IS NOT NULL,
    'registrations', v -> 'registrations', 'attended', v -> 'attended',
    'coverQueued', e.cover_image_key IS NOT NULL));
  RETURN jsonb_build_object('code', 'SUCCESS', 'registrations', v -> 'registrations');
END $$;

-- Projects: unpublish first; history and images go with the project.
CREATE FUNCTION private.project_label(p private.projects) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(nullif(btrim(p.content -> 'title' ->> 'en'), ''), nullif(btrim(p.content -> 'title' ->> 'ar'), ''),
    'project-' || left(p.id::text, 8))
$$;

CREATE FUNCTION private.project_deletion_summary(p_project uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object('id', p.id, 'title', private.project_label(p), 'confirmation', private.project_label(p),
    'status', p.status, 'published', p.published_revision IS NOT NULL,
    'author', (SELECT full_name FROM public.members WHERE id = p.member_id),
    'committee', (SELECT name FROM public.committees WHERE id = p.committee_id),
    'media', (SELECT count(*) FROM private.project_media WHERE project_id = p.id),
    'history', (SELECT count(*) FROM private.project_history WHERE project_id = p.id),
    'blockers', CASE WHEN p.published_revision IS NOT NULL THEN '["PROJECT_PUBLISHED"]'::jsonb ELSE '[]'::jsonb END)
  FROM private.projects p WHERE p.id = p_project
$$;

CREATE FUNCTION private.preview_project_deletion(p_actor uuid, p_project uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v jsonb;
BEGIN
  IF private.senior_admin_level(p_actor) IS NULL THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  v := private.project_deletion_summary(p_project);
  IF v IS NULL THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  RETURN jsonb_build_object('code', 'SUCCESS', 'preview', v);
END $$;

CREATE FUNCTION private.delete_project_permanently(p_actor uuid, p_project uuid, p_confirmation text, p_media_bucket text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE p private.projects%ROWTYPE; v jsonb; v_media integer;
BEGIN
  IF private.senior_admin_level(p_actor) IS NULL THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  SELECT * INTO p FROM private.projects WHERE id = p_project FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  IF btrim(coalesce(p_confirmation, '')) <> private.project_label(p) THEN
    RETURN jsonb_build_object('code', 'CONFIRMATION_MISMATCH'); END IF;
  v := private.project_deletion_summary(p_project);
  IF jsonb_array_length(v -> 'blockers') > 0 THEN
    RETURN jsonb_build_object('code', 'BLOCKED', 'blockers', v -> 'blockers'); END IF;
  SELECT count(*) INTO v_media FROM private.project_media WHERE project_id = p_project;
  IF v_media > 0 THEN
    IF NOT coalesce(private.storage_bucket_valid(p_media_bucket), false) THEN
      RETURN jsonb_build_object('code', 'STORAGE_UNAVAILABLE'); END IF;
    INSERT INTO private.membership_storage_deletions (storage_bucket, storage_key, reason)
    SELECT p_media_bucket, object_key, 'record_deleted' FROM private.project_media WHERE project_id = p_project
    ON CONFLICT (storage_bucket, storage_key) DO NOTHING;
  END IF;
  DELETE FROM private.project_history WHERE project_id = p_project;
  DELETE FROM private.project_media WHERE project_id = p_project;
  DELETE FROM private.projects WHERE id = p_project;
  INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
  VALUES (p.committee_id, 'authenticated', p_actor, 'project.deleted', jsonb_build_object(
    'projectId', p.id, 'title', private.project_label(p), 'status', p.status,
    'memberId', p.member_id, 'media', v_media));
  RETURN jsonb_build_object('code', 'SUCCESS');
END $$;

-- ---------------------------------------------------------------------------------------------
-- Members and accounts
-- ---------------------------------------------------------------------------------------------
-- The addresses a person used: the membership email and the sign-in email.
CREATE FUNCTION private.person_emails(p_user uuid) RETURNS text[]
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT coalesce(array_agg(DISTINCT e) FILTER (WHERE e IS NOT NULL), '{}'::text[]) FROM (
    SELECT lower(email) AS e FROM public.members WHERE id = p_user
    UNION ALL SELECT lower(email::text) FROM private.access_auth_users WHERE id = p_user) x
$$;

-- What deleting this person's membership ('membership') or account ('account') touches, and what
-- blocks it. Decisions about other people keep an account for accountability.
CREATE FUNCTION private.member_deletion_summary(p_user uuid, p_mode text) RETURNS jsonb
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
        AND d.storage_key IS NOT NULL),
    'changeRequests', (SELECT count(*) FROM private.member_change_requests WHERE member_id = p_user),
    'committees', (SELECT count(*) FROM private.committee_members WHERE member_id = p_user),
    'photo', v_member AND m.photo_key IS NOT NULL,
    'projects', v_projects, 'legacyRecords', v_legacy,
    'activeAccess', v_active,
    'formerAccess', EXISTS (SELECT 1 FROM public.administrative_access WHERE user_id = p_user AND revoked_at IS NOT NULL),
    'accountabilityRecords', v_accountability,
    'auditAsActor', (SELECT count(*) FROM private.uc02_audit WHERE actor_user_id = p_user),
    'pendingErasure', EXISTS (SELECT 1 FROM private.account_erasures WHERE user_id = p_user),
    'blockers', to_jsonb(v_blockers));
END $$;

CREATE FUNCTION private.preview_member_deletion(p_actor uuid, p_user uuid, p_mode text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_level text := private.senior_admin_level(p_actor); v jsonb;
BEGIN
  IF v_level IS NULL OR (p_mode = 'account' AND v_level <> 'TECHNICAL') THEN
    RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  IF p_mode IS NULL OR p_mode NOT IN ('membership', 'account') THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR'); END IF;
  IF p_actor = p_user THEN RETURN jsonb_build_object('code', 'SELF_CHANGE'); END IF;
  v := private.member_deletion_summary(p_user, p_mode);
  IF v IS NULL THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  RETURN jsonb_build_object('code', 'SUCCESS', 'preview', v);
END $$;

-- Removes one person's membership data. Registrations are anonymized, not deleted, so event
-- counts and attendance stay true. Applications go with their ID cards (the 0026 trigger queues
-- stored cards); the photo is queued here.
CREATE FUNCTION private.purge_member_data(p_user uuid, p_photo_bucket text) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_emails text[] := private.person_emails(p_user); v_photo text;
  v_registrations integer; v_applications integer; v_requests integer; v_roster integer;
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
  DELETE FROM private.membership_applications
  WHERE member_id = p_user OR auth_user_id = p_user OR lower(email) = ANY (v_emails);
  GET DIAGNOSTICS v_applications = ROW_COUNT;
  DELETE FROM public.members WHERE id = p_user;
  RETURN jsonb_build_object('registrationsAnonymized', v_registrations, 'applicationsDeleted', v_applications,
    'changeRequestsDeleted', v_requests, 'rosterRemoved', v_roster, 'photoQueued', v_photo IS NOT NULL);
END $$;

-- Deletes the membership record; the sign-in account remains and may apply again.
CREATE FUNCTION private.delete_member_record(p_actor uuid, p_member uuid, p_confirmation text, p_photo_bucket text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE m public.members%ROWTYPE; v jsonb; v_counts jsonb;
BEGIN
  IF private.senior_admin_level(p_actor) IS NULL THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  IF p_actor = p_member THEN RETURN jsonb_build_object('code', 'SELF_CHANGE'); END IF;
  SELECT * INTO m FROM public.members WHERE id = p_member FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  IF lower(btrim(coalesce(p_confirmation, ''))) <> lower(m.email) THEN
    RETURN jsonb_build_object('code', 'CONFIRMATION_MISMATCH'); END IF;
  v := private.member_deletion_summary(p_member, 'membership');
  IF jsonb_array_length(v -> 'blockers') > 0 THEN
    RETURN jsonb_build_object('code', 'BLOCKED', 'blockers', v -> 'blockers'); END IF;
  IF m.photo_key IS NOT NULL AND NOT coalesce(private.storage_bucket_valid(p_photo_bucket), false) THEN
    RETURN jsonb_build_object('code', 'STORAGE_UNAVAILABLE'); END IF;
  v_counts := private.purge_member_data(p_member, p_photo_bucket);
  INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
  VALUES (NULL, 'authenticated', p_actor, 'member.deleted',
    jsonb_build_object('memberId', p_member, 'mode', 'membership') || v_counts);
  RETURN jsonb_build_object('code', 'SUCCESS') || v_counts;
END $$;

-- Complete erasure (Technical Team): the membership data, the revoked grant row and every
-- identifying audit reference, in one transaction. The caller then deletes the Auth identity and
-- confirms it with complete_account_erasure; until then the erasure stays pending and retryable.
CREATE FUNCTION private.erase_account(p_actor uuid, p_user uuid, p_confirmation text, p_photo_bucket text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_email text; v jsonb; v_counts jsonb; v_photo text; v_erasure uuid; v_new boolean;
  v_actor_rows integer; v_subject_rows integer; v_keys text[] := private.audit_identity_keys();
BEGIN
  IF p_actor IS NULL OR p_user IS NULL THEN RETURN jsonb_build_object('code', 'VALIDATION_ERROR'); END IF;
  IF p_actor = p_user THEN RETURN jsonb_build_object('code', 'SELF_CHANGE'); END IF;
  -- Ordered with every access change (ADR 0014), then the target's own lock.
  PERFORM pg_advisory_xact_lock(hashtextextended('technical-ownership', 0));
  IF private.senior_admin_level(p_actor) IS DISTINCT FROM 'TECHNICAL' THEN
    RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('access:' || p_user, 0));
  SELECT email::text INTO v_email FROM private.access_auth_users WHERE id = p_user;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  IF lower(btrim(coalesce(p_confirmation, ''))) <> lower(coalesce(v_email, '')) THEN
    RETURN jsonb_build_object('code', 'CONFIRMATION_MISMATCH'); END IF;
  PERFORM 1 FROM public.administrative_access WHERE user_id = p_user FOR UPDATE;
  SELECT photo_key INTO v_photo FROM public.members WHERE id = p_user FOR UPDATE;
  v := private.member_deletion_summary(p_user, 'account');
  IF jsonb_array_length(v -> 'blockers') > 0 THEN
    RETURN jsonb_build_object('code', 'BLOCKED', 'blockers', v -> 'blockers'); END IF;
  IF v_photo IS NOT NULL AND NOT coalesce(private.storage_bucket_valid(p_photo_bucket), false) THEN
    RETURN jsonb_build_object('code', 'STORAGE_UNAVAILABLE'); END IF;
  v_counts := private.purge_member_data(p_user, p_photo_bucket);
  DELETE FROM public.administrative_access WHERE user_id = p_user AND revoked_at IS NOT NULL;
  UPDATE private.uc02_audit SET actor_user_id = NULL, actor_kind = 'erased',
    changes = private.audit_without_identity(changes, p_user)
  WHERE actor_user_id = p_user;
  GET DIAGNOSTICS v_actor_rows = ROW_COUNT;
  UPDATE private.uc02_audit SET changes = private.audit_without_identity(changes, p_user)
  WHERE EXISTS (SELECT 1 FROM unnest(v_keys) k WHERE changes ->> k = p_user::text);
  GET DIAGNOSTICS v_subject_rows = ROW_COUNT;
  INSERT INTO private.account_erasures (user_id, requested_by) VALUES (p_user, p_actor)
  ON CONFLICT (user_id) DO UPDATE SET attempts = private.account_erasures.attempts
  RETURNING id, (xmax = 0) INTO v_erasure, v_new;
  IF v_new THEN
    INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
    VALUES (NULL, 'authenticated', p_actor, 'account.erasure_started', jsonb_build_object(
      'erasureId', v_erasure, 'hadMembership', (v ->> 'hasMember')::boolean,
      'auditActorRows', v_actor_rows, 'auditSubjectRows', v_subject_rows) || v_counts);
  END IF;
  RETURN jsonb_build_object('code', 'SUCCESS', 'erasureId', v_erasure, 'userId', p_user) || v_counts;
END $$;

-- Confirms that Supabase Auth no longer has the identity, then closes the erasure.
CREATE FUNCTION private.complete_account_erasure(p_actor uuid, p_erasure uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v private.account_erasures%ROWTYPE;
BEGIN
  IF private.senior_admin_level(p_actor) IS DISTINCT FROM 'TECHNICAL' THEN
    RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  SELECT * INTO v FROM private.account_erasures WHERE id = p_erasure FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  IF EXISTS (SELECT 1 FROM private.access_auth_users WHERE id = v.user_id) THEN
    UPDATE private.account_erasures SET attempts = attempts + 1 WHERE id = p_erasure;
    RETURN jsonb_build_object('code', 'AUTH_ACCOUNT_REMAINS', 'userId', v.user_id);
  END IF;
  DELETE FROM private.account_erasures WHERE id = p_erasure;
  INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
  VALUES (NULL, 'authenticated', p_actor, 'account.erased', jsonb_build_object('erasureId', p_erasure));
  RETURN jsonb_build_object('code', 'SUCCESS');
END $$;

CREATE FUNCTION private.list_account_erasures(p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF private.senior_admin_level(p_actor) IS DISTINCT FROM 'TECHNICAL' THEN
    RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  RETURN jsonb_build_object('code', 'SUCCESS', 'erasures', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id', e.id, 'userId', e.user_id, 'requestedAt', e.requested_at, 'attempts', e.attempts,
      'email', (SELECT email FROM private.access_auth_users WHERE id = e.user_id)) ORDER BY e.requested_at)
    FROM private.account_erasures e), '[]'::jsonb));
END $$;

-- The deletion worker skips an object something still references, whatever kind it is.
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
-- Ownership and privileges: every routine runs as uc02_routine_owner; app_runtime may execute
-- only the entry points, and no browser role anything.
-- =============================================================================================
DO $$ DECLARE v_fn regprocedure; BEGIN
  FOR v_fn IN SELECT oid::regprocedure FROM pg_proc WHERE pronamespace = 'private'::regnamespace
    AND proname IN ('keep_revocation_kind', 'reject_archived_committee', 'audit_identity_keys',
      'guard_audit_update', 'audit_without_identity', 'senior_admin_level', 'committee_name_valid',
      'committee_description_valid', 'admin_create_committee', 'admin_update_committee',
      'admin_set_committee_archived', 'admin_change_committee_member', 'set_access_suspension',
      'list_administrative_access', 'admin_activity_actions', 'admin_activity_row', 'admin_overview',
      'admin_list_committees', 'admin_get_committee', 'admin_list_members', 'admin_get_member',
      'storage_bucket_valid', 'event_deletion_summary', 'preview_event_deletion', 'delete_event_permanently',
      'project_label', 'project_deletion_summary', 'preview_project_deletion', 'delete_project_permanently',
      'person_emails', 'member_deletion_summary', 'preview_member_deletion', 'purge_member_data',
      'delete_member_record', 'erase_account', 'complete_account_erasure', 'list_account_erasures') LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO uc02_routine_owner', v_fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, app_runtime, app_maintenance, service_role', v_fn);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION private.admin_create_committee(uuid, text, text, text) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.admin_update_committee(uuid, uuid, text, text) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.admin_set_committee_archived(uuid, uuid, boolean) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.admin_change_committee_member(uuid, uuid, uuid, text, text) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.set_access_suspension(uuid, uuid, boolean, text) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.list_administrative_access(uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.admin_overview(uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.admin_list_committees(uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.admin_get_committee(uuid, uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.admin_list_members(uuid, text, text, integer) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.admin_get_member(uuid, uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.preview_event_deletion(uuid, uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.delete_event_permanently(uuid, uuid, text, text) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.preview_project_deletion(uuid, uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.delete_project_permanently(uuid, uuid, text, text) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.preview_member_deletion(uuid, uuid, text) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.delete_member_record(uuid, uuid, text, text) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.erase_account(uuid, uuid, text, text) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.complete_account_erasure(uuid, uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.list_account_erasures(uuid) TO app_runtime;

DO $$ BEGIN
  IF private.core_schema_version() <> 32
     OR NOT has_function_privilege('app_runtime', 'private.erase_account(uuid,uuid,text,text)', 'EXECUTE')
     OR has_function_privilege('app_runtime', 'private.purge_member_data(uuid,text)', 'EXECUTE')
     OR has_function_privilege('app_runtime', 'private.member_deletion_summary(uuid,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'private.delete_event_permanently(uuid,uuid,text,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'private.admin_overview(uuid)', 'EXECUTE')
     OR has_table_privilege('app_runtime', 'private.committee_members', 'SELECT')
     OR has_table_privilege('app_runtime', 'private.account_erasures', 'SELECT')
     OR has_table_privilege('uc02_routine_owner', 'private.uc02_audit', 'DELETE')
     OR NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'private.committee_members'::regclass)
     OR NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'private.account_erasures'::regclass)
     OR EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'private.uc02_audit'::regclass AND contype = 'f'
       AND confrelid IN ('public.events'::regclass, 'public.registrations'::regclass))
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'uc02_audit_update_guard') THEN
    RAISE EXCEPTION '0032 self-check failed';
  END IF;
END $$;
