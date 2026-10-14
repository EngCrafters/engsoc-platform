import type { Localized } from "@/lib/i18n";

/**
 * The society's social accounts — the single place to configure them.
 *
 * No verified account URLs exist in the project yet (Draft 1's footer used empty `#` links),
 * so every `url` is null. Paste the full profile URL for each account the society actually
 * runs, for example 'https://www.instagram.com/<handle>/'.
 *
 * - `primary` accounts (Instagram, LinkedIn) always appear in the footer. Without a URL they
 *   are shown unlinked, marked "Link to come", so nothing points to a guessed address.
 * - Other accounts appear only once they have a valid URL.
 *
 * URLs are validated: they must be https, on the platform's own domain, and point to a
 * profile path — a bare platform homepage is rejected.
 */

export type SocialPlatform =
  "instagram" | "x" | "linkedin" | "youtube" | "tiktok";

export interface SocialAccount {
  platform: SocialPlatform;
  /** Platform name shown beside the icon. */
  label: Localized;
  url: string | null;
  primary?: boolean;
}

export const SOCIAL_ACCOUNTS: SocialAccount[] = [
  {
    platform: "instagram",
    label: { en: "Instagram", ar: "إنستغرام" },
    url: null,
    primary: true,
  },
  {
    platform: "linkedin",
    label: { en: "LinkedIn", ar: "لينكدإن" },
    url: null,
    primary: true,
  },
  { platform: "x", label: { en: "X", ar: "إكس" }, url: null },
  { platform: "youtube", label: { en: "YouTube", ar: "يوتيوب" }, url: null },
  { platform: "tiktok", label: { en: "TikTok", ar: "تيك توك" }, url: null },
];

const PLATFORM_HOSTS: Record<SocialPlatform, string[]> = {
  instagram: ["instagram.com"],
  x: ["x.com", "twitter.com"],
  linkedin: ["linkedin.com"],
  youtube: ["youtube.com"],
  tiktok: ["tiktok.com"],
};

export function isValidProfileUrl(
  platform: SocialPlatform,
  url: string | null
): url is string {
  if (!url) return false;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const onPlatform = PLATFORM_HOSTS[platform].some(
      (h) => host === h || host.endsWith(`.${h}`)
    );
    const hasProfilePath = u.pathname.replace(/\/+$/, "").length > 1;
    return u.protocol === "https:" && onPlatform && hasProfilePath;
  } catch {
    return false;
  }
}

/**
 * What the footer shows: every primary account (linked when its URL is valid) plus any other
 * account with a valid URL. `href` is null for an account still waiting for its URL.
 */
export const FOOTER_SOCIAL_ACCOUNTS = SOCIAL_ACCOUNTS.flatMap((a) => {
  const href = isValidProfileUrl(a.platform, a.url) ? a.url : null;
  return href || a.primary ? [{ ...a, href }] : [];
});
