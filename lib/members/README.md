# Member profiles

ADR 0023 owns the contract; migration 0031 supplies every read, write, audit row and
authorization check. `profile.ts` calls the restricted routines and reads Core's feature
switches (`MEMBER_PROFILE_EDITING`, `MEMBER_PHOTO_UPLOADS`). `photos.ts` checks, re-encodes and
stores photos in the private member-photo bucket.

The `/v1/me/profile*` and `/v1/me/events` handlers take the member from the verified Supabase
token alone. Verified-field corrections are decided on the dashboard's membership page by the
0025 membership reviewers. No direct table access or second account system is introduced.
