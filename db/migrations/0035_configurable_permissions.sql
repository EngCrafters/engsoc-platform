-- 0035: configurable committee and team permissions, and editable verification settings (ADR 0027).
--
-- Every protected operation now requires a named permission from private.permission_catalog. A
-- person's permissions are the union of: their personal level (administrative_access) through the
-- fixed mapping private.access_level_permissions; their committee's configuration when they are its
-- Committee Manager; and the configuration of the scope of each active Chief or Assistant Chief
-- appointment (the committee itself, or one team; teams never inherit). Each grant keeps its scope:
-- society-wide, or the group's own committee. private.has_permission decides every routine; the
-- helpers routines already called are redefined on top of it, and each routine that checked a level
-- directly names its permission. The Society Affairs slug exception becomes that committee's seeded
-- configuration.
--
-- Additive: no member, appointment, grant, setting or audit row is deleted or rewritten. The level
-- mapping reproduces the access each level had before 0035, plus permission management, the
-- verification settings and the Email Centre for Board Administration (the owner's request).
-- Committee-level position limits start equal to the existing per-team limits.

CREATE OR REPLACE FUNCTION private.core_schema_version() RETURNS integer
LANGUAGE sql IMMUTABLE AS $$ SELECT 35 $$;

-- =============================================================================================
-- Tables
-- =============================================================================================

-- The permissions an operation can require. Scopable ones can be granted for the group's own
-- committee instead of society-wide.
CREATE TABLE private.permission_catalog (
  key text PRIMARY KEY CHECK (key ~ '^[a-z]+(\.[a-z_]+)+$'),
  area text NOT NULL CHECK (area IN ('events', 'projects', 'membership', 'verification', 'leadership',
    'organization', 'settings', 'accounts', 'communications')),
  label_en text NOT NULL CHECK (char_length(label_en) BETWEEN 1 AND 80),
  description_en text NOT NULL CHECK (char_length(description_en) BETWEEN 1 AND 300),
  scopable boolean NOT NULL DEFAULT false,
  sort_order smallint NOT NULL UNIQUE
);

-- What each personal level grants. Fixed by migrations (ADR 0027); 'own' means the Committee
-- Manager's committee.
CREATE TABLE private.access_level_permissions (
  access_level public.administrative_access_level NOT NULL,
  permission text NOT NULL REFERENCES private.permission_catalog (key),
  scope text NOT NULL CHECK (scope IN ('all', 'own')),
  PRIMARY KEY (access_level, permission),
  CHECK (scope = 'all' OR access_level = 'COMMITTEE_MANAGER')
);

-- A committee's or a team's configuration: one row per granted permission. Exactly one of
-- committee_id and team_id. Leaders of the group (and a committee's Committee Manager) receive it.
CREATE TABLE private.group_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  committee_id uuid REFERENCES public.committees (id),
  team_id uuid REFERENCES private.committee_teams (id) ON DELETE CASCADE,
  permission text NOT NULL REFERENCES private.permission_catalog (key),
  scope text NOT NULL CHECK (scope IN ('all', 'own')),
  granted_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((committee_id IS NULL) <> (team_id IS NULL))
);
CREATE UNIQUE INDEX group_permissions_committee_unique ON private.group_permissions (committee_id, permission)
  WHERE committee_id IS NOT NULL;
CREATE UNIQUE INDEX group_permissions_team_unique ON private.group_permissions (team_id, permission)
  WHERE team_id IS NOT NULL;
CREATE INDEX group_permissions_permission_idx ON private.group_permissions (permission);

-- Committee-level holders per position, separate from team level. Starts equal to the existing
-- limit, which until now applied to both levels (ADR 0026).
ALTER TABLE private.organizational_positions ADD COLUMN max_holders_per_committee smallint
  CHECK (max_holders_per_committee IS NULL OR max_holders_per_committee BETWEEN 1 AND 50);
UPDATE private.organizational_positions SET max_holders_per_committee = max_holders_per_team;
COMMENT ON COLUMN private.organizational_positions.max_holders_per_team IS
  'Active holders allowed per team. NULL: no limit.';
COMMENT ON COLUMN private.organizational_positions.max_holders_per_committee IS
  'Active holders allowed at committee level (the committee itself). NULL: no limit.';

DO $$ DECLARE v_table text; BEGIN
  FOREACH v_table IN ARRAY ARRAY['permission_catalog', 'access_level_permissions', 'group_permissions'] LOOP
    EXECUTE format('ALTER TABLE private.%I OWNER TO uc02_routine_owner', v_table);
    EXECUTE format('ALTER TABLE private.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('ALTER TABLE private.%I FORCE ROW LEVEL SECURITY', v_table);
    EXECUTE format('REVOKE ALL ON TABLE private.%I FROM PUBLIC, anon, authenticated, service_role, app_runtime, app_maintenance', v_table);
    EXECUTE format('CREATE POLICY routine_owner ON private.%I TO uc02_routine_owner USING (true) WITH CHECK (true)', v_table);
  END LOOP;
END $$;

DO $$ DECLARE v_check text; BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_check FROM pg_constraint
    WHERE conrelid = 'private.uc02_audit'::regclass AND conname = 'uc02_audit_action_check';
  EXECUTE 'ALTER TABLE private.uc02_audit DROP CONSTRAINT uc02_audit_action_check';
  EXECUTE 'ALTER TABLE private.uc02_audit ADD CONSTRAINT uc02_audit_action_check CHECK (' ||
    substring(v_check from 8 for char_length(v_check) - 8) ||
    ' OR action IN (''permissions.changed''))';
END $$;
CREATE INDEX uc02_audit_permission_group_idx ON private.uc02_audit (
  (coalesce(changes ->> 'teamId', changes ->> 'committeeId')), occurred_at DESC) WHERE action = 'permissions.changed';

-- =============================================================================================
-- Seeds: the catalog, the level mapping, Society Affairs
-- =============================================================================================

INSERT INTO private.permission_catalog (key, area, label_en, description_en, scopable, sort_order) VALUES
  ('events.view', 'events', 'View events', 'See events, their details and registration counts.', true, 10),
  ('events.create', 'events', 'Create events', 'Create new events.', true, 11),
  ('events.edit', 'events', 'Edit events', 'Edit event details and images, and flag an event for review.', true, 12),
  ('events.publish', 'events', 'Publish events', 'Publish events, hold them as full, reopen, archive and restore them.', true, 13),
  ('events.approve', 'events', 'Approve events', 'Approve or reject events that require review (never an event the person flagged).', true, 14),
  ('events.delete', 'events', 'Delete events', 'Permanently delete events with their registrations.', true, 15),
  ('registrations.view', 'events', 'View registrations', 'See, count and export registrations and attendance.', true, 16),
  ('registrations.manage', 'events', 'Manage registrations', 'Promote from the waitlist, run check-in and record attendance.', true, 17),
  ('projects.view', 'projects', 'View projects', 'See the project review queue and project records.', false, 20),
  ('projects.review', 'projects', 'Review projects', 'Start reviews, request changes, approve and reject projects (never their own).', false, 21),
  ('projects.publish', 'projects', 'Publish projects', 'Publish and unpublish approved projects.', false, 22),
  ('projects.delete', 'projects', 'Delete projects', 'Permanently delete projects.', false, 23),
  ('membership.view', 'membership', 'View applications', 'See membership applications, their history and any legacy ID cards.', false, 30),
  ('membership.review', 'membership', 'Review applications', 'Verify, approve, reject and activate applications, and decide profile corrections (never their own).', false, 31),
  ('membership.final_approval', 'membership', 'Final approval', 'Give the second, senior approval when the two-step approval policy applies.', false, 32),
  ('members.view', 'membership', 'View members', 'See the member directory and member records.', false, 33),
  ('members.delete', 'membership', 'Delete membership records', 'Permanently delete a membership record.', false, 34),
  ('squ.view', 'verification', 'View SQU verification', 'See SQU verification requests and their evidence.', false, 40),
  ('squ.review', 'verification', 'Review SQU verification', 'Verify, reject and revoke SQU student verification (never their own).', false, 41),
  ('leadership.view', 'leadership', 'View leadership requests', 'See leadership requests and appointments.', true, 50),
  ('leadership.review', 'leadership', 'Decide leadership requests', 'Approve or reject requests, and change or revoke appointments (never their own).', true, 51),
  ('leadership.assign', 'leadership', 'Appoint leaders', 'Appoint Chiefs and Assistant Chiefs directly.', true, 52),
  ('committees.view', 'organization', 'View committees', 'See the administration overview, committees, their rosters and leaders.', false, 60),
  ('committees.manage', 'organization', 'Manage committees', 'Create, edit and archive committees and change their rosters.', false, 61),
  ('teams.manage', 'organization', 'Manage teams', 'Create, edit, move, deactivate, archive and delete teams.', true, 62),
  ('settings.verification', 'settings', 'Verification and leadership settings', 'Change submission limits, evidence retention, position limits and whether leadership requests are open.', false, 70),
  ('settings.membership_policy', 'settings', 'Membership approval policy', 'Set the membership approval policy.', false, 71),
  ('accounts.view', 'accounts', 'View accounts', 'See the account directory and the access history.', false, 80),
  ('accounts.manage', 'accounts', 'Manage committee access', 'Invite accounts, and grant, move, suspend or revoke Committee Manager access.', false, 81),
  ('accounts.admin_levels', 'accounts', 'Manage administrator access', 'Grant, suspend or revoke Board Administration and Technical access.', false, 82),
  ('accounts.credentials', 'accounts', 'Account credentials', 'Create accounts with a password, send password resets and set temporary passwords.', false, 83),
  ('accounts.erase', 'accounts', 'Delete sign-in accounts', 'Delete a sign-in account completely.', false, 84),
  ('permissions.manage', 'accounts', 'Manage permissions', 'Change the permissions of any committee or team, including full access.', false, 85),
  ('email.send', 'communications', 'Email Centre', 'Compose and send email to eligible members across all committees and teams.', false, 90);

-- Technical: everything it could do before 0035 (it never reviewed SQU evidence or leadership).
INSERT INTO private.access_level_permissions (access_level, permission, scope)
SELECT 'TECHNICAL', key, 'all' FROM private.permission_catalog
WHERE key NOT IN ('squ.view', 'squ.review', 'leadership.view', 'leadership.review', 'leadership.assign', 'email.send');
-- Board Administration: what it could do before 0035, plus permissions, settings and the Email Centre.
INSERT INTO private.access_level_permissions (access_level, permission, scope)
SELECT 'BOARD_ADMIN', key, 'all' FROM private.permission_catalog
WHERE key NOT IN ('settings.membership_policy', 'accounts.admin_levels', 'accounts.credentials', 'accounts.erase');
-- Committee Manager: the events and registrations of their own committee.
INSERT INTO private.access_level_permissions (access_level, permission, scope)
SELECT 'COMMITTEE_MANAGER', key, 'own' FROM private.permission_catalog
WHERE key IN ('events.view', 'events.create', 'events.edit', 'events.publish', 'registrations.view', 'registrations.manage');

-- Society Affairs: the authority that was tied to its slug, now its configuration.
INSERT INTO private.group_permissions (committee_id, permission, scope, granted_by)
SELECT c.id, p.key, 'all', NULL FROM public.committees c
CROSS JOIN (VALUES ('membership.view'), ('membership.review'), ('squ.view'), ('squ.review'), ('leadership.view'),
  ('leadership.review'), ('leadership.assign'), ('projects.view'), ('projects.review'), ('projects.publish'),
  ('settings.verification')) AS p (key)
WHERE c.slug = 'society-affairs';

-- =============================================================================================
-- Permission evaluation (internal)
-- =============================================================================================
-- The helpers below have no SECURITY DEFINER and no SET, so they stay cheap when a list checks every
-- row: actor_permission_grants is plain SQL, which the planner inlines into the query that reads it,
-- and the predicates are PL/pgSQL, whose plans are prepared once per session (a nested SQL function
-- with a sub-select would be planned again on every call). Only routines owned by
-- uc02_routine_owner call them, and every object they name is schema-qualified.


-- Every permission a person holds now, with its scope (committee_id NULL: society-wide) and its
-- source. Level, Committee Manager's committee, and each active appointment's own scope.
CREATE FUNCTION private.actor_permission_grants(p_actor uuid)
RETURNS TABLE (permission text, committee_id uuid, source text, source_committee uuid, source_team uuid)
LANGUAGE sql STABLE AS $$
  SELECT lp.permission, CASE WHEN lp.scope = 'own' THEN a.committee_id END, 'level'::text, a.committee_id, NULL::uuid
  FROM public.administrative_access a
  JOIN private.access_level_permissions lp ON lp.access_level = a.access_level
  WHERE a.user_id = p_actor AND a.revoked_at IS NULL
  UNION ALL
  SELECT g.permission, CASE WHEN g.scope = 'own' THEN g.committee_id END, 'manager', g.committee_id, NULL
  FROM public.administrative_access a
  JOIN public.committees c ON c.id = a.committee_id AND c.slug IS NOT NULL AND c.archived_at IS NULL
  JOIN private.group_permissions g ON g.committee_id = a.committee_id
  WHERE a.user_id = p_actor AND a.revoked_at IS NULL AND a.access_level = 'COMMITTEE_MANAGER'
  UNION ALL
  SELECT g.permission, CASE WHEN g.scope = 'own' THEN la.committee_id END, 'appointment', la.committee_id, NULL
  FROM private.leadership_appointments la
  JOIN public.members m ON m.id = la.member_id
  JOIN public.committees c ON c.id = la.committee_id AND c.slug IS NOT NULL AND c.archived_at IS NULL
  JOIN private.group_permissions g ON g.committee_id = la.committee_id
  WHERE la.member_id = p_actor AND la.ended_at IS NULL AND la.committee_id IS NOT NULL
  UNION ALL
  SELECT g.permission, CASE WHEN g.scope = 'own' THEN t.committee_id END, 'appointment', t.committee_id, t.id
  FROM private.leadership_appointments la
  JOIN public.members m ON m.id = la.member_id
  JOIN private.committee_teams t ON t.id = la.team_id AND t.status = 'active'
  JOIN public.committees c ON c.id = t.committee_id AND c.slug IS NOT NULL AND c.archived_at IS NULL
  JOIN private.group_permissions g ON g.team_id = la.team_id
  WHERE la.member_id = p_actor AND la.ended_at IS NULL AND la.team_id IS NOT NULL
$$;

-- p_committee NULL asks for society-wide authority; a committee is satisfied by a society-wide grant
-- or one scoped to that committee.
CREATE FUNCTION private.has_permission(p_actor uuid, p_permission text, p_committee uuid DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN EXISTS (SELECT 1 FROM private.actor_permission_grants(p_actor) g
    WHERE g.permission = p_permission AND (g.committee_id IS NULL OR g.committee_id = p_committee));
END $$;

-- Held in any scope (for entry points that then filter by committee).
CREATE FUNCTION private.has_any_permission(p_actor uuid, p_permission text)
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN EXISTS (SELECT 1 FROM private.actor_permission_grants(p_actor) g WHERE g.permission = p_permission);
END $$;

-- Over a live (slugged) committee's records.
CREATE FUNCTION private.can_in_committee(p_actor uuid, p_permission text, p_committee uuid)
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN EXISTS (SELECT 1 FROM public.committees WHERE id = p_committee AND slug IS NOT NULL)
    AND private.has_permission(p_actor, p_permission, p_committee);
END $$;

-- For a record looked up by id: when it does not exist (no committee), any scope suffices so the
-- routine still answers NOT_FOUND.
CREATE FUNCTION private.can_record_permission(p_actor uuid, p_permission text, p_committee uuid)
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF p_committee IS NULL THEN RETURN private.has_any_permission(p_actor, p_permission); END IF;
  RETURN private.has_permission(p_actor, p_permission, p_committee);
END $$;

-- The live committees a permission covers, computed once: lists over every event use it as an
-- uncorrelated sub-select (one evaluation per query) instead of a check per row.
CREATE FUNCTION private.permission_committees(p_actor uuid, p_permission text) RETURNS uuid[]
LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF private.has_permission(p_actor, p_permission) THEN
    RETURN ARRAY(SELECT id FROM public.committees WHERE slug IS NOT NULL);
  END IF;
  RETURN ARRAY(SELECT DISTINCT g.committee_id FROM private.actor_permission_grants(p_actor) g
    JOIN public.committees c ON c.id = g.committee_id AND c.slug IS NOT NULL
    WHERE g.permission = p_permission);
END $$;

-- Serializes a decision with changes to its sources: appointment and configuration changes hold the
-- exclusive organization lock; access changes update the administrative_access row.
CREATE FUNCTION private.lock_access_sources(p_actor uuid, p_exclusive boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM private.lock_organization(coalesce(p_exclusive, false));
  PERFORM 1 FROM public.administrative_access WHERE user_id = p_actor AND revoked_at IS NULL FOR SHARE;
END $$;

-- The locking forms. Routines that later take the exclusive organization lock pass p_exclusive.
CREATE FUNCTION private.lock_permission(p_actor uuid, p_permission text, p_committee uuid DEFAULT NULL,
  p_exclusive boolean DEFAULT false) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_actor IS NULL THEN RETURN false; END IF;
  PERFORM private.lock_access_sources(p_actor, p_exclusive);
  RETURN private.has_permission(p_actor, p_permission, p_committee);
END $$;

CREATE FUNCTION private.lock_committee_permission(p_actor uuid, p_permission text, p_committee uuid,
  p_exclusive boolean DEFAULT false) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_actor IS NULL OR NOT EXISTS (SELECT 1 FROM public.committees WHERE id = p_committee AND slug IS NOT NULL) THEN
    RETURN false; END IF;
  PERFORM private.lock_access_sources(p_actor, p_exclusive);
  RETURN private.has_permission(p_actor, p_permission, p_committee);
END $$;

CREATE FUNCTION private.lock_record_permission(p_actor uuid, p_permission text, p_committee uuid,
  p_exclusive boolean DEFAULT false) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_actor IS NULL THEN RETURN false; END IF;
  PERFORM private.lock_access_sources(p_actor, p_exclusive);
  RETURN private.can_record_permission(p_actor, p_permission, p_committee);
END $$;

-- Who may see a committee's administration page: everyone with committees.view, and people who
-- manage its teams or appoint its leaders.
CREATE FUNCTION private.can_view_committee(p_actor uuid, p_committee uuid)
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN private.has_permission(p_actor, 'committees.view')
    OR private.can_in_committee(p_actor, 'teams.manage', p_committee)
    OR private.can_in_committee(p_actor, 'leadership.assign', p_committee);
END $$;

CREATE FUNCTION private.can_view_any_committee(p_actor uuid)
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN private.has_permission(p_actor, 'committees.view')
    OR private.has_any_permission(p_actor, 'teams.manage')
    OR private.has_any_permission(p_actor, 'leadership.assign');
END $$;

-- Account administration kind for the access routines: 'full' (administrator levels) or 'limited'
-- (Committee Manager access only). Locks the actor's access sources.
CREATE FUNCTION private.account_admin_kind(p_actor uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_actor IS NULL THEN RETURN NULL; END IF;
  PERFORM private.lock_access_sources(p_actor, false);
  IF private.has_permission(p_actor, 'accounts.admin_levels') THEN RETURN 'full'; END IF;
  IF private.has_permission(p_actor, 'accounts.manage') THEN RETURN 'limited'; END IF;
  RETURN NULL;
END $$;

-- Accounts that can still recover administration: they manage both permissions and administrator
-- access society-wide.
CREATE FUNCTION private.recovery_account_count() RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT count(*)::integer FROM (
    SELECT user_id AS id FROM public.administrative_access WHERE revoked_at IS NULL
    UNION SELECT member_id FROM private.leadership_appointments WHERE ended_at IS NULL) u
  WHERE private.has_permission(u.id, 'permissions.manage') AND private.has_permission(u.id, 'accounts.admin_levels');
$$;

-- A routine that can remove someone's access calls _begin after its authorization check and _end
-- before it succeeds: if recovery accounts existed before and none remain, the whole call fails with
-- LAST_RECOVERY_ACCOUNT (Core maps the error to that code).
CREATE FUNCTION private.recovery_guard_begin() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM set_config('essqu.recovery_before', private.recovery_account_count()::text, true);
END $$;

CREATE FUNCTION private.recovery_guard_end() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF coalesce(nullif(current_setting('essqu.recovery_before', true), '')::integer, 0) > 0
     AND private.recovery_account_count() = 0 THEN
    RAISE EXCEPTION 'LAST_RECOVERY_ACCOUNT' USING ERRCODE = 'P0001';
  END IF;
END $$;

-- A permission set as stored and compared: known keys only, one entry each, catalog order.
CREATE FUNCTION private.permission_set_json(p_items jsonb) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('key', x.key, 'scope', x.scope) ORDER BY pc.sort_order), '[]'::jsonb)
  FROM (SELECT DISTINCT ON (e ->> 'key') e ->> 'key' AS key, coalesce(e ->> 'scope', 'all') AS scope
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_items) = 'array' THEN p_items ELSE '[]'::jsonb END) e
        ORDER BY e ->> 'key') x
  JOIN private.permission_catalog pc ON pc.key = x.key;
$$;

CREATE FUNCTION private.group_permissions_json(p_committee uuid, p_team uuid) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('key', g.permission, 'scope', g.scope) ORDER BY pc.sort_order), '[]'::jsonb)
  FROM private.group_permissions g JOIN private.permission_catalog pc ON pc.key = g.permission
  WHERE CASE WHEN p_team IS NULL THEN g.committee_id = p_committee ELSE g.team_id = p_team END;
