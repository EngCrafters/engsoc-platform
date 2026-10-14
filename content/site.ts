import type { Localized } from "@/lib/i18n";

/**
 * Site-wide wiring. Anything marked `null` has no verified destination yet; components hide or
 * downgrade the related UI instead of rendering a broken link. The society's name, tagline and
 * description are interface copy and live in lib/i18n/dictionaries.
 */

/** Homepage sections that appear in the navbar, in page order. Labels: `t.nav.links[id]`. */
export const SECTION_LINKS = [
  { id: "events" },
  { id: "activities" },
  { id: "projects" },
  { id: "disciplines" },
] as const;

export type SectionId = (typeof SECTION_LINKS)[number]["id"];

/** Separate pages reachable from the navbar. */
export const PAGE_LINKS = [{ href: "/about", id: "about" }] as const;

/** On the homepage a section link is a plain fragment; elsewhere it returns to the homepage. */
export function sectionHref(id: string, onHome: boolean) {
  return onHome ? `#${id}` : `/#${id}`;
}

export const SITE = {
  /**
   * Membership registration (PRD UC-01) is not built yet. While this is null, the
   * "Join the Society" actions lead to the #join invitation and a clearly labelled
   * preview dialog. Set it to the real route (for example '/join') once it exists.
   */
  membershipUrl: null as string | null,

  /**
   * The platform's real sign-in. This is the committee administration area that
   * engsoc-platform already owns — not a member account, which UC-01 will add.
   */
  signInUrl: "/admin/login" as string | null,

  /**
   * Draft 1 used an invented email address. Only add entries here once the society
   * confirms them; the footer renders nothing otherwise.
   */
  contact: [] as { label: Localized; href: string }[],
} as const;
