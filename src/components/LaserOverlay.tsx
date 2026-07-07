import { useEffect, useRef } from "react";
import type { Awareness } from "y-protocols/awareness";
import type { AwarenessState, Camera } from "../lib/types";

const TRAIL_TTL = 700; // ms a trail segment stays visible

interface Trail {
  color: string;
  pts: Array<{ x: number; y: number; t: number }>;
}

/**
 * Laser pointer trails, rendered on a screen-space 2D canvas with an rAF
 * loop so they fade smoothly. Includes the local user's own trail — everyone
 * (self included) sees the same thing.
 */
export function LaserOverlay({ awareness, camera }: { awareness: Awareness; camera: Camera }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trails = useRef(new Map<number, Trail>());
  const camRef = useRef(camera);
  camRef.current = camera;

  useEffect(() => {
    const onChange = () => {
      awareness.getStates().forEach((raw, clientId) => {
        const state = raw as AwarenessState;
        if (!state?.laser) return;
        let trail = trails.current.get(clientId);
        if (!trail) {
          trail = { color: state.user?.color ?? "#ef4444", pts: [] };
          trails.current.set(clientId, trail);
        }
        if (state.user?.color) trail.color = state.user.color;
        const last = trail.pts[trail.pts.length - 1];
        if (!last || last.x !== state.laser.x || last.y !== state.laser.y) {
          trail.pts.push({ x: state.laser.x, y: state.laser.y, t: performance.now() });
        }
      });
    };
    awareness.on("change", onChange);
    return () => awareness.off("change", onChange);
  }, [awareness]);

  useEffect(() => {
    let raf = 0;
    const draw = () => {
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

      trails.current.forEach((trail, clientId) => {
        trail.pts = trail.pts.filter((p) => now - p.t < TRAIL_TTL);
        if (trail.pts.length === 0) {
          trails.current.delete(clientId);
          return;
        }
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        for (let i = 1; i < trail.pts.length; i++) {
          const a = trail.pts[i - 1];
          const b = trail.pts[i];
          const alpha = Math.max(0, 1 - (now - b.t) / TRAIL_TTL);
          ctx.strokeStyle = trail.color;
          ctx.globalAlpha = alpha * 0.85;
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(sx(a.x), sy(a.y));
          ctx.lineTo(sx(b.x), sy(b.y));
          ctx.stroke();
        }
        const head = trail.pts[trail.pts.length - 1];
        const headAlpha = Math.max(0, 1 - (now - head.t) / TRAIL_TTL);
        ctx.globalAlpha = headAlpha;
        ctx.fillStyle = trail.color;
        ctx.beginPath();
        ctx.arc(sx(head.x), sy(head.y), 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      });
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />;
}
