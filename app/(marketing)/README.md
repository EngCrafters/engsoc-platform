# Public site (`app/(marketing)/`)

The visitor-facing surface: the landing page, the event catalogue, event detail
and anonymous registration. It is part of the same application and the same
data model as the committee dashboard — not a separate site.

## What lives here

| Route          | Purpose                                                                                                         |
| -------------- | --------------------------------------------------------------------------------------------------------------- |
| `/`            | Landing: hero, society figures, overview, upcoming events, programmes, projects, disciplines, leadership, join. |
| `/events`      | The full catalogue, upcoming or past, cursor-paginated.                                                         |
| `/events/[id]` | One event and its registration form.                                                                            |
| `/about`       | The society, its figures and its structure.                                                                     |
| `/activities`  | The archive of previous editions.                                                                               |

## Rules this route group follows

- **Events come from the database.** `lib/events` (`getPublicEventPage`,
  `getPublicEvent`) is the only source. There is no sample event data in this
  repository. `lib/marketing/adapters.ts` is the single translation point from
  the canonical `PublicEvent` DTO to presentation, and it never widens the DTO.
- **Registration uses the canonical Server Action.** `actions.ts` adapts a form
  submission into `lib/registrations`, which calls
  `private.register_for_event` over the restricted `app_runtime` connection.
  Duplicate prevention, capacity, the FIFO waitlist, the IP rate limit and the
  audit row all live in the database routine and are not reimplemented here.
- **No API route.** Mutations are Server Actions. If a feature genuinely needs a
  public HTTP endpoint, that is a new conversation, not a default.
- **No direct Supabase reads from the browser.** The public catalogue is read
  server-side through the restricted runtime role, exactly like the admin area.
- **Presentation only is themed.** `marketing.css` scopes its tokens to
  `.marketing-surface`, so the public identity cannot leak into authenticated
  screens.

## Presentation content

`content/` holds presentation content with no database backing yet: the society
overview, its six programmes, the project-archive preview, the discipline list,
the structure, and the figures strip. Every unverified value carries a
machine-readable flag (`demo`, `sample`, `descriptionStatus`) that renders a
visible label, so a reader can always tell what is confirmed.

Events are deliberately **not** in `content/`: they are canonical database rows.

## Language

English and Arabic, resolved on the server from the `es-locale` cookie, so a
returning Arabic visitor receives Arabic, right-to-left HTML with no flash.
Interface copy lives in `lib/i18n/dictionaries`; content carries its own
`{ en, ar }` fields. The Arabic dictionary is typed against the English one, so
an untranslated string fails the build.

Direction is applied to this subtree rather than to `<html>`, because the admin
area is English-only and must not inherit a visitor's public language choice.
