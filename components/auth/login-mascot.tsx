"use client";

import { useEffect, useRef } from "react";
import type {
  BufferGeometry,
  Group,
  Material,
  Mesh,
  Vector3,
  WebGLRenderer,
} from "three";

// Canvas and camera geometry. The orthographic camera maps world y = 0 to
// pixel row EDGE, so the character's seat lines up with the top edge of the
// card it sits on (the box is lifted by -EDGE px, see below).
export const MASCOT_WIDTH = 250;
export const MASCOT_HEIGHT = 280;
export const MASCOT_EDGE = 190;
const PPU = 80; // pixels per world unit

// Arm bones (world units) and how far the mitten reaches past the wrist.
const UPPER = 0.42;
const FORE = 0.38;
const HAND = 0.12;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (current: number, target: number, dt: number, speed = 8) =>
  lerp(current, target, 1 - Math.exp(-speed * dt));
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

type Focus = "none" | "email" | "password";

/**
 * "Volt", a small engineer robot in a safety-yellow hard hat, perched on the
 * top edge of the sign-in card while he waits. He waves once on load, his eyes
 * follow the pointer, he looks down and smiles while you type your email, and
 * he covers his eyes (blushing, with the odd peek) while you type a password.
 * His arms are two-bone rigs solved onto their targets, so the hands really do
 * land on his eyes.
 *
 * Rendered with three.js (loaded lazily, so it never blocks the form).
 * Decorative: aria-hidden, no pointer events, a single still frame under
 * prefers-reduced-motion, paused while the tab is hidden, and absent (with a
 * console warning) when three.js or WebGL is unavailable.
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

      scene.add(new THREE.AmbientLight(0xffffff, 1.1));
      const key = new THREE.DirectionalLight(0xffffff, 2.4);
      key.position.set(-2.5, 3.5, 5);
      scene.add(key);
      const rim = new THREE.DirectionalLight(0xfff1d6, 1.5);
      rim.position.set(3, 2, -4);
      scene.add(rim);

      // Palette: white shell, safety-yellow hat, orange gloves, dark visor.
      const std = (color: number, roughness = 0.5, metalness = 0.15) =>
        new THREE.MeshStandardMaterial({ color, roughness, metalness });
      const shell = std(0xeceef1);
      const shade = std(0xc9ced6, 0.55);
      const hat = std(0xf6b800, 0.35, 0.1);
      const hatDark = std(0xd98f00, 0.4, 0.1);
      const glove = std(0xff9a1f, 0.45, 0.05);
      const dark = std(0x16171b, 0.3, 0.45);
      const steel = std(0x9aa1ad, 0.3, 0.8);
      const eyeMat = new THREE.MeshBasicMaterial({ color: 0xe6fbff });
      const glass = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.07,
      });
      const blushMat = new THREE.MeshBasicMaterial({
        color: 0xff8fa8,
        transparent: true,
        opacity: 0,
      });
      const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff5a36 });
      const ledGreen = new THREE.MeshBasicMaterial({ color: 0x3ddc84 });
      const ledAmber = new THREE.MeshBasicMaterial({ color: 0xffc247 });
      const ledRed = new THREE.MeshBasicMaterial({ color: 0xff5a5a });
      const materials = [
        shell,
        shade,
        hat,
        hatDark,
        glove,
        dark,
        steel,
        eyeMat,
        glass,
        blushMat,
        beaconMat,
        ledGreen,
        ledAmber,
        ledRed,
      ];

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
      const box = (
        w: number,
        h: number,
        d: number,
        r: number,
        material: Material,
        x = 0,
        y = 0,
        z = 0
      ) => mesh(new RoundedBoxGeometry(w, h, d, 3, r), material, x, y, z);
      const ball = (r: number, material: Material, x = 0, y = 0, z = 0) =>
        mesh(new THREE.SphereGeometry(r, 18, 14), material, x, y, z);
      const tube = (
        r: number,
        length: number,
        material: Material,
        x = 0,
        y = 0,
        z = 0
      ) =>
        mesh(
          new THREE.CapsuleGeometry(r, Math.max(0.001, length - 2 * r), 6, 14),
          material,
          x,
          y,
          z
        );

      const rig = new THREE.Group();
      scene.add(rig);

      // ---- Torso ------------------------------------------------------------
      const torso = new THREE.Group();
      rig.add(torso);
      torso.add(box(0.95, 0.8, 0.62, 0.16, shell, 0, 0.42));
      torso.add(box(0.99, 0.1, 0.66, 0.04, dark, 0, 0.17)); // belt
      torso.add(box(0.18, 0.12, 0.05, 0.02, hat, 0, 0.17, 0.34)); // buckle
      const panel = box(0.52, 0.3, 0.05, 0.04, dark, 0, 0.58, 0.31);
      torso.add(panel);
      const leds = [ledGreen, ledAmber, ledRed].map((material, i) => {
        const led = ball(0.032, material, (i - 1) * 0.13, 0.62, 0.345);
        torso.add(led);
        return led;
      });
      const badge = mesh(
        new THREE.CylinderGeometry(0.075, 0.075, 0.03, 8),
        steel,
        0,
        0.52,
        0.345
      );
      badge.rotation.x = Math.PI / 2;
      torso.add(badge);
      const badgeCore = mesh(
        new THREE.CylinderGeometry(0.03, 0.03, 0.035, 12),
        dark,
        0,
        0.52,
        0.348
      );
      badgeCore.rotation.x = Math.PI / 2;
      torso.add(badgeCore);
      // Tool pouch with a screwdriver, on the right hip.
      torso.add(box(0.2, 0.17, 0.13, 0.03, dark, 0.4, 0.27, 0.3));
      const driver = tube(0.025, 0.2, hat, 0.43, 0.43, 0.3);
      torso.add(driver);
      torso.add(tube(0.01, 0.12, steel, 0.43, 0.54, 0.3));
      // Neck rings.
      for (const y of [0.84, 0.9]) {
        rig.add(
          mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.05, 20), dark, 0, y)
        );
      }

      // ---- Head -------------------------------------------------------------
      const head = new THREE.Group();
      head.position.set(0, 0.92, 0);
      rig.add(head);
      head.add(box(1.05, 0.82, 0.85, 0.2, shell, 0, 0.45));
      head.add(box(0.88, 0.48, 0.1, 0.06, dark, 0, 0.45, 0.42)); // visor
      head.add(
        mesh(new THREE.PlaneGeometry(0.84, 0.44), glass, 0, 0.45, 0.474)
      );

      const eyes = new THREE.Group();
      eyes.position.set(0, 0.5, 0.485);
      const eyeMeshes = [-1, 1].map((s) => {
        const eye = box(0.16, 0.2, 0.04, 0.025, eyeMat, s * 0.2, 0);
        eyes.add(eye);
        return eye;
      });
      head.add(eyes);

      const smile = mesh(
        new THREE.TorusGeometry(0.08, 0.014, 8, 20, Math.PI),
        eyeMat,
        0,
        0.37,
        0.485
      );
      smile.rotation.z = Math.PI; // an arc that curves up at both ends
      head.add(smile);

      const blushes = [-1, 1].map((s) => {
        const blush = mesh(
          new THREE.CircleGeometry(0.06, 20),
          blushMat,
          s * 0.34,
          0.36,
          0.476
        );
        blush.scale.set(1.3, 0.8, 1);
        head.add(blush);
        return blush;
      });

      // Headphone cups on the sides.
      for (const s of [-1, 1]) {
        const cup = mesh(
          new THREE.CylinderGeometry(0.15, 0.15, 0.1, 22),
          dark,
          s * 0.57,
          0.45
        );
        cup.rotation.z = Math.PI / 2;
        head.add(cup);
        const ring = mesh(
          new THREE.TorusGeometry(0.12, 0.018, 8, 24),
          hat,
          s * 0.625,
          0.45
        );
        ring.rotation.y = Math.PI / 2;
        head.add(ring);
      }

      // Hard hat: dome, base band, brim, ridge, front badge and beacon.
      const dome = mesh(
        new THREE.SphereGeometry(0.58, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2),
        hat,
        0,
        0.78,
        -0.02
      );
      dome.scale.set(1, 0.82, 0.98);
      head.add(dome);
      const band = mesh(
        new THREE.TorusGeometry(0.575, 0.02, 8, 40),
        hatDark,
        0,
        0.83,
        -0.02
      );
      band.rotation.x = Math.PI / 2;
      band.scale.set(1, 0.98, 1);
      head.add(band);
      const brim = mesh(
        new THREE.CylinderGeometry(0.67, 0.67, 0.05, 36),
        hat,
        0,
        0.79,
        0.05
      );
      brim.scale.set(1, 1, 1.05);
      head.add(brim);
      head.add(box(0.14, 0.1, 0.78, 0.04, hatDark, 0, 1.22));
      head.add(box(0.1, 0.1, 0.5, 0.04, hatDark, -0.27, 1.14));
      head.add(box(0.1, 0.1, 0.5, 0.04, hatDark, 0.27, 1.14));
      const hatBadge = box(0.2, 0.14, 0.03, 0.03, dark, 0, 1.0, 0.54);
      hatBadge.rotation.x = -0.35;
      head.add(hatBadge);
      const hatGear = mesh(
        new THREE.CylinderGeometry(0.04, 0.04, 0.03, 8),
        hat,
        0,
        1.0,
        0.555
      );
      hatGear.rotation.x = Math.PI / 2 - 0.35;
      head.add(hatGear);
      const antenna = new THREE.Group();
      antenna.position.set(0.05, 1.28, 0.18);
      antenna.add(tube(0.012, 0.22, steel, 0, 0.11));
      const beacon = ball(0.07, beaconMat, 0, 0.24);
      antenna.add(beacon);
      head.add(antenna);

      // Eye anchors the hands aim at while he covers his eyes.
      const eyeAnchors = [-1, 1].map((s) => {
        const anchor = new THREE.Object3D();
        anchor.position.set(s * 0.2, 0.5, 0.58);
        head.add(anchor);
        return anchor;
      });

      // ---- Arms: shoulder, upper arm, elbow, forearm, wrist band, mitten ----
      const DOWN = new THREE.Vector3(0, -1, 0);
      const arms = [-1, 1].map((side) => {
        const shoulder = ball(0.15, shell);
        const shoulderCap = ball(0.1, shade);
        shoulderCap.position.set(side * 0.04, 0.02, 0.06);
        shoulder.add(shoulderCap);
        const upper = new THREE.Group();
        upper.add(tube(0.095, UPPER, shell, 0, -UPPER / 2));
        const elbow = ball(0.105, dark);
        const fore = new THREE.Group();
        fore.add(tube(0.085, FORE, shade, 0, -FORE / 2));
        const wrist = mesh(
          new THREE.CylinderGeometry(0.1, 0.1, 0.05, 18),
          dark,
          0,
          -FORE + 0.02
        );
        fore.add(wrist);
        const hand = new THREE.Group();
        hand.add(box(0.2, 0.2, 0.1, 0.05, glove, 0, -0.1));
        hand.add(box(0.2, 0.04, 0.103, 0.02, hat, 0, -0.17)); // knuckle stripe
        const thumb = tube(0.04, 0.12, glove, side * -0.12, -0.07);
        thumb.rotation.z = side * 0.5;
        hand.add(thumb);
        rig.add(shoulder, upper, elbow, fore, hand);
        return { side, shoulder, upper, elbow, fore, hand };
      });

      // ---- Legs: hip, thigh, knee, shin, boot --------------------------------
      const legs = [-1, 1].map((side) => {
        const hip = new THREE.Group();
        hip.position.set(side * 0.24, 0.02, 0.12);
        hip.add(tube(0.12, 0.3, shell, 0, -0.17));
        hip.add(ball(0.115, dark, 0, -0.32));
        const knee = new THREE.Group();
        knee.position.set(0, -0.32, 0);
        knee.add(tube(0.1, 0.28, shade, 0, -0.14));
        const boot = new THREE.Group();
        boot.position.set(0, -0.3, 0.05);
        boot.add(box(0.26, 0.14, 0.4, 0.05, dark, 0, 0));
        boot.add(box(0.275, 0.05, 0.415, 0.02, hat, 0, -0.06));
        knee.add(boot);
        hip.add(knee);
        rig.add(hip);
        return { side, hip, knee };
      });

      // ---- Two-bone IK -------------------------------------------------------
      const vDir = new THREE.Vector3();
      const vWrist = new THREE.Vector3();
      const vD = new THREE.Vector3();
      const vPole = new THREE.Vector3();
      const vElbow = new THREE.Vector3();
      const vAim = new THREE.Vector3();
      const aim = (group: Group, from: Vector3, to: Vector3) => {
        group.position.copy(from);
        vAim.subVectors(to, from).normalize();
        group.quaternion.setFromUnitVectors(DOWN, vAim);
      };
      const solveArm = (
        arm: (typeof arms)[number],
        shoulder: Vector3,
        target: Vector3
      ) => {
        vDir.subVectors(target, shoulder).normalize();
        vWrist.copy(target).addScaledVector(vDir, -HAND);
        vD.subVectors(vWrist, shoulder);
        const dist = Math.min(
          UPPER + FORE - 0.01,
          Math.max(Math.abs(UPPER - FORE) + 0.02, vD.length())
        );
        vD.normalize();
        vWrist.copy(shoulder).addScaledVector(vD, dist);
        const a = (UPPER * UPPER - FORE * FORE + dist * dist) / (2 * dist);
        const h = Math.sqrt(Math.max(0, UPPER * UPPER - a * a));
        vPole.set(arm.side * 0.8, -0.6, -0.4).normalize();
        vPole.addScaledVector(vD, -vPole.dot(vD)).normalize();
        vElbow.copy(shoulder).addScaledVector(vD, a).addScaledVector(vPole, h);
        arm.shoulder.position.copy(shoulder);
        arm.elbow.position.copy(vElbow);
        aim(arm.upper, shoulder, vElbow);
        aim(arm.fore, vElbow, vWrist);
        arm.hand.position.copy(vWrist);
        arm.hand.quaternion.copy(arm.fore.quaternion);
      };

      // ---- Interaction state -------------------------------------------------
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
      const pointer = { x: 0, y: 0, active: -10 };
      let focus: Focus = "none";
      let shyAmount = 0;
      let happyAmount = 0;
      let lookX = 0;
      let lookY = 0;
      let blinkIn = 2.5;
      let blinkT = -1;
      let peekIn = 5;
      let peekT = -1;
      let elapsed = 0;
      let last = performance.now();
      let raf = 0;

      const focusOf = (target: EventTarget | null): Focus => {
        if (!(target instanceof HTMLInputElement)) return "none";
        if (target.type === "password") return "password";
        if (target.type === "email" || target.type === "text") return "email";
        return "none";
      };
      const onPointer = (event: PointerEvent) => {
        pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
        pointer.y = (event.clientY / window.innerHeight) * 2 - 1;
        pointer.active = elapsed;
      };
      const onFocusIn = (event: FocusEvent) => {
        focus = focusOf(event.target);
      };
      const onFocusOut = () => {
        focus = "none";
      };

      const target = new THREE.Vector3();
      const anchor = new THREE.Vector3();
      const shoulderPos = new THREE.Vector3();

      const render = (dt: number) => {
        elapsed += dt;
        const still = reduced.matches;
        const t = elapsed;
        const idle = t - pointer.active > 4;

        // Gaze: pointer, a slow glance when idle, or down at the field he's reading.
        let targetX = idle ? Math.sin(t * 0.45) * 0.55 : pointer.x;
        let targetY = idle ? Math.sin(t * 0.3 + 1) * 0.2 : pointer.y;
        if (focus === "email") {
          targetX = 0;
          targetY = 0.9;
        }
        if (focus === "password") {
          targetX = 0;
          targetY = 0.35;
        }
        lookX = ease(lookX, still ? 0 : targetX, dt, 5);
        lookY = ease(lookY, still ? 0 : targetY, dt, 5);
        shyAmount = ease(
          shyAmount,
          focus === "password" && !still ? 1 : 0,
          dt,
          7
        );
        happyAmount = ease(
          happyAmount,
          focus === "email" && !still ? 1 : 0,
          dt,
          6
        );

        // Body and head.
        const breath = still ? 0 : Math.sin(t * 1.8);
        torso.scale.y = 1 + breath * 0.012;
        head.position.y = 0.92 + breath * 0.012;
        head.rotation.y = lookX * 0.55 * (1 - shyAmount * 0.8);
        head.rotation.x = lookY * 0.25 + shyAmount * 0.1;
        head.rotation.z = still
          ? 0
          : Math.sin(t * 0.8) * 0.02 + happyAmount * -0.05;
        eyes.position.x = lookX * 0.05;
        rig.rotation.y = lookX * 0.14;
        scene.updateMatrixWorld(true);

        // Blink, squint and smile.
        blinkIn -= dt;
        if (blinkIn <= 0 && blinkT < 0 && !still) {
          blinkT = 0;
          blinkIn = 2.5 + Math.random() * 3.5;
        }
        let blink = 1;
        if (blinkT >= 0) {
          blinkT += dt;
          blink = Math.max(0.08, Math.abs(1 - (blinkT / 0.14) * 2));
          if (blinkT > 0.14) blinkT = -1;
        }
        peekIn -= dt;
        if (peekIn <= 0 && peekT < 0 && shyAmount > 0.9) {
          peekT = 0;
          peekIn = 4 + Math.random() * 4;
        }
        let peek = 0;
        if (peekT >= 0) {
          peekT += dt;
          peek = Math.sin(clamp01(peekT / 0.9) * Math.PI);
          if (peekT > 0.9) peekT = -1;
        }
        const squint = lerp(1, 0.55, happyAmount);
        for (const eye of eyeMeshes) {
          eye.scale.y = Math.max(
            0.08,
            blink * squint * lerp(1, 0.5, shyAmount)
          );
        }
        smile.scale.setScalar(1 + happyAmount * 0.45);
        smile.position.y = 0.37 - happyAmount * 0.01;
        blushMat.opacity = shyAmount * 0.85;
        for (const blush of blushes) blush.scale.x = 1.3 + shyAmount * 0.3;

        // Beacon and chest LEDs.
        const pulse = still ? 0.6 : 0.5 + 0.5 * Math.sin(t * 3);
        beaconMat.color.setRGB(1, 0.35 + 0.3 * pulse, 0.2 + 0.2 * pulse);
        beacon.scale.setScalar(1 + 0.25 * pulse);
        antenna.rotation.z = still
          ? 0
          : Math.sin(t * 1.6) * 0.08 - lookX * 0.05;
        leds.forEach((led, i) => {
          const on = still ? 1 : 0.55 + 0.45 * Math.sin(t * 2.1 + i * 1.7);
          led.scale.setScalar(0.8 + 0.4 * on);
        });

        // Legs swing while he waits; the knees bend on the back swing.
        for (const { side, hip, knee } of legs) {
          const phase = side > 0 ? 0 : Math.PI;
          const swing = Math.sin(t * 2.4 + phase);
          hip.rotation.x = still ? 0.05 : 0.06 + swing * 0.26;
          knee.rotation.x = still
            ? 0.1
            : 0.1 + 0.55 * Math.max(0, Math.sin(t * 2.4 + phase + 1));
        }

        // Arms: rest on the edge, wave hello once, or cover the eyes.
        const waveOn =
          !still && t > 0.7 && t < 3.2 && shyAmount < 0.05
            ? clamp01((t - 0.7) / 0.4) * clamp01((3.2 - t) / 0.4)
            : 0;
        for (const arm of arms) {
          const { side } = arm;
          shoulderPos.set(
            side * 0.6,
            lerp(0.72, 0.84, shyAmount),
            lerp(0, 0.08, shyAmount)
          );
          // Rest target, then wave, then cover.
          target.set(side * 0.7, 0.12, 0.16);
          if (side > 0 && waveOn > 0) {
            const sway = Math.sin(t * 11) * 0.09 * waveOn;
            target.lerp(
              anchor.set(0.95 + sway, 1.25 + Math.cos(t * 11) * 0.03, 0.15),
              waveOn
            );
          }
          if (shyAmount > 0.001) {
            eyeAnchors[side < 0 ? 0 : 1].getWorldPosition(anchor);
            rig.worldToLocal(anchor);
            // The right hand lifts away now and then for a peek.
            if (side > 0) anchor.x += peek * 0.2;
            if (side > 0) anchor.y -= peek * 0.04;
            target.lerp(anchor, shyAmount);
          }
          solveArm(arm, shoulderPos, target);
        }
        if (peek > 0.3) {
          eyeMeshes[1].scale.y = Math.max(eyeMeshes[1].scale.y, 0.9 * peek);
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
      focus = focusOf(document.activeElement);
      start();

      cleanup = () => {
        cancelAnimationFrame(raf);
        window.removeEventListener("pointermove", onPointer);
        document.removeEventListener("focusin", onFocusIn);
        document.removeEventListener("focusout", onFocusOut);
        document.removeEventListener("visibilitychange", start);
        reduced.removeEventListener("change", start);
        scene.traverse((object) => {
          const m = object as Mesh;
          if (m.isMesh) m.geometry.dispose();
        });
        materials.forEach((material) => material.dispose());
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
