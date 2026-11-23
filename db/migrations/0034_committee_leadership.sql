-- 0034: committee-level leadership and the leadership request switch (ADR 0026).
--
-- Every leadership request and appointment belongs to a committee; a team is optional. A
-- committee-level appointment stores its committee and no team; a team-level one stores its team
-- (its committee is the team's, never copied). Requests already record the chosen committee, so
-- their team simply becomes optional. One active holder of each position per scope (the committee
-- itself, or one team) by default, still enforced under the organization lock; one active position
-- per member per scope by unique indexes that also work when the team is absent.
--
-- Additive: no row is deleted or rewritten. Existing team appointments and requests satisfy the new
-- constraints unchanged. Routines keep their signatures, so the previous Core keeps working.

CREATE OR REPLACE FUNCTION private.core_schema_version() RETURNS integer
LANGUAGE sql IMMUTABLE AS $$ SELECT 34 $$;

-- =============================================================================================
-- Tables
-- =============================================================================================

ALTER TABLE private.leadership_appointments
  ADD COLUMN committee_id uuid REFERENCES public.committees (id),
  ALTER COLUMN team_id DROP NOT NULL;
-- A committee-level appointment has a committee and no team; a team-level one a team and no
-- committee (it is read from the team, so a team move needs no rewrite).
ALTER TABLE private.leadership_appointments
  ADD CONSTRAINT leadership_appointments_scope CHECK ((team_id IS NULL) <> (committee_id IS NULL));
-- One active position per member at committee level (the team level has its own index from 0033).
CREATE UNIQUE INDEX leadership_appointments_one_per_committee
  ON private.leadership_appointments (member_id, committee_id) WHERE ended_at IS NULL AND committee_id IS NOT NULL;
CREATE INDEX leadership_appointments_committee_idx
  ON private.leadership_appointments (committee_id, position_id) WHERE ended_at IS NULL AND committee_id IS NOT NULL;

ALTER TABLE private.leadership_requests ALTER COLUMN team_id DROP NOT NULL;
-- One open committee-level request per member and committee (team requests keep 0033's index).
CREATE UNIQUE INDEX leadership_requests_one_pending_committee
  ON private.leadership_requests (member_id, committee_id) WHERE status = 'pending' AND team_id IS NULL;

-- Whether members may send new leadership requests. Open by default, as before this migration.
-- Closing it stops new requests only: appointments stay visible and pending requests can still be
-- decided.
ALTER TABLE private.verification_settings
  ADD COLUMN leadership_requests_open boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN private.organizational_positions.max_holders_per_team IS
  'Active holders allowed per scope: the committee itself (committee-level leadership) or one team.';

DO $$ DECLARE v_check text; BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_check FROM pg_constraint
    WHERE conrelid = 'private.uc02_audit'::regclass AND conname = 'uc02_audit_action_check';
  EXECUTE 'ALTER TABLE private.uc02_audit DROP CONSTRAINT uc02_audit_action_check';
  EXECUTE 'ALTER TABLE private.uc02_audit ADD CONSTRAINT uc02_audit_action_check CHECK (' ||
    substring(v_check from 8 for char_length(v_check) - 8) ||
    ' OR action IN (''leadership.requests_opened'',''leadership.requests_closed''))';
END $$;

-- =============================================================================================
-- Helpers (internal)
-- =============================================================================================

-- The member-facing scope of a request or appointment: its committee, its team or NULL, and the
-- level. p_team_row is the team (NULL for committee level).
CREATE FUNCTION private.leadership_scope_json(p_committee uuid, p_team_row private.committee_teams)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'committee', (SELECT jsonb_build_object('id', c.id, 'name', c.name, 'archived', c.archived_at IS NOT NULL)
      FROM public.committees c WHERE c.id = p_committee),
    'team', CASE WHEN p_team_row.id IS NULL THEN NULL ELSE private.team_json(p_team_row) END,
    'level', CASE WHEN p_team_row.id IS NULL THEN 'committee' ELSE 'team' END)
$$;

-- Writes an appointment in a scope (p_team, or the committee when p_team is NULL) when the scope,
-- position and member limits allow it. The caller holds the exclusive organization lock and has
-- checked that the structure is live.
CREATE FUNCTION private.leadership_appoint_scoped(p_member uuid, p_committee uuid, p_team uuid, p_position text,
  p_actor uuid, p_source text, p_note text) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_max integer; v_member_max integer; v_held integer; v_id uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM private.leadership_appointments WHERE member_id = p_member AND ended_at IS NULL
      AND (CASE WHEN p_team IS NULL THEN committee_id = p_committee ELSE team_id = p_team END)) THEN
    RETURN jsonb_build_object('code', 'ALREADY_APPOINTED'); END IF;
  SELECT max_holders_per_team INTO v_max FROM private.organizational_positions WHERE id = p_position;
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

