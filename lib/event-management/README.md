Event enhancements follow ADR 0020 and unapplied migration 0028 (after 0027).
`server.ts` calls scoped private routines; `images.ts` uses the existing S3 signer
and a separate private `SUPABASE_S3_EVENT_BUCKET`. `PUBLIC_WEBSITE_ORIGIN` selects
the QR destination (default https://essqu.com). Phone values never enter public
DTOs, audit payloads or attendance exports. Runtime needs `app_runtime`, not postgres.
