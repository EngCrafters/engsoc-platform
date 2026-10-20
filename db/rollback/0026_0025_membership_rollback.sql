-- DESTRUCTIVE. Last-resort schema rollback of 0026_membership_document_storage and
-- 0025_membership_applications, restoring the database to its exact post-0024 shape.
--
-- Not a migration and never applied automatically (it lives outside db/migrations). Prefer the
-- non-destructive recovery in docs/UC-01_Staging_Rollout.md. Run only with the owner's explicit
-- authorization, inside BEGIN/COMMIT, and only while no membership data exists: the guard below
-- refuses to run if any application, pending Storage deletion or membership audit row exists,
-- because those are permanent records this script would otherwise destroy.
--
-- Afterwards, remove the two rows from supabase_migrations.schema_migrations (or the Drizzle
-- journal on a local database) so the migrations can be applied again later.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM private.membership_applications) THEN
    RAISE EXCEPTION 'membership applications exist: this rollback would destroy them';
  END IF;
  IF EXISTS (SELECT 1 FROM private.membership_storage_deletions WHERE completed_at IS NULL) THEN
    RAISE EXCEPTION 'Storage deletions are pending: delete those objects first';
  END IF;
  IF EXISTS (SELECT 1 FROM private.uc02_audit WHERE action LIKE 'membership.%') THEN
    RAISE EXCEPTION 'membership audit history exists: audit rows are permanent';
  END IF;
END;
$$;

-- 0026 ------------------------------------------------------------------------------------------
DROP FUNCTION private.get_membership_document(uuid, uuid);
DROP FUNCTION private.complete_membership_storage_deletion(uuid);
DROP FUNCTION private.claim_membership_storage_deletions(integer);
DROP FUNCTION private.queue_abandoned_membership_upload(text, text);
DROP FUNCTION private.submit_stored_membership_application(
  text, text, text, integer, text, text[], text, text, text, text, integer, text, text, inet);
DROP FUNCTION private.begin_membership_submission(text, text, inet);
DROP FUNCTION private.membership_invalid_field(text, text, text, integer, text, text[], text, text);
DROP TRIGGER membership_document_removed ON private.membership_documents;
DROP FUNCTION private.queue_removed_membership_document();
DROP TABLE private.membership_storage_deletions;

-- 0025 ------------------------------------------------------------------------------------------
DROP FUNCTION private.set_membership_approval_policy(uuid, text);
DROP FUNCTION private.activate_membership(uuid, uuid, text);
DROP FUNCTION private.review_membership_application(uuid, uuid, integer, text, text);
DROP FUNCTION private.list_membership_application_history(uuid, uuid);
DROP FUNCTION private.get_membership_application(uuid, uuid);
DROP FUNCTION private.list_membership_applications(uuid, text, text, timestamptz, uuid, integer);
DROP FUNCTION private.get_membership_review_overview(uuid);
DROP FUNCTION private.can_review_membership(uuid);
DROP FUNCTION private.get_membership_application_status(text);
DROP FUNCTION private.submit_membership_application(
  text, text, text, integer, text, text[], text, text, text, text, bytea, inet);
DROP FUNCTION private.membership_actor_email(uuid);
DROP FUNCTION private.membership_reviewer_kind(uuid, boolean);
DROP TABLE private.membership_documents;
DROP TABLE private.membership_applications;
DROP TABLE private.membership_submission_attempts;
DROP TABLE private.membership_settings;
DROP TYPE private.membership_application_status;

DROP POLICY routine_owner_select_members ON public.members;
DROP POLICY routine_owner_insert_members ON public.members;
REVOKE SELECT, INSERT ON public.members FROM uc02_routine_owner;

DROP INDEX private.uc02_audit_membership_application_idx;
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
  'registrations.exported','history.imported'
));