-- 0033's team-only helper, kept for any caller of the old shape.
CREATE OR REPLACE FUNCTION private.leadership_appoint(p_member uuid, p_team uuid, p_position text, p_actor uuid,
  p_source text, p_note text) RETURNS jsonb
LANGUAGE sql SET search_path = public, pg_temp AS $$
  SELECT private.leadership_appoint_scoped(p_member, NULL, p_team, p_position, p_actor, p_source, p_note)
$$;

-- Closes a committee's pending committee-level requests when the committee is archived.
CREATE FUNCTION private.cancel_committee_requests(p_committee uuid, p_reason text, p_actor uuid) RETURNS integer
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE r record; v_count integer := 0;
BEGIN
  FOR r IN SELECT id, member_id FROM private.leadership_requests
      WHERE committee_id = p_committee AND team_id IS NULL AND status = 'pending' FOR UPDATE LOOP
    UPDATE private.leadership_requests SET status = 'cancelled', cancellation_reason = p_reason,
      decided_at = clock_timestamp(), decided_by = p_actor, revision = revision + 1
    WHERE id = r.id;
    INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
    VALUES (p_committee, 'authenticated', p_actor, 'leadership.cancelled', jsonb_build_object(
      'requestId', r.id, 'memberId', r.member_id, 'teamId', NULL, 'reason', p_reason));
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $$;

-- =============================================================================================
-- The member's side
-- =============================================================================================

CREATE OR REPLACE FUNCTION private.get_own_leadership(p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
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
          'endedAt', a.ended_at, 'endReason', a.end_reason, 'position', private.position_json(a.position_id))
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
    'dashboardAccess', EXISTS (SELECT 1 FROM public.administrative_access
      WHERE user_id = p_actor AND revoked_at IS NULL));
END $$;

-- What a member may request: every active committee (with its active teams, possibly none) and the
-- requestable positions, and whether requests are open.
CREATE OR REPLACE FUNCTION private.get_leadership_options(p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_profile jsonb;
BEGIN
  v_profile := private.get_member_profile(p_actor);
  IF v_profile->>'code' <> 'SUCCESS' THEN RETURN jsonb_build_object('code', v_profile->>'code'); END IF;
  RETURN jsonb_build_object('code', 'SUCCESS',
    'requestsOpen', (SELECT leadership_requests_open FROM private.verification_settings),
    'committees', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name,
        'teams', (SELECT coalesce(jsonb_agg(private.team_json(t) ORDER BY t.name_en), '[]'::jsonb)
          FROM private.committee_teams t WHERE t.committee_id = c.id AND t.status = 'active'))
        ORDER BY c.name), '[]'::jsonb)
      FROM public.committees c WHERE c.slug IS NOT NULL AND c.archived_at IS NULL),
    'positions', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', id,
        'label', jsonb_build_object('en', label_en, 'ar', label_ar)) ORDER BY rank), '[]'::jsonb)
      FROM private.organizational_positions WHERE active AND requestable));
END $$;

