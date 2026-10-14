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

  // There is deliberately no admin sign-in entry here.
  //
  // The committee administration area still exists at /admin/login and is still
  // protected by the platform's Auth architecture — nothing about that changed.
  // What changed is that the public site no longer advertises it: an
  // administration entry point is not a public destination, and a public link
  // to it invites exactly the traffic the sign-in page then has to refuse.
  // Administrators reach it by navigating directly, and a redirect sends any
  // signed-out visitor who lands on a protected page there.
  //
  // This is discoverability, not authorization. Removing the link protects
  // nothing on its own; the route's own guards do that.

  /**
   * Draft 1 used an invented email address. Only add entries here once the society
   * confirms them; the footer renders nothing otherwise.
   */
  contact: [] as { label: Localized; href: string }[],
} as const;
