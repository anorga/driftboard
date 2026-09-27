import { useCallback, useEffect, useMemo, useRef } from "react";
import type { Camera } from "./types";

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Small camera controller.
 *
 * - Discrete controls (zoom-to-fit, reset, +/-) get a short eased, cancellable
 *   tween via {@link useCameraController.tweenTo}.
 * - Follow mode eases toward a goal that later updates RETARGET (one
 *   continuously retargeted loop, never overlapping tweens, so we don't trail
 *   or stutter) via {@link useCameraController.followTarget}.
 * - Direct gestures (wheel, trackpad, pinch, drag-pan) write instantly via
 *   {@link useCameraController.instant}, which also cancels any in-flight
 *   animation so the two never fight the user.
 *
 * Respects `prefers-reduced-motion`: every animation collapses to an immediate
 * write.
 */
export function useCameraController(
  camera: Camera,
  setCamera: React.Dispatch<React.SetStateAction<Camera>>,
) {
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const rafRef = useRef<number | null>(null);
  const modeRef = useRef<"none" | "tween" | "follow">("none");
  const goalRef = useRef<Camera | null>(null);
  const reducedRef = useRef(false);

  const cancel = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    modeRef.current = "none";
    goalRef.current = null;
  }, []);

  // Discrete, eased move (~ms, default 220). `target` may be a camera or a
  // resolver against the live camera, so callers can express "zoom by 1.2 at
  // screen center" without racing the current render. Cancellable.
  const tweenTo = useCallback(
    (target: Camera | ((c: Camera) => Camera), ms = 220) => {
      reducedRef.current = prefersReducedMotion();
      cancel();
      const goal = typeof target === "function" ? target(cameraRef.current) : target;
      if (reducedRef.current) {
        setCamera(goal);
        return;
      }
      const from = cameraRef.current;
      const start = performance.now();
      modeRef.current = "tween";
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / ms);
        const e = easeOutCubic(t);
        setCamera({ x: lerp(from.x, goal.x, e), y: lerp(from.y, goal.y, e), z: lerp(from.z, goal.z, e) });
        if (t < 1) rafRef.current = requestAnimationFrame(step);
        else {
          rafRef.current = null;
          modeRef.current = "none";
        }
      };
      rafRef.current = requestAnimationFrame(step);
    },
    [cancel, setCamera],
  );

  // Follow: ease toward a goal; a retarget only moves the target of the SAME
  // loop (never overlaps a second tween, so we don't trail). The loop stops
  // itself once settled; a later goal restarts it.
  const followTarget = useCallback(
    (goal: Camera) => {
      reducedRef.current = prefersReducedMotion();
      if (reducedRef.current) {
        cancel();
        setCamera(goal);
        return;
      }
      goalRef.current = goal;
      if (modeRef.current === "follow" && rafRef.current != null) return; // retarget in place
      // Restart the loop WITHOUT wiping the goal we just set (cancel() would
      // null goalRef and the first step would bail immediately).
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      modeRef.current = "follow";
      const step = () => {
        const g = goalRef.current;
        if (!g) {
          cancel();
          return;
        }
        const cur = cameraRef.current;
        const k = 0.25;
        const nx = lerp(cur.x, g.x, k);
        const ny = lerp(cur.y, g.y, k);
        const nz = lerp(cur.z, g.z, k);
        const settled =
          Math.abs(nx - g.x) < 0.01 && Math.abs(ny - g.y) < 0.01 && Math.abs(nz - g.z) < 0.0005;
        setCamera(settled ? g : { x: nx, y: ny, z: nz });
        if (settled) {
          rafRef.current = null;
          modeRef.current = "none";
          goalRef.current = null;
        } else {
          rafRef.current = requestAnimationFrame(step);
        }
      };
      rafRef.current = requestAnimationFrame(step);
    },
    [cancel, setCamera],
  );

  // Direct gesture: cancel any animation and write immediately.
  const instant = useCallback(
    (updater: Camera | ((c: Camera) => Camera)) => {
      cancel();
      setCamera(updater as React.SetStateAction<Camera>);
    },
    [cancel, setCamera],
  );

  useEffect(() => cancel, [cancel]);

  // Stable object identity so consumers can safely use it in effect deps
  // (every function inside is itself stable).
  return useMemo(() => ({ tweenTo, followTarget, instant, cancel }), [tweenTo, followTarget, instant, cancel]);
}
