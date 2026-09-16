# Current work — handoff state

Keep this short. Update only at milestone/checkpoint transitions. See
`docs/UC-02_Acceptance_and_Delivery.md` for full evidence, `docs/UC-02_Deep_Dive.md`
for behavior spec.

**CURRENT MILESTONE:** UC-02, M5 (Admin identity and scope) — not started.

**CURRENT STATUS:** M1–M4 complete and delivered. M4 closed with a full
deterministic Playwright E2E suite (`tests/e2e/`) plus three real bugs it
found and fixed (broken UUID regex in `lib/events`, an invalid `"use server"`
export crashing registration in production builds, and an unconditional-TLS
bug breaking local/test databases).

**LAST DELIVERED COMMIT:** (fill in after the M4 commit lands — see `git log
--oneline -1`).

**COMPLETED IN M4:** public event list + `/events/[id]` detail, cursor
pagination, Asia/Muscat formatting, accessible registration/waitlist form,
narrow `private.list_public_events`/`private.get_public_event` read routines
(migration `0007`), full E2E matrix (catalog/detail/registration/waitlist/
pagination/draft-denial × desktop/mobile), production-build E2E harness.

**REMAINING (M5+):** Admin identity and scope — read
`docs/UC-02_Acceptance_and_Delivery.md`'s M5 row and `docs/UC-02_Deep_Dive.md`
section 5 before starting. Do not re-read M1–M4 material to get there.

**KNOWN BLOCKERS:** none currently. M5 needs configured Supabase Auth and at
least one named test manager per its milestone prerequisites — confirm both
exist before writing admin routes.

**NEXT EXACT TASK:** Read only the M5 milestone definition, confirm Auth is
configured and a test manager grant exists (or provision one), then implement
per-request auth verification and the deny-unassigned-user path.