$$;

CREATE FUNCTION private.is_full_access(p_set jsonb) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT (SELECT count(*) FROM private.permission_catalog) =
    (SELECT count(*) FROM jsonb_array_elements(coalesce(p_set, '[]'::jsonb)) e WHERE e ->> 'scope' = 'all');
$$;

-- =============================================================================================
-- Existing helpers, redefined on the permission model
-- =============================================================================================

CREATE OR REPLACE FUNCTION private.can_access_committee(p_actor uuid, p_committee uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT private.can_in_committee(p_actor, 'events.view', p_committee);
$$;

-- No routine calls this after 0035 (each names its own permission); kept for compatibility.
CREATE OR REPLACE FUNCTION private.lock_committee_access(p_actor uuid, p_committee uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RETURN private.lock_committee_permission(p_actor, 'events.edit', p_committee);
END $$;

CREATE OR REPLACE FUNCTION private.can_review_event(p_actor uuid, p_event uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_committee uuid;
BEGIN
  SELECT e.committee_id INTO v_committee FROM public.events e JOIN public.committees c
    ON c.id = e.committee_id WHERE e.id = p_event AND c.slug IS NOT NULL;
  IF v_committee IS NULL THEN RETURN false; END IF;
  RETURN private.lock_committee_permission(p_actor, 'events.approve', v_committee);
END $$;

-- 'senior' when the reviewer can also give final approval (two-step policy), else 'reviewer'.
-- Reads need membership.view; decisions (p_lock) membership.review.
CREATE OR REPLACE FUNCTION private.membership_reviewer_kind(p_actor uuid, p_lock boolean)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_actor IS NULL THEN RETURN NULL; END IF;
  IF NOT (CASE WHEN p_lock THEN private.lock_permission(p_actor, 'membership.review')
      ELSE private.has_permission(p_actor, 'membership.view') END) THEN
    RETURN NULL; END IF;
  RETURN CASE WHEN private.has_permission(p_actor, 'membership.final_approval') THEN 'senior' ELSE 'reviewer' END;
END $$;

CREATE OR REPLACE FUNCTION private.verification_reviewer_kind(p_actor uuid, p_lock boolean)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_actor IS NULL THEN RETURN NULL; END IF;
  RETURN CASE WHEN CASE WHEN p_lock THEN private.lock_permission(p_actor, 'squ.review')
      ELSE private.has_permission(p_actor, 'squ.view') END THEN 'reviewer' END;
END $$;

-- Any scope. Routines that act on one request or appointment check that record's committee.
CREATE OR REPLACE FUNCTION private.leadership_reviewer_kind(p_actor uuid, p_lock boolean)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_actor IS NULL THEN RETURN NULL; END IF;
  IF p_lock THEN PERFORM private.lock_access_sources(p_actor, true); END IF;
  RETURN CASE WHEN private.has_any_permission(p_actor, CASE WHEN p_lock THEN 'leadership.review' ELSE 'leadership.view' END)
    THEN 'reviewer' END;
END $$;

CREATE OR REPLACE FUNCTION private.project_reviewer(p_actor uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RETURN private.lock_permission(p_actor, 'projects.view');
END $$;

-- Committee-level appointments use the committee-level limit (ADR 0027).
CREATE OR REPLACE FUNCTION private.leadership_appoint_scoped(p_member uuid, p_committee uuid, p_team uuid, p_position text,
  p_actor uuid, p_source text, p_note text) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_max integer; v_member_max integer; v_held integer; v_id uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM private.leadership_appointments WHERE member_id = p_member AND ended_at IS NULL
      AND (CASE WHEN p_team IS NULL THEN committee_id = p_committee ELSE team_id = p_team END)) THEN
    RETURN jsonb_build_object('code', 'ALREADY_APPOINTED'); END IF;
  SELECT CASE WHEN p_team IS NULL THEN max_holders_per_committee ELSE max_holders_per_team END INTO v_max
    FROM private.organizational_positions WHERE id = p_position;
  SELECT count(*) INTO v_held FROM private.leadership_appointments WHERE position_id = p_position AND ended_at IS NULL
    AND (CASE WHEN p_team IS NULL THEN committee_id = p_committee ELSE team_id = p_team END);
  IF v_max IS NOT NULL AND v_held >= v_max THEN RETURN jsonb_build_object('code', 'POSITION_FULL'); END IF;
  SELECT max_active_appointments_per_member INTO v_member_max FROM private.verification_settings;
  IF v_member_max IS NOT NULL AND (SELECT count(*) FROM private.leadership_appointments
      WHERE member_id = p_member AND ended_at IS NULL) >= v_member_max THEN
    RETURN jsonb_build_object('code', 'MEMBER_LIMIT_REACHED'); END IF;
  INSERT INTO private.leadership_appointments (member_id, team_id, committee_id, position_id, source, appointed_by,
    appointment_note)
  VALUES (p_member, p_team, CASE WHEN p_team IS NULL THEN p_committee END, p_position, p_source, p_actor, p_note)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('code', 'SUCCESS', 'appointmentId', v_id);
END $$;

-- =============================================================================================
-- Dashboard access (runtime)
-- =============================================================================================

-- The signed-in person's dashboard access for one request: each permission with 'all' or the
-- committees it covers, where it comes from, and the committees the dashboard can show.
CREATE FUNCTION private.get_dashboard_access(p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_level text; v_committee uuid; v_permissions jsonb;
BEGIN
  IF p_actor IS NULL THEN RETURN jsonb_build_object('code', 'VALIDATION_ERROR'); END IF;
  SELECT access_level::text, committee_id INTO v_level, v_committee
    FROM public.administrative_access WHERE user_id = p_actor AND revoked_at IS NULL;
  SELECT coalesce(jsonb_object_agg(x.permission, x.scope), '{}'::jsonb) INTO v_permissions FROM (
    SELECT g.permission, CASE WHEN bool_or(g.committee_id IS NULL) THEN to_jsonb('all'::text)
      ELSE to_jsonb(array_agg(DISTINCT g.committee_id)) END AS scope
    FROM private.actor_permission_grants(p_actor) g GROUP BY g.permission) x;
  RETURN jsonb_build_object('code', 'SUCCESS', 'level', v_level, 'levelCommitteeId', v_committee,
    'permissions', v_permissions,
    'appointments', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'position', private.position_json(la.position_id),
        'committee', jsonb_build_object('id', c.id, 'name', c.name),
        'team', CASE WHEN t.id IS NULL THEN NULL ELSE jsonb_build_object('id', t.id, 'name', t.name_en) END,
        'permissions', (SELECT count(*) FROM private.group_permissions g
          WHERE CASE WHEN la.team_id IS NULL THEN g.committee_id = la.committee_id ELSE g.team_id = la.team_id END))
        ORDER BY c.name, t.name_en NULLS FIRST), '[]'::jsonb)
      FROM private.leadership_appointments la
      LEFT JOIN private.committee_teams t ON t.id = la.team_id
      JOIN public.committees c ON c.id = coalesce(la.committee_id, t.committee_id)
      WHERE la.member_id = p_actor AND la.ended_at IS NULL),
    'committees', CASE WHEN v_permissions = '{}'::jsonb THEN '[]'::jsonb ELSE (SELECT coalesce(jsonb_agg(
        jsonb_build_object('id', c.id, 'name', c.name, 'slug', c.slug, 'archived', c.archived_at IS NOT NULL)
        ORDER BY c.name), '[]'::jsonb) FROM public.committees c WHERE c.slug IS NOT NULL) END);
END $$;

-- =============================================================================================
-- Permission management (runtime; permissions.manage)
-- =============================================================================================

CREATE FUNCTION private.permission_catalog_json() RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('key', key, 'area', area, 'label', label_en,
    'description', description_en, 'scopable', scopable) ORDER BY sort_order), '[]'::jsonb)
  FROM private.permission_catalog;
