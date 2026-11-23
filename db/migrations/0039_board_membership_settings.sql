-- 0039: Board Administration manages the membership settings (owner decision 2026-11-23, recorded
-- in ADR 0030). Requires 0038.
--
-- settings.membership_policy guards both membership settings on /admin/membership: the approval
-- policy (ADR 0017, 0029) and account activation (ADR 0030). Until now only the Technical level held
-- it (0035's fixed level mapping). The owner gives it to Board Administration as well. Nothing else
-- in the mapping changes: Committee Managers, leaders and every other permission are untouched, and
-- every change of either setting is still checked by the database and audited.

CREATE OR REPLACE FUNCTION private.core_schema_version() RETURNS integer
LANGUAGE sql IMMUTABLE AS $$ SELECT 39 $$;

UPDATE private.permission_catalog
SET label_en = 'Membership settings',
    description_en = 'Set the membership approval policy and how registrants'' accounts are activated.'
WHERE key = 'settings.membership_policy';

INSERT INTO private.access_level_permissions (access_level, permission, scope)
VALUES ('BOARD_ADMIN', 'settings.membership_policy', 'all')
ON CONFLICT (access_level, permission) DO NOTHING;

INSERT INTO private.uc02_audit (committee_id, actor_kind, action, changes)
VALUES (NULL, 'migration', 'permissions.changed', jsonb_build_object(
  'levelKind', 'access_level', 'level', 'BOARD_ADMIN',
  'added', jsonb_build_array('settings.membership_policy'), 'migration', '0039'));

-- Checks: exactly the intended change.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM private.access_level_permissions
      WHERE access_level = 'BOARD_ADMIN' AND permission = 'settings.membership_policy' AND scope = 'all')
     OR NOT EXISTS (SELECT 1 FROM private.access_level_permissions
      WHERE access_level = 'TECHNICAL' AND permission = 'settings.membership_policy')
     OR EXISTS (SELECT 1 FROM private.access_level_permissions
      WHERE access_level = 'COMMITTEE_MANAGER' AND permission = 'settings.membership_policy')
     OR EXISTS (SELECT 1 FROM private.access_level_permissions WHERE access_level = 'BOARD_ADMIN'
      AND permission IN ('accounts.admin_levels', 'accounts.credentials', 'accounts.erase')) THEN
    RAISE EXCEPTION '0039 self-check failed: level mapping';
  END IF;
END $$;
