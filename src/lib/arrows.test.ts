import { describe, expect, it } from "vitest";
import { anchorPoint, hitTestBindTarget, resolveArrows } from "./arrows";
import type { BoardElement } from "./types";

function el(partial: Partial<BoardElement>): BoardElement {
  return { id: "e1", type: "rect", x: 0, y: 0, w: 100, h: 100, color: "yellow", order: 1, ...partial };
}

describe("anchorPoint", () => {
  it("exits a rect through the facing edge (plus a small gap)", () => {
    const shape = el({ x: 0, y: 0, w: 100, h: 100 });
    const p = anchorPoint(shape, { x: 300, y: 50 }); // due east of center
    expect(p.x).toBeGreaterThanOrEqual(100);
    expect(p.x).toBeLessThan(112);
    expect(p.y).toBeCloseTo(50);
  });

  it("exits an ellipse on its boundary, not its bounding box corner", () => {
    const shape = el({ type: "ellipse", x: 0, y: 0, w: 100, h: 100 });
    const p = anchorPoint(shape, { x: 200, y: 200 }); // 45° toward bottom-right
    // Ellipse radius at 45° is 50, so the anchor sits ~(85, 85), well inside
    // the bounding-box corner (100, 100).
    const dist = Math.hypot(p.x - 50, p.y - 50);
    expect(dist).toBeGreaterThan(50);
    expect(dist).toBeLessThan(60);
    expect(p.x).toBeCloseTo(p.y);
  });

  it("returns the center for a zero-length direction", () => {
    const shape = el({ x: 0, y: 0, w: 100, h: 100 });
    expect(anchorPoint(shape, { x: 50, y: 50 })).toEqual({ x: 50, y: 50 });
  });
});

describe("resolveArrows", () => {
  it("passes unbound arrows through with identity preserved", () => {
    const els = [el({}), el({ id: "a", type: "arrow", x: 10, y: 10, w: 50, h: 0 })];
    expect(resolveArrows(els)).toBe(els);
  });

  it("pins bound endpoints to the shapes' borders and follows moves", () => {
    const shapeA = el({ id: "s1", x: 0, y: 0, w: 100, h: 100 });
    const shapeB = el({ id: "s2", x: 300, y: 0, w: 100, h: 100, order: 2 });
    const arrow = el({ id: "a", type: "arrow", x: 50, y: 50, w: 100, h: 0, order: 3, startRef: "s1", endRef: "s2" });

    const [, , resolved] = resolveArrows([shapeA, shapeB, arrow]);
    // Start exits shapeA's right edge, end enters shapeB's left edge
    expect(resolved.x).toBeGreaterThanOrEqual(100);
    expect(resolved.y).toBeCloseTo(50);
    expect(resolved.x + resolved.w).toBeLessThanOrEqual(300);
    expect(resolved.y + resolved.h).toBeCloseTo(50);

    // Moving shapeB down drags the arrow's end with it
    const moved = { ...shapeB, y: 400 };
    const [, , resolved2] = resolveArrows([shapeA, moved, arrow]);
    expect(resolved2.y + resolved2.h).toBeGreaterThan(100);
  });

  it("falls back to stored geometry when a referenced element is gone", () => {
    const arrow = el({ id: "a", type: "arrow", x: 10, y: 20, w: 30, h: 40, startRef: "missing" });
    const [resolved] = resolveArrows([arrow]);
    expect(resolved).toMatchObject({ x: 10, y: 20, w: 30, h: 40 });
  });
});

describe("hitTestBindTarget", () => {
  const bottom = el({ id: "bottom", x: 0, y: 0, w: 100, h: 100, order: 1 });
  const top = el({ id: "top", x: 50, y: 50, w: 100, h: 100, order: 2 });
  const stroke = el({ id: "ink", type: "stroke", x: 0, y: 0, w: 200, h: 200, order: 3 });

  it("returns the topmost bindable element under the point", () => {
    expect(hitTestBindTarget([bottom, top, stroke], { x: 75, y: 75 })?.id).toBe("top");
  });

  it("ignores strokes and misses", () => {
    expect(hitTestBindTarget([stroke], { x: 75, y: 75 })).toBeNull();
    expect(hitTestBindTarget([bottom], { x: 500, y: 500 })).toBeNull();
  });

  it("respects the exclusion id", () => {
    expect(hitTestBindTarget([bottom, top], { x: 75, y: 75 }, "top")?.id).toBe("bottom");
  });
});