$$;

CREATE FUNCTION private.list_permission_groups(p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT private.has_permission(p_actor, 'permissions.manage') THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  RETURN jsonb_build_object('code', 'SUCCESS', 'catalog', private.permission_catalog_json(),
    'levels', (SELECT coalesce(jsonb_object_agg(x.access_level, x.items), '{}'::jsonb) FROM (
      SELECT lp.access_level, jsonb_agg(jsonb_build_object('key', lp.permission, 'scope', lp.scope) ORDER BY pc.sort_order) AS items
      FROM private.access_level_permissions lp JOIN private.permission_catalog pc ON pc.key = lp.permission
      GROUP BY lp.access_level) x),
    'committees', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'slug', c.slug,
        'archived', c.archived_at IS NOT NULL,
        'permissions', private.group_permissions_json(c.id, NULL),
        'leaders', (SELECT count(*) FROM private.leadership_appointments la WHERE la.committee_id = c.id AND la.ended_at IS NULL),
        'managers', (SELECT count(*) FROM public.administrative_access a WHERE a.committee_id = c.id
          AND a.revoked_at IS NULL AND a.access_level = 'COMMITTEE_MANAGER'),
        'teams', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', t.id,
            'name', jsonb_build_object('en', t.name_en, 'ar', t.name_ar), 'status', t.status,
            'permissions', private.group_permissions_json(NULL, t.id),
            'leaders', (SELECT count(*) FROM private.leadership_appointments la WHERE la.team_id = t.id AND la.ended_at IS NULL))
          ORDER BY t.status <> 'active', t.name_en), '[]'::jsonb)
          FROM private.committee_teams t WHERE t.committee_id = c.id AND t.status <> 'archived'))
      ORDER BY c.archived_at IS NOT NULL, c.name), '[]'::jsonb)
      FROM public.committees c WHERE c.slug IS NOT NULL));
END $$;

-- One group's configuration, the people it applies to, and its change history.
CREATE FUNCTION private.get_permission_group(p_actor uuid, p_committee uuid, p_team uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c public.committees%ROWTYPE; t private.committee_teams%ROWTYPE; v_self boolean;
BEGIN
  IF (p_committee IS NULL) = (p_team IS NULL) THEN RETURN jsonb_build_object('code', 'VALIDATION_ERROR'); END IF;
  IF NOT private.has_permission(p_actor, 'permissions.manage') THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  IF p_team IS NOT NULL THEN
    SELECT * INTO t FROM private.committee_teams WHERE id = p_team;
    IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
    SELECT * INTO c FROM public.committees WHERE id = t.committee_id;
    v_self := EXISTS (SELECT 1 FROM private.leadership_appointments WHERE member_id = p_actor AND ended_at IS NULL AND team_id = p_team);
  ELSE
    SELECT * INTO c FROM public.committees WHERE id = p_committee AND slug IS NOT NULL;
    IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
    v_self := EXISTS (SELECT 1 FROM private.leadership_appointments WHERE member_id = p_actor AND ended_at IS NULL AND committee_id = p_committee)
      OR EXISTS (SELECT 1 FROM public.administrative_access WHERE user_id = p_actor AND revoked_at IS NULL
        AND access_level = 'COMMITTEE_MANAGER' AND committee_id = p_committee);
  END IF;
  RETURN jsonb_build_object('code', 'SUCCESS',
    'group', jsonb_build_object('kind', CASE WHEN p_team IS NULL THEN 'committee' ELSE 'team' END,
      'id', coalesce(p_team, p_committee),
      'name', CASE WHEN p_team IS NULL THEN c.name ELSE t.name_en END,
      'nameAr', CASE WHEN p_team IS NULL THEN NULL ELSE t.name_ar END,
      'committee', jsonb_build_object('id', c.id, 'name', c.name, 'archived', c.archived_at IS NOT NULL),
      'status', CASE WHEN p_team IS NULL THEN CASE WHEN c.archived_at IS NULL THEN 'active' ELSE 'archived' END ELSE t.status END),
    'permissions', private.group_permissions_json(p_committee, p_team),
    'catalog', private.permission_catalog_json(),
    'self', v_self,
    'holders', (SELECT coalesce(jsonb_agg(h.j ORDER BY h.name), '[]'::jsonb) FROM (
      SELECT m.full_name AS name, jsonb_build_object('memberId', m.id, 'name', m.full_name, 'email', m.email,
        'source', 'appointment', 'position', private.position_json(la.position_id)) AS j
      FROM private.leadership_appointments la JOIN public.members m ON m.id = la.member_id
      WHERE la.ended_at IS NULL AND CASE WHEN p_team IS NULL THEN la.committee_id = p_committee ELSE la.team_id = p_team END
      UNION ALL
      SELECT u.email, jsonb_build_object('memberId', a.user_id, 'name', NULL, 'email', u.email,
        'source', 'manager', 'position', NULL)
      FROM public.administrative_access a JOIN private.access_auth_users u ON u.id = a.user_id
      WHERE p_team IS NULL AND a.committee_id = p_committee AND a.revoked_at IS NULL AND a.access_level = 'COMMITTEE_MANAGER') h),
    'history', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'at', x.occurred_at,
        'actorEmail', private.membership_actor_email(x.actor_user_id), 'previous', x.changes -> 'previous',
        'next', x.changes -> 'next', 'note', x.changes ->> 'note') ORDER BY x.occurred_at DESC), '[]'::jsonb)
      FROM (SELECT * FROM private.uc02_audit a WHERE a.action = 'permissions.changed'
        AND coalesce(a.changes ->> 'teamId', a.changes ->> 'committeeId') = coalesce(p_team, p_committee)::text
        AND (a.changes ->> 'groupKind') = CASE WHEN p_team IS NULL THEN 'committee' ELSE 'team' END
        ORDER BY a.occurred_at DESC LIMIT 50) x));
END $$;

-- Replaces a group's configuration. p_previous is the configuration the editor started from
-- (STALE_REVISION if it changed since). Granting full access, or adding or removing
-- permissions.manage, needs p_confirmed. Nobody changes a group through which they hold access.
-- Refused with LAST_RECOVERY_ACCOUNT if no account could still manage permissions and administrator
-- access afterwards. Audited with the previous and new configuration.
CREATE FUNCTION private.set_group_permissions(p_actor uuid, p_committee uuid, p_team uuid, p_permissions jsonb,
  p_previous jsonb, p_confirmed boolean, p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_committee uuid; v_prev jsonb; v_next jsonb; v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_before integer; v_items integer; v_manage_changed boolean;
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
    IF EXISTS (SELECT 1 FROM private.leadership_appointments WHERE member_id = p_actor AND ended_at IS NULL AND team_id = p_team) THEN
      RETURN jsonb_build_object('code', 'SELF_CHANGE'); END IF;
  ELSE
    PERFORM 1 FROM public.committees WHERE id = p_committee AND slug IS NOT NULL FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
    v_committee := p_committee;
    IF EXISTS (SELECT 1 FROM private.leadership_appointments WHERE member_id = p_actor AND ended_at IS NULL AND committee_id = p_committee)
       OR EXISTS (SELECT 1 FROM public.administrative_access WHERE user_id = p_actor AND revoked_at IS NULL
         AND access_level = 'COMMITTEE_MANAGER' AND committee_id = p_committee) THEN
      RETURN jsonb_build_object('code', 'SELF_CHANGE'); END IF;
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
    'fullAccess', private.is_full_access(v_next), 'note', v_note));
  RETURN jsonb_build_object('code', 'SUCCESS', 'permissions', v_next);
END $$;

-- =============================================================================================
-- Verification and leadership settings (runtime; settings.verification to change)
-- =============================================================================================

CREATE OR REPLACE FUNCTION private.get_verification_settings(p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s private.verification_settings%ROWTYPE;
BEGIN
  IF NOT (private.has_permission(p_actor, 'settings.verification') OR private.has_permission(p_actor, 'squ.view')
      OR private.has_any_permission(p_actor, 'leadership.view') OR private.has_permission(p_actor, 'membership.view')) THEN
    RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  SELECT * INTO s FROM private.verification_settings;
  RETURN jsonb_build_object('code', 'SUCCESS',
    'canEdit', private.has_permission(p_actor, 'settings.verification'),
    'leadershipRequestsOpen', s.leadership_requests_open,
    'squSubmissionsPer30Days', s.squ_submissions_per_30_days,
    'documentRetentionDays', s.document_retention_days,
    'leadershipRequestsPer30Days', s.leadership_requests_per_30_days,
    'maxActiveAppointmentsPerMember', s.max_active_appointments_per_member,
    'updatedAt', s.updated_at, 'updatedByEmail', private.membership_actor_email(s.updated_by),
    'positions', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', id,
        'label', jsonb_build_object('en', label_en, 'ar', label_ar), 'maxHolders', max_holders_per_team,
        'maxHoldersPerCommittee', max_holders_per_committee)
        ORDER BY rank), '[]'::jsonb) FROM private.organizational_positions WHERE active));
END $$;

-- How many stored SQU evidence files a retention period (days) makes eligible for deletion now.
CREATE FUNCTION private.preview_retention_impact(p_actor uuid, p_days integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT private.has_permission(p_actor, 'settings.verification') THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  IF p_days IS NULL OR p_days NOT BETWEEN 30 AND 3650 THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'documentRetentionDays'); END IF;
  RETURN jsonb_build_object('code', 'SUCCESS', 'days', p_days, 'eligible', (
    SELECT count(*) FROM private.squ_verification_documents d JOIN private.squ_verification_requests r ON r.id = d.request_id
    WHERE r.status <> 'pending' AND r.decided_at < clock_timestamp() - make_interval(days => p_days)));
END $$;

-- 0033's settings with a confirmation: setting or shortening the retention period so that stored
-- evidence becomes eligible for deletion needs p_confirm_retention. Saving deletes nothing.
CREATE FUNCTION private.set_verification_settings(p_actor uuid, p_squ_per_30_days integer, p_retention_days integer,
  p_leadership_per_30_days integer, p_max_active_appointments integer, p_confirm_retention boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_current integer; v_eligible integer;
BEGIN
  IF p_retention_days IS NOT NULL AND p_retention_days BETWEEN 30 AND 3650 THEN
    SELECT document_retention_days INTO v_current FROM private.verification_settings;
    IF v_current IS NULL OR p_retention_days < v_current THEN
      SELECT count(*) INTO v_eligible FROM private.squ_verification_documents d
        JOIN private.squ_verification_requests r ON r.id = d.request_id
        WHERE r.status <> 'pending' AND r.decided_at < clock_timestamp() - make_interval(days => p_retention_days);
      IF v_eligible > 0 AND NOT coalesce(p_confirm_retention, false)
         AND private.has_permission(p_actor, 'settings.verification') THEN
        RETURN jsonb_build_object('code', 'RETENTION_CONFIRMATION_REQUIRED', 'eligible', v_eligible); END IF;
    END IF;
  END IF;
  RETURN private.set_verification_settings(p_actor, p_squ_per_30_days, p_retention_days, p_leadership_per_30_days,
    p_max_active_appointments);
END $$;

-- Committee-level or team-level holders per position.
CREATE FUNCTION private.set_position_limit(p_actor uuid, p_position text, p_level text, p_max integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_previous integer;
BEGIN
  IF p_level IS NULL OR p_level NOT IN ('team', 'committee') THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'level'); END IF;
  IF p_level = 'team' THEN RETURN private.set_position_limit(p_actor, p_position, p_max); END IF;
  IF p_max IS NOT NULL AND p_max NOT BETWEEN 1 AND 50 THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'maxHolders'); END IF;
  IF NOT private.lock_permission(p_actor, 'settings.verification', NULL, true) THEN
    RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  SELECT max_holders_per_committee INTO v_previous FROM private.organizational_positions WHERE id = p_position FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  IF v_previous IS NOT DISTINCT FROM p_max THEN RETURN jsonb_build_object('code', 'UNCHANGED'); END IF;
  UPDATE private.organizational_positions SET max_holders_per_committee = p_max WHERE id = p_position;
  INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
  VALUES (NULL, 'authenticated', p_actor, 'position.limit_changed', jsonb_build_object(
    'position', p_position, 'level', 'committee', 'previous', v_previous, 'next', p_max));
  RETURN jsonb_build_object('code', 'SUCCESS');
END $$;

