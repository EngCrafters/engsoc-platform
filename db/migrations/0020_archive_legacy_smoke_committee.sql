-- Controlled archive of the generic Events smoke committee. Preserve IDs,
-- archived events, registrations and existing audit foreign keys. A project
-- with non-smoke or active Events data is left untouched for manual review.
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
  'registrations.exported','history.imported'
));

DO $$
DECLARE v_committee uuid; v_events integer; v_registrations integer; v_event_ids jsonb;
BEGIN
  IF (SELECT count(*) FROM public.committees WHERE name = 'Events' AND slug IS NULL) <> 1 THEN
    RETURN;
  END IF;
  SELECT id INTO v_committee FROM public.committees
    WHERE name = 'Events' AND slug IS NULL FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.administrative_access
      WHERE committee_id = v_committee AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'Legacy Events still has active access';
  END IF;
  SELECT count(*), jsonb_agg(id ORDER BY id) INTO v_events, v_event_ids
    FROM public.events WHERE committee_id = v_committee;
  IF v_events = 0 OR EXISTS (
    SELECT 1 FROM public.events WHERE committee_id = v_committee
      AND (archived_at IS NULL OR title NOT LIKE 'M8 release smoke%')
  ) OR EXISTS (
    SELECT 1 FROM public.registrations r JOIN public.events e ON e.id = r.event_id
    WHERE e.committee_id = v_committee AND r.attendee_email !~* '(test|example|smoke)'
  ) THEN
    RETURN;
  END IF;
  SELECT count(*) INTO v_registrations FROM public.registrations r
    JOIN public.events e ON e.id = r.event_id WHERE e.committee_id = v_committee;
  UPDATE public.committees SET name = 'Legacy Events (archived M8 smoke)'
    WHERE id = v_committee;
  INSERT INTO private.uc02_audit (committee_id, actor_kind, action, changes)
  VALUES (v_committee, 'migration', 'legacy.smoke_archived',
    jsonb_build_object('previousName', 'Events',
      'newName', 'Legacy Events (archived M8 smoke)',
      'eventIds', v_event_ids, 'eventCount', v_events,
      'registrationCount', v_registrations,
      'reason', 'Owner confirmed M8 records are smoke/test only; archived history retained'));
END;
$$;
