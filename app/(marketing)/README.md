# app/(marketing)

The current inline list/form is a partial implementation. The target
list/detail/waitlist UX and specification gate are in
`docs/UC-02_Deep_Dive.md` and its companion contracts.

The public marketing site — UC-02's landing page and registration flow.
A route group, so `(marketing)` doesn't appear in the URL: `page.tsx` here
is the site's `/`.

- `layout.tsx` — public-facing chrome only (a plain header, no internal
  nav). Nests inside the root `app/layout.tsx`. Kept separate so a future
  internal/admin layout (see CLAUDE.md's admin dashboard scope) never
  shares this one.
- `page.tsx` — the landing page. A Server Component that imports
  `getPublishedEvents` from `lib/events` directly and renders the list.
  No `fetch()`, no API route — that's the reason this lives in the same
  repo as the rest of the app instead of a separate one.
- `registration-form.tsx` — client component, posts straight to the
  Server Action below.
- `actions.ts` — the registration Server Action. Thin on purpose: it reads
  the request's IP from headers and adapts `FormData` into the shape
  `lib/registrations`' `registerForEvent` expects. The actual rules
  (validation, rate limiting, event-status checks) live in that module,
  not here — see `lib/registrations/README.md`.

There is no API route in this folder and none should be added here. If a
feature genuinely needs a public HTTP endpoint, that's a new conversation,
not a default.
