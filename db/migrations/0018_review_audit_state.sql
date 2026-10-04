-- Preserve explicit nulls in the resulting review state for audit inspection.
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
    'event.review_rejected', jsonb_build_object(
      'previous', jsonb_build_object('approvedBy', v_event.approved_by,
        'approvedRevision', v_event.approved_revision, 'revision', v_event.revision),
      'next', jsonb_build_object('approvedBy', NULL, 'approvedRevision', NULL,
        'revision', v_event.revision + 1), 'note', v_note));
  RETURN jsonb_build_object('code', 'SUCCESS', 'revision', v_event.revision + 1);
END;
$$;
ALTER FUNCTION private.reject_review(uuid, uuid, integer, text) OWNER TO uc02_routine_owner;
REVOKE ALL ON FUNCTION private.reject_review(uuid, uuid, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.reject_review(uuid, uuid, integer, text) TO app_runtime;
