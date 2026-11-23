# verification

SQU student verification, leadership requests and appointments, and their settings (ADR 0025,
migration `0033_membership_verification_leadership`). Since ADR 0026 (migration
`0034_committee_leadership`) a request or appointment belongs to a committee, and to a team only for
team leadership (`team: null`, `level: "committee"`), and a switch (`setLeadershipRequestsOpen`,
Board Administration or Technical) opens or closes new requests. Teams and committee leaders are
managed through `lib/administration/teams.ts`.

Every read and write goes through the fixed `private.*` routines of migration 0033 over the
restricted `app_runtime` connection. Those routines own:

- who may act: verification and leadership reviewers (Board Administration and Society Affairs,
  never Technical by its access alone), senior administrators for teams (Board and Technical),
  Technical for settings, or the member themself;
- state transitions, self-review refusal and the occupancy and per-member limits;
- the organization lock that serializes structure changes and appointment decisions;
- audit rows, and the member-facing payloads that leave out reviewer notes and full student
  numbers.

This module validates transport shapes, moves evidence to and from Storage, and maps result codes
to wording. It never decides who may do what.

- `db.ts`: one function per routine. The actor is always the verified identity.
- `member.ts` (server-only): the member's own SQU verification (`ownSquVerification`) and committee
  leadership (`ownLeadership`), loaded by separate routines so one failing never hides the other; SQU evidence submission
  (begin → upload under `squ-verification/` → submit, ADR 0018's order) and leadership requests.
  Used by `app/v1/me/verification/**` and `app/v1/me/leadership/**`.
- `review.ts` (server-only): reviewer lists, details, decisions, revocations, the evidence read
  (size and SHA-256 checked), the retention cleanup (does nothing until Technical sets a period)
  and the settings. Used by `app/admin/(protected)/membership/**`.
- `labels.ts`: dashboard wording for states and result codes.
- `types.ts`: the payload shapes the routines return.

The five concepts stay separate: an appointment never writes `administrative_access`, a
verification never changes membership, and membership never verifies anyone.
