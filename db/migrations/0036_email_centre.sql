-- 0036: the Email Centre (ADR 0028). Requires 0035 (email.send and private.has_permission).
--
-- Drafts, reusable templates, server-side audience selection over real member data, and durable,
-- individual deliveries that a provider-independent worker sends in bounded batches. Before every
-- send the database rechecks that the person who queued the campaign still holds email.send and
-- that the recipient is still eligible (member, status, announcements subscription, not
-- suppressed). Provider acceptance and confirmed delivery are separate states. No provider is
-- chosen here and nothing is sent by this migration.
--
-- Additive: new tables and routines only; no existing row changes.

CREATE OR REPLACE FUNCTION private.core_schema_version() RETURNS integer
LANGUAGE sql IMMUTABLE AS $$ SELECT 36 $$;

-- =============================================================================================
-- Tables
-- =============================================================================================

-- A member's choice about optional announcements. No row: subscribed.
CREATE TABLE private.email_preferences (
  member_id uuid PRIMARY KEY REFERENCES public.members (id) ON DELETE CASCADE,
  announcements boolean NOT NULL,
  source text NOT NULL CHECK (source IN ('member', 'unsubscribe_link')),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Addresses never emailed again: bounced, complained, invalid (from a provider's answer) or manual.
CREATE TABLE private.email_suppressions (
  email text PRIMARY KEY CHECK (email = lower(btrim(email)) AND char_length(email) BETWEEN 3 AND 254),
  reason text NOT NULL CHECK (reason IN ('bounced', 'complained', 'invalid', 'manual')),
  detail text CHECK (detail IS NULL OR char_length(detail) <= 300),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE private.email_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 120),
  subject_en text CHECK (subject_en IS NULL OR char_length(subject_en) <= 200),
  subject_ar text CHECK (subject_ar IS NULL OR char_length(subject_ar) <= 200),
  body_en text CHECK (body_en IS NULL OR char_length(body_en) <= 20000),
  body_ar text CHECK (body_ar IS NULL OR char_length(body_ar) <= 20000),
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  updated_at timestamptz,
  archived_at timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0)
);

CREATE TABLE private.email_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'queued', 'sending', 'completed', 'cancelled', 'halted')),
  language text NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'ar', 'both')),
  subject_en text CHECK (subject_en IS NULL OR char_length(subject_en) <= 200),
  subject_ar text CHECK (subject_ar IS NULL OR char_length(subject_ar) <= 200),
  body_en text CHECK (body_en IS NULL OR char_length(body_en) <= 20000),
  body_ar text CHECK (body_ar IS NULL OR char_length(body_ar) <= 20000),
  audience jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(audience) = 'object'),
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  updated_at timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  queued_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  queued_at timestamptz,
  recipient_count integer CHECK (recipient_count IS NULL OR recipient_count >= 0),
  test_sent_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  halted_at timestamptz,
  halt_reason text CHECK (halt_reason IS NULL OR halt_reason IN ('SENDER_NOT_AUTHORIZED')),
  CHECK ((status = 'draft') = (queued_at IS NULL))
);
CREATE INDEX email_campaigns_recent_idx ON private.email_campaigns (created_at DESC, id);
CREATE INDEX email_campaigns_active_idx ON private.email_campaigns (status) WHERE status IN ('queued', 'sending');

-- One row per recipient per campaign: individual delivery, never a shared To/Cc. The address is a
-- snapshot taken when the campaign was queued; the row goes with the membership record.
CREATE TABLE private.email_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES private.email_campaigns (id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES public.members (id) ON DELETE CASCADE,
  email text NOT NULL CHECK (email = lower(btrim(email))),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'accepted', 'delivered', 'failed', 'skipped')),
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 50),
  next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  lease_until timestamptz,
  provider_message_id text CHECK (provider_message_id IS NULL OR char_length(provider_message_id) <= 200),
  last_error text CHECK (last_error IS NULL OR char_length(last_error) <= 300),
  skip_reason text CHECK (skip_reason IS NULL OR skip_reason IN
    ('unsubscribed', 'suppressed', 'not_eligible', 'sender_not_authorized', 'cancelled')),
  accepted_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (campaign_id, email),
  UNIQUE (campaign_id, member_id),
  CHECK ((status = 'sending') = (lease_until IS NOT NULL)),
  CHECK ((status = 'skipped') = (skip_reason IS NOT NULL))
);
CREATE INDEX email_deliveries_due_idx ON private.email_deliveries (next_attempt_at)
  WHERE status IN ('pending', 'sending');
CREATE INDEX email_deliveries_campaign_idx ON private.email_deliveries (campaign_id, status);
CREATE INDEX email_deliveries_provider_idx ON private.email_deliveries (provider_message_id)
  WHERE provider_message_id IS NOT NULL;
CREATE INDEX email_deliveries_member_idx ON private.email_deliveries (member_id);

-- Indexed audience filters (ADR 0028). Interests fall back to the activated application.
CREATE INDEX IF NOT EXISTS members_category_idx ON public.members (category, institution_id);
CREATE INDEX IF NOT EXISTS members_major_idx ON public.members (major);
CREATE INDEX IF NOT EXISTS members_interests_idx ON public.members USING gin (interests);
CREATE INDEX IF NOT EXISTS membership_applications_member_idx ON private.membership_applications (member_id)
  WHERE member_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS leadership_appointments_active_member_idx ON private.leadership_appointments (member_id)
  WHERE ended_at IS NULL;

DO $$ DECLARE v_table text; BEGIN
  FOREACH v_table IN ARRAY ARRAY['email_preferences', 'email_suppressions', 'email_templates', 'email_campaigns',
      'email_deliveries'] LOOP
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
    ' OR action IN (''email.campaign_queued'', ''email.campaign_cancelled'', ''email.campaign_halted'',' ||
    ' ''email.campaign_completed'', ''email.test_sent'', ''email.template_saved'', ''email.template_archived'',' ||
    ' ''email.preferences_changed'', ''email.unsubscribed'', ''email.suppressed''))';
