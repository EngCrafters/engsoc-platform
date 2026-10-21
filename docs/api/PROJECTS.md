# Member Projects

ADR 0021 and migration `0029_member_projects` define this extension. Page flags
are static and exist only in ESWebsite's `config/site-features.json` (ADR 0023),
which `content/site.ts` reads; no visibility API, database settings, or dashboard
controls are provided.

Public no-store reads: `GET /v1/projects?offset=0` and `GET /v1/projects/{id}` return
`{data:{code:"SUCCESS",projects:[{id,revision,content}],total,hasMore}}`. Catalogue
pages contain 30 card projections, excluding long stories; the detail route
returns the full published snapshot. Missing detail IDs return 404. `content` matches the
existing Projects design; the strict contract is `lib/projects/content.ts`.
The website never substitutes the sample catalogue for unavailable Core data.

Member routes reuse verified Supabase Bearer tokens, exact-origin CORS and
credential-free requests. No body field can select the author or grant approval.
List responses include the latest history entry per project; detail responses
include the latest 100 entries and `historyTotal`. Full audit history is retained.
Six images may be selected for each revision. Up to 12 stored assets allow a
full six-image published gallery to stay online while replacements are reviewed.

| Route                                       | Input                                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------- |
| GET `/v1/me/projects`                       | optional `offset`, 30 records per page                                    |
| POST `/v1/me/projects`                      | `{operation:"create",content}`                                            |
| GET `/v1/me/projects/{id}`                  | own record with uploaded media and review history                         |
| PATCH `/v1/me/projects/{id}`                | `{operation:"save",revision,content}` or `{operation:"submit",revision}`  |
| POST `/v1/me/projects/{id}/media`           | raw JPEG/PNG body, at most 3 MiB                                          |
| DELETE `/v1/me/projects/{id}/media/{media}` | only assets absent from working/published snapshots                       |
| GET `/v1/projects/{id}/media/{media}`       | public if in the published snapshot; otherwise own-member/reviewer Bearer |

Successful writes return `{data:{code:"SUCCESS",id,revision}}` (media writes
return the media ID). Validation uses 422; ownership/missing IDs use 404;
wrong role/nonmember/self-review uses 403; stale revision/invalid transition
uses 409; dependency failure uses 503. `errors[0].code` identifies the precise
domain result. All private responses and media are no-store.

Drafts are editable. Submission freezes the revision in `submitted`. A scoped
reviewer explicitly starts `under_review`, then approves, rejects or requests
changes. Negative decisions require feedback; approval requires no-conflict
attestation and rejects the author/linked contributors. Publication is separate
and requires the currently approved revision. Editing a published revision starts
a new draft, preserving its previous public snapshot until approval/publication.
Private review history supplies in-account decision notifications; no new email
provider or external messaging behavior is introduced.

Review is restricted to the existing Society Affairs committee manager or
Board/Technical. Raw anon/authenticated roles cannot access these private tables
or execute actor-parameter routines. Existing membership/Auth behavior is reused.

After approval, apply unchanged 0027/0028 dependencies and reviewed 0029 to the
intended environment; provision a separate private `SUPABASE_S3_PROJECT_BUCKET`
using the existing S3 credentials. Never reuse membership/event buckets. Verify
the restricted `app_runtime` URL, matching Auth project and allowed website
origin. No hosted migrations or data mutations are authorized by implementation.
