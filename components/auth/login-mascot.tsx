"use client";

import { useEffect, useRef } from "react";
import type { BufferGeometry, Material, WebGLRenderer } from "three";

// Canvas and camera geometry. The orthographic camera maps world y = 0 to
// pixel row EDGE, so the character's seat lines up with the top edge of the
// card it sits on (see AuthShell, which offsets this box by -EDGE px).
export const MASCOT_WIDTH = 250;
export const MASCOT_HEIGHT = 280;
export const MASCOT_EDGE = 190;
const PPU = 80; // pixels per world unit

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (current: number, target: number, dt: number, speed = 8) =>
  lerp(current, target, 1 - Math.exp(-speed * dt));

/**
 * "Volt", a small engineer robot in a hard hat, perched on the top edge of the
 * sign-in card with its legs swinging while it waits. It waves once on load,
 * its eyes follow the pointer, and it covers its eyes whenever a password field
 * has focus. Rendered with three.js (loaded lazily, so it never blocks the
 * form). Decorative: aria-hidden, no pointer events, a single still frame under
 * prefers-reduced-motion, paused while the tab is hidden, and silently absent
 * when WebGL is unavailable.
 */
export function LoginMascot({ className }: { className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    let disposed = false;
    let cleanup = () => {};

    (async () => {
      let THREE: typeof import("three");
      let RoundedBoxGeometry: typeof import("three/examples/jsm/geometries/RoundedBoxGeometry.js").RoundedBoxGeometry;
      try {
        THREE = await import("three");
        ({ RoundedBoxGeometry } =
          await import("three/examples/jsm/geometries/RoundedBoxGeometry.js"));
      } catch (error) {
        console.warn("Volt could not load three.js", error);
        return;
      }
      if (disposed) return;

      let renderer: WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
      } catch (error) {
        console.warn("Volt needs WebGL, which is unavailable", error);
        return;
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(MASCOT_WIDTH, MASCOT_HEIGHT, false);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      host.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.OrthographicCamera(
        -MASCOT_WIDTH / 2 / PPU,
        MASCOT_WIDTH / 2 / PPU,
        MASCOT_EDGE / PPU,
        -(MASCOT_HEIGHT - MASCOT_EDGE) / PPU,
        0.1,
        30
      );
      camera.position.set(0, 0, 10);

      scene.add(new THREE.AmbientLight(0xffffff, 1.15));
      const key = new THREE.DirectionalLight(0xffffff, 2.4);
      key.position.set(-2.5, 3.5, 5);
      scene.add(key);
      const rim = new THREE.DirectionalLight(0xffffff, 1.4);
      rim.position.set(3, 2, -4);
      scene.add(rim);

      const body = new THREE.MeshStandardMaterial({
        color: 0xe9e9ed,
        roughness: 0.5,
        metalness: 0.15,
      });
      const hatMat = new THREE.MeshStandardMaterial({
        color: 0xc9c9d0,
        roughness: 0.4,
        metalness: 0.2,
      });
      const dark = new THREE.MeshStandardMaterial({
        color: 0x17171b,
        roughness: 0.3,
        metalness: 0.45,
      });
      const glow = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const lamp = new THREE.MeshBasicMaterial({ color: 0x777777 });

      const mesh = (
        geometry: BufferGeometry,
        material: Material,
        x = 0,
        y = 0,
        z = 0
      ) => {
        const m = new THREE.Mesh(geometry, material);
        m.position.set(x, y, z);
        return m;
      };

      const rig = new THREE.Group();
      scene.add(rig);

      // Torso, chest gear and neck.
      const torso = mesh(
        new RoundedBoxGeometry(0.95, 0.8, 0.62, 4, 0.16),
        body,
        0,
        0.42
      );
      rig.add(torso);
      const gear = mesh(
        new THREE.CylinderGeometry(0.17, 0.17, 0.04, 8),
        dark,
        0,
        0.46,
        0.32
      );
      gear.rotation.x = Math.PI / 2;
      torso.add(gear);
      const gearCore = mesh(
        new THREE.CylinderGeometry(0.06, 0.06, 0.05, 16),
        glow,
        0,
        0.46,
        0.335
      );
      gearCore.rotation.x = Math.PI / 2;
      torso.add(gearCore);
      rig.add(
        mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.12, 16), dark, 0, 0.86)
      );

      // Head: shell, visor, eyes, ears, hard hat and beacon.
      const head = new THREE.Group();
      head.position.set(0, 0.92, 0);
      rig.add(head);
      head.add(
        mesh(new RoundedBoxGeometry(1.05, 0.82, 0.85, 4, 0.2), body, 0, 0.45)
      );
      head.add(
        mesh(
          new RoundedBoxGeometry(0.86, 0.46, 0.1, 3, 0.05),
          dark,
          0,
          0.45,
          0.42
        )
      );
      const eyes = new THREE.Group();
      eyes.position.set(0, 0.45, 0.5);
      for (const s of [-1, 1]) {
        eyes.add(
          mesh(
            new RoundedBoxGeometry(0.17, 0.2, 0.04, 3, 0.02),
            glow,
            s * 0.2,
            0
          )
        );
      }
      head.add(eyes);
      for (const s of [-1, 1]) {
        const ear = mesh(
          new THREE.CylinderGeometry(0.12, 0.12, 0.08, 16),
          dark,
          s * 0.56,
          0.45
        );
        ear.rotation.z = Math.PI / 2;
        head.add(ear);
      }
      const hat = mesh(
        new THREE.SphereGeometry(0.58, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2),
        hatMat,
        0,
        0.78,
        -0.02
      );
      hat.scale.set(1, 0.8, 0.98);
      head.add(hat);
      const brim = mesh(
        new THREE.CylinderGeometry(0.66, 0.66, 0.05, 32),
        hatMat,
        0,
        0.79,
        0.05
      );
      brim.scale.set(1, 1, 1.04);
      head.add(brim);
      head.add(
        mesh(
          new RoundedBoxGeometry(0.14, 0.1, 0.78, 3, 0.04),
          hatMat,
          0,
          1.21,
          0
        )
      );
      const beacon = mesh(
        new THREE.SphereGeometry(0.075, 16, 12),
        lamp,
        0,
        1.3,
        0.2
      );
      head.add(beacon);

      // Arms hang from the shoulders and rest their hands on the edge.
      const armGeo = new THREE.CapsuleGeometry(0.1, 0.38, 6, 12);
      const handGeo = new THREE.SphereGeometry(0.125, 16, 12);
      const arms = [-1, 1].map((side) => {
        const pivot = new THREE.Group();
        pivot.position.set(side * 0.6, 0.72, 0);
        pivot.add(mesh(armGeo, body, 0, -0.3));
        pivot.add(mesh(handGeo, dark, 0, -0.64));
        rig.add(pivot);
        return { side, pivot };
      });

      // Legs dangle over the edge and swing.
      const legGeo = new THREE.CapsuleGeometry(0.11, 0.4, 6, 12);
      const footGeo = new RoundedBoxGeometry(0.24, 0.12, 0.34, 3, 0.05);
      const legs = [-1, 1].map((side) => {
        const pivot = new THREE.Group();
        pivot.position.set(side * 0.24, 0.02, 0.12);
        pivot.add(mesh(legGeo, body, 0, -0.3));
        pivot.add(mesh(footGeo, dark, 0, -0.63, 0.06));
        rig.add(pivot);
        return { side, pivot };
      });

      // Interaction state.
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
      const pointer = { x: 0, y: 0, active: 0 };
      let shy = false;
      let shyAmount = 0;
      let lookX = 0;
      let lookY = 0;
      let blinkIn = 2.5;
      let blinkT = -1;
      let elapsed = 0;
      let last = performance.now();
      let raf = 0;

      const onPointer = (event: PointerEvent) => {
        pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
        pointer.y = (event.clientY / window.innerHeight) * 2 - 1;
        pointer.active = elapsed;
      };
      const isPassword = (target: EventTarget | null) =>
        target instanceof HTMLInputElement && target.type === "password";
      const onFocusIn = (event: FocusEvent) => {
        shy = isPassword(event.target);
      };
      const onFocusOut = (event: FocusEvent) => {
        if (isPassword(event.target)) shy = false;
      };

      const render = (dt: number) => {
        elapsed += dt;
        const still = reduced.matches;
        const idle = elapsed - pointer.active > 4;

        // Where the head looks: the pointer, or a slow glance around when idle.
        const targetX = idle ? Math.sin(elapsed * 0.45) * 0.55 : pointer.x;
        const targetY = idle ? Math.sin(elapsed * 0.3 + 1) * 0.2 : pointer.y;
        lookX = ease(lookX, still ? 0 : targetX, dt, 5);
        lookY = ease(lookY, still ? 0 : targetY, dt, 5);
        shyAmount = ease(shyAmount, shy && !still ? 1 : 0, dt, 9);

        const breath = still ? 0 : Math.sin(elapsed * 1.8);
        torso.scale.y = 1 + breath * 0.012;
        head.position.y = 0.92 + breath * 0.012;
        head.rotation.y = lookX * 0.55 * (1 - shyAmount * 0.6);
        head.rotation.x = lookY * 0.25 + shyAmount * 0.32;
        eyes.position.x = lookX * 0.05;
        rig.rotation.y = lookX * 0.14;

        // Blink.
        blinkIn -= dt;
        if (blinkIn <= 0 && blinkT < 0 && !still) {
          blinkT = 0;
          blinkIn = 2.5 + Math.random() * 3.5;
        }
        if (blinkT >= 0) {
          blinkT += dt;
          eyes.scale.y = Math.max(0.08, Math.abs(1 - (blinkT / 0.14) * 2));
          if (blinkT > 0.14) {
            blinkT = -1;
            eyes.scale.y = 1;
          }
        }
        if (shyAmount > 0.5) eyes.scale.y = 0.4;

        // Beacon pulse.
        const pulse = still ? 0.6 : 0.5 + 0.5 * Math.sin(elapsed * 3);
        lamp.color.setScalar(0.35 + 0.65 * pulse);
        beacon.scale.setScalar(1 + 0.25 * pulse);

        // Legs swing while it waits.
        for (const { side, pivot } of legs) {
          const phase = side > 0 ? 0 : Math.PI;
          pivot.rotation.x = still
            ? 0.05
            : 0.06 + Math.sin(elapsed * 2.4 + phase) * 0.3;
        }

        // Arms: rest, wave hello once, or cover the eyes.
        const wave =
          !still && elapsed > 0.7 && elapsed < 3.2 && shyAmount < 0.05
            ? Math.sin(Math.min((elapsed - 0.7) / 0.35, 1) * (Math.PI / 2))
            : 0;
        const waveFade = elapsed > 2.8 ? Math.max(0, (3.2 - elapsed) / 0.4) : 1;
        for (const { side, pivot } of arms) {
          const restZ = side * 0.3;
          const restX = -0.15;
          const waving = side > 0 ? wave * waveFade : 0;
          const wiggle = waving * Math.sin(elapsed * 11) * 0.28;
          const targetRotZ = lerp(
            lerp(restZ, side * 2.35 + wiggle, waving),
            -side * 0.7,
            shyAmount
          );
          const targetRotX = lerp(lerp(restX, 0, waving), -2.55, shyAmount);
          pivot.rotation.z = ease(pivot.rotation.z, targetRotZ, dt, 14);
          pivot.rotation.x = ease(pivot.rotation.x, targetRotX, dt, 14);
          pivot.position.y = lerp(0.72, 0.95, shyAmount);
          pivot.position.z = lerp(0, 0.28, shyAmount);
        }

        renderer.render(scene, camera);
      };

      const tick = (now: number) => {
        const dt = Math.min((now - last) / 1000, 0.1);
        last = now;
        render(dt);
        raf = requestAnimationFrame(tick);
      };
      const start = () => {
        cancelAnimationFrame(raf);
        if (document.hidden) return;
        last = performance.now();
        if (reduced.matches) {
          render(0);
          return;
        }
        raf = requestAnimationFrame(tick);
      };

      window.addEventListener("pointermove", onPointer);
      document.addEventListener("focusin", onFocusIn);
      document.addEventListener("focusout", onFocusOut);
      document.addEventListener("visibilitychange", start);
      reduced.addEventListener("change", start);
      shy = isPassword(document.activeElement);
      start();

      cleanup = () => {
        cancelAnimationFrame(raf);
        window.removeEventListener("pointermove", onPointer);
        document.removeEventListener("focusin", onFocusIn);
        document.removeEventListener("focusout", onFocusOut);
        document.removeEventListener("visibilitychange", start);
        reduced.removeEventListener("change", start);
        scene.traverse((object) => {
          if (object instanceof THREE.Mesh) object.geometry.dispose();
        });
        [body, hatMat, dark, glow, lamp].forEach((m) => m.dispose());
        renderer.dispose();
        renderer.domElement.remove();
      };
    })();

    return () => {
      disposed = true;
      cleanup();
    };
  }, []);

  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      className={className}
      // marginTop lifts the box so its seat line (row EDGE) sits on the card's top edge.
      style={{
        width: MASCOT_WIDTH,
        height: MASCOT_HEIGHT,
        marginTop: -MASCOT_EDGE,
      }}
    />
  );
}
