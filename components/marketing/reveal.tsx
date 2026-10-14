"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";

/**
 * A single reveal recipe, used sparingly.
 *
 * Content is rendered plainly on the server and on first paint, so the page is
 * fully readable with no JavaScript. The animation is only armed for elements
 * that are still below the fold when the client takes over — there is nothing
 * to flash, and nothing can end up stuck invisible.
 *
 * Reduced motion opts out entirely.
 */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (reduced) return;
    const element = ref.current;
    if (!element) return;
    const { top } = element.getBoundingClientRect();
    if (top < window.innerHeight * 0.9) return;
    setArmed(true);
  }, [reduced]);

  if (!armed) {
    return (
      <div ref={ref} className={className}>
        {children}
      </div>
    );
  }

  return (
    <motion.div
      ref={ref}
      className={className}
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-8% 0px -8% 0px" }}
      transition={{ duration: 0.6, delay, ease: [0.23, 1, 0.32, 1] }}
    >
      {children}
    </motion.div>
  );
}
