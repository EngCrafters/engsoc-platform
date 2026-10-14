import type { SocialPlatform } from "@/content/social";

/**
 * Recognisable platform glyphs on the site's 24-unit icon grid, drawn to share its 1.5
 * stroke. They identify a platform next to its visible name; they are never used alone.
 */
const GLYPHS: Record<SocialPlatform, React.ReactNode> = {
  instagram: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.2" cy="6.8" r="0.4" fill="currentColor" />
    </>
  ),
  x: (
    <>
      <path d="M4.6 4.5h3.9l10.9 15h-3.9z" fill="currentColor" stroke="none" />
      <path d="M19.2 4.5l-6.2 6.9M10.9 13.4l-6.1 6.1" />
    </>
  ),
  linkedin: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
      <path d="M8.2 10.4V16.5M8.2 7.6v.01M11.8 16.5v-6.1M11.8 13c0-1.6 1-2.6 2.4-2.6s2.3 1 2.3 2.6v3.5" />
    </>
  ),
  youtube: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="3.6" />
      <path d="M10.2 9.4l4.6 2.6-4.6 2.6z" fill="currentColor" />
    </>
  ),
  tiktok: (
    <path d="M13.8 4v10.6a3.4 3.4 0 1 1-3.4-3.4M13.8 4c.4 2.3 2 3.9 4.4 4.2" />
  ),
};

export function SocialIcon({
  platform,
  className,
}: {
  platform: SocialPlatform;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {GLYPHS[platform]}
    </svg>
  );
}
