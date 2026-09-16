-- Main never received the staging-only 0002 RLS migration. Enable and force
-- RLS on every existing public domain table so the policies/grants installed
-- by 0004 are effective there too. Tables without a policy remain default
-- deny; this is intentional for deferred use cases.

ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.members FORCE ROW LEVEL SECURITY;
ALTER TABLE public.committees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.committees FORCE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registrations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.certificates FORCE ROW LEVEL SECURITY;
ALTER TABLE public.archive_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.archive_items FORCE ROW LEVEL SECURITY;
ALTER TABLE public.mentorship_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mentorship_connections FORCE ROW LEVEL SECURITY;
ALTER TABLE public.registration_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registration_attempts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.committee_managers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.committee_managers FORCE ROW LEVEL SECURITY;
ALTER TABLE private.uc02_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.uc02_audit FORCE ROW LEVEL SECURITY;