-- A request for committee-level leadership (p_team NULL) or team leadership. The database checks
-- again that the committee is active, that the team (if any) belongs to it and is active, the
-- position, the member's pending requests and limits, and that requests are open.
CREATE OR REPLACE FUNCTION private.request_leadership(p_actor uuid, p_committee uuid, p_team uuid, p_position text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_profile jsonb; c public.committees%ROWTYPE; t private.committee_teams%ROWTYPE;
  v_limit integer; v_id uuid;
BEGIN
  v_profile := private.get_member_profile(p_actor);
  IF v_profile->>'code' <> 'SUCCESS' THEN RETURN jsonb_build_object('code', v_profile->>'code'); END IF;
  IF p_committee IS NULL THEN RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'committee'); END IF;
  IF p_position IS NULL THEN RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'position'); END IF;
  IF NOT (SELECT leadership_requests_open FROM private.verification_settings) THEN
    RETURN jsonb_build_object('code', 'REQUESTS_CLOSED', 'field', 'leadership'); END IF;
  -- Shared: structure changes wait for this request, and this request sees a settled structure.
  PERFORM private.lock_organization(false);
  PERFORM pg_advisory_xact_lock(hashtextextended('leadership-member:' || p_actor, 0));
  SELECT * INTO c FROM public.committees WHERE id = p_committee AND slug IS NOT NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND', 'field', 'committee'); END IF;
  IF c.archived_at IS NOT NULL THEN RETURN jsonb_build_object('code', 'COMMITTEE_ARCHIVED', 'field', 'committee'); END IF;
  IF p_team IS NOT NULL THEN
    SELECT * INTO t FROM private.committee_teams WHERE id = p_team;
    IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND', 'field', 'team'); END IF;
    IF t.committee_id <> p_committee THEN RETURN jsonb_build_object('code', 'HIERARCHY_MISMATCH', 'field', 'team'); END IF;
    IF t.status <> 'active' THEN RETURN jsonb_build_object('code', 'TEAM_INACTIVE', 'field', 'team'); END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM private.organizational_positions WHERE id = p_position AND active AND requestable) THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'position'); END IF;
  IF EXISTS (SELECT 1 FROM private.leadership_appointments WHERE member_id = p_actor AND ended_at IS NULL
      AND (CASE WHEN p_team IS NULL THEN committee_id = p_committee ELSE team_id = p_team END)) THEN
    RETURN jsonb_build_object('code', 'ALREADY_APPOINTED'); END IF;
  IF EXISTS (SELECT 1 FROM private.leadership_requests WHERE member_id = p_actor AND status = 'pending'
      AND (CASE WHEN p_team IS NULL THEN committee_id = p_committee AND team_id IS NULL ELSE team_id = p_team END)) THEN
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
    'memberId', p_actor, 'teamId', p_team, 'position', p_position,
    'level', CASE WHEN p_team IS NULL THEN 'committee' ELSE 'team' END));
  RETURN private.get_own_leadership(p_actor) || jsonb_build_object('requestId', v_id);
END $$;

-- =============================================================================================
-- Reviewers
-- =============================================================================================

CREATE OR REPLACE FUNCTION private.list_leadership_requests(p_actor uuid, p_status text, p_committee uuid, p_team uuid,
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
    LEFT JOIN private.committee_teams t ON t.id = r.team_id
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
        'level', CASE WHEN p.team_id IS NULL THEN 'committee' ELSE 'team' END,
        'committee', jsonb_build_object('id', p.committee_id, 'name', p.committee_name),
        'team', CASE WHEN p.team_id IS NULL THEN NULL ELSE jsonb_build_object('id', p.team_id,
          'name', jsonb_build_object('en', p.name_en, 'ar', p.name_ar), 'status', p.team_status) END,
        'position', private.position_json(p.position_id)) ORDER BY p.ord)
      FROM page p WHERE p.ord > p_offset AND p.ord <= p_offset + 25), '[]'::jsonb)));
END $$;

