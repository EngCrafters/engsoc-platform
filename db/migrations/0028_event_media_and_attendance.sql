-- ADR 0020. Forward-only; apply only after approval and 0027. No hosted DML.
ALTER TABLE public.events
  ADD COLUMN cover_image_key text,
  ADD COLUMN phone_required boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT events_cover_key_check CHECK (cover_image_key IS NULL OR
    cover_image_key ~ '^event-covers/[0-9a-f-]{36}\.(jpg|png)$');
ALTER TABLE public.members ADD COLUMN phone text
  CHECK (phone IS NULL OR phone ~ '^\+[1-9][0-9]{6,14}$');
ALTER TABLE public.registrations ADD COLUMN attendee_phone text
  CHECK (attendee_phone IS NULL OR attendee_phone ~ '^\+[1-9][0-9]{6,14}$');
CREATE UNIQUE INDEX registrations_active_event_member_idx ON public.registrations(event_id,member_id)
  WHERE member_id IS NOT NULL AND status IN ('confirmed','waitlisted');
-- Members have no browser table grants. Only own-profile routines expose phone.
GRANT UPDATE (phone) ON public.members TO uc02_routine_owner;
CREATE POLICY routine_owner_update_member_phone ON public.members FOR UPDATE
  TO uc02_routine_owner USING (true) WITH CHECK (true);

CREATE TABLE private.event_checkin_sessions (
  event_id uuid PRIMARY KEY REFERENCES public.events(id),
  is_open boolean NOT NULL DEFAULT false,
  closes_at timestamptz,
  challenge_hash text,
  challenge_expires_at timestamptz,
  CHECK (NOT is_open OR (closes_at IS NOT NULL AND challenge_hash IS NOT NULL
    AND challenge_expires_at IS NOT NULL)),
  CHECK (challenge_hash IS NULL OR challenge_hash ~ '^[0-9a-f]{64}$')
);
ALTER TABLE private.event_checkin_sessions OWNER TO uc02_routine_owner;
ALTER TABLE private.event_checkin_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.event_checkin_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY routine_owner_sessions ON private.event_checkin_sessions
  TO uc02_routine_owner USING (true) WITH CHECK (true);
REVOKE ALL ON private.event_checkin_sessions FROM PUBLIC, anon, authenticated,
  app_runtime, app_maintenance, service_role;

-- Extend the audit vocabulary without discarding any prior allowed action.
DO $$ DECLARE v_check text; BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_check FROM pg_constraint
    WHERE conrelid = 'private.uc02_audit'::regclass AND conname = 'uc02_audit_action_check';
  EXECUTE 'ALTER TABLE private.uc02_audit DROP CONSTRAINT uc02_audit_action_check';
  EXECUTE 'ALTER TABLE private.uc02_audit ADD CONSTRAINT uc02_audit_action_check CHECK (' ||
    substring(v_check from 8 for char_length(v_check)-8) ||
    ' OR action IN (''attendance.session_changed'',''attendance.confirmed'',''attendance.exported'',''member.phone_updated'',''registration.member_linked''))';
END $$;

