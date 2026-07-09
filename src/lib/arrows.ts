/**
 * Arrow-to-shape bindings.
 *
 * An arrow can carry `startRef`/`endRef` element ids. Bound endpoints are
 * not stored as coordinates — they're resolved every render from the current
 * geometry of the referenced elements, so arrows stay attached while shapes
 * move. The arrow's stored x/y/w/h remain as a fallback for endpoints that
 * are unbound (or whose referenced element was deleted).
 */
import type { BoardElement } from "./types";
import { elementBounds, type Point } from "./geometry";

/** Gap between a bound endpoint and the shape border, in world units. */
const ANCHOR_GAP = 6;

/** Element types an arrow endpoint can attach to. */
const BINDABLE = new Set(["sticky", "text", "rect", "ellipse", "image"]);

export function isBindable(el: BoardElement): boolean {
  return BINDABLE.has(el.type);
}

/**
 * Point on `el`'s border where a line from its center toward `toward` exits,
 * pushed out by a small gap so arrowheads don't touch the shape.
 */
export function anchorPoint(el: BoardElement, toward: Point): Point {
  const b = elementBounds(el);
  const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return c;

  let s: number;
  if (el.type === "ellipse") {
    const rx = b.w / 2;
    const ry = b.h / 2;
    s = 1 / Math.sqrt((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry));
  } else {
    const sx = dx !== 0 ? b.w / 2 / Math.abs(dx) : Infinity;
    const sy = dy !== 0 ? b.h / 2 / Math.abs(dy) : Infinity;
    s = Math.min(sx, sy);
  }
  return { x: c.x + dx * (s + ANCHOR_GAP / len), y: c.y + dy * (s + ANCHOR_GAP / len) };
}

function centerOf(el: BoardElement): Point {
  const b = elementBounds(el);
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

/**
 * Replace every bound arrow with a clone whose x/y/w/h reflect the current
 * positions of the elements it's attached to. Unbound arrows (and everything
 * else) pass through untouched, preserving object identity for memoization.
 */
export function resolveArrows(els: BoardElement[]): BoardElement[] {
  if (!els.some((el) => el.type === "arrow" && (el.startRef || el.endRef))) return els;
  const byId = new Map(els.map((el) => [el.id, el]));
  return els.map((el) => {
    if (el.type !== "arrow" || (!el.startRef && !el.endRef)) return el;
    const startEl = el.startRef ? byId.get(el.startRef) : undefined;
    const endEl = el.endRef ? byId.get(el.endRef) : undefined;
    if (!startEl && !endEl) return el;

    const rawStart = { x: el.x, y: el.y };
    const rawEnd = { x: el.x + el.w, y: el.y + el.h };
    // Each bound endpoint aims at the other side's center (or raw point).
    const start = startEl ? anchorPoint(startEl, endEl ? centerOf(endEl) : rawEnd) : rawStart;
    const end = endEl ? anchorPoint(endEl, startEl ? centerOf(startEl) : rawStart) : rawEnd;
    return { ...el, x: start.x, y: start.y, w: end.x - start.x, h: end.y - start.y };
  });
}

/** Topmost bindable element under `world`, if any. */
export function hitTestBindTarget(
  els: BoardElement[],
  world: Point,
  excludeId?: string,
): BoardElement | null {
  let best: BoardElement | null = null;
  for (const el of els) {
    if (!isBindable(el) || el.id === excludeId) continue;
    const b = elementBounds(el);
    if (world.x >= b.x && world.x <= b.x + b.w && world.y >= b.y && world.y <= b.y + b.h) {
      if (!best || el.order > best.order) best = el;
    }
  }
  return best;
}
