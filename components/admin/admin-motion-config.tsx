"use client";

import type { ReactNode } from "react";
import { MotionConfig } from "motion/react";

/** Ensures every Motion component in the admin workspace drops movement when requested. */
export function AdminMotionConfig({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