-- Every committee with its teams (possibly none), for the reviewers' filters. Names only.
CREATE OR REPLACE FUNCTION private.leadership_filter_options(p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF private.leadership_reviewer_kind(p_actor, false) IS NULL THEN
    RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  RETURN jsonb_build_object('code', 'SUCCESS', 'committees', (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'name', c.name, 'archived', c.archived_at IS NOT NULL,
      'teams', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name_en, 'status', t.status)
        ORDER BY t.name_en), '[]'::jsonb) FROM private.committee_teams t WHERE t.committee_id = c.id))
      ORDER BY c.name), '[]'::jsonb)
    FROM public.committees c WHERE c.slug IS NOT NULL));
END $$;

CREATE OR REPLACE FUNCTION private.get_leadership_request(p_actor uuid, p_request uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_kind text := private.leadership_reviewer_kind(p_actor, false);
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
  RETURN jsonb_build_object('code', 'SUCCESS', 'reviewer', v_kind, 'own', r.member_id = p_actor,
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
    'maxHolders', (SELECT max_holders_per_team FROM private.organizational_positions WHERE id = r.position_id),
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
END $$;

-- Approval only against the structure the member chose, still live. Requests being closed to new
-- submissions does not stop decisions.
CREATE OR REPLACE FUNCTION private.decide_leadership_request(p_actor uuid, p_request uuid, p_revision integer,
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
END $$;

-- Direct appointment by a leadership reviewer, at committee level (p_team NULL) or in a team.
CREATE FUNCTION private.assign_leadership(p_actor uuid, p_member uuid, p_committee uuid, p_team uuid,
  p_position text, p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE t private.committee_teams%ROWTYPE; v_note text := nullif(btrim(coalesce(p_note, '')), ''); v_result jsonb;
BEGIN
  IF NOT private.note_text_valid(v_note, 1000) THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'note'); END IF;
  IF private.leadership_reviewer_kind(p_actor, true) IS NULL THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
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
END $$;

-- 0033's team-only signature, for the previous Core: the team's committee, then the above.
CREATE OR REPLACE FUNCTION private.assign_leadership(p_actor uuid, p_member uuid, p_team uuid, p_position text,
  p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_committee uuid;
BEGIN
  SELECT committee_id INTO v_committee FROM private.committee_teams WHERE id = p_team;
  IF NOT FOUND THEN
    IF private.leadership_reviewer_kind(p_actor, false) IS NULL THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
    RETURN jsonb_build_object('code', 'NOT_FOUND');
  END IF;
  RETURN private.assign_leadership(p_actor, p_member, v_committee, p_team, p_position, p_note);
END $$;

-- A leadership reviewer changes an active appointment's position, within its scope's limits.
CREATE OR REPLACE FUNCTION private.update_leadership_appointment(p_actor uuid, p_appointment uuid, p_revision integer,
  p_position text, p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a private.leadership_appointments%ROWTYPE; t private.committee_teams%ROWTYPE; v_max integer;
  v_committee uuid; v_note text := nullif(btrim(coalesce(p_note, '')), '');
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
  IF a.team_id IS NOT NULL THEN
    SELECT * INTO t FROM private.committee_teams WHERE id = a.team_id FOR UPDATE;
    IF t.status <> 'active' THEN RETURN jsonb_build_object('code', 'TEAM_INACTIVE'); END IF;
  END IF;
  v_committee := coalesce(a.committee_id, t.committee_id);
  SELECT max_holders_per_team INTO v_max FROM private.organizational_positions WHERE id = p_position;
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
END $$;

-- A leadership reviewer (Board Administration or Society Affairs) ends an appointment with a reason.
CREATE OR REPLACE FUNCTION private.revoke_leadership_appointment(p_actor uuid, p_appointment uuid, p_revision integer,
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
  v_committee := coalesce(a.committee_id, (SELECT committee_id FROM private.committee_teams WHERE id = a.team_id));
  INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
  VALUES (v_committee, 'authenticated', p_actor, 'appointment.revoked', jsonb_build_object(
    'appointmentId', a.id, 'memberId', a.member_id, 'teamId', a.team_id, 'position', a.position_id,
    'reviewer', v_kind, 'hasNote', v_note IS NOT NULL));
  RETURN jsonb_build_object('code', 'SUCCESS', 'revision', a.revision + 1);
END $$;

-- =============================================================================================
-- Committee management and settings
-- =============================================================================================

-- A committee's own leaders (committee level), its teams with their leaders, and the positions.
CREATE OR REPLACE FUNCTION private.admin_list_committee_teams(p_actor uuid, p_committee uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF private.senior_admin_level(p_actor) IS NULL THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
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
        'label', jsonb_build_object('en', label_en, 'ar', label_ar), 'maxHolders', max_holders_per_team,
        'requestable', requestable) ORDER BY rank), '[]'::jsonb)
      FROM private.organizational_positions WHERE active));
END $$;

-- Archiving a committee is refused while it, or any of its teams, has active appointments, and it
-- closes their pending requests. Everything else is 0033's routine.
CREATE OR REPLACE FUNCTION private.admin_set_committee_archived(p_actor uuid, p_committee uuid, p_archived boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_old public.committees%ROWTYPE; v_managers integer; v_upcoming integer; v_appointments integer;
  v_team uuid; v_cancelled integer := 0;
BEGIN
  IF p_archived IS NULL THEN RETURN jsonb_build_object('code', 'VALIDATION_ERROR'); END IF;
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
END $$;

CREATE OR REPLACE FUNCTION private.admin_activity_actions() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['committee.created', 'committee.updated', 'committee.archived', 'committee.restored',
    'committee.member_added', 'committee.member_updated', 'committee.member_removed',
    'manager.assigned', 'manager.reassigned', 'manager.revoked', 'board_admin.granted',
    'board_admin.revoked', 'technical.granted', 'technical.revoked', 'access.suspended',
    'access.reactivated', 'user.created', 'user.invited', 'event.deleted', 'project.deleted',
    'member.deleted', 'account.erasure_started', 'account.erased',
    'team.created', 'team.updated', 'team.moved', 'team.status_changed', 'team.deleted',
    'leadership.approved', 'appointment.created', 'appointment.updated', 'appointment.revoked',
    'leadership.requests_opened', 'leadership.requests_closed']
$$;

-- 0033's member view; its appointments include committee-level ones (team NULL).
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
        'team', CASE WHEN t.id IS NULL THEN NULL ELSE private.team_json(t) END,
        'position', private.position_json(a.position_id), 'appointedAt', a.appointed_at)
        ORDER BY a.appointed_at), '[]'::jsonb)
      FROM private.leadership_appointments a LEFT JOIN private.committee_teams t ON t.id = a.team_id
      JOIN public.committees c ON c.id = coalesce(a.committee_id, t.committee_id)
      WHERE a.member_id = m.id AND a.ended_at IS NULL));
