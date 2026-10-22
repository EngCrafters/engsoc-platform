# Administration

ADR 0024 owns the contract; migration 0032 holds every rule. `server.ts` calls the restricted
routines with the verified actor and nothing else. `access.ts` is the page and action gate, which
mirrors the database's Board/Technical check. `messages.ts` and `labels.ts` are display text only.

Permanent deletion always previews first, then deletes in one transaction. Storage files go
through the existing deletion queue (`processMembershipStorageDeletions`). Account erasure removes
the database references first, then the Supabase Auth identity (`lib/auth/admin.ts`), and closes
the erasure only after the database confirms the identity is gone. A failed Auth step stays pending
and can be retried from the Administration overview.