-- The membership section's overview: counts for each queue the person can see.
CREATE OR REPLACE FUNCTION private.get_membership_review_overview(p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_apps boolean := private.has_permission(p_actor, 'membership.view');
  v_squ boolean := private.has_permission(p_actor, 'squ.view');
  v_lead boolean := private.has_any_permission(p_actor, 'leadership.view');
  v_counts jsonb;
BEGIN
  IF NOT (v_apps OR v_squ OR v_lead) THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  SELECT jsonb_build_object(
      'pending_review', count(*) FILTER (WHERE status = 'pending_review'),
      'verified', count(*) FILTER (WHERE status = 'verified'),
      'approved', count(*) FILTER (WHERE status = 'approved'),
      'rejected', count(*) FILTER (WHERE status = 'rejected'),
      'activationPending', count(*) FILTER (WHERE status = 'approved' AND activated_at IS NULL))
    INTO v_counts FROM private.membership_applications WHERE v_apps;
  v_counts := v_counts || jsonb_build_object(
    'squPending', CASE WHEN v_squ THEN (SELECT count(*) FROM private.squ_verification_requests WHERE status = 'pending') ELSE 0 END,
    'leadershipPending', CASE WHEN v_lead THEN (SELECT count(*) FROM private.leadership_requests r WHERE r.status = 'pending'
      AND private.has_permission(p_actor, 'leadership.view', r.committee_id)) ELSE 0 END);
  RETURN jsonb_build_object('code', 'SUCCESS',
    'reviewer', CASE WHEN v_apps THEN CASE WHEN private.has_permission(p_actor, 'membership.final_approval')
      THEN 'senior' ELSE 'reviewer' END END,
    'verificationReviewer', CASE WHEN v_squ THEN 'reviewer' END,
    'leadershipReviewer', CASE WHEN v_lead THEN 'reviewer' END,
    'can', jsonb_build_object('reviewApplications', private.has_permission(p_actor, 'membership.review'),
      'finalApproval', private.has_permission(p_actor, 'membership.final_approval'),
      'reviewSqu', private.has_permission(p_actor, 'squ.review'),
      'reviewLeadership', private.has_any_permission(p_actor, 'leadership.review'),
      'settings', private.has_permission(p_actor, 'settings.verification')),
    'policy', (SELECT approval_policy FROM private.membership_settings), 'counts', v_counts);
END $$;

-- =============================================================================================
-- Existing routines: each now names the permission it requires (generated from their schema-34
-- definitions; only the authorization lines, and the committee-level position limit, change)
-- =============================================================================================

CREATE OR REPLACE FUNCTION private.archive_event(p_actor uuid, p_event_id uuid, p_expected_revision integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_event record;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.id = p_event_id
      AND private.lock_committee_permission(p_actor, 'events.publish', e.committee_id)
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
$function$;

CREATE OR REPLACE FUNCTION private.create_event(p_actor uuid, p_committee_id uuid, p_title text, p_description text, p_event_date timestamp with time zone, p_location text, p_capacity integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_event_id uuid;
BEGIN
  -- Lock the live grant before changing the committee's data. A concurrent
  -- revocation waits for this short transaction and blocks later operations.
  IF NOT private.lock_committee_permission(p_actor, 'events.create', p_committee_id) THEN
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
$function$;

CREATE OR REPLACE FUNCTION private.edit_event(p_actor uuid, p_event_id uuid, p_expected_revision integer, p_title text, p_description text, p_event_date timestamp with time zone, p_location text, p_capacity integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  IF NOT private.lock_committee_permission(p_actor, 'events.edit', v_event.committee_id) THEN
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
$function$;

CREATE OR REPLACE FUNCTION private.flag_review(p_actor uuid, p_event_id uuid, p_expected_revision integer, p_required boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_event record;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.id = p_event_id
      AND private.lock_committee_permission(p_actor, 'events.edit', e.committee_id)
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
$function$;

CREATE OR REPLACE FUNCTION private.hold_event_full(p_actor uuid, p_event_id uuid, p_expected_revision integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_event record;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.id = p_event_id
      AND private.lock_committee_permission(p_actor, 'events.publish', e.committee_id)
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
$function$;

CREATE OR REPLACE FUNCTION private.publish_event(p_actor uuid, p_event_id uuid, p_expected_revision integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_event record;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.id = p_event_id
      AND private.lock_committee_permission(p_actor, 'events.publish', e.committee_id)
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
$function$;

CREATE OR REPLACE FUNCTION private.restore_event(p_actor uuid, p_event_id uuid, p_expected_revision integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_event record;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.id = p_event_id
      AND private.lock_committee_permission(p_actor, 'events.publish', e.committee_id)
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
$function$;

CREATE OR REPLACE FUNCTION private.save_event_details(p_actor uuid, p_event uuid, p_committee uuid, p_revision integer, p_title text, p_description text, p_date timestamp with time zone, p_location text, p_capacity integer, p_cover text, p_phone boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_result jsonb; v_event public.events%ROWTYPE; v_id uuid;
  v_cover_changed boolean; v_phone_changed boolean;
BEGIN
  IF p_phone IS NULL OR (p_cover IS NOT NULL AND p_cover !~ '^event-covers/[0-9a-f-]{36}\.(jpg|png)$') THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR');
  END IF;
  IF p_event IS NULL THEN
    v_result := private.create_event(p_actor, p_committee, p_title, p_description, p_date, p_location, p_capacity);
    IF v_result->>'code' <> 'SUCCESS' THEN RETURN v_result; END IF;
    v_id := (v_result->>'eventId')::uuid;
    UPDATE public.events SET cover_image_key = p_cover, phone_required = p_phone WHERE id = v_id;
    v_cover_changed := p_cover IS NOT NULL;
    v_phone_changed := p_phone;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.events e WHERE e.id = p_event
        AND private.lock_committee_permission(p_actor, 'events.edit', e.committee_id)) THEN
      RETURN jsonb_build_object('code', 'NOT_FOUND');
    END IF;
    SELECT * INTO v_event FROM public.events WHERE id = p_event FOR UPDATE;
    v_result := private.edit_event(p_actor, p_event, p_revision, p_title, p_description, p_date, p_location, p_capacity);
    IF v_result->>'code' <> 'SUCCESS' THEN RETURN v_result; END IF;
    v_id := p_event;
    v_cover_changed := v_event.cover_image_key IS DISTINCT FROM p_cover;
    v_phone_changed := v_event.phone_required IS DISTINCT FROM p_phone;
    IF v_cover_changed OR v_phone_changed THEN
      UPDATE public.events SET cover_image_key = p_cover, phone_required = p_phone,
        revision = CASE WHEN revision = v_event.revision THEN revision + 1 ELSE revision END,
        flagged_by = CASE WHEN review_required THEN p_actor ELSE flagged_by END,
        approved_by = CASE WHEN review_required THEN NULL ELSE approved_by END,
        approved_at = CASE WHEN review_required THEN NULL ELSE approved_at END,
        approved_revision = CASE WHEN review_required THEN NULL ELSE approved_revision END
      WHERE id = v_id;
    END IF;
  END IF;
  IF v_cover_changed OR v_phone_changed THEN
    INSERT INTO private.uc02_audit (committee_id, event_id, actor_kind, actor_user_id, action, changes)
    SELECT committee_id, id, 'authenticated', p_actor, 'event.updated',
      jsonb_build_object('coverChanged', v_cover_changed, 'phoneRequiredChanged', v_phone_changed,
        'phoneRequired', p_phone)
    FROM public.events WHERE id = v_id;
  END IF;
  RETURN (SELECT jsonb_build_object('code', 'SUCCESS', 'eventId', id, 'revision', revision) FROM public.events WHERE id = v_id);
END $function$;

CREATE OR REPLACE FUNCTION private.list_event_attendance(p_actor uuid, p_event uuid, p_filter text, p_search text, p_offset integer, p_limit integer, p_export boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_committee uuid; v_rows jsonb; v_total integer; v_confirmed integer; v_attended integer; v_waitlisted integer;
BEGIN
  SELECT committee_id INTO v_committee FROM public.events WHERE id = p_event;
  IF NOT FOUND OR NOT private.lock_committee_permission(p_actor, 'registrations.view', v_committee) THEN
    RETURN jsonb_build_object('code', 'NOT_FOUND');
  END IF;
  PERFORM 1 FROM public.events WHERE id = p_event FOR SHARE;
  IF p_filter IS NULL OR p_filter NOT IN ('all', 'attended', 'absent', 'waitlisted')
     OR p_search IS NULL OR char_length(p_search) > 200
     OR p_offset IS NULL OR p_offset < 0 OR p_offset > 100000
     OR p_limit IS NULL OR p_limit < 1 OR p_limit > (CASE WHEN p_export THEN 10000 ELSE 101 END) THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR');
  END IF;
  SELECT count(*) FILTER (WHERE status = 'confirmed'), count(*) FILTER (WHERE status = 'confirmed' AND attended),
    count(*) FILTER (WHERE status = 'waitlisted')
  INTO v_confirmed, v_attended, v_waitlisted FROM public.registrations WHERE event_id = p_event;
  SELECT count(*) INTO v_total FROM public.registrations r
  WHERE r.event_id = p_event AND r.status IN ('confirmed', 'waitlisted')
    AND (p_filter = 'all' OR p_filter = 'waitlisted' AND r.status = 'waitlisted'
      OR p_filter = 'attended' AND r.status = 'confirmed' AND r.attended
      OR p_filter = 'absent' AND r.status = 'confirmed' AND NOT r.attended)
    AND (p_search = '' OR position(lower(p_search) IN lower(r.attendee_name || ' ' || r.attendee_email)) > 0);
  IF p_export AND v_total > 10000 THEN RETURN jsonb_build_object('code', 'EXPORT_LIMIT'); END IF;
  SELECT coalesce(jsonb_agg(x ORDER BY lower(x.name), x.email, x.id), '[]') INTO v_rows FROM (
    SELECT r.id, r.attendee_name AS name, r.attendee_email AS email, r.status, r.attended,
      r.checked_in_at AS "checkedInAt", r.registered_at AS "registeredAt", r.checkin_method AS method,
      r.member_id IS NOT NULL AS "hasAccount"
    FROM public.registrations r
    WHERE r.event_id = p_event AND r.status IN ('confirmed', 'waitlisted')
      AND (p_filter = 'all' OR p_filter = 'waitlisted' AND r.status = 'waitlisted'
        OR p_filter = 'attended' AND r.status = 'confirmed' AND r.attended
        OR p_filter = 'absent' AND r.status = 'confirmed' AND NOT r.attended)
      AND (p_search = '' OR position(lower(p_search) IN lower(r.attendee_name || ' ' || r.attendee_email)) > 0)
    ORDER BY lower(r.attendee_name), r.attendee_email, r.id OFFSET p_offset LIMIT p_limit
  ) x;
  IF p_export THEN
    INSERT INTO private.uc02_audit (committee_id, event_id, actor_kind, actor_user_id, action, changes)
    VALUES (v_committee, p_event, 'authenticated', p_actor, 'attendance.exported',
      jsonb_build_object('rowCount', v_total, 'filter', p_filter));
  END IF;
  RETURN jsonb_build_object('code', 'SUCCESS', 'rows', v_rows, 'total', v_total,
    'confirmed', v_confirmed, 'attended', v_attended, 'waitlisted', v_waitlisted);
END $function$;

CREATE OR REPLACE FUNCTION private.manage_event_checkin(p_actor uuid, p_event uuid, p_operation text, p_secret text, p_closes timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_event public.events%ROWTYPE; v_session private.event_checkin_sessions%ROWTYPE;
  v_now timestamptz := clock_timestamp(); v_open boolean; v_window bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.events e WHERE e.id = p_event
      AND private.lock_committee_permission(p_actor, 'registrations.manage', e.committee_id)) THEN
    RETURN jsonb_build_object('code', 'NOT_FOUND');
  END IF;
  SELECT * INTO v_event FROM public.events WHERE id = p_event FOR UPDATE;
  SELECT * INTO v_session FROM private.event_checkin_sessions WHERE event_id = p_event;
  v_open := coalesce(v_session.is_open AND v_session.closes_at > v_now, false);

  IF p_operation = 'read' THEN
    v_window := private.checkin_window(v_now);
    RETURN jsonb_build_object('code', 'SUCCESS', 'isOpen', v_open, 'closesAt', v_session.closes_at,
      'checkinCode', CASE WHEN v_open THEN private.checkin_code(v_session.code_secret, v_window) END,
      'refreshAt', CASE WHEN v_open THEN least(v_session.closes_at, to_timestamp((v_window + 1) * 60)) END,
      'codeMinutes', 3);
  END IF;
  IF p_operation IS NULL OR p_operation NOT IN ('open', 'rotate', 'close') THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR');
  END IF;
  IF p_operation <> 'close' AND (v_event.archived_at IS NOT NULL OR v_event.status NOT IN ('published', 'full')) THEN
    RETURN jsonb_build_object('code', 'INVALID_TRANSITION');
  END IF;
  IF p_operation = 'rotate' AND NOT v_open THEN RETURN jsonb_build_object('code', 'CHECKIN_CLOSED'); END IF;
  IF p_operation = 'rotate' THEN p_closes := v_session.closes_at; END IF;
  IF p_operation <> 'close' AND (p_secret IS NULL OR p_secret !~ '^[0-9a-f]{64}$' OR p_closes IS NULL
      OR p_closes <= v_now OR p_closes > v_now + interval '12 hours') THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR');
  END IF;

  INSERT INTO private.event_checkin_sessions (event_id, is_open, closes_at, code_secret)
  VALUES (p_event, p_operation <> 'close',
    CASE WHEN p_operation <> 'close' THEN p_closes END,
    -- Opening an open session only changes its closing time: codes on screen stay valid.
    CASE WHEN p_operation = 'close' THEN NULL
         WHEN p_operation = 'open' AND v_open THEN v_session.code_secret
         ELSE p_secret END)
  ON CONFLICT (event_id) DO UPDATE SET is_open = excluded.is_open, closes_at = excluded.closes_at,
    code_secret = excluded.code_secret;
  INSERT INTO private.uc02_audit (committee_id, event_id, actor_kind, actor_user_id, action, changes)
  VALUES (v_event.committee_id, p_event, 'authenticated', p_actor, 'attendance.session_changed',
    jsonb_build_object('operation', p_operation, 'closesAt', CASE WHEN p_operation <> 'close' THEN p_closes END));
  RETURN private.manage_event_checkin(p_actor, p_event, 'read', NULL, NULL);
END $function$;

CREATE OR REPLACE FUNCTION private.promote_waitlist(p_actor uuid, p_event_id uuid, p_registration_id uuid, p_contact_confirmed boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
      AND private.lock_committee_permission(p_actor, 'registrations.manage', e.committee_id)
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
$function$;

CREATE OR REPLACE FUNCTION private.record_manual_attendance(p_actor uuid, p_event uuid, p_registration uuid, p_attended boolean, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_event public.events%ROWTYPE; v_registration public.registrations%ROWTYPE; v_now timestamptz := clock_timestamp();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.events e WHERE e.id = p_event
      AND private.lock_committee_permission(p_actor, 'registrations.manage', e.committee_id)) THEN
    RETURN jsonb_build_object('code', 'NOT_FOUND');
  END IF;
  IF p_attended IS NULL OR p_reason IS NULL
     OR (p_attended AND p_reason NOT IN ('qr_unavailable', 'no_account', 'organizer_verified'))
     OR (NOT p_attended AND p_reason NOT IN ('recorded_in_error', 'not_present')) THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR');
  END IF;
  SELECT * INTO v_event FROM public.events WHERE id = p_event FOR UPDATE;
  IF v_event.archived_at IS NOT NULL OR v_event.status NOT IN ('published', 'full') THEN
    RETURN jsonb_build_object('code', 'INVALID_TRANSITION');
  END IF;
  SELECT * INTO v_registration FROM public.registrations
  WHERE id = p_registration AND event_id = p_event AND status IN ('confirmed', 'waitlisted') FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  IF v_registration.status <> 'confirmed' THEN RETURN jsonb_build_object('code', 'WAITLISTED'); END IF;
  IF v_registration.member_id = p_actor THEN RETURN jsonb_build_object('code', 'SELF_CHECKIN'); END IF;
  IF v_registration.attended = p_attended THEN
    RETURN jsonb_build_object('code', 'SUCCESS', 'attended', p_attended,
      'checkedInAt', v_registration.checked_in_at, 'unchanged', true);
  END IF;
  UPDATE public.registrations SET attended = p_attended,
    checked_in_at = CASE WHEN p_attended THEN v_now END,
    checkin_method = CASE WHEN p_attended THEN 'manual' END
  WHERE id = v_registration.id;
  INSERT INTO private.uc02_audit (committee_id, event_id, registration_id, actor_kind, actor_user_id, action, changes)
  VALUES (v_event.committee_id, p_event, v_registration.id, 'authenticated', p_actor,
    CASE WHEN p_attended THEN 'attendance.manual_confirmed' ELSE 'attendance.manual_reverted' END,
    jsonb_build_object('reason', p_reason, 'previousMethod', v_registration.checkin_method));
  RETURN jsonb_build_object('code', 'SUCCESS', 'attended', p_attended,
    'checkedInAt', CASE WHEN p_attended THEN v_now END, 'unchanged', false);
END $function$;

CREATE OR REPLACE FUNCTION private.count_admin_registrations(p_actor uuid, p_event_id uuid)
 RETURNS TABLE(confirmed_count integer, waitlisted_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.id = p_event_id
      AND private.can_in_committee(p_actor, 'registrations.view', e.committee_id)
  ) THEN RETURN; END IF;
  RETURN QUERY SELECT
    count(*) FILTER (WHERE r.status = 'confirmed')::integer,
    count(*) FILTER (WHERE r.status = 'waitlisted')::integer
  FROM public.registrations r WHERE r.event_id = p_event_id;
END;
$function$;

CREATE OR REPLACE FUNCTION private.list_admin_registrations(p_actor uuid, p_event_id uuid, p_status text DEFAULT 'confirmed'::text, p_cursor_registered_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 51)
 RETURNS TABLE(id uuid, attendee_name text, attendee_email text, status registration_status, registered_at timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT r.id, r.attendee_name, r.attendee_email, r.status, r.registered_at
  FROM public.registrations r
  JOIN public.events e ON e.id = r.event_id
  WHERE r.event_id = p_event_id
    AND p_status IN ('confirmed', 'waitlisted')
    AND r.status::text = p_status
    AND private.can_in_committee(p_actor, 'registrations.view', e.committee_id)
    AND (p_cursor_registered_at IS NULL OR p_cursor_id IS NULL OR (r.registered_at, r.id) > (p_cursor_registered_at, p_cursor_id))
  ORDER BY r.registered_at ASC, r.id ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 51), 1), 51);
$function$;

CREATE OR REPLACE FUNCTION private.export_admin_registrations(p_actor uuid, p_event_id uuid, p_status text)
 RETURNS TABLE(id uuid, attendee_name text, attendee_email text, status registration_status, registered_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    AND private.can_in_committee(p_actor, 'registrations.view', e.committee_id);
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
$function$;

CREATE OR REPLACE FUNCTION private.delete_event_permanently(p_actor uuid, p_event uuid, p_confirmation text, p_cover_bucket text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE e public.events%ROWTYPE; v jsonb;
BEGIN
  IF NOT private.lock_record_permission(p_actor, 'events.delete', (SELECT committee_id FROM public.events WHERE id = p_event)) THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
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
END $function$;

CREATE OR REPLACE FUNCTION private.preview_event_deletion(p_actor uuid, p_event uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT private.can_record_permission(p_actor, 'events.delete', (SELECT committee_id FROM public.events WHERE id = p_event)) THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  v := private.event_deletion_summary(p_event);
  IF v IS NULL THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  RETURN jsonb_build_object('code', 'SUCCESS', 'preview', v);
END $function$;

CREATE OR REPLACE FUNCTION private.list_admin_events(p_actor uuid, p_committee_id uuid DEFAULT NULL::uuid, p_status text DEFAULT 'all'::text, p_cursor_event_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 21)
 RETURNS TABLE(id uuid, title text, description text, event_date timestamp with time zone, location text, committee_id uuid, committee_name text, status event_status, capacity integer, revision integer, archived_at timestamp with time zone, review_required boolean, flagged_by uuid, approved_by uuid, confirmed_count integer, waitlisted_count integer)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    WHERE e.committee_id = ANY ((SELECT private.permission_committees(p_actor, 'events.view'))::uuid[])
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
$function$;

CREATE OR REPLACE FUNCTION private.count_admin_events(p_actor uuid, p_committee_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(total_count integer, draft_count integer, review_count integer, approved_count integer, published_count integer, full_count integer, past_count integer, archived_count integer)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH scoped AS (
    SELECT e.status, e.event_date, e.archived_at, e.review_required, e.approved_by
    FROM public.events e
    WHERE (p_committee_id IS NULL OR e.committee_id = p_committee_id)
      AND e.committee_id = ANY ((SELECT private.permission_committees(p_actor, 'events.view'))::uuid[])
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
$function$;

CREATE OR REPLACE FUNCTION private.project_write(p_actor uuid, p_project uuid, p_revision integer, p_operation text, p_content jsonb DEFAULT NULL::jsonb, p_feedback text DEFAULT NULL::text, p_attest boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE p private.projects%ROWTYPE; c uuid; item jsonb; next_status text; BEGIN
 IF p_operation IN ('create','save','submit') THEN
   IF NOT private.project_member(p_actor) THEN RETURN jsonb_build_object('code','MEMBER_REQUIRED'); END IF;
   -- A concurrent graduation cannot change eligibility partway through a write.
   PERFORM 1 FROM public.members WHERE id=p_actor AND status='member' FOR SHARE;
   IF NOT FOUND THEN RETURN jsonb_build_object('code','MEMBER_REQUIRED'); END IF;
 ELSIF p_operation IN ('start_review','approve','reject','request_changes','publish','unpublish') THEN
   IF NOT private.lock_permission(p_actor, CASE WHEN p_operation IN ('publish', 'unpublish') THEN 'projects.publish' ELSE 'projects.review' END) THEN RETURN jsonb_build_object('code','FORBIDDEN'); END IF;
 ELSE RETURN jsonb_build_object('code','VALIDATION_ERROR'); END IF;
 IF p_operation='create' THEN
   PERFORM pg_advisory_xact_lock(hashtextextended('project-owner:'||p_actor::text,0));
   IF (SELECT count(*) FROM private.projects WHERE member_id=p_actor AND status IN ('draft','submitted','under_review','changes_requested'))>=20 THEN RETURN jsonb_build_object('code','PROJECT_LIMIT'); END IF;
   IF NOT private.project_content_valid(p_content,false) OR jsonb_array_length(p_content->'mediaIds')<>0 THEN RETURN jsonb_build_object('code','VALIDATION_ERROR'); END IF;
   SELECT id INTO c FROM public.committees WHERE slug='society-affairs';
   IF c IS NULL THEN RETURN jsonb_build_object('code','UNAVAILABLE'); END IF;
   INSERT INTO private.projects(member_id,committee_id,content) VALUES(p_actor,c,p_content) RETURNING * INTO p;
   INSERT INTO private.project_history(project_id,actor_id,revision,action) VALUES(p.id,p_actor,p.revision,'created');
   RETURN jsonb_build_object('code','SUCCESS','id',p.id,'revision',p.revision);
 END IF;
 SELECT * INTO p FROM private.projects WHERE id=p_project FOR UPDATE;
 IF NOT FOUND OR p_operation IN ('save','submit') AND p.member_id<>p_actor THEN RETURN jsonb_build_object('code','NOT_FOUND'); END IF;
 IF p.revision IS DISTINCT FROM p_revision THEN RETURN jsonb_build_object('code','STALE_REVISION'); END IF;
 IF p_operation IN ('start_review','approve','reject','request_changes','publish') AND
   (p.member_id=p_actor OR EXISTS(SELECT 1 FROM jsonb_array_elements(p.content->'team') t WHERE lower(t->>'memberId')=p_actor::text))
 THEN RETURN jsonb_build_object('code','SELF_REVIEW'); END IF;
 IF p_operation='save' THEN
   IF p.status IN ('submitted','under_review') OR p.status='approved' AND p.published_revision IS DISTINCT FROM p.revision THEN RETURN jsonb_build_object('code','INVALID_TRANSITION'); END IF;
   IF NOT private.project_content_valid(p_content,false) THEN RETURN jsonb_build_object('code','VALIDATION_ERROR'); END IF;
   FOR item IN SELECT * FROM jsonb_array_elements(p_content->'mediaIds') LOOP
     IF NOT EXISTS(SELECT 1 FROM private.project_media WHERE project_id=p.id AND id::text=item#>>'{}') THEN RETURN jsonb_build_object('code','VALIDATION_ERROR'); END IF;
   END LOOP;
   UPDATE private.projects SET content=p_content,revision=revision+1,status='draft',approved_revision=NULL,updated_at=clock_timestamp() WHERE id=p.id;
   p.revision:=p.revision+1; next_status:='saved';
 ELSIF p_operation='submit' THEN
   IF p.status<>'draft' OR NOT private.project_content_valid(p.content,true) THEN RETURN jsonb_build_object('code','INVALID_TRANSITION'); END IF;
   UPDATE private.projects SET status='submitted',updated_at=clock_timestamp() WHERE id=p.id; next_status:='submitted';
 ELSIF p_operation='start_review' THEN
   IF p.status<>'submitted' THEN RETURN jsonb_build_object('code','INVALID_TRANSITION'); END IF;
   IF p.member_id=p_actor THEN RETURN jsonb_build_object('code','SELF_REVIEW'); END IF;
   UPDATE private.projects SET status='under_review',updated_at=clock_timestamp() WHERE id=p.id; next_status:='under_review';
 ELSIF p_operation IN ('approve','reject','request_changes') THEN
   IF p.status<>'under_review' THEN RETURN jsonb_build_object('code','INVALID_TRANSITION'); END IF;
   IF p_operation='approve' AND (p.member_id=p_actor OR NOT coalesce(p_attest,false) OR EXISTS(SELECT 1 FROM jsonb_array_elements(p.content->'team') t WHERE lower(t->>'memberId')=p_actor::text)) THEN RETURN jsonb_build_object('code','SELF_REVIEW'); END IF;
   IF p_feedback IS NOT NULL AND char_length(p_feedback)>2000 OR p_operation<>'approve' AND NOT coalesce(p_feedback ~ '[^[:space:]]',false) THEN RETURN jsonb_build_object('code','VALIDATION_ERROR'); END IF;
   next_status:=CASE p_operation WHEN 'approve' THEN 'approved' WHEN 'reject' THEN 'rejected' ELSE 'changes_requested' END;
   UPDATE private.projects SET status=next_status,approved_revision=CASE WHEN p_operation='approve' THEN p.revision END,updated_at=clock_timestamp() WHERE id=p.id;
 ELSIF p_operation='publish' THEN
   IF p.status<>'approved' OR p.approved_revision IS DISTINCT FROM p.revision THEN RETURN jsonb_build_object('code','INVALID_TRANSITION'); END IF;
   IF p.member_id=p_actor OR EXISTS(SELECT 1 FROM jsonb_array_elements(p.content->'team') t WHERE lower(t->>'memberId')=p_actor::text) THEN RETURN jsonb_build_object('code','SELF_REVIEW'); END IF;
   IF p.published_revision=p.revision THEN RETURN jsonb_build_object('code','SUCCESS','id',p.id,'revision',p.revision); END IF;
   UPDATE private.projects SET published_content=content,published_revision=revision,updated_at=clock_timestamp() WHERE id=p.id; next_status:='published';
 ELSIF p_operation='unpublish' THEN
   UPDATE private.projects SET published_content=NULL,published_revision=NULL,updated_at=clock_timestamp() WHERE id=p.id; next_status:='unpublished';
 END IF;
 INSERT INTO private.project_history(project_id,actor_id,revision,action,feedback) VALUES(p.id,p_actor,p.revision,next_status,p_feedback);
 RETURN jsonb_build_object('code','SUCCESS','id',p.id,'revision',p.revision);
END $function$;

CREATE OR REPLACE FUNCTION private.delete_project_permanently(p_actor uuid, p_project uuid, p_confirmation text, p_media_bucket text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE p private.projects%ROWTYPE; v jsonb; v_media integer;
BEGIN
  IF NOT private.lock_permission(p_actor, 'projects.delete') THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
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
END $function$;

CREATE OR REPLACE FUNCTION private.preview_project_deletion(p_actor uuid, p_project uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT private.has_permission(p_actor, 'projects.delete') THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  v := private.project_deletion_summary(p_project);
  IF v IS NULL THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  RETURN jsonb_build_object('code', 'SUCCESS', 'preview', v);
END $function$;

CREATE OR REPLACE FUNCTION private.delete_member_record(p_actor uuid, p_member uuid, p_confirmation text, p_photo_bucket text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE m public.members%ROWTYPE; v jsonb; v_counts jsonb;
BEGIN
  IF NOT private.lock_permission(p_actor, 'members.delete') THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  PERFORM private.recovery_guard_begin();
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
  PERFORM private.recovery_guard_end();
  RETURN jsonb_build_object('code', 'SUCCESS') || v_counts;
END $function$;

CREATE OR REPLACE FUNCTION private.preview_member_deletion(p_actor uuid, p_user uuid, p_mode text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_level text; v jsonb;
BEGIN
  IF NOT private.has_permission(p_actor, CASE WHEN p_mode = 'account' THEN 'accounts.erase' ELSE 'members.delete' END) THEN
    RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  IF p_mode IS NULL OR p_mode NOT IN ('membership', 'account') THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR'); END IF;
  IF p_actor = p_user THEN RETURN jsonb_build_object('code', 'SELF_CHANGE'); END IF;
  v := private.member_deletion_summary(p_user, p_mode);
  IF v IS NULL THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  RETURN jsonb_build_object('code', 'SUCCESS', 'preview', v);
END $function$;

CREATE OR REPLACE FUNCTION private.admin_list_members(p_actor uuid, p_search text, p_filter text, p_offset integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_search text := nullif(btrim(coalesce(p_search, '')), ''); v_pattern text;
BEGIN
  IF NOT private.has_permission(p_actor, 'members.view') THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
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
END $function$;

CREATE OR REPLACE FUNCTION private.admin_get_member(p_actor uuid, p_member uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE m public.members%ROWTYPE;
BEGIN
  IF NOT private.has_permission(p_actor, 'members.view') THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
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
        'team', CASE WHEN t.id IS NULL THEN NULL ELSE private.team_json(t) END,
        'position', private.position_json(a.position_id), 'appointedAt', a.appointed_at)
        ORDER BY a.appointed_at), '[]'::jsonb)
      FROM private.leadership_appointments a LEFT JOIN private.committee_teams t ON t.id = a.team_id
      JOIN public.committees c ON c.id = coalesce(a.committee_id, t.committee_id)
      WHERE a.member_id = m.id AND a.ended_at IS NULL));
END $function$;

CREATE OR REPLACE FUNCTION private.assign_leadership(p_actor uuid, p_member uuid, p_committee uuid, p_team uuid, p_position text, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE t private.committee_teams%ROWTYPE; v_note text := nullif(btrim(coalesce(p_note, '')), ''); v_result jsonb;
BEGIN
  IF NOT private.note_text_valid(v_note, 1000) THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'note'); END IF;
  IF NOT private.lock_committee_permission(p_actor, 'leadership.assign', p_committee, true) THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  IF p_member = p_actor THEN RETURN jsonb_build_object('code', 'SELF_REVIEW'); END IF;
  IF p_committee IS NULL THEN RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'committee'); END IF;
  PERFORM private.lock_organization(true);
  IF NOT EXISTS (SELECT 1 FROM public.committees WHERE id = p_committee AND slug IS NOT NULL) THEN
    RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  IF EXISTS (SELECT 1 FROM public.committees WHERE id = p_committee AND archived_at IS NOT NULL) THEN
    RETURN jsonb_build_object('code', 'COMMITTEE_ARCHIVED'); END IF;
  IF p_team IS NOT NULL THEN
    SELECT * INTO t FROM private.committee_teams WHERE id = p_team FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
    IF t.committee_id <> p_committee THEN RETURN jsonb_build_object('code', 'HIERARCHY_MISMATCH'); END IF;
    IF t.status <> 'active' THEN RETURN jsonb_build_object('code', 'TEAM_INACTIVE'); END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM private.organizational_positions WHERE id = p_position AND active) THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'position'); END IF;
  PERFORM 1 FROM public.members WHERE id = p_member FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'MEMBER_NOT_FOUND'); END IF;
  IF EXISTS (SELECT 1 FROM private.leadership_requests WHERE member_id = p_member AND status = 'pending'
      AND (CASE WHEN p_team IS NULL THEN committee_id = p_committee AND team_id IS NULL ELSE team_id = p_team END)) THEN
    RETURN jsonb_build_object('code', 'PENDING_REQUEST'); END IF;
  v_result := private.leadership_appoint_scoped(p_member, p_committee, p_team, p_position, p_actor, 'direct', v_note);
  IF v_result->>'code' <> 'SUCCESS' THEN RETURN v_result; END IF;
  INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
  VALUES (p_committee, 'authenticated', p_actor, 'appointment.created', jsonb_build_object(
    'appointmentId', v_result->>'appointmentId', 'memberId', p_member, 'teamId', p_team,
    'position', p_position, 'source', 'direct', 'hasNote', v_note IS NOT NULL,
    'level', CASE WHEN p_team IS NULL THEN 'committee' ELSE 'team' END));
  RETURN v_result;
END $function$;

CREATE OR REPLACE FUNCTION private.assign_leadership(p_actor uuid, p_member uuid, p_team uuid, p_position text, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_committee uuid;
BEGIN
  SELECT committee_id INTO v_committee FROM private.committee_teams WHERE id = p_team;
  IF NOT FOUND THEN
    IF NOT private.can_record_permission(p_actor, 'leadership.assign', (SELECT committee_id FROM private.committee_teams WHERE id = p_team)) THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
    RETURN jsonb_build_object('code', 'NOT_FOUND');
  END IF;
  RETURN private.assign_leadership(p_actor, p_member, v_committee, p_team, p_position, p_note);
END $function$;

CREATE OR REPLACE FUNCTION private.decide_leadership_request(p_actor uuid, p_request uuid, p_revision integer, p_decision text, p_reason text, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_kind text; r private.leadership_requests%ROWTYPE; t private.committee_teams%ROWTYPE;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), ''); v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_result jsonb;
BEGIN
  IF p_request IS NULL OR p_revision IS NULL OR p_decision IS NULL OR p_decision NOT IN ('approve', 'reject')
     OR NOT private.note_text_valid(v_note, 1000) THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'note'); END IF;
  IF p_decision = 'reject' AND (v_reason IS NULL OR NOT private.note_text_valid(v_reason, 500)) THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'rejectionReason'); END IF;
  v_kind := CASE WHEN private.lock_record_permission(p_actor, 'leadership.review', (SELECT committee_id FROM private.leadership_requests WHERE id = p_request), true) THEN 'reviewer' END;
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
  IF r.team_id IS NOT NULL THEN
    SELECT * INTO t FROM private.committee_teams WHERE id = r.team_id FOR UPDATE;
    IF t.committee_id <> r.committee_id OR t.status <> 'active' THEN
      RETURN jsonb_build_object('code', 'STALE_STRUCTURE'); END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.committees WHERE id = r.committee_id AND (archived_at IS NOT NULL OR slug IS NULL))
     OR NOT EXISTS (SELECT 1 FROM private.organizational_positions WHERE id = r.position_id AND active) THEN
    RETURN jsonb_build_object('code', 'STALE_STRUCTURE'); END IF;
  v_result := private.leadership_appoint_scoped(r.member_id, r.committee_id, r.team_id, r.position_id, p_actor,
    'request', v_note);
  IF v_result->>'code' <> 'SUCCESS' THEN RETURN v_result; END IF;
  UPDATE private.leadership_requests SET status = 'approved', decided_by = p_actor, decided_at = clock_timestamp(),
    reviewer_note = v_note, appointment_id = (v_result->>'appointmentId')::uuid, revision = revision + 1
  WHERE id = r.id;
  INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
  VALUES (r.committee_id, 'authenticated', p_actor, 'leadership.approved', jsonb_build_object('requestId', r.id,
    'memberId', r.member_id, 'appointmentId', v_result->>'appointmentId', 'teamId', r.team_id,
    'position', r.position_id, 'reviewer', v_kind, 'hasNote', v_note IS NOT NULL,
    'level', CASE WHEN r.team_id IS NULL THEN 'committee' ELSE 'team' END));
  RETURN jsonb_build_object('code', 'SUCCESS', 'status', 'approved', 'revision', r.revision + 1,
    'appointmentId', v_result->>'appointmentId');
END $function$;

CREATE OR REPLACE FUNCTION private.get_leadership_request(p_actor uuid, p_request uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_kind text := CASE WHEN private.can_record_permission(p_actor, 'leadership.view', (SELECT committee_id FROM private.leadership_requests WHERE id = p_request)) THEN 'reviewer' END;
  r private.leadership_requests%ROWTYPE; t private.committee_teams%ROWTYPE; m public.members%ROWTYPE;
  a private.leadership_appointments%ROWTYPE; v_has boolean;
BEGIN
  IF v_kind IS NULL THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  SELECT * INTO r FROM private.leadership_requests WHERE id = p_request;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  IF r.team_id IS NOT NULL THEN SELECT * INTO t FROM private.committee_teams WHERE id = r.team_id; END IF;
  SELECT * INTO m FROM public.members WHERE id = r.member_id;
  SELECT * INTO a FROM private.leadership_appointments WHERE id = r.appointment_id;
  v_has := FOUND;
  RETURN jsonb_build_object('code', 'SUCCESS', 'reviewer', v_kind, 'canDecide', private.has_permission(p_actor, 'leadership.review', r.committee_id),
    'canAssign', private.has_permission(p_actor, 'leadership.assign', r.committee_id), 'own', r.member_id = p_actor,
    'level', CASE WHEN r.team_id IS NULL THEN 'committee' ELSE 'team' END,
    'request', jsonb_build_object('id', r.id, 'status', r.status, 'submittedAt', r.submitted_at,
      'decidedAt', r.decided_at, 'decidedByEmail', private.membership_actor_email(r.decided_by),
      'rejectionReason', r.rejection_reason, 'cancellationReason', r.cancellation_reason,
      'reviewerNote', r.reviewer_note, 'revision', r.revision,
      'committee', (SELECT jsonb_build_object('id', id, 'name', name, 'archived', archived_at IS NOT NULL)
        FROM public.committees WHERE id = r.committee_id),
      'position', private.position_json(r.position_id)),
    'team', CASE WHEN r.team_id IS NULL THEN NULL ELSE private.team_json(t) || jsonb_build_object('committee',
      (SELECT jsonb_build_object('id', id, 'name', name, 'archived', archived_at IS NOT NULL)
        FROM public.committees WHERE id = t.committee_id)) END,
    'stale', r.status = 'pending' AND (
      CASE WHEN r.team_id IS NULL
        THEN EXISTS (SELECT 1 FROM public.committees WHERE id = r.committee_id AND (archived_at IS NOT NULL OR slug IS NULL))
        ELSE t.committee_id <> r.committee_id OR t.status <> 'active'
          OR EXISTS (SELECT 1 FROM public.committees WHERE id = t.committee_id AND archived_at IS NOT NULL) END),
    'holders', (SELECT coalesce(jsonb_agg(jsonb_build_object('appointmentId', x.id, 'memberId', x.member_id,
        'name', xm.full_name) ORDER BY xm.full_name), '[]'::jsonb)
      FROM private.leadership_appointments x JOIN public.members xm ON xm.id = x.member_id
      WHERE x.position_id = r.position_id AND x.ended_at IS NULL
        AND (CASE WHEN r.team_id IS NULL THEN x.committee_id = r.committee_id ELSE x.team_id = r.team_id END)),
    'maxHolders', (SELECT CASE WHEN r.team_id IS NULL THEN max_holders_per_committee ELSE max_holders_per_team END FROM private.organizational_positions WHERE id = r.position_id),
    'appointment', CASE WHEN v_has THEN jsonb_build_object('id', a.id, 'active', a.ended_at IS NULL,
      'position', private.position_json(a.position_id), 'revision', a.revision, 'endedAt', a.ended_at,
      'endedByEmail', private.membership_actor_email(a.ended_by), 'endReason', a.end_reason,
      'endNote', a.end_note) END,
    'member', jsonb_build_object('id', m.id, 'name', m.full_name, 'email', m.email, 'memberSince', m.created_at)
      || private.membership_details_json(m.category, m.institution_id, m.institution_name),
    'memberAppointments', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', x.id,
        'committee', c.name, 'team', CASE WHEN xt.id IS NULL THEN NULL ELSE private.team_json(xt) END,
        'position', private.position_json(x.position_id)) ORDER BY x.appointed_at), '[]'::jsonb)
      FROM private.leadership_appointments x LEFT JOIN private.committee_teams xt ON xt.id = x.team_id
      JOIN public.committees c ON c.id = coalesce(x.committee_id, xt.committee_id)
      WHERE x.member_id = r.member_id AND x.ended_at IS NULL),
    'history', (SELECT coalesce(jsonb_agg(jsonb_build_object('occurredAt', h.occurred_at, 'action', h.action,
        'actorKind', h.actor_kind, 'actorEmail', private.membership_actor_email(h.actor_user_id),
        'changes', h.changes - 'memberId') ORDER BY h.occurred_at, h.id), '[]'::jsonb)
      FROM private.uc02_audit h
      WHERE (h.action LIKE 'leadership.%' AND h.changes ->> 'requestId' = r.id::text)
        OR (r.appointment_id IS NOT NULL AND h.action LIKE 'appointment.%'
          AND h.changes ->> 'appointmentId' = r.appointment_id::text)));
END $function$;

CREATE OR REPLACE FUNCTION private.revoke_leadership_appointment(p_actor uuid, p_appointment uuid, p_revision integer, p_reason text, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_kind text; a private.leadership_appointments%ROWTYPE; v_committee uuid;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), ''); v_note text := nullif(btrim(coalesce(p_note, '')), '');
BEGIN
  IF p_revision IS NULL OR v_reason IS NULL OR NOT private.note_text_valid(v_reason, 500) THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'reason'); END IF;
  IF NOT private.note_text_valid(v_note, 1000) THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'note'); END IF;
  v_kind := CASE WHEN private.lock_record_permission(p_actor, 'leadership.review', (SELECT coalesce(la.committee_id, lt.committee_id) FROM private.leadership_appointments la LEFT JOIN private.committee_teams lt ON lt.id = la.team_id WHERE la.id = p_appointment), true) THEN 'reviewer' END;
  IF v_kind IS NULL THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  PERFORM private.recovery_guard_begin();
  PERFORM private.lock_organization(true);
  SELECT * INTO a FROM private.leadership_appointments WHERE id = p_appointment FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  IF a.member_id = p_actor THEN RETURN jsonb_build_object('code', 'SELF_REVIEW'); END IF;
  IF a.revision <> p_revision THEN RETURN jsonb_build_object('code', 'STALE_REVISION'); END IF;
  IF a.ended_at IS NOT NULL THEN RETURN jsonb_build_object('code', 'INVALID_TRANSITION'); END IF;
  UPDATE private.leadership_appointments SET ended_at = clock_timestamp(), ended_by = p_actor,
    end_reason = v_reason, end_note = v_note, revision = revision + 1
  WHERE id = a.id;
  v_committee := coalesce(a.committee_id, (SELECT committee_id FROM private.committee_teams WHERE id = a.team_id));
  INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
  VALUES (v_committee, 'authenticated', p_actor, 'appointment.revoked', jsonb_build_object(
    'appointmentId', a.id, 'memberId', a.member_id, 'teamId', a.team_id, 'position', a.position_id,
    'reviewer', v_kind, 'hasNote', v_note IS NOT NULL));
  PERFORM private.recovery_guard_end();
  RETURN jsonb_build_object('code', 'SUCCESS', 'revision', a.revision + 1);
END $function$;

CREATE OR REPLACE FUNCTION private.update_leadership_appointment(p_actor uuid, p_appointment uuid, p_revision integer, p_position text, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE a private.leadership_appointments%ROWTYPE; t private.committee_teams%ROWTYPE; v_max integer;
  v_committee uuid; v_note text := nullif(btrim(coalesce(p_note, '')), '');
BEGIN
  IF p_revision IS NULL OR NOT private.note_text_valid(v_note, 1000) THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'note'); END IF;
  IF NOT private.lock_record_permission(p_actor, 'leadership.review', (SELECT coalesce(la.committee_id, lt.committee_id) FROM private.leadership_appointments la LEFT JOIN private.committee_teams lt ON lt.id = la.team_id WHERE la.id = p_appointment), true) THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  PERFORM private.lock_organization(true);
  SELECT * INTO a FROM private.leadership_appointments WHERE id = p_appointment FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  IF a.member_id = p_actor THEN RETURN jsonb_build_object('code', 'SELF_REVIEW'); END IF;
  IF a.revision <> p_revision THEN RETURN jsonb_build_object('code', 'STALE_REVISION'); END IF;
  IF a.ended_at IS NOT NULL THEN RETURN jsonb_build_object('code', 'INVALID_TRANSITION'); END IF;
  IF a.position_id = p_position THEN RETURN jsonb_build_object('code', 'UNCHANGED'); END IF;
  IF NOT EXISTS (SELECT 1 FROM private.organizational_positions WHERE id = p_position AND active) THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'position'); END IF;
  IF a.team_id IS NOT NULL THEN
    SELECT * INTO t FROM private.committee_teams WHERE id = a.team_id FOR UPDATE;
    IF t.status <> 'active' THEN RETURN jsonb_build_object('code', 'TEAM_INACTIVE'); END IF;
  END IF;
  v_committee := coalesce(a.committee_id, t.committee_id);
  SELECT CASE WHEN a.team_id IS NULL THEN max_holders_per_committee ELSE max_holders_per_team END INTO v_max
    FROM private.organizational_positions WHERE id = p_position;
  IF v_max IS NOT NULL AND (SELECT count(*) FROM private.leadership_appointments
      WHERE position_id = p_position AND ended_at IS NULL
        AND (CASE WHEN a.team_id IS NULL THEN committee_id = a.committee_id ELSE team_id = a.team_id END)) >= v_max THEN
    RETURN jsonb_build_object('code', 'POSITION_FULL'); END IF;
  UPDATE private.leadership_appointments SET position_id = p_position, updated_by = p_actor,
    updated_at = clock_timestamp(), revision = revision + 1
  WHERE id = a.id;
  INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
  VALUES (v_committee, 'authenticated', p_actor, 'appointment.updated', jsonb_build_object(
    'appointmentId', a.id, 'memberId', a.member_id, 'teamId', a.team_id, 'previousPosition', a.position_id,
    'position', p_position, 'hasNote', v_note IS NOT NULL, 'note', v_note));
  RETURN jsonb_build_object('code', 'SUCCESS', 'revision', a.revision + 1);
END $function$;

CREATE OR REPLACE FUNCTION private.list_leadership_requests(p_actor uuid, p_status text, p_committee uuid, p_team uuid, p_query text, p_from timestamp with time zone, p_to timestamp with time zone, p_offset integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    LEFT JOIN private.committee_teams t ON t.id = r.team_id
    JOIN public.committees c ON c.id = r.committee_id
    WHERE private.has_permission(p_actor, 'leadership.view', r.committee_id) AND (p_status = 'all' OR r.status = p_status)
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
        'level', CASE WHEN p.team_id IS NULL THEN 'committee' ELSE 'team' END,
        'committee', jsonb_build_object('id', p.committee_id, 'name', p.committee_name),
        'team', CASE WHEN p.team_id IS NULL THEN NULL ELSE jsonb_build_object('id', p.team_id,
          'name', jsonb_build_object('en', p.name_en, 'ar', p.name_ar), 'status', p.team_status) END,
        'position', private.position_json(p.position_id)) ORDER BY p.ord)
      FROM page p WHERE p.ord > p_offset AND p.ord <= p_offset + 25), '[]'::jsonb)));