END $$;

-- =============================================================================================
-- The audience (internal)
-- =============================================================================================

-- A uuid array from an audience key; invalid entries make the whole audience invalid upstream.
CREATE FUNCTION private.email_uuid_list(p_audience jsonb, p_key text) RETURNS uuid[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(array_agg(value::uuid), '{}'::uuid[])
  FROM jsonb_array_elements_text(coalesce(p_audience -> p_key, '[]'::jsonb))
  WHERE value ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
$$;

CREATE FUNCTION private.email_text_list(p_audience jsonb, p_key text) RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(array_agg(value), '{}'::text[])
  FROM jsonb_array_elements_text(coalesce(p_audience -> p_key, '[]'::jsonb));
$$;

-- Whether an audience is well formed: known keys, arrays of known values, bounded sizes.
CREATE FUNCTION private.email_audience_valid(p_audience jsonb) RETURNS boolean
LANGUAGE plpgsql STABLE AS $$
DECLARE v_key text; v_value jsonb;
BEGIN
  IF p_audience IS NULL OR jsonb_typeof(p_audience) <> 'object' THEN RETURN false; END IF;
  FOR v_key, v_value IN SELECT * FROM jsonb_each(p_audience) LOOP
    IF v_key NOT IN ('categories', 'institutions', 'years', 'disciplines', 'interests', 'statuses', 'squ',
        'leadership', 'committees', 'teams', 'include', 'exclude') OR jsonb_typeof(v_value) <> 'array'
       OR jsonb_array_length(v_value) > (CASE WHEN v_key IN ('include', 'exclude') THEN 500 ELSE 50 END) THEN
      RETURN false; END IF;
  END LOOP;
  RETURN private.email_text_list(p_audience, 'categories') <@ (SELECT array_agg(id) FROM private.membership_categories)
    AND private.email_text_list(p_audience, 'institutions') <@ (SELECT array_agg(id) FROM private.institutions)
    AND private.email_text_list(p_audience, 'years') <@ ARRAY['1', '2', '3', '4', '5', '6', '7']
    AND private.email_text_list(p_audience, 'disciplines') <@ private.member_discipline_ids()
    AND private.email_text_list(p_audience, 'interests') <@ private.member_interest_ids()
    AND private.email_text_list(p_audience, 'statuses') <@ ARRAY['member', 'graduate']
    AND private.email_text_list(p_audience, 'squ') <@ ARRAY['verified', 'pending', 'not_verified']
    AND private.email_text_list(p_audience, 'leadership') <@ ARRAY['chief', 'assistant_chief', 'any']
    AND cardinality(private.email_uuid_list(p_audience, 'committees')) = jsonb_array_length(coalesce(p_audience -> 'committees', '[]'))
    AND cardinality(private.email_uuid_list(p_audience, 'teams')) = jsonb_array_length(coalesce(p_audience -> 'teams', '[]'))
    AND cardinality(private.email_uuid_list(p_audience, 'include')) = jsonb_array_length(coalesce(p_audience -> 'include', '[]'))
    AND cardinality(private.email_uuid_list(p_audience, 'exclude')) = jsonb_array_length(coalesce(p_audience -> 'exclude', '[]'));
END $$;

-- The eligible, deduplicated recipients of an audience. Filters narrow together; values within a
-- filter match any. Included members join the filtered set, excluded ones leave it. Eligibility
-- always applies: status in the selected statuses (default member), subscribed to announcements,
-- address not suppressed. Callers have checked email.send and validity.
CREATE FUNCTION private.email_audience_members(p_audience jsonb)
RETURNS TABLE (member_id uuid, email text, name text)
LANGUAGE sql STABLE AS $$
  WITH f AS (
    SELECT private.email_text_list(p_audience, 'categories') AS categories,
      private.email_text_list(p_audience, 'institutions') AS institutions,
      (SELECT coalesce(array_agg(y::integer), '{}') FROM unnest(private.email_text_list(p_audience, 'years')) y) AS years,
      private.email_text_list(p_audience, 'disciplines') AS disciplines,
      private.email_text_list(p_audience, 'interests') AS interests,
      coalesce(nullif(private.email_text_list(p_audience, 'statuses'), '{}'), ARRAY['member']) AS statuses,
      private.email_text_list(p_audience, 'squ') AS squ,
      private.email_text_list(p_audience, 'leadership') AS leadership,
      private.email_uuid_list(p_audience, 'committees') AS committees,
      private.email_uuid_list(p_audience, 'teams') AS teams,
      private.email_uuid_list(p_audience, 'include') AS include,
      private.email_uuid_list(p_audience, 'exclude') AS exclude
  ), matched AS (
    SELECT m.id FROM public.members m, f
    WHERE (cardinality(f.categories) = 0 OR m.category = ANY (f.categories))
      AND (cardinality(f.institutions) = 0 OR m.institution_id = ANY (f.institutions))
      AND (cardinality(f.years) = 0 OR m.year = ANY (f.years))
      AND (cardinality(f.disciplines) = 0 OR m.major = ANY (f.disciplines))
      AND (cardinality(f.interests) = 0 OR coalesce(m.interests, (SELECT a.interests FROM private.membership_applications a
            WHERE a.member_id = m.id ORDER BY a.submitted_at DESC LIMIT 1), '{}') && f.interests)
      AND (cardinality(f.squ) = 0
        OR ('verified' = ANY (f.squ) AND EXISTS (SELECT 1 FROM private.squ_verifications v
              WHERE v.member_id = m.id AND v.revoked_at IS NULL))
        OR ('pending' = ANY (f.squ) AND EXISTS (SELECT 1 FROM private.squ_verification_requests r
              WHERE r.member_id = m.id AND r.status = 'pending'))
        OR ('not_verified' = ANY (f.squ) AND NOT EXISTS (SELECT 1 FROM private.squ_verifications v
              WHERE v.member_id = m.id AND v.revoked_at IS NULL)))
      AND (cardinality(f.committees) = 0
        OR EXISTS (SELECT 1 FROM private.committee_members cm WHERE cm.member_id = m.id AND cm.committee_id = ANY (f.committees))
        OR EXISTS (SELECT 1 FROM private.leadership_appointments la LEFT JOIN private.committee_teams t ON t.id = la.team_id
              WHERE la.member_id = m.id AND la.ended_at IS NULL AND coalesce(la.committee_id, t.committee_id) = ANY (f.committees)))
      AND (cardinality(f.teams) = 0
        OR EXISTS (SELECT 1 FROM private.leadership_appointments la WHERE la.member_id = m.id AND la.ended_at IS NULL
              AND la.team_id = ANY (f.teams)))
      AND (cardinality(f.leadership) = 0
        OR EXISTS (SELECT 1 FROM private.leadership_appointments la LEFT JOIN private.committee_teams t ON t.id = la.team_id
              WHERE la.member_id = m.id AND la.ended_at IS NULL
                AND ('any' = ANY (f.leadership) OR la.position_id = ANY (f.leadership))
                AND (cardinality(f.committees) = 0 OR coalesce(la.committee_id, t.committee_id) = ANY (f.committees))
                AND (cardinality(f.teams) = 0 OR la.team_id = ANY (f.teams))))
    UNION
    SELECT unnest(f.include) FROM f
  )
  SELECT DISTINCT ON (lower(m.email)) m.id, lower(btrim(m.email)), m.full_name
  FROM matched x JOIN public.members m ON m.id = x.id, f
  WHERE m.id <> ALL (f.exclude)
    AND m.status::text = ANY (f.statuses)
    AND m.email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    AND NOT EXISTS (SELECT 1 FROM private.email_preferences p WHERE p.member_id = m.id AND NOT p.announcements)
    AND NOT EXISTS (SELECT 1 FROM private.email_suppressions s WHERE s.email = lower(btrim(m.email)))
  ORDER BY lower(m.email), m.id;
$$;

-- =============================================================================================
-- Email Centre routines (runtime; email.send)
-- =============================================================================================

-- The real values the filters offer.
CREATE FUNCTION private.email_filter_options(p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT private.has_permission(p_actor, 'email.send') THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  RETURN jsonb_build_object('code', 'SUCCESS',
    'categories', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'label', jsonb_build_object('en', label_en,
        'ar', label_ar), 'academicYear', academic_year_required) ORDER BY sort_order), '[]') FROM private.membership_categories),
    'institutions', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', jsonb_build_object('en', name_en,
        'ar', name_ar)) ORDER BY sort_order), '[]') FROM private.institutions),
    'disciplines', to_jsonb(private.member_discipline_ids()),
    'interests', to_jsonb(private.member_interest_ids()),
    'committees', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name,
        'teams', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name_en) ORDER BY t.name_en), '[]')
          FROM private.committee_teams t WHERE t.committee_id = c.id AND t.status <> 'archived'))
        ORDER BY c.name), '[]') FROM public.committees c WHERE c.slug IS NOT NULL AND c.archived_at IS NULL),
    'positions', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'label', jsonb_build_object('en', label_en,
        'ar', label_ar)) ORDER BY rank), '[]') FROM private.organizational_positions WHERE active),
    'unsubscribed', (SELECT count(*) FROM private.email_preferences WHERE NOT announcements),
    'suppressed', (SELECT count(*) FROM private.email_suppressions));