CREATE FUNCTION private.public_event_options(p_ids uuid[])
RETURNS TABLE (id uuid, cover_image_key text, phone_required boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT e.id, e.cover_image_key, e.phone_required FROM public.events e
  WHERE e.id = ANY(p_ids) AND cardinality(p_ids) <= 50
    AND e.archived_at IS NULL AND e.status IN ('published','full');
$$;

CREATE FUNCTION private.admin_event_options(p_actor uuid, p_event uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object('coverImageKey', e.cover_image_key, 'phoneRequired', e.phone_required)
  FROM public.events e WHERE e.id = p_event AND private.can_access_committee(p_actor, e.committee_id);
$$;

-- One atomic save, delegating existing lifecycle/capacity/review checks.
CREATE FUNCTION private.save_event_details(
  p_actor uuid, p_event uuid, p_committee uuid, p_revision integer,
  p_title text, p_description text, p_date timestamptz, p_location text,
  p_capacity integer, p_cover text, p_phone boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_result jsonb; v_event public.events%ROWTYPE; v_id uuid; v_changed boolean;
BEGIN
  IF p_phone IS NULL OR (p_cover IS NOT NULL AND p_cover !~ '^event-covers/[0-9a-f-]{36}\.(jpg|png)$') THEN
    RETURN jsonb_build_object('code','VALIDATION_ERROR');
  END IF;
  IF p_event IS NULL THEN
    v_result := private.create_event(p_actor,p_committee,p_title,p_description,p_date,p_location,p_capacity);
    IF v_result->>'code' <> 'SUCCESS' THEN RETURN v_result; END IF;
    v_id := (v_result->>'eventId')::uuid;
    UPDATE public.events SET cover_image_key=p_cover, phone_required=p_phone WHERE id=v_id;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.events e WHERE e.id=p_event
      AND private.lock_committee_access(p_actor,e.committee_id)) THEN
      RETURN jsonb_build_object('code','NOT_FOUND');
    END IF;
    SELECT * INTO v_event FROM public.events WHERE id=p_event FOR UPDATE;
    v_result := private.edit_event(p_actor,p_event,p_revision,p_title,p_description,p_date,p_location,p_capacity);
    IF v_result->>'code' <> 'SUCCESS' THEN RETURN v_result; END IF;
    v_id := p_event;
    v_changed := v_event.cover_image_key IS DISTINCT FROM p_cover OR v_event.phone_required IS DISTINCT FROM p_phone;
    IF v_changed THEN
      UPDATE public.events SET cover_image_key=p_cover, phone_required=p_phone,
        revision=CASE WHEN revision=v_event.revision THEN revision+1 ELSE revision END,
        flagged_by=CASE WHEN review_required THEN p_actor ELSE flagged_by END,
        approved_by=CASE WHEN review_required THEN NULL ELSE approved_by END,
        approved_at=CASE WHEN review_required THEN NULL ELSE approved_at END,
        approved_revision=CASE WHEN review_required THEN NULL ELSE approved_revision END
      WHERE id=v_id;
    END IF;
  END IF;
  IF p_event IS NULL OR v_changed THEN
    INSERT INTO private.uc02_audit(committee_id,event_id,actor_kind,actor_user_id,action,changes)
      SELECT committee_id,id,'authenticated',p_actor,'event.updated',
        jsonb_build_object('coverChanged',true,'phoneRequired',p_phone) FROM public.events WHERE id=v_id;
  END IF;
  RETURN (SELECT jsonb_build_object('code','SUCCESS','eventId',id,'revision',revision) FROM public.events WHERE id=v_id);
END $$;

CREATE FUNCTION private.get_member_profile(p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_member public.members%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM private.access_auth_users WHERE id=p_actor AND email_confirmed_at IS NOT NULL) THEN
    RETURN jsonb_build_object('code','EMAIL_UNCONFIRMED');
  END IF;
  SELECT * INTO v_member FROM public.members WHERE id=p_actor;
  IF NOT FOUND THEN RETURN jsonb_build_object('code','MEMBER_REQUIRED'); END IF;
  RETURN jsonb_build_object('code','SUCCESS','name',v_member.full_name,'email',v_member.email,'phone',v_member.phone);
END $$;

CREATE FUNCTION private.update_member_phone(p_actor uuid,p_phone text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_profile jsonb;
BEGIN
  v_profile:=private.get_member_profile(p_actor);
  IF v_profile->>'code'<>'SUCCESS' THEN RETURN v_profile; END IF;
  IF p_phone IS NULL OR p_phone !~ '^\+[1-9][0-9]{6,14}$' THEN RETURN jsonb_build_object('code','PHONE_REQUIRED'); END IF;
  UPDATE public.members SET phone=p_phone WHERE id=p_actor AND phone IS DISTINCT FROM p_phone;
  IF FOUND THEN
    INSERT INTO private.uc02_audit(actor_kind,actor_user_id,action,changes)
      VALUES('authenticated',p_actor,'member.phone_updated','{}');
  END IF;
  RETURN private.get_member_profile(p_actor);
END $$;

-- Retain the canonical algorithm intact, reachable only by the checked wrappers.
ALTER FUNCTION private.register_for_event(uuid,text,text,text,inet) RENAME TO register_for_event_base;
REVOKE ALL ON FUNCTION private.register_for_event_base(uuid,text,text,text,inet) FROM app_runtime;

CREATE FUNCTION private.register_event_guest(p_event uuid,p_name text,p_email text,p_intent text,p_ip inet,p_phone text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_result jsonb; v_required boolean;
BEGIN
  -- Keep the canonical lock order: IP limiter then event then registration.
  PERFORM pg_advisory_xact_lock(hashtext(p_ip::text));
  SELECT phone_required INTO v_required FROM public.events WHERE id=p_event AND archived_at IS NULL AND status IN ('published','full') FOR UPDATE;
  IF (v_required AND p_phone IS NULL) OR (p_phone IS NOT NULL AND p_phone !~ '^\+[1-9][0-9]{6,14}$') THEN
    RETURN jsonb_build_object('code','PHONE_REQUIRED');
  END IF;
  v_result:=private.register_for_event_base(p_event,p_name,p_email,p_intent,p_ip);
  IF v_result->>'code' IN ('SUCCESS','WAITLISTED') THEN
    UPDATE public.registrations SET attendee_phone=p_phone WHERE id=(v_result->>'registrationId')::uuid;
  END IF;
  RETURN v_result;
END $$;

-- Preserve the old internal contract for accountless callers.
CREATE FUNCTION private.register_for_event(p_event_id uuid,p_attendee_name text,p_attendee_email text,p_intent text,p_ip inet)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT private.register_event_guest(p_event_id,p_attendee_name,p_attendee_email,p_intent,p_ip,NULL);
$$;

CREATE FUNCTION private.register_event_member(p_actor uuid,p_event uuid,p_intent text,p_ip inet)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_profile jsonb; v_result jsonb;
BEGIN
  v_profile:=private.get_member_profile(p_actor);
  IF v_profile->>'code'<>'SUCCESS' THEN RETURN v_profile; END IF;
  v_result:=private.register_event_guest(p_event,v_profile->>'name',v_profile->>'email',p_intent,p_ip,v_profile->>'phone');
  IF v_result->>'code' IN ('SUCCESS','WAITLISTED') THEN
    UPDATE public.registrations SET member_id=p_actor WHERE id=(v_result->>'registrationId')::uuid;
    -- The canonical audit captures the seat decision; add verified attribution.
    INSERT INTO private.uc02_audit(committee_id,event_id,registration_id,actor_kind,actor_user_id,action,changes)
      SELECT committee_id,p_event,(v_result->>'registrationId')::uuid,'authenticated',p_actor,'registration.member_linked','{}'
      FROM public.events WHERE id=p_event;
  END IF;
  RETURN v_result;
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('code','ALREADY_REGISTERED');
END $$;

CREATE FUNCTION private.get_member_event(p_actor uuid,p_event uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_profile jsonb; v_registration public.registrations%ROWTYPE; v_session private.event_checkin_sessions%ROWTYPE;
BEGIN
  v_profile:=private.get_member_profile(p_actor);
  IF v_profile->>'code'<>'SUCCESS' THEN RETURN v_profile; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.events WHERE id=p_event AND archived_at IS NULL AND status IN ('published','full')) THEN
    RETURN jsonb_build_object('code','NOT_FOUND'); END IF;
  SELECT * INTO v_registration FROM public.registrations WHERE event_id=p_event AND member_id=p_actor AND status IN ('confirmed','waitlisted');
  SELECT * INTO v_session FROM private.event_checkin_sessions WHERE event_id=p_event;
  RETURN jsonb_build_object('code','SUCCESS','profile',v_profile,
    'registration',CASE WHEN v_registration.id IS NOT NULL THEN jsonb_build_object(
      'status',v_registration.status,'attended',v_registration.attended,'checkedInAt',v_registration.checked_in_at) END,
    'checkinOpen',coalesce(v_session.is_open AND v_session.closes_at>clock_timestamp(),false),
    'closesAt',v_session.closes_at);
END $$;

CREATE FUNCTION private.manage_event_checkin(p_actor uuid,p_event uuid,p_operation text,p_hash text,p_closes timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_event public.events%ROWTYPE; v_session private.event_checkin_sessions%ROWTYPE;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.events e WHERE e.id=p_event AND private.lock_committee_access(p_actor,e.committee_id)) THEN
    RETURN jsonb_build_object('code','NOT_FOUND'); END IF;
  SELECT * INTO v_event FROM public.events WHERE id=p_event FOR UPDATE;
  SELECT * INTO v_session FROM private.event_checkin_sessions WHERE event_id=p_event;
  IF p_operation='read' THEN
    RETURN jsonb_build_object('code','SUCCESS','isOpen',coalesce(v_session.is_open AND v_session.closes_at>clock_timestamp(),false),
      'closesAt',v_session.closes_at,'challengeExpiresAt',v_session.challenge_expires_at);
  END IF;
  IF p_operation IS NULL OR p_operation NOT IN ('open','rotate','close') THEN RETURN jsonb_build_object('code','VALIDATION_ERROR'); END IF;
  IF p_operation<>'close' AND (v_event.archived_at IS NOT NULL OR v_event.status NOT IN ('published','full')) THEN
    RETURN jsonb_build_object('code','INVALID_TRANSITION'); END IF;
  IF p_operation='rotate' THEN
    IF NOT coalesce(v_session.is_open AND v_session.closes_at>clock_timestamp(),false) THEN RETURN jsonb_build_object('code','CHECKIN_CLOSED'); END IF;
    p_closes:=v_session.closes_at;
  END IF;
  IF p_operation<>'close' AND (p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$' OR p_closes IS NULL
      OR p_closes<=clock_timestamp() OR p_closes>clock_timestamp()+interval '12 hours') THEN
    RETURN jsonb_build_object('code','VALIDATION_ERROR'); END IF;
  INSERT INTO private.event_checkin_sessions(event_id,is_open,closes_at,challenge_hash,challenge_expires_at)
    VALUES(p_event,p_operation<>'close',CASE WHEN p_operation<>'close' THEN p_closes END,
      CASE WHEN p_operation<>'close' THEN p_hash END,
      CASE WHEN p_operation<>'close' THEN least(p_closes,clock_timestamp()+interval '2 minutes') END)
    ON CONFLICT(event_id) DO UPDATE SET is_open=excluded.is_open,closes_at=excluded.closes_at,
      challenge_hash=excluded.challenge_hash,challenge_expires_at=excluded.challenge_expires_at;
  INSERT INTO private.uc02_audit(committee_id,event_id,actor_kind,actor_user_id,action,changes)
    VALUES(v_event.committee_id,p_event,'authenticated',p_actor,'attendance.session_changed',jsonb_build_object('operation',p_operation,'closesAt',p_closes));
  RETURN private.manage_event_checkin(p_actor,p_event,'read',NULL,NULL);
END $$;

CREATE FUNCTION private.confirm_member_attendance(p_actor uuid,p_event uuid,p_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_profile jsonb; v_event public.events%ROWTYPE; v_registration public.registrations%ROWTYPE; v_session private.event_checkin_sessions%ROWTYPE; v_now timestamptz;
BEGIN
  v_profile:=private.get_member_profile(p_actor);
  IF v_profile->>'code'<>'SUCCESS' THEN RETURN v_profile; END IF;
  SELECT * INTO v_event FROM public.events WHERE id=p_event FOR UPDATE;
  IF NOT FOUND OR v_event.archived_at IS NOT NULL OR v_event.status NOT IN ('published','full') THEN RETURN jsonb_build_object('code','NOT_FOUND'); END IF;
  SELECT * INTO v_registration FROM public.registrations WHERE event_id=p_event AND member_id=p_actor AND status IN ('confirmed','waitlisted') FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('code','NOT_REGISTERED'); END IF;
  IF v_registration.status<>'confirmed' THEN RETURN jsonb_build_object('code','WAITLISTED'); END IF;
  -- A retry is a read of the original successful result, never another write.
  IF v_registration.attended THEN RETURN jsonb_build_object('code','SUCCESS','checkedInAt',v_registration.checked_in_at,'alreadyAttended',true); END IF;
  SELECT * INTO v_session FROM private.event_checkin_sessions WHERE event_id=p_event;
  v_now:=clock_timestamp();
  IF NOT coalesce(v_session.is_open AND v_session.closes_at>v_now,false) THEN RETURN jsonb_build_object('code','CHECKIN_CLOSED'); END IF;
  IF v_session.challenge_expires_at<=v_now THEN RETURN jsonb_build_object('code','CHALLENGE_EXPIRED'); END IF;
  IF p_hash IS NULL OR p_hash IS DISTINCT FROM v_session.challenge_hash THEN RETURN jsonb_build_object('code','INVALID_CHALLENGE'); END IF;
  UPDATE public.registrations SET attended=true,checked_in_at=v_now WHERE id=v_registration.id;
  INSERT INTO private.uc02_audit(committee_id,event_id,registration_id,actor_kind,actor_user_id,action,changes)
    VALUES(v_event.committee_id,p_event,v_registration.id,'authenticated',p_actor,'attendance.confirmed',jsonb_build_object('checkedInAt',v_now));
  RETURN jsonb_build_object('code','SUCCESS','checkedInAt',v_now,'alreadyAttended',false);
END $$;

CREATE FUNCTION private.list_event_attendance(p_actor uuid,p_event uuid,p_filter text,p_search text,p_after uuid,p_limit integer,p_export boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_committee uuid; v_rows jsonb; v_total integer; v_confirmed integer; v_attended integer; v_waitlisted integer;
BEGIN
  SELECT committee_id INTO v_committee FROM public.events WHERE id=p_event;
  IF NOT FOUND OR NOT private.lock_committee_access(p_actor,v_committee) THEN RETURN jsonb_build_object('code','NOT_FOUND'); END IF;
  -- Cooperating registration/check-in writers lock the event first, so counts,
  -- rows and export audit share a stable event snapshot while this lock is held.
  PERFORM 1 FROM public.events WHERE id=p_event FOR SHARE;
  IF p_filter IS NULL OR p_filter NOT IN ('all','attended','absent','waitlisted') OR p_search IS NULL OR char_length(p_search)>200
    OR p_limit IS NULL OR p_limit<1 OR p_limit>(CASE WHEN p_export THEN 10000 ELSE 101 END) THEN RETURN jsonb_build_object('code','VALIDATION_ERROR'); END IF;
  SELECT count(*) FILTER(WHERE status='confirmed'),count(*) FILTER(WHERE status='confirmed' AND attended),count(*) FILTER(WHERE status='waitlisted')
    INTO v_confirmed,v_attended,v_waitlisted FROM public.registrations WHERE event_id=p_event;
  SELECT count(*) INTO v_total FROM public.registrations r WHERE r.event_id=p_event AND r.status IN ('confirmed','waitlisted')
    AND (p_filter='all' OR p_filter='waitlisted' AND r.status='waitlisted' OR p_filter='attended' AND r.status='confirmed' AND r.attended OR p_filter='absent' AND r.status='confirmed' AND NOT r.attended)
    AND (p_search='' OR position(lower(p_search) in lower(r.attendee_name||' '||r.attendee_email))>0);
  IF p_export AND v_total>10000 THEN RETURN jsonb_build_object('code','EXPORT_LIMIT'); END IF;
  SELECT coalesce(jsonb_agg(x ORDER BY x.id),'[]') INTO v_rows FROM (
    SELECT r.id,r.attendee_name AS name,r.attendee_email AS email,r.status,r.attended,r.checked_in_at AS "checkedInAt",r.registered_at AS "registeredAt"
    FROM public.registrations r WHERE r.event_id=p_event AND r.status IN ('confirmed','waitlisted') AND (p_after IS NULL OR r.id>p_after)
      AND (p_filter='all' OR p_filter='waitlisted' AND r.status='waitlisted' OR p_filter='attended' AND r.status='confirmed' AND r.attended OR p_filter='absent' AND r.status='confirmed' AND NOT r.attended)
      AND (p_search='' OR position(lower(p_search) in lower(r.attendee_name||' '||r.attendee_email))>0)
    ORDER BY r.id LIMIT p_limit
  ) x;
  IF p_export THEN
    INSERT INTO private.uc02_audit(committee_id,event_id,actor_kind,actor_user_id,action,changes)
      VALUES(v_committee,p_event,'authenticated',p_actor,'attendance.exported',jsonb_build_object('rowCount',v_total,'filter',p_filter));
  END IF;
  RETURN jsonb_build_object('code','SUCCESS','rows',v_rows,'total',v_total,'confirmed',v_confirmed,'attended',v_attended,'waitlisted',v_waitlisted);
END $$;

-- All new routines use the same trusted server actor boundary as ADR 0015.
DO $$ DECLARE v_fn regprocedure; BEGIN
  FOR v_fn IN SELECT oid::regprocedure FROM pg_proc WHERE pronamespace='private'::regnamespace
    AND proname IN ('public_event_options','admin_event_options','save_event_details','get_member_profile',
      'update_member_phone','register_event_guest','register_for_event','register_event_member','get_member_event',
      'manage_event_checkin','confirm_member_attendance','list_event_attendance') LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO uc02_routine_owner',v_fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,app_maintenance,service_role',v_fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO app_runtime',v_fn);
  END LOOP;
END $$;
