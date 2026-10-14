import type { StatIcon as StatIconId } from "@/content/stats";

/**
 * Line icons for the society figures, on the site's 24-unit grid and 1.5 stroke. Every stroke
 * has pathLength 1 so the strip can draw them in uniformly as the figures arrive.
 */
const GLYPHS: Record<StatIconId, React.ReactNode> = {
  // Two members, one ahead of the other.
  members: (
    <>
      <circle cx="9" cy="8.5" r="3.1" pathLength={1} />
      <path d="M3.5 19.5c.9-3.2 3-4.9 5.5-4.9s4.6 1.7 5.5 4.9" pathLength={1} />
      <path
        d="M15.4 5.7a3.1 3.1 0 010 5.6M17.2 14.8c1.6.6 2.7 2.1 3.3 4.7"
        pathLength={1}
      />
    </>
  ),
  // A browser window with a pointer arriving.
  visitors: (
    <>
      <path
        d="M20.5 11V6.2a1.7 1.7 0 00-1.7-1.7H5.2a1.7 1.7 0 00-1.7 1.7v10.6a1.7 1.7 0 001.7 1.7H11"
        pathLength={1}
      />
      <path d="M3.5 8.5h17" pathLength={1} />
      <path d="M14 13.2l6.4 2.4-2.8 1.1-1.1 2.8z" pathLength={1} />
    </>
  ),
  // An isometric block: something built.
  projects: (
    <>
      <path d="M12 3.5l7.5 4.2v8.6L12 20.5l-7.5-4.2V7.7z" pathLength={1} />
      <path d="M4.5 7.7L12 12l7.5-4.3M12 12v8.5" pathLength={1} />
    </>
  ),
  events: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.4" pathLength={1} />
      <path d="M3.5 9.8h17M8 3v3.6M16 3v3.6" pathLength={1} />
      <path d="M8.2 14.2h2.6v2.6H8.2z" pathLength={1} />
    </>
  ),
};

export function StatIcon({
  id,
  className,
}: {
  id: StatIconId;
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
      {GLYPHS[id]}
    </svg>
  );
}