END $function$;

CREATE OR REPLACE FUNCTION private.leadership_filter_options(p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF private.leadership_reviewer_kind(p_actor, false) IS NULL THEN
    RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  RETURN jsonb_build_object('code', 'SUCCESS', 'committees', (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'name', c.name, 'archived', c.archived_at IS NOT NULL,
      'teams', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name_en, 'status', t.status)
        ORDER BY t.name_en), '[]'::jsonb) FROM private.committee_teams t WHERE t.committee_id = c.id))
      ORDER BY c.name), '[]'::jsonb)
    FROM public.committees c WHERE c.slug IS NOT NULL AND private.has_permission(p_actor, 'leadership.view', c.id)));
END $function$;

CREATE OR REPLACE FUNCTION private.set_leadership_requests_open(p_actor uuid, p_open boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_was boolean;
BEGIN
  IF p_open IS NULL THEN RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'open'); END IF;
  IF NOT private.lock_permission(p_actor, 'settings.verification') THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  SELECT leadership_requests_open INTO v_was FROM private.verification_settings FOR UPDATE;
  IF v_was = p_open THEN RETURN jsonb_build_object('code', 'UNCHANGED'); END IF;
  UPDATE private.verification_settings SET leadership_requests_open = p_open, updated_by = p_actor,
    updated_at = clock_timestamp();
  INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
  VALUES (NULL, 'authenticated', p_actor,
    CASE WHEN p_open THEN 'leadership.requests_opened' ELSE 'leadership.requests_closed' END,
    jsonb_build_object('open', p_open));
  RETURN jsonb_build_object('code', 'SUCCESS', 'open', p_open);