END $$;

-- The settings, now including whether leadership requests are open.
CREATE OR REPLACE FUNCTION private.get_verification_settings(p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s private.verification_settings%ROWTYPE;
BEGIN
  IF private.membership_reviewer_kind(p_actor, false) IS NULL AND private.senior_admin_level(p_actor) IS NULL THEN
    RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  SELECT * INTO s FROM private.verification_settings;
  RETURN jsonb_build_object('code', 'SUCCESS',
    'leadershipRequestsOpen', s.leadership_requests_open,
    'squSubmissionsPer30Days', s.squ_submissions_per_30_days,
    'documentRetentionDays', s.document_retention_days,
    'leadershipRequestsPer30Days', s.leadership_requests_per_30_days,
    'maxActiveAppointmentsPerMember', s.max_active_appointments_per_member,
    'updatedAt', s.updated_at, 'updatedByEmail', private.membership_actor_email(s.updated_by),
    'positions', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', id,
        'label', jsonb_build_object('en', label_en, 'ar', label_ar), 'maxHolders', max_holders_per_team)
        ORDER BY rank), '[]'::jsonb) FROM private.organizational_positions WHERE active));
END $$;

-- Opens or closes new leadership requests: Board Administration or Technical (the senior
-- administrators who manage committee structure). Audited. Pending requests stay decidable.
CREATE FUNCTION private.set_leadership_requests_open(p_actor uuid, p_open boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_was boolean;
BEGIN
  IF p_open IS NULL THEN RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'open'); END IF;
  IF private.senior_admin_level(p_actor) IS NULL THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  SELECT leadership_requests_open INTO v_was FROM private.verification_settings FOR UPDATE;
  IF v_was = p_open THEN RETURN jsonb_build_object('code', 'UNCHANGED'); END IF;
  UPDATE private.verification_settings SET leadership_requests_open = p_open, updated_by = p_actor,
    updated_at = clock_timestamp();
  INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
  VALUES (NULL, 'authenticated', p_actor,
    CASE WHEN p_open THEN 'leadership.requests_opened' ELSE 'leadership.requests_closed' END,
    jsonb_build_object('open', p_open));
  RETURN jsonb_build_object('code', 'SUCCESS', 'open', p_open);
