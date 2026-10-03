"use client";

import { useEffect, useRef } from "react";

type Star = {
  x: number;
  y: number;
  r: number;
  speed: number;
  phase: number;
  rate: number;
  shiny: boolean;
};

const STAR_DENSITY = 1 / 6000;
const MAX_STARS = 220;

/**
 * Decorative twinkling starfield for the signed-out screens. Stars drift
 * slowly upward and twinkle on a sine wave; a few "shiny" stars also get a
 * soft four-point glint. Drawn in the current text color, so it follows the
 * light/dark theme. Static (one frame) under prefers-reduced-motion, paused
 * while the tab is hidden, and invisible to assistive tech.
 */
export function Starfield({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return undefined;

    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let width = 0;
    let height = 0;
    let stars: Star[] = [];
    let frame = 0;
    let raf = 0;
    let color = "#ffffff";

    const readColor = () => {
      color = getComputedStyle(canvas).color || color;
    };

    const seed = () => {
      const count = Math.min(
        MAX_STARS,
        Math.round(width * height * STAR_DENSITY)
      );
      stars = Array.from({ length: count }, () => {
        const shiny = Math.random() < 0.12;
        return {
          x: Math.random() * width,
          y: Math.random() * height,
          r: shiny ? 1.3 + Math.random() * 1 : 0.6 + Math.random() * 0.9,
          speed: 0.04 + Math.random() * 0.14,
          phase: Math.random() * Math.PI * 2,
          rate: 0.6 + Math.random() * 1.6,
          shiny,
        };
      });
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
      draw(0);
    };

    const draw = (time: number) => {
      ctx.clearRect(0, 0, width, height);
      for (const star of stars) {
        const twinkle = 0.5 + 0.5 * Math.sin(time * star.rate + star.phase);
        const alpha = star.shiny
          ? 0.35 + 0.65 * twinkle
          : 0.15 + 0.55 * twinkle;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
        ctx.fill();
        if (star.shiny && twinkle > 0.35) {
          const len = star.r * (4 + 7 * twinkle);
          ctx.globalAlpha = alpha * 0.55;
          ctx.strokeStyle = color;
          ctx.lineWidth = 0.6;
          ctx.beginPath();
          ctx.moveTo(star.x - len, star.y);
          ctx.lineTo(star.x + len, star.y);
          ctx.moveTo(star.x, star.y - len);
          ctx.lineTo(star.x, star.y + len);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    };

    let last = performance.now();
    let elapsed = 0;
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      elapsed += dt;
      frame += 1;
      if (frame % 60 === 0) readColor();
      for (const star of stars) {
        star.y -= star.speed * dt * 60 * 0.25;
        if (star.y < -4) {
          star.y = height + 4;
          star.x = Math.random() * width;
        }
      }
      draw(elapsed);
      raf = requestAnimationFrame(tick);
    };

    const start = () => {
      cancelAnimationFrame(raf);
      if (motion.matches || document.hidden) return;
      last = performance.now();
      raf = requestAnimationFrame(tick);
    };

    readColor();
    resize();
    start();

    const observer = new ResizeObserver(() => {
      resize();
    });
    observer.observe(canvas);
    const themeObserver = new MutationObserver(() => {
      readColor();
      if (motion.matches) draw(0);
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    document.addEventListener("visibilitychange", start);
    motion.addEventListener("change", start);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      themeObserver.disconnect();
      document.removeEventListener("visibilitychange", start);
      motion.removeEventListener("change", start);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`pointer-events-none size-full text-foreground ${className ?? ""}`}
    />
  );
}
