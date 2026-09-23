/**
 * Shared Motion presets. Durations stay in the 150–300ms band; distances
 * stay small. See CLAUDE.md-referenced M6 brief "Animation / Motion".
 */
export const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1];
export const EASE_IN_OUT: [number, number, number, number] = [0.65, 0, 0.35, 1];

export const fadeUp = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 8 },
};

export const listStagger = {
  animate: {
    transition: { staggerChildren: 0.035, delayChildren: 0.02 },
  },
};

export const listItem = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.22, ease: EASE_OUT } },
};

export const tapScale = { scale: 0.97 };
