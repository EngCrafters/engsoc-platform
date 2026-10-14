"use client";

import { getImageProps } from "next/image";
import {
  motion,
  useReducedMotion,
  useScroll,
  useTransform,
} from "motion/react";
import { useRef } from "react";

const STILL_SIZE = 1280;
const SIZES = "(min-width: 64rem) 55vw, 100vw";

/**
 * The hero emblem.
 *
 * The society's four-part mark, rendered as three prepared stills of the
 * sculpture: the separated opening pose on desktop, the compact pose on phones
 * and tablets, and the assembled mark when the visitor prefers reduced motion.
 * Only the matching <source> is fetched, so a phone never pays for the desktop
 * image.
 *
 * The live WebGL sculpture that produced these stills is not part of this
 * migration: it would add a renderer, a scene-graph library and a scroll
 * animation engine to the public entry bundle. The stills are what every
 * visitor sees first, so the identity is intact and the weight is not. See
 * docs/MIGRATION_SOURCE_MAP.md.
 */
function StillPicture({ className }: { className: string }) {
  const common = {
    alt: "",
    width: STILL_SIZE,
    height: STILL_SIZE,
    sizes: SIZES,
    loading: "eager" as const,
  };
  const assembled = getImageProps({
    ...common,
    src: "/hero/emblem-assembled.webp",
    fetchPriority: "high",
  }).props;
  const opening = getImageProps({
    ...common,
    src: "/hero/emblem-opening.webp",
  }).props;
  const stacked = getImageProps({
    ...common,
    src: "/hero/emblem-stacked.webp",
  }).props;

  return (
    <picture className={className}>
      <source
        media="(prefers-reduced-motion: reduce)"
        srcSet={assembled.srcSet}
        sizes={SIZES}
      />
      <source
        media="(min-width: 64rem)"
        srcSet={opening.srcSet}
        sizes={SIZES}
      />
      <source
        media="(max-width: 63.99rem)"
        srcSet={stacked.srcSet}
        sizes={SIZES}
      />
      <img {...assembled} alt="" />
    </picture>
  );
}

export function HeroArt() {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  });
  const y = useTransform(scrollYProgress, [0, 1], ["-3%", "3%"]);

  return (
    <div
      ref={ref}
      className="relative mx-auto w-full max-w-[34rem] lg:max-w-none"
    >
      <motion.div style={reduced ? undefined : { y }} className="relative">
        <div
          aria-hidden="true"
          className="absolute inset-[8%] rounded-full bg-[radial-gradient(circle_at_50%_45%,rgb(35_75_196/0.16),transparent_68%)] blur-2xl"
        />
        <StillPicture className="relative block [&>img]:h-auto [&>img]:w-full" />
      </motion.div>
    </div>
  );
}
