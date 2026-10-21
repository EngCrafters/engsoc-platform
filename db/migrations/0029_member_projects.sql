-- ADR 0021 (owner correction): project data only. Page visibility is static in ESWebsite.
-- Forward-only, run only after approved 0027/0028 rollout.
CREATE TABLE private.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.members(id),
  committee_id uuid NOT NULL REFERENCES public.committees(id),
  content jsonb NOT NULL DEFAULT '{}',
  revision integer NOT NULL DEFAULT 1 CHECK (revision>0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','under_review','approved','rejected','changes_requested')),
  approved_revision integer, published_revision integer, published_content jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((published_revision IS NULL)=(published_content IS NULL)),
  CHECK (approved_revision IS NULL OR (status='approved' AND approved_revision=revision)),
  CHECK (octet_length(content::text)<=65536),
  CHECK (published_content IS NULL OR octet_length(published_content::text)<=65536)
);
CREATE INDEX projects_member_updated_idx ON private.projects(member_id,updated_at DESC,id);
CREATE INDEX projects_status_updated_idx ON private.projects(status,updated_at DESC,id);
CREATE TABLE private.project_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES private.projects(id),
  object_key text NOT NULL UNIQUE CHECK (object_key ~ '^project-images/[0-9a-f-]{36}\.(jpg|png)$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX project_media_project_idx ON private.project_media(project_id);
CREATE TABLE private.project_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES private.projects(id), actor_id uuid NOT NULL REFERENCES auth.users(id),
  revision integer NOT NULL, action text NOT NULL CHECK(action IN ('created','saved','submitted','under_review','approved','rejected','changes_requested','published','unpublished','media_added','media_removed')),
  feedback text CHECK (char_length(feedback)<=2000), occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX project_history_project_idx ON private.project_history(project_id,occurred_at,id);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['projects','project_media','project_history'] LOOP
    EXECUTE format('ALTER TABLE private.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE private.%I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON private.%I FROM PUBLIC,anon,authenticated,app_runtime,app_maintenance,service_role',t);
    EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON private.%I TO uc02_routine_owner',t);
    EXECUTE format('CREATE POLICY routine_owner ON private.%I TO uc02_routine_owner USING (true) WITH CHECK (true)',t);
  END LOOP;
END $$;
REVOKE UPDATE,DELETE ON private.project_history FROM uc02_routine_owner;

CREATE FUNCTION private.project_member(p_actor uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.members m JOIN private.access_auth_users u ON u.id=m.id
   WHERE m.id=p_actor AND m.status='member' AND u.email_confirmed_at IS NOT NULL)
$$;
CREATE FUNCTION private.project_reviewer(p_actor uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c uuid; BEGIN
 SELECT id INTO c FROM public.committees WHERE slug='society-affairs';
 RETURN c IS NOT NULL AND private.lock_committee_access(p_actor,c);
END $$;
-- Server validates the complete design-shaped DTO; database additionally enforces
-- bounded JSON, the publication minimum, controlled enums and owned media links.
CREATE FUNCTION private.project_content_valid(c jsonb,complete boolean) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE field text; item jsonb; BEGIN
 IF c IS NULL OR jsonb_typeof(c)<>'object' OR octet_length(c::text)>65536 THEN RETURN false; END IF;
 IF NOT coalesce(c->>'discipline' IN ('mechanical','electrical','civil','petroleum','chemical','mechatronics','industrial'),false)
   OR NOT coalesce(c->>'stage' IN ('idea','research','development','prototype','testing','competition-ready','completed'),false)
   OR NOT coalesce(c->>'type' IN ('capstone','competition','research','course'),false)
   OR NOT coalesce(c->>'year' ~ '^20[0-9]{2}$',false) THEN RETURN false; END IF;
 FOREACH field IN ARRAY ARRAY['title','summary','problem','solution','nextSteps'] LOOP
   IF jsonb_typeof(c->field) IS DISTINCT FROM 'object' OR jsonb_typeof(c->field->'en') IS DISTINCT FROM 'string'
     OR char_length(c->field->>'en')>10000 OR char_length(c->field->>'ar')>10000 THEN RETURN false; END IF;
   IF complete AND field IN ('title','summary','problem','solution') AND NOT coalesce((c->field->>'en') ~ '[^[:space:]]' OR (c->field->>'ar') ~ '[^[:space:]]',false) THEN RETURN false; END IF;
 END LOOP;
 IF complete AND NOT coalesce((c->'technicalApproach'->'overview'->>'en') ~ '[^[:space:]]' OR (c->'technicalApproach'->'overview'->>'ar') ~ '[^[:space:]]',false) THEN RETURN false; END IF;
 FOREACH field IN ARRAY ARRAY['team','mediaIds','technologies','alsoDisciplines','development','validation','parts','achievements','links'] LOOP
   IF jsonb_typeof(c->field) IS DISTINCT FROM 'array' OR jsonb_array_length(c->field)>30 THEN RETURN false; END IF;
 END LOOP;
 IF jsonb_array_length(c->'mediaIds')>6 OR jsonb_array_length(c->'team')>20 THEN RETURN false; END IF;
 FOR item IN SELECT * FROM jsonb_array_elements(c->'links') LOOP
   IF NOT coalesce(item->>'href' ~ '^https?://[a-zA-Z0-9][^[:space:]@]*$',false) THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
CREATE FUNCTION private.project_read(p_actor uuid,p_project uuid DEFAULT NULL,p_review boolean DEFAULT false,p_status text DEFAULT 'all',p_search text DEFAULT '',p_offset integer DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE rows jsonb; total integer; BEGIN
 IF p_review THEN
   IF NOT private.project_reviewer(p_actor) THEN RETURN jsonb_build_object('code','FORBIDDEN'); END IF;
 ELSIF NOT private.project_member(p_actor) THEN RETURN jsonb_build_object('code','MEMBER_REQUIRED'); END IF;
 IF p_offset IS NULL OR p_offset<0 OR p_offset>10000 OR p_search IS NULL OR char_length(p_search)>100
   OR p_status IS NULL OR p_status NOT IN ('all','draft','submitted','under_review','approved','rejected','changes_requested','published') THEN RETURN jsonb_build_object('code','VALIDATION_ERROR'); END IF;
 SELECT count(*) INTO total FROM private.projects p WHERE (p_review OR p.member_id=p_actor)
   AND (p_project IS NULL OR p.id=p_project) AND (p_status='all' OR p_status='published' AND p.published_content IS NOT NULL OR p.status=p_status)
   AND (p_search='' OR position(lower(p_search) in lower(p.content->'title'->>'en'||' '||coalesce(p.content->'title'->>'ar','')))>0);
 SELECT coalesce(jsonb_agg(r),'[]') INTO rows FROM (
   SELECT p.id,p.content,p.revision,p.status,p.published_revision AS "publishedRevision",p.updated_at AS "updatedAt",
     (SELECT full_name FROM public.members WHERE id=p.member_id) AS "authorName",
     p.member_id=p_actor AS "isAuthor",coalesce(p.published_content->'mediaIds','[]') AS "publishedMediaIds",
     coalesce((SELECT jsonb_agg(jsonb_build_object('id',m.id) ORDER BY m.created_at,m.id) FROM private.project_media m WHERE m.project_id=p.id),'[]') AS media,
     (SELECT count(*) FROM private.project_history WHERE project_id=p.id) AS "historyTotal",
     coalesce((SELECT jsonb_agg(jsonb_build_object('id',h.id,'revision',h.revision,'action',h.action,'feedback',h.feedback,'occurredAt',h.occurred_at) ORDER BY h.occurred_at,h.id)
       FROM (SELECT * FROM private.project_history WHERE project_id=p.id ORDER BY occurred_at DESC,id DESC LIMIT CASE WHEN p_project IS NULL THEN 1 ELSE 100 END) h),'[]') AS history
   FROM private.projects p WHERE (p_review OR p.member_id=p_actor) AND (p_project IS NULL OR p.id=p_project)
     AND (p_status='all' OR p_status='published' AND p.published_content IS NOT NULL OR p.status=p_status)
     AND (p_search='' OR position(lower(p_search) in lower(p.content->'title'->>'en'||' '||coalesce(p.content->'title'->>'ar','')))>0)
   ORDER BY p.updated_at DESC,p.id LIMIT 30 OFFSET p_offset
 ) r;
 IF p_project IS NOT NULL AND total=0 THEN RETURN jsonb_build_object('code','NOT_FOUND'); END IF;
 RETURN jsonb_build_object('code','SUCCESS','projects',rows,'total',total);
END $$;
CREATE FUNCTION private.project_write(p_actor uuid,p_project uuid,p_revision integer,p_operation text,p_content jsonb DEFAULT NULL,p_feedback text DEFAULT NULL,p_attest boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p private.projects%ROWTYPE; c uuid; item jsonb; next_status text; BEGIN
 IF p_operation IN ('create','save','submit') THEN
   IF NOT private.project_member(p_actor) THEN RETURN jsonb_build_object('code','MEMBER_REQUIRED'); END IF;
   -- A concurrent graduation cannot change eligibility partway through a write.
   PERFORM 1 FROM public.members WHERE id=p_actor AND status='member' FOR SHARE;
   IF NOT FOUND THEN RETURN jsonb_build_object('code','MEMBER_REQUIRED'); END IF;
 ELSIF p_operation IN ('start_review','approve','reject','request_changes','publish','unpublish') THEN
   IF NOT private.project_reviewer(p_actor) THEN RETURN jsonb_build_object('code','FORBIDDEN'); END IF;
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
END $$;
CREATE FUNCTION private.project_media_change(p_actor uuid,p_project uuid,p_operation text,p_media uuid,p_key text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p private.projects%ROWTYPE; m private.project_media%ROWTYPE; BEGIN
 IF NOT private.project_member(p_actor) THEN RETURN jsonb_build_object('code','MEMBER_REQUIRED'); END IF;
 PERFORM 1 FROM public.members WHERE id=p_actor AND status='member' FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('code','MEMBER_REQUIRED'); END IF;
 SELECT * INTO p FROM private.projects WHERE id=p_project AND member_id=p_actor FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('code','NOT_FOUND'); END IF;
 IF p.status IN ('submitted','under_review') OR p.status='approved' AND p.published_revision IS DISTINCT FROM p.revision THEN RETURN jsonb_build_object('code','INVALID_TRANSITION'); END IF;
 IF p_operation='add' THEN
   -- Six images per snapshot plus six replacements, so editing a full gallery
   -- never requires taking the approved gallery offline.
   IF (SELECT count(*) FROM private.project_media WHERE project_id=p.id)>=12 THEN RETURN jsonb_build_object('code','MEDIA_LIMIT'); END IF;
   IF NOT coalesce(p_key ~ '^project-images/[0-9a-f-]{36}\.(jpg|png)$',false) THEN RETURN jsonb_build_object('code','VALIDATION_ERROR'); END IF;
   INSERT INTO private.project_media(project_id,object_key) VALUES(p.id,p_key) RETURNING * INTO m;
 ELSIF p_operation='remove' THEN
   IF p.content->'mediaIds' ? p_media::text OR p.published_content->'mediaIds' ? p_media::text THEN RETURN jsonb_build_object('code','MEDIA_IN_USE'); END IF;
   DELETE FROM private.project_media WHERE project_id=p.id AND id=p_media RETURNING * INTO m;
   IF NOT FOUND THEN RETURN jsonb_build_object('code','NOT_FOUND'); END IF;
 ELSE RETURN jsonb_build_object('code','VALIDATION_ERROR'); END IF;
 INSERT INTO private.project_history(project_id,actor_id,revision,action) VALUES(p.id,p_actor,p.revision,CASE p_operation WHEN 'add' THEN 'media_added' ELSE 'media_removed' END);
 RETURN jsonb_build_object('code','SUCCESS','id',m.id,'key',CASE WHEN p_operation='remove' THEN m.object_key END);
END $$;
CREATE FUNCTION private.project_media_key(p_actor uuid,p_project uuid,p_media uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p private.projects%ROWTYPE; BEGIN
 SELECT * INTO p FROM private.projects WHERE id=p_project;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF NOT coalesce(p.published_content->'mediaIds' ? p_media::text,false) THEN
   IF p_actor IS NULL OR NOT (p.member_id=p_actor AND private.project_member(p_actor) OR private.project_reviewer(p_actor)) THEN RETURN NULL; END IF;
 END IF;
 RETURN (SELECT object_key FROM private.project_media WHERE id=p_media AND project_id=p.id);
END $$;
CREATE FUNCTION private.public_projects(p_project uuid DEFAULT NULL,p_offset integer DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE rows jsonb; total integer; empty_text jsonb:=jsonb_build_object('en','','ar',''); BEGIN
 IF p_offset IS NULL OR p_offset<0 OR p_offset>1000000 OR p_project IS NOT NULL AND p_offset<>0 THEN RETURN jsonb_build_object('code','VALIDATION_ERROR'); END IF;
 SELECT count(*) INTO total FROM private.projects WHERE published_content IS NOT NULL AND (p_project IS NULL OR id=p_project);
 SELECT coalesce(jsonb_agg(r),'[]') INTO rows FROM (
   SELECT id,CASE WHEN p_project IS NOT NULL THEN published_content ELSE published_content || jsonb_build_object(
     'problem',empty_text,'solution',empty_text,'nextSteps',empty_text,
     'technicalApproach',jsonb_build_object('overview',empty_text,'decisions','[]'::jsonb),
     'development','[]'::jsonb,'validation','[]'::jsonb,'parts','[]'::jsonb,'links','[]'::jsonb,
     'collaboration',jsonb_build_object('seeking',empty_text,'application',empty_text),
     'achievements',CASE WHEN jsonb_array_length(published_content->'achievements')>0 THEN jsonb_build_array(published_content->'achievements'->0) ELSE '[]'::jsonb END
   ) END AS content,published_revision AS revision FROM private.projects
   WHERE published_content IS NOT NULL AND (p_project IS NULL OR id=p_project)
   ORDER BY created_at DESC,id LIMIT 30 OFFSET p_offset
 ) r;
 RETURN jsonb_build_object('code','SUCCESS','projects',rows,'total',total,'hasMore',p_project IS NULL AND p_offset+jsonb_array_length(rows)<total);
END $$;
DO $$ DECLARE fn regprocedure; BEGIN
 FOR fn IN SELECT oid::regprocedure FROM pg_proc WHERE pronamespace='private'::regnamespace
 AND proname IN ('project_member','project_reviewer','project_content_valid','project_read','project_write','project_media_change','project_media_key','public_projects') LOOP
   EXECUTE format('ALTER FUNCTION %s OWNER TO uc02_routine_owner',fn);
   EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,app_maintenance,service_role,app_runtime',fn);
   IF split_part(fn::text,'(',1) NOT IN ('private.project_member','private.project_reviewer','private.project_content_valid') THEN
     EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO app_runtime',fn);
   END IF;
 END LOOP;
END $$;