END $$;

-- =============================================================================================
-- Ownership and privileges
-- =============================================================================================
DO $$ DECLARE v_fn regprocedure; BEGIN
  FOR v_fn IN SELECT oid::regprocedure FROM pg_proc WHERE pronamespace = 'private'::regnamespace
    AND proname IN ('leadership_scope_json', 'leadership_appoint_scoped', 'cancel_committee_requests',
      'assign_leadership', 'set_leadership_requests_open') LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO uc02_routine_owner', v_fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, app_runtime, app_maintenance, service_role', v_fn);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION private.assign_leadership(uuid, uuid, uuid, uuid, text, text) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.assign_leadership(uuid, uuid, uuid, text, text) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.set_leadership_requests_open(uuid, boolean) TO app_runtime;

-- The migration proves its own boundary; any failure rolls the whole migration back.
DO $$
BEGIN
  IF private.core_schema_version() <> 34 THEN RAISE EXCEPTION '0034 self-check failed: version'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leadership_appointments_scope'
      AND conrelid = 'private.leadership_appointments'::regclass) THEN
    RAISE EXCEPTION '0034 self-check failed: appointment scope constraint'; END IF;
  IF to_regclass('private.leadership_appointments_one_per_committee') IS NULL
     OR to_regclass('private.leadership_requests_one_pending_committee') IS NULL THEN
    RAISE EXCEPTION '0034 self-check failed: committee-level unique indexes'; END IF;
  IF EXISTS (SELECT 1 FROM private.leadership_appointments WHERE (team_id IS NULL) = (committee_id IS NULL)) THEN
    RAISE EXCEPTION '0034 self-check failed: an appointment without exactly one scope'; END IF;
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class
      WHERE oid = 'private.leadership_appointments'::regclass) THEN
    RAISE EXCEPTION '0034 self-check failed: forced RLS'; END IF;
  IF NOT has_function_privilege('app_runtime', 'private.assign_leadership(uuid,uuid,uuid,uuid,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('app_runtime', 'private.set_leadership_requests_open(uuid,boolean)', 'EXECUTE')
     OR NOT has_function_privilege('app_runtime', 'private.request_leadership(uuid,uuid,uuid,text)', 'EXECUTE')
     OR has_function_privilege('app_runtime', 'private.leadership_appoint_scoped(uuid,uuid,uuid,text,uuid,text,text)', 'EXECUTE')
     OR has_function_privilege('app_runtime', 'private.cancel_committee_requests(uuid,text,uuid)', 'EXECUTE')
     OR has_function_privilege('app_runtime', 'private.leadership_scope_json(uuid,private.committee_teams)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'private.set_leadership_requests_open(uuid,boolean)', 'EXECUTE')
     OR has_table_privilege('app_runtime', 'private.leadership_appointments', 'SELECT') THEN
    RAISE EXCEPTION '0034 self-check failed: routine privileges'; END IF;
END $$;