END $function$;

CREATE OR REPLACE FUNCTION private.set_verification_settings(p_actor uuid, p_squ_per_30_days integer, p_retention_days integer, p_leadership_per_30_days integer, p_max_active_appointments integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  IF NOT private.lock_permission(p_actor, 'settings.verification') THEN
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
END $function$;

CREATE OR REPLACE FUNCTION private.set_position_limit(p_actor uuid, p_position text, p_max integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_previous integer;
BEGIN
  IF p_max IS NOT NULL AND p_max NOT BETWEEN 1 AND 50 THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'maxHolders'); END IF;
  IF NOT private.lock_permission(p_actor, 'settings.verification', NULL, true) THEN
    RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  PERFORM private.lock_organization(true);
  SELECT max_holders_per_team INTO v_previous FROM private.organizational_positions WHERE id = p_position FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  IF v_previous IS NOT DISTINCT FROM p_max THEN RETURN jsonb_build_object('code', 'UNCHANGED'); END IF;
  UPDATE private.organizational_positions SET max_holders_per_team = p_max WHERE id = p_position;
  INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
  VALUES (NULL, 'authenticated', p_actor, 'position.limit_changed', jsonb_build_object(
    'position', p_position, 'level', 'team', 'previous', v_previous, 'next', p_max));
  RETURN jsonb_build_object('code', 'SUCCESS');
END $function$;

CREATE OR REPLACE FUNCTION private.set_membership_approval_policy(p_actor uuid, p_policy text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_previous text; v_next text;
BEGIN
  IF p_policy IS NULL OR p_policy NOT IN ('two_step', 'single_step', 'unset') THEN
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
END;
$function$;

CREATE OR REPLACE FUNCTION private.admin_overview(p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_level text := CASE WHEN private.has_permission(p_actor, 'committees.view') THEN coalesce((SELECT access_level::text
    FROM public.administrative_access WHERE user_id = p_actor AND revoked_at IS NULL), 'PERMISSIONS') END;
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
END $function$;

CREATE OR REPLACE FUNCTION private.admin_list_committees(p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT private.can_view_any_committee(p_actor) THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
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
    ORDER BY c.archived_at IS NOT NULL, c.name) FROM public.committees c WHERE c.slug IS NOT NULL AND private.can_view_committee(p_actor, c.id)), '[]'::jsonb));
