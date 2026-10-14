# Migration Architecture — target state

## Decision: one production application

`engsoc-platform` remains the single deployable. The migrated public experience
lives inside it, in the existing `app/(marketing)/` route group.

No second frontend, no separate public repository, no runtime dependency on the
upstream repository, no HTTP boundary between the public pages and the data.
A separate deployment was considered and rejected: the public pages need the
same domain objects, the same restricted database role and the same rendering
runtime as the rest of the application, so an API boundary would add a failure
mode, a latency hop and a second place for the data contract to drift, in
exchange for nothing.

```
engsoc-platform
├── canonical Auth                    lib/auth/*, proxy.ts, app/auth/*
├── canonical authorization           administrative_access + private.* routines
├── canonical DB / RLS / grants       db/**, app_runtime, uc02_routine_owner
├── canonical event domain            lib/events
├── canonical registration domain     lib/registrations
├── canonical admin                   app/admin/**
└── migrated public experience        app/(marketing)/**
      ├── shell                        site-header, site-footer, i18n-provider
      ├── landing                      hero, figures, overview, events, programmes,
      │                                projects, disciplines, leadership, join
      ├── catalogue                    /events
      ├── event detail + registration  /events/[id]
      ├── society pages                /about, /activities
      └── shared presentation          components/marketing/*, content/*, lib/i18n
```

## Data ownership

Exactly one source of truth per domain, unchanged by this migration:

| Domain                                                                                                               | Owner                                                    |
| -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Auth identities                                                                                                      | Supabase Auth                                            |
| Administrative authorization                                                                                         | `public.administrative_access`                           |
| Committees                                                                                                           | canonical database                                       |
| Events                                                                                                               | canonical database                                       |
| Registrations                                                                                                        | canonical database                                       |
| Event lifecycle, waitlist, capacity                                                                                  | canonical `private.*` routines                           |
| Audit                                                                                                                | `private.uc02_audit`                                     |
| Presentation content with no domain backing (overview, programmes, project preview, disciplines, structure, figures) | `content/*` in this repository, flagged where unverified |

The upstream repository supplied **no** persistence and had **no** database, so
no persistence was imported. Its `content/events.ts` — a static event list — was
deliberately discarded, because a static event list beside a real events table is
two sources for one fact.

## Adapter: the one translation seam

```
private.list_public_events / get_public_event   (canonical, in the database)
        │
        ▼
PublicEvent                                     (lib/events — narrow, safe DTO)
        │
        ▼  toMarketingEventCard(event, t, intl)
MarketingEventCardModel                         (lib/marketing/adapters.ts)
        │
        ▼
EventCard                                       (components/marketing)
```

The adapter is typed, deterministic, and contains no authorization decision and
no persistence. It cannot widen the DTO: `status`, `capacity`, counts,
`revision` and `committeeId` are not present on `PublicEvent` and are not
invented. Event dates are formatted for the active language but always in
`Asia/Muscat`, matching the rule the platform already applies.

## Presentation consolidation

The canonical stack is Tailwind v4 + shadcn/ui + Radix + Lucide + Geist +
semantic tokens. The upstream stack was hand-written CSS Modules with a different
palette, type scale and font set.

Carrying both would leave two styling systems in one application. The migration
therefore **re-expressed the upstream presentation in the canonical system**
while keeping the upstream _identity_:

| Upstream identity                                           | How it is preserved                                                             |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Warm ivory paper, cobalt brand, navy bands, one gold accent | `--m-*` custom properties in `app/(marketing)/marketing.css`                    |
| Space Grotesk display, Manrope body, IBM Plex Sans Arabic   | Loaded in the marketing layout only, so the admin shell keeps Geist             |
| The "leaf" corner (`50% 50% 50% 0`)                         | Used for discipline tiles and vacant portraits                                  |
| Technical drawings for imagery                              | Carried over unchanged, with their class set scoped in the marketing stylesheet |
| Section rhythm and the fluid type scale                     | Reproduced with the same clamp values                                           |
| One motion vocabulary, nine reveal recipes                  | One `Reveal` component on `motion`, disarmed below the fold                     |

**Containment rules.** The public palette is scoped to `.marketing-surface`, and
language plus direction are applied to that subtree rather than to `<html>`. The
admin area is English-only, left-to-right, and keeps its own tokens and fonts. It
is not restyled by this migration in any way.

## Deliberate exclusions

| Excluded                                  | Reason                                                                                                                                                                                                                                                                  |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GSAP and `@gsap/react`                    | ADR 0011 removed GSAP from this repository on purpose, and it was in the upstream root provider, so it reached every page. The canonical `motion` library covers the same ground.                                                                                       |
| `@react-three/fiber`, `@react-three/drei` | New renderer and scene-graph dependencies for one decorative element on the public entry route.                                                                                                                                                                         |
| The live WebGL hero sculpture             | Deferred, not rejected. The three prepared stills already carry the identity at first paint for every visitor, and they are what most visitors see anyway. Re-adding the scene is a self-contained change behind a lazy boundary and needs an ADR for the dependencies. |
| The layered canvas light field            | Continuous canvas animation on a content page is not worth its cost.                                                                                                                                                                                                    |
| CSS Modules                               | Would create a second styling system.                                                                                                                                                                                                                                   |
| The preview-dialog pattern                | A button that opens a dialog saying nothing was submitted is wrong in an application that really registers people.                                                                                                                                                      |
| `CustomEvent` cross-component state       | Does not survive a real router; replaced with local state on the single consumer.                                                                                                                                                                                       |
| Shipping both dictionaries to the client  | A known upstream weakness; the canonical provider receives the active locale from the server.                                                                                                                                                                           |

## Security model: unchanged

This migration changes **no** authorization behaviour, and that is the point.
Specifically untouched:

- `app_runtime` still holds no direct table grant; every read and write still
  goes through a `private.*` routine.
- RLS remains enabled and forced on every exposed table.
- `administrative_access` remains the only authorization source.
- Registration still goes through `private.register_for_event` via the canonical
  Server Action.
- The CSV export's same-origin check and the Auth callback's allow-list are
  untouched.
- The public site gained no new browser-side database access. It reads
  server-side through the restricted runtime role, exactly as before.

The migrated public surface is **presentation**. It is not, and must not become,
an authorization boundary.

## Rendering and caching

Public routes are `force-dynamic` because the locale is resolved from a cookie on
the server. This is a deliberate, contained trade-off: it is what lets a
returning Arabic visitor receive Arabic, right-to-left HTML with no flash. The
catalogue is cursor-paginated and the data fetching is one routine call per page,
so the cost is bounded.