END $$;

-- The audience's count and one page (25) of recipients, optionally searched by name or email.
CREATE FUNCTION private.email_audience_preview(p_actor uuid, p_audience jsonb, p_search text, p_offset integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_search text := nullif(btrim(coalesce(p_search, '')), ''); v_pattern text;
BEGIN
  IF NOT private.has_permission(p_actor, 'email.send') THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  IF NOT private.email_audience_valid(p_audience) OR p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 100000
     OR char_length(coalesce(v_search, '')) > 100 THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR'); END IF;
  v_pattern := '%' || replace(replace(replace(coalesce(v_search, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  RETURN (WITH audience AS (SELECT * FROM private.email_audience_members(p_audience)),
    shown AS (SELECT a.* FROM audience a WHERE v_search IS NULL OR a.name ILIKE v_pattern ESCAPE '\'
      OR a.email ILIKE v_pattern ESCAPE '\')
  SELECT jsonb_build_object('code', 'SUCCESS', 'count', (SELECT count(*) FROM audience),
    'matching', (SELECT count(*) FROM shown),
    'recipients', coalesce((SELECT jsonb_agg(r.j ORDER BY r.name, r.email) FROM (
      SELECT s.name, s.email, jsonb_build_object('id', m.id, 'name', m.full_name, 'email', s.email,
        'category', m.category, 'institution', m.institution_id, 'year', m.year, 'discipline', m.major,
        'status', m.status, 'squVerified', EXISTS (SELECT 1 FROM private.squ_verifications v
          WHERE v.member_id = m.id AND v.revoked_at IS NULL),
        'leader', EXISTS (SELECT 1 FROM private.leadership_appointments la WHERE la.member_id = m.id AND la.ended_at IS NULL)) AS j
      FROM shown s JOIN public.members m ON m.id = s.member_id
      ORDER BY s.name, s.email OFFSET p_offset LIMIT 25) r), '[]'::jsonb)));
END $$;

-- Members to include or exclude by hand: up to 10 matches by name or email.
CREATE FUNCTION private.email_search_members(p_actor uuid, p_query text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_query text := nullif(btrim(coalesce(p_query, '')), ''); v_pattern text;
BEGIN
  IF NOT private.has_permission(p_actor, 'email.send') THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  IF v_query IS NULL OR char_length(v_query) < 2 OR char_length(v_query) > 100 THEN
    RETURN jsonb_build_object('code', 'SUCCESS', 'members', '[]'::jsonb); END IF;
  v_pattern := '%' || replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  RETURN jsonb_build_object('code', 'SUCCESS', 'members', coalesce((SELECT jsonb_agg(jsonb_build_object('id', id,
      'name', full_name, 'email', email, 'status', status) ORDER BY full_name) FROM (
    SELECT id, full_name, email, status FROM public.members
    WHERE full_name ILIKE v_pattern ESCAPE '\' OR email ILIKE v_pattern ESCAPE '\'
    ORDER BY full_name LIMIT 10) x), '[]'::jsonb));
END $$;

-- Names for included or excluded member ids, for the editor.
CREATE FUNCTION private.email_member_names(p_actor uuid, p_ids uuid[]) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT private.has_permission(p_actor, 'email.send') THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  IF cardinality(coalesce(p_ids, '{}')) > 1000 THEN RETURN jsonb_build_object('code', 'VALIDATION_ERROR'); END IF;
  RETURN jsonb_build_object('code', 'SUCCESS', 'members', coalesce((SELECT jsonb_agg(jsonb_build_object('id', id,
    'name', full_name, 'email', email)) FROM public.members WHERE id = ANY (p_ids)), '[]'::jsonb));
END $$;

-- Creates (p_campaign NULL) or updates a draft. p_content: {language, subjectEn, subjectAr, bodyEn,
-- bodyAr, audience}. Only drafts change; the revision guards concurrent edits.
CREATE FUNCTION private.email_save_campaign(p_actor uuid, p_campaign uuid, p_revision integer, p_content jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c private.email_campaigns%ROWTYPE; v_id uuid;
  v_language text := coalesce(p_content ->> 'language', 'en');
  v_subject_en text := nullif(btrim(coalesce(p_content ->> 'subjectEn', '')), '');
  v_subject_ar text := nullif(btrim(coalesce(p_content ->> 'subjectAr', '')), '');
  v_body_en text := nullif(btrim(coalesce(p_content ->> 'bodyEn', '')), '');
  v_body_ar text := nullif(btrim(coalesce(p_content ->> 'bodyAr', '')), '');
  v_audience jsonb := coalesce(p_content -> 'audience', '{}'::jsonb);
BEGIN
  IF NOT private.lock_permission(p_actor, 'email.send') THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  IF p_content IS NULL OR jsonb_typeof(p_content) <> 'object' OR v_language NOT IN ('en', 'ar', 'both')
     OR char_length(coalesce(v_subject_en, '')) > 200 OR char_length(coalesce(v_subject_ar, '')) > 200
     OR char_length(coalesce(v_body_en, '')) > 20000 OR char_length(coalesce(v_body_ar, '')) > 20000
     OR coalesce(v_subject_en, '') ~ '[\x01-\x1f\x7f]' OR coalesce(v_subject_ar, '') ~ '[\x01-\x1f\x7f]' THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'content'); END IF;
  IF NOT private.email_audience_valid(v_audience) THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'audience'); END IF;
  IF p_campaign IS NULL THEN
    INSERT INTO private.email_campaigns (language, subject_en, subject_ar, body_en, body_ar, audience, created_by)
    VALUES (v_language, v_subject_en, v_subject_ar, v_body_en, v_body_ar, v_audience, p_actor) RETURNING id INTO v_id;
    RETURN jsonb_build_object('code', 'SUCCESS', 'id', v_id, 'revision', 1);
  END IF;
  SELECT * INTO c FROM private.email_campaigns WHERE id = p_campaign FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  IF c.status <> 'draft' THEN RETURN jsonb_build_object('code', 'INVALID_TRANSITION'); END IF;
  IF c.revision IS DISTINCT FROM p_revision THEN RETURN jsonb_build_object('code', 'STALE_REVISION'); END IF;
  UPDATE private.email_campaigns SET language = v_language, subject_en = v_subject_en, subject_ar = v_subject_ar,
    body_en = v_body_en, body_ar = v_body_ar, audience = v_audience, updated_by = p_actor,
    updated_at = clock_timestamp(), revision = revision + 1
  WHERE id = c.id;
  RETURN jsonb_build_object('code', 'SUCCESS', 'id', c.id, 'revision', c.revision + 1);
END $$;

CREATE FUNCTION private.email_campaign_counts(p_campaign uuid) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'pending', count(*) FILTER (WHERE status = 'pending'), 'sending', count(*) FILTER (WHERE status = 'sending'),
    'accepted', count(*) FILTER (WHERE status = 'accepted'), 'delivered', count(*) FILTER (WHERE status = 'delivered'),
    'failed', count(*) FILTER (WHERE status = 'failed'), 'skipped', count(*) FILTER (WHERE status = 'skipped'),
    'total', count(*))
  FROM private.email_deliveries WHERE campaign_id = p_campaign;
$$;

CREATE FUNCTION private.email_list_campaigns(p_actor uuid, p_offset integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT private.has_permission(p_actor, 'email.send') THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  IF p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 100000 THEN RETURN jsonb_build_object('code', 'VALIDATION_ERROR'); END IF;
  RETURN jsonb_build_object('code', 'SUCCESS', 'total', (SELECT count(*) FROM private.email_campaigns),
    'campaigns', coalesce((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'status', c.status, 'language', c.language,
        'subject', coalesce(c.subject_en, c.subject_ar), 'createdAt', c.created_at,
        'createdByEmail', private.membership_actor_email(c.created_by), 'queuedAt', c.queued_at,
        'queuedByEmail', private.membership_actor_email(c.queued_by), 'recipientCount', c.recipient_count,
        'completedAt', c.completed_at, 'haltReason', c.halt_reason,
        'counts', CASE WHEN c.status = 'draft' THEN NULL ELSE private.email_campaign_counts(c.id) END)
        ORDER BY c.created_at DESC, c.id)
      FROM (SELECT * FROM private.email_campaigns ORDER BY created_at DESC, id OFFSET p_offset LIMIT 20) c), '[]'::jsonb));
END $$;

CREATE FUNCTION private.email_get_campaign(p_actor uuid, p_campaign uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c private.email_campaigns%ROWTYPE;
BEGIN
  IF NOT private.has_permission(p_actor, 'email.send') THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  SELECT * INTO c FROM private.email_campaigns WHERE id = p_campaign;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  RETURN jsonb_build_object('code', 'SUCCESS', 'campaign', jsonb_build_object('id', c.id, 'status', c.status,
      'language', c.language, 'subjectEn', c.subject_en, 'subjectAr', c.subject_ar, 'bodyEn', c.body_en,
      'bodyAr', c.body_ar, 'audience', c.audience, 'revision', c.revision, 'createdAt', c.created_at,
      'createdByEmail', private.membership_actor_email(c.created_by), 'updatedAt', c.updated_at,
      'queuedAt', c.queued_at, 'queuedByEmail', private.membership_actor_email(c.queued_by),
      'recipientCount', c.recipient_count, 'testSentAt', c.test_sent_at, 'completedAt', c.completed_at,
      'cancelledAt', c.cancelled_at, 'haltedAt', c.halted_at, 'haltReason', c.halt_reason),
    'counts', private.email_campaign_counts(c.id),
    'problems', coalesce((SELECT jsonb_agg(jsonb_build_object('email', d.email, 'name', d.name, 'status', d.status,
        'attempts', d.attempts, 'error', d.last_error, 'skipReason', d.skip_reason, 'at', d.updated_at)
        ORDER BY d.updated_at DESC)
      FROM (SELECT * FROM private.email_deliveries WHERE campaign_id = c.id AND status IN ('failed', 'skipped')
        ORDER BY updated_at DESC LIMIT 100) d), '[]'::jsonb));
END $$;

-- Queues a draft: snapshots its recipients as individual deliveries. p_expected is the count the
-- sender confirmed; a different count answers AUDIENCE_CHANGED with the new count instead.
CREATE FUNCTION private.email_queue_campaign(p_actor uuid, p_campaign uuid, p_revision integer, p_expected integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c private.email_campaigns%ROWTYPE; v_count integer;
BEGIN
  IF NOT private.lock_permission(p_actor, 'email.send') THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  SELECT * INTO c FROM private.email_campaigns WHERE id = p_campaign FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  IF c.status <> 'draft' THEN RETURN jsonb_build_object('code', 'ALREADY_QUEUED'); END IF;
  IF c.revision IS DISTINCT FROM p_revision THEN RETURN jsonb_build_object('code', 'STALE_REVISION'); END IF;
  IF (c.language IN ('en', 'both') AND (c.subject_en IS NULL OR c.body_en IS NULL))
     OR (c.language IN ('ar', 'both') AND (c.subject_ar IS NULL OR c.body_ar IS NULL)) THEN
    RETURN jsonb_build_object('code', 'CONTENT_INCOMPLETE'); END IF;
  IF NOT private.email_audience_valid(c.audience) THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'audience'); END IF;
  SELECT count(*) INTO v_count FROM private.email_audience_members(c.audience);
  IF v_count = 0 THEN RETURN jsonb_build_object('code', 'EMPTY_AUDIENCE'); END IF;
  IF p_expected IS DISTINCT FROM v_count THEN RETURN jsonb_build_object('code', 'AUDIENCE_CHANGED', 'count', v_count); END IF;
  INSERT INTO private.email_deliveries (campaign_id, member_id, email, name)
    SELECT c.id, a.member_id, a.email, a.name FROM private.email_audience_members(c.audience) a
    ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  UPDATE private.email_campaigns SET status = 'queued', queued_by = p_actor, queued_at = clock_timestamp(),
    recipient_count = v_count, revision = revision + 1 WHERE id = c.id;
  INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
  VALUES (NULL, 'authenticated', p_actor, 'email.campaign_queued', jsonb_build_object(
    'campaignId', c.id, 'recipients', v_count, 'language', c.language, 'audience', c.audience));
  RETURN jsonb_build_object('code', 'SUCCESS', 'recipients', v_count);
END $$;

-- Stops a queued or sending campaign: deliveries not yet handed to the provider are skipped.
CREATE FUNCTION private.email_cancel_campaign(p_actor uuid, p_campaign uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c private.email_campaigns%ROWTYPE; v_skipped integer;
BEGIN
  IF NOT private.lock_permission(p_actor, 'email.send') THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  SELECT * INTO c FROM private.email_campaigns WHERE id = p_campaign FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  IF c.status NOT IN ('queued', 'sending') THEN RETURN jsonb_build_object('code', 'INVALID_TRANSITION'); END IF;
  UPDATE private.email_deliveries SET status = 'skipped', skip_reason = 'cancelled', updated_at = clock_timestamp()
    WHERE campaign_id = c.id AND status = 'pending';
  GET DIAGNOSTICS v_skipped = ROW_COUNT;
  UPDATE private.email_campaigns SET status = 'cancelled', cancelled_at = clock_timestamp(), cancelled_by = p_actor
    WHERE id = c.id;
  INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
  VALUES (NULL, 'authenticated', p_actor, 'email.campaign_cancelled', jsonb_build_object(
    'campaignId', c.id, 'skipped', v_skipped));
  RETURN jsonb_build_object('code', 'SUCCESS', 'skipped', v_skipped);
END $$;

-- Records a test sent to the actor's own sign-in address and returns that address.
CREATE FUNCTION private.email_record_test(p_actor uuid, p_campaign uuid, p_outcome text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_email text;
BEGIN
  IF NOT private.lock_permission(p_actor, 'email.send') THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  IF p_outcome IS NULL OR p_outcome NOT IN ('accepted', 'failed') THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR'); END IF;
  SELECT lower(email) INTO v_email FROM private.access_auth_users WHERE id = p_actor;
  UPDATE private.email_campaigns SET test_sent_at = clock_timestamp() WHERE id = p_campaign AND p_outcome = 'accepted';
  IF NOT FOUND AND p_outcome = 'accepted' THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
  VALUES (NULL, 'authenticated', p_actor, 'email.test_sent', jsonb_build_object(
    'campaignId', p_campaign, 'outcome', p_outcome));
  RETURN jsonb_build_object('code', 'SUCCESS', 'email', v_email);
END $$;

-- Templates.
CREATE FUNCTION private.email_save_template(p_actor uuid, p_template uuid, p_revision integer, p_content jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE t private.email_templates%ROWTYPE; v_id uuid;
  v_name text := nullif(btrim(coalesce(p_content ->> 'name', '')), '');
BEGIN
  IF NOT private.lock_permission(p_actor, 'email.send') THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  IF v_name IS NULL OR char_length(v_name) > 120 OR char_length(coalesce(p_content ->> 'subjectEn', '')) > 200
     OR char_length(coalesce(p_content ->> 'subjectAr', '')) > 200 OR char_length(coalesce(p_content ->> 'bodyEn', '')) > 20000
     OR char_length(coalesce(p_content ->> 'bodyAr', '')) > 20000 THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR', 'field', 'template'); END IF;
  IF p_template IS NULL THEN
    INSERT INTO private.email_templates (name, subject_en, subject_ar, body_en, body_ar, created_by)
    VALUES (v_name, nullif(btrim(p_content ->> 'subjectEn'), ''), nullif(btrim(p_content ->> 'subjectAr'), ''),
      nullif(btrim(p_content ->> 'bodyEn'), ''), nullif(btrim(p_content ->> 'bodyAr'), ''), p_actor) RETURNING id INTO v_id;
  ELSE
    SELECT * INTO t FROM private.email_templates WHERE id = p_template AND archived_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
    IF t.revision IS DISTINCT FROM p_revision THEN RETURN jsonb_build_object('code', 'STALE_REVISION'); END IF;
    UPDATE private.email_templates SET name = v_name, subject_en = nullif(btrim(p_content ->> 'subjectEn'), ''),
      subject_ar = nullif(btrim(p_content ->> 'subjectAr'), ''), body_en = nullif(btrim(p_content ->> 'bodyEn'), ''),
      body_ar = nullif(btrim(p_content ->> 'bodyAr'), ''), updated_by = p_actor, updated_at = clock_timestamp(),
      revision = revision + 1 WHERE id = t.id;
    v_id := t.id;
  END IF;
  INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
  VALUES (NULL, 'authenticated', p_actor, 'email.template_saved', jsonb_build_object('templateId', v_id, 'name', v_name));
  RETURN jsonb_build_object('code', 'SUCCESS', 'id', v_id);
END $$;

CREATE FUNCTION private.email_list_templates(p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT private.has_permission(p_actor, 'email.send') THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  RETURN jsonb_build_object('code', 'SUCCESS', 'templates', coalesce((SELECT jsonb_agg(jsonb_build_object('id', id,
      'name', name, 'subjectEn', subject_en, 'subjectAr', subject_ar, 'bodyEn', body_en, 'bodyAr', body_ar,
      'revision', revision, 'updatedAt', coalesce(updated_at, created_at)) ORDER BY name)
    FROM private.email_templates WHERE archived_at IS NULL), '[]'::jsonb));
END $$;

CREATE FUNCTION private.email_archive_template(p_actor uuid, p_template uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT private.lock_permission(p_actor, 'email.send') THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
  UPDATE private.email_templates SET archived_at = clock_timestamp() WHERE id = p_template AND archived_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
  VALUES (NULL, 'authenticated', p_actor, 'email.template_archived', jsonb_build_object('templateId', p_template));
  RETURN jsonb_build_object('code', 'SUCCESS');
END $$;

-- =============================================================================================
-- Dispatch (runtime, no actor: called by Core's worker after its own authorization)
-- =============================================================================================

-- Claims up to p_limit due deliveries for one bounded batch, after rechecking each campaign's
-- sender and each recipient's eligibility. A campaign whose sender lost email.send is halted and
-- its remaining deliveries skipped. A claim is a lease; an expired lease is claimed again (the
-- delivery id is the provider idempotency key, so a resend cannot duplicate an accepted message).
CREATE FUNCTION private.email_claim_deliveries(p_limit integer, p_lease_seconds integer, p_campaign uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c record; d record; v_out jsonb := '[]'::jsonb; v_skip text;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 30 AND 900 THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR'); END IF;
  -- Sender recheck: halt campaigns whose sender no longer holds email.send.
  FOR c IN SELECT id, queued_by FROM private.email_campaigns
      WHERE status IN ('queued', 'sending') AND (p_campaign IS NULL OR id = p_campaign) FOR UPDATE SKIP LOCKED LOOP
    IF c.queued_by IS NULL OR NOT private.has_permission(c.queued_by, 'email.send') THEN
      UPDATE private.email_deliveries SET status = 'skipped', skip_reason = 'sender_not_authorized',
        lease_until = NULL, updated_at = clock_timestamp()
        WHERE campaign_id = c.id AND status IN ('pending', 'sending');
      UPDATE private.email_campaigns SET status = 'halted', halted_at = clock_timestamp(),
        halt_reason = 'SENDER_NOT_AUTHORIZED' WHERE id = c.id;
      -- A system action: recorded without an actor, naming the sender in the details.
      INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
      VALUES (NULL, 'migration', NULL, 'email.campaign_halted', jsonb_build_object(
        'campaignId', c.id, 'reason', 'SENDER_NOT_AUTHORIZED', 'queuedBy', c.queued_by));
    END IF;
  END LOOP;
  FOR d IN SELECT dl.id, dl.campaign_id, dl.member_id, dl.email, dl.name, dl.attempts, cp.audience, cp.language,
        cp.subject_en, cp.subject_ar, cp.body_en, cp.body_ar
      FROM private.email_deliveries dl JOIN private.email_campaigns cp ON cp.id = dl.campaign_id
      WHERE cp.status IN ('queued', 'sending') AND (p_campaign IS NULL OR cp.id = p_campaign)
        AND ((dl.status = 'pending' AND dl.next_attempt_at <= clock_timestamp())
          OR (dl.status = 'sending' AND dl.lease_until < clock_timestamp()))
      ORDER BY dl.next_attempt_at, dl.id LIMIT p_limit
      FOR UPDATE OF dl SKIP LOCKED LOOP
    -- Recipient recheck: still a member in the selected statuses, subscribed and not suppressed.
    v_skip := CASE
      WHEN NOT EXISTS (SELECT 1 FROM public.members m WHERE m.id = d.member_id
          AND m.status::text = ANY (coalesce(nullif(private.email_text_list(d.audience, 'statuses'), '{}'), ARRAY['member'])))
        THEN 'not_eligible'
      WHEN EXISTS (SELECT 1 FROM private.email_preferences p WHERE p.member_id = d.member_id AND NOT p.announcements)
        THEN 'unsubscribed'
      WHEN EXISTS (SELECT 1 FROM private.email_suppressions s WHERE s.email = d.email) THEN 'suppressed' END;
    IF v_skip IS NOT NULL THEN
      UPDATE private.email_deliveries SET status = 'skipped', skip_reason = v_skip, lease_until = NULL,
        updated_at = clock_timestamp() WHERE id = d.id;
      CONTINUE;
    END IF;
    UPDATE private.email_deliveries SET status = 'sending', attempts = attempts + 1,
      lease_until = clock_timestamp() + make_interval(secs => p_lease_seconds), updated_at = clock_timestamp()
      WHERE id = d.id;
    UPDATE private.email_campaigns SET status = 'sending' WHERE id = d.campaign_id AND status = 'queued';
    v_out := v_out || jsonb_build_object('id', d.id, 'campaignId', d.campaign_id, 'email', d.email, 'name', d.name,
      'attempt', d.attempts + 1, 'language', d.language, 'subjectEn', d.subject_en, 'subjectAr', d.subject_ar,
      'bodyEn', d.body_en, 'bodyAr', d.body_ar);
  END LOOP;
  PERFORM private.email_finish_campaigns(p_campaign);
  RETURN jsonb_build_object('code', 'SUCCESS', 'deliveries', v_out);
END $$;

-- Marks campaigns with nothing left to send as completed.
CREATE FUNCTION private.email_finish_campaigns(p_campaign uuid) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE c record;
BEGIN
  FOR c IN SELECT cp.id, cp.queued_by FROM private.email_campaigns cp
      WHERE cp.status IN ('queued', 'sending') AND (p_campaign IS NULL OR cp.id = p_campaign)
        AND NOT EXISTS (SELECT 1 FROM private.email_deliveries d WHERE d.campaign_id = cp.id AND d.status IN ('pending', 'sending'))
      FOR UPDATE SKIP LOCKED LOOP
    UPDATE private.email_campaigns SET status = 'completed', completed_at = clock_timestamp() WHERE id = c.id;
    INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
    VALUES (NULL, 'migration', NULL, 'email.campaign_completed', jsonb_build_object(
      'campaignId', c.id, 'queuedBy', c.queued_by, 'counts', private.email_campaign_counts(c.id)));
  END LOOP;
END $$;

-- The outcome of one send attempt, from the lease holder. 'accepted': the provider took it (not yet
-- delivered). 'retry': a temporary failure, retried with back-off up to five attempts. 'failed': a
-- permanent failure; p_invalid_address also suppresses the address.
CREATE FUNCTION private.email_complete_delivery(p_delivery uuid, p_outcome text, p_provider_id text, p_error text,
  p_invalid_address boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE d private.email_deliveries%ROWTYPE; v_error text := left(nullif(btrim(coalesce(p_error, '')), ''), 300);
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('accepted', 'retry', 'failed') THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR'); END IF;
  SELECT * INTO d FROM private.email_deliveries WHERE id = p_delivery FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  -- Only the current lease holder completes; anything else is a late, duplicate answer.
  IF d.status <> 'sending' THEN RETURN jsonb_build_object('code', 'NOT_LEASED', 'status', d.status); END IF;
  IF p_outcome = 'accepted' THEN
    UPDATE private.email_deliveries SET status = 'accepted', lease_until = NULL, accepted_at = clock_timestamp(),
      provider_message_id = left(p_provider_id, 200), last_error = NULL, updated_at = clock_timestamp() WHERE id = d.id;
  ELSIF p_outcome = 'retry' AND d.attempts < 5 THEN
    UPDATE private.email_deliveries SET status = 'pending', lease_until = NULL, last_error = v_error,
      next_attempt_at = clock_timestamp() + make_interval(mins => least(60, (2 ^ d.attempts)::integer)),
      updated_at = clock_timestamp() WHERE id = d.id;
  ELSE
    UPDATE private.email_deliveries SET status = 'failed', lease_until = NULL, failed_at = clock_timestamp(),
      last_error = coalesce(v_error, CASE WHEN p_outcome = 'retry' THEN 'Gave up after five attempts.' END),
      updated_at = clock_timestamp() WHERE id = d.id;
    IF coalesce(p_invalid_address, false) THEN
      INSERT INTO private.email_suppressions (email, reason, detail) VALUES (d.email, 'invalid', v_error)
      ON CONFLICT (email) DO NOTHING;
    END IF;
  END IF;
  PERFORM private.email_finish_campaigns(d.campaign_id);
  RETURN jsonb_build_object('code', 'SUCCESS');
END $$;

-- Provider evidence (for a provider webhook, deferred with the provider): delivered, bounced or
-- complained. Only evidence makes a message "delivered".
CREATE FUNCTION private.email_record_event(p_provider_id text, p_event text, p_detail text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE d private.email_deliveries%ROWTYPE;
BEGIN
  IF p_event IS NULL OR p_event NOT IN ('delivered', 'bounced', 'complained') OR nullif(p_provider_id, '') IS NULL THEN
    RETURN jsonb_build_object('code', 'VALIDATION_ERROR'); END IF;
  SELECT * INTO d FROM private.email_deliveries WHERE provider_message_id = p_provider_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  IF p_event = 'delivered' THEN
    UPDATE private.email_deliveries SET status = 'delivered', delivered_at = clock_timestamp(),
      updated_at = clock_timestamp() WHERE id = d.id AND status IN ('accepted', 'delivered');
  ELSE
    UPDATE private.email_deliveries SET status = 'failed', failed_at = clock_timestamp(),
      last_error = left(coalesce(nullif(p_detail, ''), initcap(p_event)), 300), updated_at = clock_timestamp()
      WHERE id = d.id;
    INSERT INTO private.email_suppressions (email, reason, detail)
    VALUES (d.email, p_event, left(p_detail, 300)) ON CONFLICT (email) DO NOTHING;
    INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
    VALUES (NULL, 'migration', NULL, 'email.suppressed', jsonb_build_object('deliveryId', d.id, 'reason', p_event));
  END IF;
  RETURN jsonb_build_object('code', 'SUCCESS');
END $$;

-- The signed unsubscribe link (Core verifies the signature first): announcements off for the
-- delivery's member. Idempotent.
CREATE FUNCTION private.email_unsubscribe(p_delivery uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_member uuid;
BEGIN
  SELECT member_id INTO v_member FROM private.email_deliveries WHERE id = p_delivery;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  INSERT INTO private.email_preferences (member_id, announcements, source) VALUES (v_member, false, 'unsubscribe_link')
  ON CONFLICT (member_id) DO UPDATE SET announcements = false, source = 'unsubscribe_link', updated_at = clock_timestamp()
    WHERE private.email_preferences.announcements;
  IF FOUND THEN
    INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
    VALUES (NULL, 'anonymous', NULL, 'email.unsubscribed', jsonb_build_object('deliveryId', p_delivery));
  END IF;
  RETURN jsonb_build_object('code', 'SUCCESS');
END $$;

-- =============================================================================================
-- The member's own preference (runtime; the website's profile)
-- =============================================================================================

CREATE FUNCTION private.get_own_email_preferences(p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.members WHERE id = p_actor) THEN RETURN jsonb_build_object('code', 'MEMBER_REQUIRED'); END IF;
  RETURN jsonb_build_object('code', 'SUCCESS', 'announcements', coalesce((SELECT announcements
    FROM private.email_preferences WHERE member_id = p_actor), true));
END $$;

CREATE FUNCTION private.set_own_email_preferences(p_actor uuid, p_announcements boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_was boolean;
BEGIN
  IF p_announcements IS NULL THEN RETURN jsonb_build_object('code', 'VALIDATION_ERROR'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.members WHERE id = p_actor) THEN RETURN jsonb_build_object('code', 'MEMBER_REQUIRED'); END IF;
  SELECT announcements INTO v_was FROM private.email_preferences WHERE member_id = p_actor FOR UPDATE;
  IF coalesce(v_was, true) = p_announcements THEN
    RETURN jsonb_build_object('code', 'SUCCESS', 'announcements', p_announcements); END IF;
  INSERT INTO private.email_preferences (member_id, announcements, source) VALUES (p_actor, p_announcements, 'member')
  ON CONFLICT (member_id) DO UPDATE SET announcements = EXCLUDED.announcements, source = 'member', updated_at = clock_timestamp();
  INSERT INTO private.uc02_audit (committee_id, actor_kind, actor_user_id, action, changes)
  VALUES (NULL, 'authenticated', p_actor, 'email.preferences_changed', jsonb_build_object('announcements', p_announcements));
  RETURN jsonb_build_object('code', 'SUCCESS', 'announcements', p_announcements);
END $$;

-- =============================================================================================
-- Ownership and privileges
-- =============================================================================================
DO $$ DECLARE v_fn regprocedure; BEGIN
  FOR v_fn IN SELECT oid::regprocedure FROM pg_proc WHERE pronamespace = 'private'::regnamespace
    AND proname LIKE 'email\_%' OR (pronamespace = 'private'::regnamespace
      AND proname IN ('get_own_email_preferences', 'set_own_email_preferences')) LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO uc02_routine_owner', v_fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, app_runtime, app_maintenance, service_role', v_fn);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION private.email_filter_options(uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.email_audience_preview(uuid, jsonb, text, integer) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.email_search_members(uuid, text) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.email_member_names(uuid, uuid[]) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.email_save_campaign(uuid, uuid, integer, jsonb) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.email_list_campaigns(uuid, integer) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.email_get_campaign(uuid, uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.email_queue_campaign(uuid, uuid, integer, integer) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.email_cancel_campaign(uuid, uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.email_record_test(uuid, uuid, text) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.email_save_template(uuid, uuid, integer, jsonb) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.email_list_templates(uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.email_archive_template(uuid, uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.email_claim_deliveries(integer, integer, uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.email_complete_delivery(uuid, text, text, text, boolean) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.email_record_event(text, text, text) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.email_unsubscribe(uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.get_own_email_preferences(uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION private.set_own_email_preferences(uuid, boolean) TO app_runtime;

-- The migration proves its own boundary; any failure rolls the whole migration back.
DO $$
BEGIN
  IF private.core_schema_version() <> 36 THEN RAISE EXCEPTION '0036 self-check failed: version'; END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'private'::regnamespace AND relname LIKE 'email\_%'
      AND relkind = 'r' AND NOT (relrowsecurity AND relforcerowsecurity)) THEN
    RAISE EXCEPTION '0036 self-check failed: forced RLS'; END IF;
  IF NOT EXISTS (SELECT 1 FROM private.permission_catalog WHERE key = 'email.send') THEN
    RAISE EXCEPTION '0036 self-check failed: email.send (0035) missing'; END IF;
  IF has_function_privilege('app_runtime', 'private.email_audience_members(jsonb)', 'EXECUTE')
     OR has_function_privilege('app_runtime', 'private.email_finish_campaigns(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'private.email_claim_deliveries(integer,integer,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'private.email_unsubscribe(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('app_runtime', 'private.email_queue_campaign(uuid,uuid,integer,integer)', 'EXECUTE')
     OR has_table_privilege('app_runtime', 'private.email_deliveries', 'SELECT') THEN
    RAISE EXCEPTION '0036 self-check failed: routine privileges'; END IF;
END $$;
