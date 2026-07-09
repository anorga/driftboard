import { describe, expect, it } from "vitest";
import {
  screenToWorld,
  worldToScreen,
  zoomAt,
  normalizeRect,
  rectsIntersect,
  elementBounds,
  fitCamera,
} from "./geometry";
import { MAX_ZOOM, MIN_ZOOM } from "./constants";
import type { BoardElement, Camera } from "./types";

const cam: Camera = { x: 100, y: 50, z: 2 };

function el(partial: Partial<BoardElement>): BoardElement {
  return { id: "e1", type: "rect", x: 0, y: 0, w: 100, h: 100, color: "yellow", order: 1, ...partial };
}

describe("screenToWorld / worldToScreen", () => {
  it("are inverses", () => {
    const screen = { x: 123, y: 456 };
    const world = screenToWorld(screen, cam);
    expect(worldToScreen(world, cam)).toEqual(screen);
  });

  it("maps the screen origin to the camera position", () => {
    expect(screenToWorld({ x: 0, y: 0 }, cam)).toEqual({ x: 100, y: 50 });
  });
});

describe("zoomAt", () => {
  it("keeps the given screen point fixed in world space", () => {
    const screen = { x: 300, y: 200 };
    const before = screenToWorld(screen, cam);
    const zoomed = zoomAt(cam, screen, cam.z * 1.7);
    const after = screenToWorld(screen, zoomed);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it("clamps to the zoom limits", () => {
    expect(zoomAt(cam, { x: 0, y: 0 }, 999).z).toBe(MAX_ZOOM);
    expect(zoomAt(cam, { x: 0, y: 0 }, 0.0001).z).toBe(MIN_ZOOM);
  });
});

describe("normalizeRect", () => {
  it("normalizes rects dragged in any direction", () => {
    const rect = normalizeRect({ x: 10, y: 20 }, { x: -5, y: 60 });
    expect(rect).toEqual({ x: -5, y: 20, w: 15, h: 40 });
  });
});

describe("rectsIntersect", () => {
  const a = { x: 0, y: 0, w: 10, h: 10 };
  it("detects overlap", () => {
    expect(rectsIntersect(a, { x: 5, y: 5, w: 10, h: 10 })).toBe(true);
  });
  it("rejects disjoint rects", () => {
    expect(rectsIntersect(a, { x: 20, y: 0, w: 5, h: 5 })).toBe(false);
  });
  it("rejects rects that only share an edge", () => {
    expect(rectsIntersect(a, { x: 10, y: 0, w: 5, h: 5 })).toBe(false);
  });
});

describe("elementBounds", () => {
  it("passes through normal elements", () => {
    expect(elementBounds(el({ x: 5, y: 6, w: 7, h: 8 }))).toEqual({ x: 5, y: 6, w: 7, h: 8 });
  });

  it("normalizes arrows with negative offsets", () => {
    const arrow = el({ type: "arrow", x: 100, y: 100, w: -40, h: -30 });
    expect(elementBounds(arrow)).toEqual({ x: 60, y: 70, w: 40, h: 30 });
  });
});

describe("fitCamera", () => {
  const viewport = { width: 1000, height: 800 };
  const fallback: Camera = { x: 0, y: 0, z: 1 };

  it("returns the fallback for an empty board", () => {
    expect(fitCamera([], viewport, fallback)).toBe(fallback);
  });

  it("fits all elements inside the viewport", () => {
    const els = [el({ x: 0, y: 0, w: 500, h: 100 }), el({ id: "e2", x: 900, y: 700, w: 100, h: 100 })];
    const fit = fitCamera(els, viewport, fallback);
    for (const e of els) {
      const tl = worldToScreen({ x: e.x, y: e.y }, fit);
      const br = worldToScreen({ x: e.x + e.w, y: e.y + e.h }, fit);
      expect(tl.x).toBeGreaterThanOrEqual(0);
      expect(tl.y).toBeGreaterThanOrEqual(0);
      expect(br.x).toBeLessThanOrEqual(viewport.width);
      expect(br.y).toBeLessThanOrEqual(viewport.height);
    }
  });
});
