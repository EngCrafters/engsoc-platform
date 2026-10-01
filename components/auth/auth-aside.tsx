"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { Liquid } from "@/components/canvasui/Liquid";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { BrandMark } from "@/components/ui/brand-mark";

/**
 * Desktop-only brand panel for the auth shell. The GSAP entrance and the
 * Canvas UI Liquid background are decorative only — scoped to this column,
 * never the form card — and both already no-op/settle under
 * prefers-reduced-motion. See docs/DESIGN_SYSTEM.md "Canvas UI / GSAP".
 */
export function AuthAside({
  eyebrow,
  heading,
  description,
}: {
  eyebrow: string;
  heading: string;
  description: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return undefined;
    }
    const ctx = gsap.context(() => {
      gsap
        .timeline({ defaults: { ease: "power3.out" } })
        .from("[data-auth-brand]", { opacity: 0, y: 10, duration: 0.5 })
        .from(
          "[data-auth-eyebrow]",
          { opacity: 0, y: 8, duration: 0.4 },
          "-=0.25"
        )
        .from(
          "[data-auth-heading]",
          { opacity: 0, y: 14, duration: 0.55 },
          "-=0.25"
        )
        .from(
          "[data-auth-description]",
          { opacity: 0, y: 8, duration: 0.4 },
          "-=0.3"
        );
    }, root);
    return () => ctx.revert();
  }, []);

  return (
    <aside
      ref={rootRef}
      className="hidden min-h-screen lg:flex lg:flex-col lg:bg-shell lg:text-shell-foreground"
    >
      <Liquid
        className="flex h-full flex-1"
        color={[0.82, 0.82, 0.84]}
        distortion={0.3}
        intensity={1.5}
        blend={4}
        force={0.9}
      >
        <div className="flex h-full flex-col justify-between px-10 py-10 xl:px-16 xl:py-14">
          <div
            data-auth-brand
            className="flex items-center justify-between gap-3"
          >
            <div className="flex items-center gap-3">
              <BrandMark />
              <span className="leading-tight">
                <span className="block text-sm font-semibold">
                  Engineering Society
                </span>
                <span className="block text-xs text-shell-muted">
                  Administration
                </span>
              </span>
            </div>
            <ThemeToggle variant="shell" />
          </div>
          <div className="max-w-sm">
            <p
              data-auth-eyebrow
              className="text-xs font-semibold uppercase tracking-[0.15em] text-shell-accent"
            >
              {eyebrow}
            </p>
            <p
              data-auth-heading
              className="mt-5 text-3xl font-semibold leading-tight tracking-[-0.04em] xl:text-4xl"
            >
              {heading}
            </p>
            <p
              data-auth-description
              className="mt-5 text-sm leading-6 text-shell-muted"
            >
              {description}
            </p>
          </div>
          <p className="text-xs text-shell-muted">
            Engineering Society Platform
          </p>
        </div>
      </Liquid>
    </aside>
  );
}