END $function$;

CREATE OR REPLACE FUNCTION private.admin_get_committee(p_actor uuid, p_committee uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE c public.committees%ROWTYPE;
BEGIN
  IF NOT private.can_view_committee(p_actor, p_committee) THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
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
END $function$;

CREATE OR REPLACE FUNCTION private.admin_list_committee_teams(p_actor uuid, p_committee uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT private.can_view_committee(p_actor, p_committee) THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.committees WHERE id = p_committee AND slug IS NOT NULL) THEN
    RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  RETURN jsonb_build_object('code', 'SUCCESS',
    'committeeLeaders', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'memberId', m.id,
        'name', m.full_name, 'email', m.email, 'position', private.position_json(a.position_id),
        'appointedAt', a.appointed_at, 'source', a.source, 'revision', a.revision) ORDER BY p.rank, m.full_name), '[]'::jsonb)
      FROM private.leadership_appointments a JOIN public.members m ON m.id = a.member_id
      JOIN private.organizational_positions p ON p.id = a.position_id
      WHERE a.committee_id = p_committee AND a.ended_at IS NULL),
    'committeePendingRequests', (SELECT count(*) FROM private.leadership_requests r
      WHERE r.committee_id = p_committee AND r.team_id IS NULL AND r.status = 'pending'),
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
        'label', jsonb_build_object('en', label_en, 'ar', label_ar), 'maxHolders', max_holders_per_team, 'maxHoldersPerCommittee', max_holders_per_committee,
        'requestable', requestable) ORDER BY rank), '[]'::jsonb)
      FROM private.organizational_positions WHERE active));
END $function$;

