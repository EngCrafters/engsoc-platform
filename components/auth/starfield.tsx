"use client";

import { useEffect, useRef } from "react";

type Star = {
  x: number;
  y: number;
  r: number;
  phase: number;
  rate: number;
  kind: "dust" | "star" | "bright";
};

type Streak = { x: number; y: number; vx: number; vy: number; life: number };

const MAX_STARS = 520;
const MIN_STARS = 220;
const ROTATION_SPEED = 0.006; // radians per second: a full turn takes ~17 minutes

function gaussian() {
  // Box-Muller, clamped so no star lands absurdly far from the band.
  const u = Math.max(Math.random(), 1e-6);
  const v = Math.random();
  return Math.max(
    -2.6,
    Math.min(2.6, Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v))
  );
}

/**
 * Decorative galaxy for the signed-out screens: a slowly rotating Milky Way
 * band with a soft glowing core, dense star dust along it, twinkling stars,
 * bright glowing stars with glints, and an occasional shooting star. Always
 * drawn in white for a dark backdrop. Renders one still frame under
 * prefers-reduced-motion, pauses while the tab is hidden, and is hidden from
 * assistive tech.
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
    let radius = 0; // half the diagonal: the rotating field must cover every corner
    let stars: Star[] = [];
    let streak: Streak | null = null;
    let nextStreak = 3;
    let angle = -0.45;
    let elapsed = 0;
    let last = performance.now();
    let raf = 0;

    const seed = () => {
      const count = Math.min(
        MAX_STARS,
        Math.max(MIN_STARS, Math.round(width * height * 0.00045))
      );
      stars = Array.from({ length: count }, () => {
        const roll = Math.random();
        const kind: Star["kind"] =
          roll < 0.02 ? "bright" : roll < 0.34 ? "star" : "dust";
        // 60% of the stars cluster along the band, the rest scatter everywhere.
        const inBand = Math.random() < 0.6;
        const x = inBand
          ? gaussian() * radius * 0.42
          : (Math.random() * 2 - 1) * radius;
        const y = inBand
          ? gaussian() * radius * 0.11
          : (Math.random() * 2 - 1) * radius;
        return {
          x,
          y,
          kind,
          r:
            kind === "bright"
              ? 1.1 + Math.random() * 0.8
              : kind === "star"
                ? 0.8 + Math.random() * 0.8
                : 0.35 + Math.random() * 0.5,
          phase: Math.random() * Math.PI * 2,
          rate: 0.5 + Math.random() * 1.8,
        };
      });
    };

    const glow = (rx: number, ry: number, alpha: number) => {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
      g.addColorStop(0, `rgba(255,255,255,${alpha})`);
      g.addColorStop(0.35, `rgba(255,255,255,${alpha * 0.4})`);
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.save();
      ctx.scale(1, ry / rx);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, rx, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      ctx.save();
      ctx.translate(width / 2, height / 2);
      ctx.rotate(angle);

      // Galactic band and core.
      glow(radius * 0.95, radius * 0.2, 0.1);
      glow(radius * 0.5, radius * 0.11, 0.14);
      glow(radius * 0.2, radius * 0.1, 0.22);

      for (const star of stars) {
        const twinkle = 0.5 + 0.5 * Math.sin(elapsed * star.rate + star.phase);
        if (star.kind === "dust") {
          ctx.globalAlpha = 0.25 + 0.5 * twinkle;
          ctx.fillStyle = "#fff";
          ctx.fillRect(star.x, star.y, star.r * 1.6, star.r * 1.6);
          continue;
        }
        const alpha =
          star.kind === "bright"
            ? 0.75 + 0.25 * twinkle
            : 0.45 + 0.55 * twinkle;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = "#fff";
        if (star.kind === "bright") {
          ctx.shadowColor = "rgba(255,255,255,0.95)";
          ctx.shadowBlur = 7 + 7 * twinkle;
        }
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        if (star.kind === "bright" && twinkle > 0.3) {
          // Glints stay upright on screen while the field rotates.
          const len = star.r * (3.5 + 5 * twinkle);
          ctx.globalAlpha = alpha * 0.6;
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 0.7;
          ctx.save();
          ctx.translate(star.x, star.y);
          ctx.rotate(-angle);
          ctx.beginPath();
          ctx.moveTo(-len, 0);
          ctx.lineTo(len, 0);
          ctx.moveTo(0, -len);
          ctx.lineTo(0, len);
          ctx.stroke();
          ctx.restore();
        }
      }
      ctx.restore();
      ctx.globalAlpha = 1;

      if (streak) {
        const tail = 90;
        const speed = Math.hypot(streak.vx, streak.vy);
        const tx = streak.x - (streak.vx / speed) * tail;
        const ty = streak.y - (streak.vy / speed) * tail;
        const g = ctx.createLinearGradient(streak.x, streak.y, tx, ty);
        g.addColorStop(0, `rgba(255,255,255,${0.95 * streak.life})`);
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.strokeStyle = g;
        ctx.lineWidth = 1.6;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(streak.x, streak.y);
        ctx.lineTo(tx, ty);
        ctx.stroke();
      }
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      radius = Math.hypot(width, height) / 2;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
      draw();
    };

    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      elapsed += dt;
      angle += ROTATION_SPEED * dt;

      nextStreak -= dt;
      if (!streak && nextStreak <= 0) {
        const fromLeft = Math.random() < 0.5;
        streak = {
          x: fromLeft
            ? Math.random() * width * 0.4
            : width - Math.random() * width * 0.4,
          y: Math.random() * height * 0.4,
          vx: (fromLeft ? 1 : -1) * (500 + Math.random() * 250),
          vy: 220 + Math.random() * 160,
          life: 1,
        };
        nextStreak = 5 + Math.random() * 5;
      }
      if (streak) {
        streak.x += streak.vx * dt;
        streak.y += streak.vy * dt;
        streak.life -= dt * 0.9;
        if (streak.life <= 0 || streak.x < -120 || streak.x > width + 120) {
          streak = null;
        }
      }

      draw();
      raf = requestAnimationFrame(tick);
    };

    const start = () => {
      cancelAnimationFrame(raf);
      if (motion.matches || document.hidden) return;
      last = performance.now();
      raf = requestAnimationFrame(tick);
    };

    resize();
    start();

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    document.addEventListener("visibilitychange", start);
    motion.addEventListener("change", start);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      document.removeEventListener("visibilitychange", start);
      motion.removeEventListener("change", start);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`pointer-events-none size-full ${className ?? ""}`}
    />
  );
}
