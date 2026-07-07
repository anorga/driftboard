import type { BoardElement, Camera } from "./types";
import { MAX_ZOOM, MIN_ZOOM } from "./constants";

export interface Point {
  x: number;
  y: number;
}

export function screenToWorld(p: Point, cam: Camera): Point {
  return { x: p.x / cam.z + cam.x, y: p.y / cam.z + cam.y };
}

export function worldToScreen(p: Point, cam: Camera): Point {
  return { x: (p.x - cam.x) * cam.z, y: (p.y - cam.y) * cam.z };
}

/** Zoom keeping the given screen point fixed (e.g. the cursor). */
export function zoomAt(cam: Camera, screen: Point, nextZ: number): Camera {
  const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZ));
  const world = screenToWorld(screen, cam);
  return {
    x: world.x - screen.x / z,
    y: world.y - screen.y / z,
    z,
  };
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function normalizeRect(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function elementBounds(el: BoardElement): Rect {
  // Arrows store a signed end offset in w/h; normalize to a positive rect
  if (el.type === "arrow") {
    return {
      x: Math.min(el.x, el.x + el.w),
      y: Math.min(el.y, el.y + el.h),
      w: Math.abs(el.w),
      h: Math.abs(el.h),
    };
  }
  return { x: el.x, y: el.y, w: el.w, h: el.h };
}

/** Camera that fits all elements in the viewport with padding. */
export function fitCamera(
  els: BoardElement[],
  viewport: { width: number; height: number },
  fallback: Camera,
): Camera {
  if (els.length === 0) return fallback;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const el of els) {
    minX = Math.min(minX, el.x);
    minY = Math.min(minY, el.y);
    maxX = Math.max(maxX, el.x + el.w);
    maxY = Math.max(maxY, el.y + el.h);
  }
  const pad = 80;
  const w = maxX - minX + pad * 2;
  const h = maxY - minY + pad * 2;
  const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(viewport.width / w, viewport.height / h, 1.5)));
  return {
    x: minX - pad - (viewport.width / z - w) / 2,
    y: minY - pad - (viewport.height / z - h) / 2,
    z,
  };
}
