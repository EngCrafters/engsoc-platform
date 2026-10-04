# Design system

Source of truth for tokens, components, and motion across the platform. See
`docs/adr/0011-dashboard-ui-refactor.md` for why the visual language changed
and what it replaced. New UI should consume this, not introduce ad-hoc colors,
shadows, or layouts.

## Principles

- **Monochrome.** Black, white, and neutral grays only. Hierarchy comes from
  contrast, weight, borders, and spacing, never hue. The one exception is
  `destructive` for errors and destructive actions.
- **Tokens, not literals.** Every color, radius, and motion value comes from a
  named token (`app/globals.css`, `lib/motion/variants.ts`) or a component
  variant.
- **Borders over shadows.** Surfaces are separated by thin borders. Shadows
  appear only on floating layers (dialog, sheet, dropdown, popover).
- **Fewer cards.** Prefer sections, rules, rows, tables and tabs. Use `Card`
  for metrics and genuinely isolated summaries; never nest cards.
- **Status is never color alone.** A status pairs an icon with text and
  differs by fill, border style and weight (see `EventStatusBadge`).
- **shadcn first.** Use the installed shadcn components (`Sidebar`, `Tabs`,
  `Table`, `Dialog`, `Sheet`, `ToggleGroup`, `Breadcrumb`...) before custom
  markup.

## Tokens

Defined in `app/globals.css` (`:root` / `.dark`) and mapped into Tailwind via
`@theme inline`. All core tokens (`background`, `foreground`, `card`,
`popover`, `surface`, `secondary`, `muted`, `border`, `input`, `primary`,
`accent`, `sidebar-*`) have zero chroma.

- Light: white page, near-white sidebar, light gray muted surfaces, near-black
  text, light neutral borders.
- Dark: near-black page and sidebar, slightly raised graphite surfaces, white
  text, translucent white borders.
- `success`/`warning`/`full`/`quiet` tokens still exist in the CSS but are not
  used by application components; do not add new uses.

## Typography

Geist (variable) via `next/font/google`, aliased to `font-sans`/`font-heading`.

| Role              | Size / weight                            |
| ----------------- | ---------------------------------------- |
| Page title        | `text-3xl` (about 30px) / 600            |
| Section title     | `text-lg` / 600                          |
| Group / row title | `text-sm`–`text-base` / 500–600          |
| Body              | `text-sm` / 400                          |
| Label             | `text-sm` / 500                          |
| Metadata          | `text-xs` / 400, `text-muted-foreground` |
| Metric            | `text-3xl` / 600, `tabular-nums`         |

Use `tabular-nums` for counts, capacity, and any figure in a column.

## Layout

- **Admin shell** (`components/admin/admin-shell.tsx`): shadcn dashboard-01
  structure. `SidebarProvider` with `--sidebar-width` 18rem and
  `--header-height` 3rem, an inset `AdminSidebar`, `SidebarInset`, and
  `AdminHeader` (sidebar trigger, breadcrumb, theme toggle). Content sits in a
  `max-w-7xl` column with 16px gutters on mobile and 24px on large screens.
  On mobile the sidebar is the shadcn `Sheet` and closes after navigation.
- **Page header** (`AdminPageHeader`): title, one-line description, optional
  context row (status, committee) and the page's primary action on the right.
- **Page order:** header, summary, tabs/filters, main content, pagination.
- **Tabs** organise meaningful content (event Details/Lifecycle, account
  Profile/Permissions/Security, status filters). Panels that hold forms stay
  mounted so edits survive a tab switch.
- **Lists** are shadcn `Table` inside a bordered, rounded container, with
  secondary columns hidden on small screens and their content folded under the
  title.
- **Forms** use `EventFormSection`: a title and description beside a group of
  fields, sections separated by rules; a bordered Status panel with the primary
  save action beside them on wide screens.
- **Settings** (`components/settings-dialog.tsx`): shadcn sidebar-13 pattern in
  a `Dialog` (full screen on mobile). Rows are `SettingRow` (title and help on
  the left, control on the right, stacking by container width).
- **Auth** (`components/auth/*`): one centered card over a decorative `Starfield`
  galaxy (rotating band, glowing core, twinkling and glinting stars, an occasional
  shooting star). The screen is always dark whatever the site theme; the canvas is
  still under reduced motion. No other effects.

## Components

- **Buttons:** `default` (black in light, white in dark) is the single primary
  action; `outline` for secondary; `ghost` for navigation and low priority;
  `destructive` only for truly destructive steps. Icons use `data-icon`.
- **Badge:** `default`, `secondary`, `outline`, `ghost`, `destructive` only.
- **Forms:** `FormField`, `FormDescription`, `FormMessage`, `FormActions`
  (`components/ui/form-field.tsx`), driven by `useActionState`. Controls are
  40px (`h-10`) in forms for touch comfort.
- **Feedback:** `Alert` for callouts, `StatePanel` (via `EmptyState` /
  `ErrorState`) for empty and error pages, `MessageBanner` for form results,
  `sonner` toasts for saves. `Spinner` and `Skeleton` for loading.
- **Brand mark:** `BrandMark` renders `public/brand/engineering-society-logo.png`,
  the only colored asset.

## Preferences and theming

`next-themes` (`attribute="class"`, `defaultTheme="system"`). Settings >
Appearance offers Light / Dark / System, Density (comfortable or compact table
rows) and Motion (enabled or reduced). Density and motion live in this
browser's localStorage only (`components/admin/preferences.tsx`) and are
applied as `data-density` / `data-motion` on the shell. `ThemeToggle` in the
header and auth screens switches light/dark in one click.

## Motion

`lib/motion/variants.ts` is the single source for easing and duration
(`DURATION.fast|normal|slow`, `EASE_OUT`). Motion is limited to short feedback:
alerts, dialogs, sheets, tab and sidebar state. No decorative animation in data
tables. `AdminPreferencesProvider` wraps the shell in `MotionConfig`, honoring
the OS reduced-motion setting and the in-app Motion preference.

## Layout stability

`html` sets `overflow-y: auto; scrollbar-gutter: stable;`. Keep it: without a
reserved gutter, opening a Radix menu or changing `color-scheme` shifts the page
by the scrollbar width.

## Accessibility

- Semantic landmarks, visible focus rings, labeled controls.
- Dialogs, sheets and menus use Radix primitives for focus trapping and return.
- Status uses icon plus text; motion respects `prefers-reduced-motion`.

## Dev-only reference

`app/dev/design-system` renders a live showcase of typography, buttons, status
badges, forms and feedback states. It 404s whenever `NODE_ENV === "production"`.