CREATE OR REPLACE FUNCTION private.admin_create_committee(p_actor uuid, p_name text, p_slug text, p_description text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_name text := btrim(coalesce(p_name, '')); v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_description text := nullif(btrim(coalesce(p_description, '')), ''); v_id uuid;
BEGIN
  IF NOT private.lock_permission(p_actor, 'committees.manage') THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
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
END $function$;

CREATE OR REPLACE FUNCTION private.admin_update_committee(p_actor uuid, p_committee uuid, p_name text, p_description text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_old public.committees%ROWTYPE; v_name text := btrim(coalesce(p_name, ''));
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
BEGIN
  IF NOT private.lock_permission(p_actor, 'committees.manage') THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
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
END $function$;

CREATE OR REPLACE FUNCTION private.admin_change_committee_member(p_actor uuid, p_committee uuid, p_member uuid, p_operation text, p_responsibility text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_committee public.committees%ROWTYPE; v_row private.committee_members%ROWTYPE;
  v_responsibility text := nullif(btrim(coalesce(p_responsibility, '')), '');
BEGIN
  IF p_operation IS NULL OR p_operation NOT IN ('add', 'update', 'remove') THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR'); END IF;
  IF v_responsibility IS NOT NULL AND (char_length(v_responsibility) > 120 OR v_responsibility ~ '[[:cntrl:]]') THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'responsibility'); END IF;
  IF NOT private.lock_permission(p_actor, 'committees.manage') THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
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
END $function$;

CREATE OR REPLACE FUNCTION private.admin_set_committee_archived(p_actor uuid, p_committee uuid, p_archived boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_old public.committees%ROWTYPE; v_managers integer; v_upcoming integer; v_appointments integer;
  v_team uuid; v_cancelled integer := 0;
BEGIN
  IF p_archived IS NULL THEN RETURN jsonb_build_object('code', 'VALIDATION_ERROR'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('technical-ownership', 0));
  IF NOT private.lock_permission(p_actor, 'committees.manage', NULL, true) THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
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
      LEFT JOIN private.committee_teams t ON t.id = a.team_id
      WHERE coalesce(a.committee_id, t.committee_id) = p_committee AND a.ended_at IS NULL;
    IF v_managers > 0 OR v_upcoming > 0 OR v_appointments > 0 THEN
      RETURN jsonb_build_object('code', 'BLOCKED', 'managers', v_managers, 'upcomingEvents', v_upcoming,
        'appointments', v_appointments); END IF;
    FOR v_team IN SELECT id FROM private.committee_teams WHERE committee_id = p_committee LOOP
      v_cancelled := v_cancelled + private.cancel_team_requests(v_team, 'committee_archived', p_actor);
    END LOOP;
    v_cancelled := v_cancelled + private.cancel_committee_requests(p_committee, 'committee_archived', p_actor);
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
END $function$;

CREATE OR REPLACE FUNCTION private.admin_create_team(p_actor uuid, p_committee uuid, p_name_en text, p_name_ar text, p_description_en text, p_description_ar text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_en text := btrim(coalesce(p_name_en, '')); v_ar text := nullif(btrim(coalesce(p_name_ar, '')), '');
  v_den text := nullif(btrim(coalesce(p_description_en, '')), ''); v_dar text := nullif(btrim(coalesce(p_description_ar, '')), '');
  v_field text; c public.committees%ROWTYPE; v_id uuid;
BEGIN
  IF NOT private.lock_committee_permission(p_actor, 'teams.manage', p_committee, true) THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
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
END $function$;

CREATE OR REPLACE FUNCTION private.admin_update_team(p_actor uuid, p_team uuid, p_name_en text, p_name_ar text, p_description_en text, p_description_ar text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_en text := btrim(coalesce(p_name_en, '')); v_ar text := nullif(btrim(coalesce(p_name_ar, '')), '');
  v_den text := nullif(btrim(coalesce(p_description_en, '')), ''); v_dar text := nullif(btrim(coalesce(p_description_ar, '')), '');
  v_field text; t private.committee_teams%ROWTYPE;
BEGIN
  IF NOT private.lock_record_permission(p_actor, 'teams.manage', (SELECT committee_id FROM private.committee_teams WHERE id = p_team), true) THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
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
END $function$;

CREATE OR REPLACE FUNCTION private.admin_delete_team(p_actor uuid, p_team uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE t private.committee_teams%ROWTYPE;
BEGIN
  IF NOT private.lock_record_permission(p_actor, 'teams.manage', (SELECT committee_id FROM private.committee_teams WHERE id = p_team), true) THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
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
END $function$;

CREATE OR REPLACE FUNCTION private.admin_set_team_status(p_actor uuid, p_team uuid, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE t private.committee_teams%ROWTYPE; v_appointments integer; v_cancelled integer := 0;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('active', 'inactive', 'archived') THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR'); END IF;
  IF NOT private.lock_record_permission(p_actor, 'teams.manage', (SELECT committee_id FROM private.committee_teams WHERE id = p_team), true) THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  PERFORM private.recovery_guard_begin();
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
  PERFORM private.recovery_guard_end();
  RETURN jsonb_build_object('code', 'SUCCESS', 'cancelledRequests', v_cancelled);
END $function$;

CREATE OR REPLACE FUNCTION private.admin_move_team(p_actor uuid, p_team uuid, p_committee uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE t private.committee_teams%ROWTYPE; c public.committees%ROWTYPE; v_cancelled integer;
BEGIN
  IF NOT (private.lock_record_permission(p_actor, 'teams.manage', (SELECT committee_id FROM private.committee_teams WHERE id = p_team), true)
      AND private.lock_record_permission(p_actor, 'teams.manage', p_committee, true)) THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
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
END $function$;

CREATE OR REPLACE FUNCTION private.list_access_audit(p_actor uuid)
 RETURNS TABLE(id uuid, occurred_at timestamp with time zone, actor_user_id uuid, target_user_id uuid, action text, committee_id uuid, previous_state jsonb, new_state jsonb, note text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    AND private.has_permission(p_actor, 'accounts.view')
  ORDER BY audit.occurred_at DESC, audit.id DESC LIMIT 100;
$function$;

CREATE OR REPLACE FUNCTION private.list_administrative_access(p_actor uuid)
 RETURNS TABLE(user_id uuid, email text, access_level text, committee_id uuid, committee_name text, active boolean, revocation_kind text, granted_at timestamp with time zone, revoked_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT a.user_id, u.email::text, a.access_level::text, a.committee_id,
    c.name, a.revoked_at IS NULL,
    CASE WHEN a.revoked_at IS NULL THEN NULL ELSE coalesce(a.revocation_kind, 'revoked') END,
    a.granted_at, a.revoked_at
  FROM public.administrative_access a
  JOIN private.access_auth_users u ON u.id = a.user_id
  LEFT JOIN public.committees c ON c.id = a.committee_id
  WHERE private.has_permission(p_actor, 'accounts.view')
  ORDER BY u.email NULLS LAST, a.user_id;
$function$;

CREATE OR REPLACE FUNCTION private.list_auth_directory(p_actor uuid)
 RETURNS TABLE(user_id uuid, email text, email_confirmed boolean, created_at timestamp with time zone, last_sign_in_at timestamp with time zone, invited boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT u.id, u.email::text, u.email_confirmed_at IS NOT NULL, u.created_at,
    u.last_sign_in_at, u.invited_at IS NOT NULL
  FROM private.access_auth_users u
  WHERE u.email IS NOT NULL AND private.has_permission(p_actor, 'accounts.view')
  ORDER BY u.email, u.id;
$function$;

CREATE OR REPLACE FUNCTION private.list_user_audit(p_actor uuid, p_target uuid)
 RETURNS TABLE(id uuid, occurred_at timestamp with time zone, actor_user_id uuid, action text, committee_id uuid, previous_state jsonb, new_state jsonb, note text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    AND private.has_permission(p_actor, 'accounts.view')
  ORDER BY audit.occurred_at DESC, audit.id DESC LIMIT 50;
$function$;

CREATE OR REPLACE FUNCTION private.list_auth_users_for_access(p_actor uuid)
 RETURNS TABLE(user_id uuid, email text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT u.id, u.email::text FROM private.access_auth_users u
  WHERE u.email IS NOT NULL AND private.has_permission(p_actor, 'accounts.manage')
  ORDER BY u.email, u.id;
$function$;

CREATE OR REPLACE FUNCTION private.change_administrative_access(p_actor uuid, p_user uuid, p_level administrative_access_level, p_committee uuid, p_operation text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  v_actor_level := private.account_admin_kind(p_actor);
  IF v_actor_level IS NULL OR (v_actor_level = 'limited' AND p_level IS DISTINCT FROM 'COMMITTEE_MANAGER') THEN
    RETURN jsonb_build_object('code', 'FORBIDDEN');
  END IF;
  PERFORM private.recovery_guard_begin();
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
  IF v_actor_level = 'limited' AND v_exists AND v_old.access_level <> 'COMMITTEE_MANAGER'
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
  PERFORM private.recovery_guard_end();
  RETURN jsonb_build_object('code', 'SUCCESS', 'action', v_action);
END;
$function$;

CREATE OR REPLACE FUNCTION private.set_access_suspension(p_actor uuid, p_user uuid, p_suspend boolean, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_old public.administrative_access%ROWTYPE; v_actor_level text;
  v_note text := NULLIF(btrim(p_note), ''); v_state jsonb;
BEGIN
  IF p_actor IS NULL OR p_user IS NULL OR p_suspend IS NULL
     OR (v_note IS NOT NULL AND char_length(v_note) > 200) THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR'); END IF;
  IF p_actor = p_user THEN RETURN jsonb_build_object('code', 'SELF_CHANGE'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('technical-ownership', 0));
  v_actor_level := private.account_admin_kind(p_actor);
  IF v_actor_level IS NULL THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  PERFORM private.recovery_guard_begin();
  PERFORM pg_advisory_xact_lock(hashtextextended('access:' || p_user, 0));
  SELECT * INTO v_old FROM public.administrative_access WHERE user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  IF v_actor_level = 'limited' AND v_old.access_level <> 'COMMITTEE_MANAGER' THEN
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
  PERFORM private.recovery_guard_end();
  RETURN jsonb_build_object('code', 'SUCCESS');
END $function$;

CREATE OR REPLACE FUNCTION private.replace_committee_manager(p_actor uuid, p_old_user uuid, p_new_user uuid, p_committee uuid, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  v_actor_level := private.account_admin_kind(p_actor);
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
  IF v_actor_level = 'limited' AND v_new_exists AND v_new.revoked_at IS NOT NULL
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
$function$;

CREATE OR REPLACE FUNCTION private.change_technical_access(p_actor uuid, p_user uuid, p_operation text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_old public.administrative_access%ROWTYPE;
  v_previous jsonb; v_next jsonb; v_exists boolean;
  v_note text := NULLIF(btrim(p_note), '');
BEGIN
  IF p_actor IS NULL OR p_user IS NULL OR p_operation NOT IN ('grant','revoke')
    OR p_operation IS NULL OR (v_note IS NOT NULL AND char_length(v_note) > 200) THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('technical-ownership', 0));
  PERFORM 1 WHERE private.lock_permission(p_actor, 'accounts.admin_levels');
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
$function$;

CREATE OR REPLACE FUNCTION private.record_auth_admin_action(p_actor uuid, p_target uuid, p_action text, p_detail text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_detail text := NULLIF(btrim(p_detail), ''); v_level text;
BEGIN
  IF p_actor IS NULL OR p_target IS NULL
    OR p_action NOT IN ('user.created','user.invited','user.invitation_resent',
      'user.password_reset_sent','user.password_admin_reset')
    OR (v_detail IS NOT NULL AND (char_length(v_detail) > 60
      OR v_detail !~ '^[a-z0-9_ .-]+$')) THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR');
  END IF;
  IF NOT private.lock_permission(p_actor, CASE WHEN p_action IN ('user.invited', 'user.invitation_resent')
      THEN 'accounts.manage' ELSE 'accounts.credentials' END) THEN
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
$function$;

CREATE OR REPLACE FUNCTION private.erase_account(p_actor uuid, p_user uuid, p_confirmation text, p_photo_bucket text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_email text; v jsonb; v_counts jsonb; v_photo text; v_erasure uuid; v_new boolean;
  v_actor_rows integer; v_subject_rows integer; v_keys text[] := private.audit_identity_keys();
BEGIN
  IF p_actor IS NULL OR p_user IS NULL THEN RETURN jsonb_build_object('code', 'VALIDATION_ERROR'); END IF;
  IF p_actor = p_user THEN RETURN jsonb_build_object('code', 'SELF_CHANGE'); END IF;
  -- Ordered with every access change (ADR 0014), then the target's own lock.
  PERFORM pg_advisory_xact_lock(hashtextextended('technical-ownership', 0));
  IF NOT private.lock_permission(p_actor, 'accounts.erase') THEN
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
END $function$;

CREATE OR REPLACE FUNCTION private.complete_account_erasure(p_actor uuid, p_erasure uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v private.account_erasures%ROWTYPE;
BEGIN
  IF NOT private.lock_permission(p_actor, 'accounts.erase') THEN
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
END $function$;

CREATE OR REPLACE FUNCTION private.list_account_erasures(p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT private.has_permission(p_actor, 'accounts.erase') THEN
    RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  RETURN jsonb_build_object('code', 'SUCCESS', 'erasures', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id', e.id, 'userId', e.user_id, 'requestedAt', e.requested_at, 'attempts', e.attempts,
      'email', (SELECT email FROM private.access_auth_users WHERE id = e.user_id)) ORDER BY e.requested_at)
    FROM private.account_erasures e), '[]'::jsonb));
END $function$;

CREATE OR REPLACE FUNCTION private.get_own_leadership(p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_profile jsonb; s private.verification_settings%ROWTYPE;
BEGIN
  v_profile := private.get_member_profile(p_actor);
  IF v_profile->>'code' <> 'SUCCESS' THEN RETURN jsonb_build_object('code', v_profile->>'code'); END IF;
  SELECT * INTO s FROM private.verification_settings;
  RETURN jsonb_build_object('code', 'SUCCESS',
    'requestsOpen', s.leadership_requests_open,
    'appointments', (SELECT coalesce(jsonb_agg(x.j ORDER BY x.active DESC, x.appointed DESC), '[]'::jsonb) FROM (
      SELECT a.ended_at IS NULL AS active, a.appointed_at AS appointed,
        jsonb_build_object('id', a.id, 'active', a.ended_at IS NULL, 'appointedAt', a.appointed_at,
          'endedAt', a.ended_at, 'endReason', a.end_reason, 'position', private.position_json(a.position_id),
          'grantsAccess', a.ended_at IS NULL AND EXISTS (SELECT 1 FROM private.actor_permission_grants(p_actor) x
            WHERE x.source = 'appointment' AND x.source_committee = coalesce(a.committee_id, t.committee_id)
              AND x.source_team IS NOT DISTINCT FROM a.team_id))
        || private.leadership_scope_json(coalesce(a.committee_id, t.committee_id), t) AS j
      FROM private.leadership_appointments a LEFT JOIN private.committee_teams t ON t.id = a.team_id
      WHERE a.member_id = p_actor AND (a.ended_at IS NULL OR a.ended_at > clock_timestamp() - interval '180 days')
      ORDER BY a.ended_at IS NULL DESC, a.appointed_at DESC LIMIT 20) x),
    'requests', (SELECT coalesce(jsonb_agg(x.j ORDER BY x.submitted DESC), '[]'::jsonb) FROM (
      SELECT r.submitted_at AS submitted,
        jsonb_build_object('id', r.id, 'status', r.status, 'submittedAt', r.submitted_at, 'decidedAt', r.decided_at,
          'rejectionReason', r.rejection_reason, 'cancellationReason', r.cancellation_reason,
          'position', private.position_json(r.position_id))
        || private.leadership_scope_json(r.committee_id, t) AS j
      FROM private.leadership_requests r LEFT JOIN private.committee_teams t ON t.id = r.team_id
      WHERE r.member_id = p_actor ORDER BY r.submitted_at DESC LIMIT 20) x),
    'limits', jsonb_build_object(
      'requestsPer30Days', s.leadership_requests_per_30_days,
      'recentRequests', private.leadership_recent_requests(p_actor),
      'maxActiveAppointments', s.max_active_appointments_per_member,
      'activeAppointments', (SELECT count(*) FROM private.leadership_appointments
        WHERE member_id = p_actor AND ended_at IS NULL)),
    'dashboardAccess', EXISTS (SELECT 1 FROM private.actor_permission_grants(p_actor)));
END $function$;

-- =============================================================================================
-- Ownership and privileges: every new routine runs as uc02_routine_owner; app_runtime executes only
-- the entry points. Replaced routines keep their owner and grants.
-- =============================================================================================
DO $$ DECLARE v_fn regprocedure; BEGIN
  FOR v_fn IN SELECT oid::regprocedure FROM pg_proc WHERE pronamespace = 'private'::regnamespace
    AND proname IN ('actor_permission_grants', 'has_permission', 'has_any_permission', 'can_in_committee',
      'can_record_permission', 'lock_access_sources', 'lock_permission', 'lock_committee_permission',
      'lock_record_permission', 'can_view_committee', 'can_view_any_committee', 'account_admin_kind',
      'recovery_account_count', 'recovery_guard_begin', 'recovery_guard_end', 'permission_set_json',
      'group_permissions_json', 'is_full_access', 'permission_catalog_json', 'permission_committees', 'get_dashboard_access',
      'list_permission_groups', 'get_permission_group', 'set_group_permissions', 'preview_retention_impact',
      'set_verification_settings', 'set_position_limit') LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO uc02_routine_owner', v_fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, app_runtime, app_maintenance, service_role', v_fn);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION private.get_dashboard_access(uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.list_permission_groups(uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.get_permission_group(uuid, uuid, uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.set_group_permissions(uuid, uuid, uuid, jsonb, jsonb, boolean, text) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.preview_retention_impact(uuid, integer) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.set_verification_settings(uuid, integer, integer, integer, integer) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.set_verification_settings(uuid, integer, integer, integer, integer, boolean) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.set_position_limit(uuid, text, integer) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.set_position_limit(uuid, text, text, integer) TO app_runtime;

-- The migration proves its own boundary; any failure rolls the whole migration back.
DO $$
DECLARE v_bad text;
BEGIN
  IF private.core_schema_version() <> 35 THEN RAISE EXCEPTION '0035 self-check failed: version'; END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE oid IN ('private.permission_catalog'::regclass,
      'private.access_level_permissions'::regclass, 'private.group_permissions'::regclass)
      AND NOT (relrowsecurity AND relforcerowsecurity)) THEN
    RAISE EXCEPTION '0035 self-check failed: forced RLS'; END IF;
  -- No routine decides by personal level any more, except the level lookup itself and the mapping.
  SELECT string_agg(proname, ', ') INTO v_bad FROM pg_proc
    WHERE pronamespace = 'private'::regnamespace AND proname <> 'senior_admin_level'
      AND (prosrc LIKE '%senior_admin_level(%' OR prosrc ~ 'access_level IN \(''BOARD_ADMIN'''
        OR prosrc ~ 'v_slug = ''society-affairs''');
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION '0035 self-check failed: level checks remain in %', v_bad; END IF;
  -- The mapping reproduces the existing boundaries.
  IF EXISTS (SELECT 1 FROM private.access_level_permissions WHERE access_level = 'TECHNICAL'
      AND permission IN ('squ.view', 'squ.review', 'leadership.view', 'leadership.review', 'leadership.assign'))
     OR NOT EXISTS (SELECT 1 FROM private.access_level_permissions WHERE access_level = 'BOARD_ADMIN' AND permission = 'permissions.manage')
     OR EXISTS (SELECT 1 FROM private.access_level_permissions WHERE access_level = 'BOARD_ADMIN'
       AND permission IN ('accounts.admin_levels', 'accounts.credentials', 'accounts.erase', 'settings.membership_policy'))
     OR EXISTS (SELECT 1 FROM private.access_level_permissions WHERE access_level = 'COMMITTEE_MANAGER'
       AND (scope <> 'own' OR permission NOT LIKE 'events.%' AND permission NOT LIKE 'registrations.%')) THEN
    RAISE EXCEPTION '0035 self-check failed: level mapping'; END IF;
  IF EXISTS (SELECT 1 FROM public.committees WHERE slug = 'society-affairs')
     AND (SELECT count(*) FROM private.group_permissions g JOIN public.committees c ON c.id = g.committee_id
          WHERE c.slug = 'society-affairs') <> 11 THEN
    RAISE EXCEPTION '0035 self-check failed: Society Affairs configuration'; END IF;
  IF NOT has_function_privilege('app_runtime', 'private.get_dashboard_access(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('app_runtime', 'private.set_group_permissions(uuid,uuid,uuid,jsonb,jsonb,boolean,text)', 'EXECUTE')
     OR has_function_privilege('app_runtime', 'private.has_permission(uuid,text,uuid)', 'EXECUTE')
     OR has_function_privilege('app_runtime', 'private.actor_permission_grants(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'private.get_dashboard_access(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'private.lock_permission(uuid,text,uuid,boolean)', 'EXECUTE')
     OR has_table_privilege('app_runtime', 'private.group_permissions', 'SELECT') THEN
    RAISE EXCEPTION '0035 self-check failed: routine privileges'; END IF;
END $$;
