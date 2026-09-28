import { useEffect, useRef } from "react";
import type { Awareness } from "y-protocols/awareness";
import type { AwarenessState, Camera } from "../lib/types";

const TRAIL_TTL = 700; // ms a trail segment stays visible

interface Trail {
  color: string;
  /** Growing point list; `start` is the index of the first live point. */
  pts: Array<{ x: number; y: number; t: number }>;
  /** First index not yet expired — pruned in place, so no per-frame
   *  reallocation (the old filter() built a new array every frame). */
  start: number;
}

/**
 * Laser pointer trails, rendered on a screen-space 2D canvas. The rAF loop
 * only runs while trails are live: it starts when a point arrives and stops
 * (after a final clear) once every trail has expired, so an idle board costs
 * zero per-frame work.
 */
export function LaserOverlay({ awareness, camera }: { awareness: Awareness; camera: Camera }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trails = useRef(new Map<number, Trail>());
  const rafRef = useRef(0);
  const camRef = useRef(camera);
  camRef.current = camera;

  useEffect(() => {
    const ensureLoop = () => {
      if (rafRef.current === 0) rafRef.current = requestAnimationFrame(draw);
    };
    const draw = () => {
      rafRef.current = 0; // stop; restarted below while trails are live
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      const ctx = canvas.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const now = performance.now();
      const cam = camRef.current;
      const sx = (x: number) => (x - cam.x) * cam.z;
      const sy = (y: number) => (y - cam.y) * cam.z;
      let live = false;

      trails.current.forEach((trail, clientId) => {
        while (trail.start < trail.pts.length && now - trail.pts[trail.start]!.t >= TRAIL_TTL) {
          trail.start++;
        }
        if (trail.start >= trail.pts.length) {
          trails.current.delete(clientId);
          return;
        }
        // Amortized compaction: drop the dead prefix now and then so the
        // array stays bounded without a per-frame copy.
        if (trail.start > 64 && trail.start * 2 > trail.pts.length) {
          trail.pts.splice(0, trail.start);
          trail.start = 0;
        }
        live = true;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        for (let i = trail.start + 1; i < trail.pts.length; i++) {
          const a = trail.pts[i - 1]!;
          const b = trail.pts[i]!;
          const alpha = Math.max(0, 1 - (now - b.t) / TRAIL_TTL);
          ctx.strokeStyle = trail.color;
          ctx.globalAlpha = alpha * 0.85;
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(sx(a.x), sy(a.y));
          ctx.lineTo(sx(b.x), sy(b.y));
          ctx.stroke();
        }
        const head = trail.pts[trail.pts.length - 1]!;
        const headAlpha = Math.max(0, 1 - (now - head.t) / TRAIL_TTL);
        ctx.globalAlpha = headAlpha;
        ctx.fillStyle = trail.color;
        ctx.beginPath();
        ctx.arc(sx(head.x), sy(head.y), 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      });

      if (live) rafRef.current = requestAnimationFrame(draw);
    };

    const onChange = () => {
      awareness.getStates().forEach((raw, clientId) => {
        const state = raw as AwarenessState;
        if (!state?.laser) return;
        let trail = trails.current.get(clientId);
        if (!trail) {
          trail = { color: state.user?.color ?? "#ef4444", pts: [], start: 0 };
          trails.current.set(clientId, trail);
        }
        if (state.user?.color) trail.color = state.user.color;
        const last = trail.pts[trail.pts.length - 1];
        if (!last || last.x !== state.laser.x || last.y !== state.laser.y) {
          trail.pts.push({ x: state.laser.x, y: state.laser.y, t: performance.now() });
          ensureLoop(); // a new point means the frame loop must be running
        }
      });
    };
    awareness.on("change", onChange);
    return () => {
      awareness.off("change", onChange);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
  }, [awareness]);

  return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />;
}
