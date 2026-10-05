import { describe, expect, it } from "vitest";
import { normalizeWheelDelta, WHEEL_PIXELS_PER_LINE } from "./wheel";

// Arbitrary non-square viewport so an axis mix-up can't pass silently.
const vp = { width: 1280, height: 720 };

describe("normalizeWheelDelta", () => {
  it("passes pixel-mode deltas through unchanged (signs, fractions, negative zero)", () => {
    expect(normalizeWheelDelta({ deltaX: 120, deltaY: 60, deltaMode: 0 }, vp)).toEqual({
      deltaX: 120,
      deltaY: 60,
    });
    // Existing sensitivity must not drift: fractional pixel deltas verbatim.
    expect(normalizeWheelDelta({ deltaX: -3.14159, deltaY: 0.0005, deltaMode: 0 }, vp)).toEqual({
      deltaX: -3.14159,
      deltaY: 0.0005,
    });
    const r = normalizeWheelDelta({ deltaX: 0, deltaY: -0, deltaMode: 0 }, vp);
    expect(Object.is(r.deltaY, -0)).toBe(true); // no arithmetic happens in pixel mode
  });

  it("converts line-mode deltas at 24 px/line on both axes and both signs", () => {
    expect(WHEEL_PIXELS_PER_LINE).toBe(24);
    expect(normalizeWheelDelta({ deltaX: 1, deltaY: 3, deltaMode: 1 }, vp)).toEqual({
      deltaX: 24,
      deltaY: 72,
    });
    expect(normalizeWheelDelta({ deltaX: -2, deltaY: -3, deltaMode: 1 }, vp)).toEqual({
      deltaX: -48,
      deltaY: -72,
    });
    expect(normalizeWheelDelta({ deltaX: 2.5, deltaY: -0.5, deltaMode: 1 }, vp)).toEqual({
      deltaX: 60,
      deltaY: -12,
    });
  });

  it("converts page-mode deltas with the viewport width/height per axis", () => {
    // x must use width, y must use height — a non-square viewport proves it.
    expect(normalizeWheelDelta({ deltaX: 1, deltaY: 1, deltaMode: 2 }, vp)).toEqual({
      deltaX: 1280,
      deltaY: 720,
    });
    expect(normalizeWheelDelta({ deltaX: -1, deltaY: 0.5, deltaMode: 2 }, vp)).toEqual({
      deltaX: -1280,
      deltaY: 360,
    });
  });

  it("falls back conservatively to pixel behavior for unknown modes", () => {
    expect(normalizeWheelDelta({ deltaX: 5, deltaY: -7, deltaMode: 99 }, vp)).toEqual({
      deltaX: 5,
      deltaY: -7,
    });
  });

  it("normalized line events equal the camera-equivalent pixel event", () => {
    // Pan math is linear in the deltas, so equal pixel output === equal
    // camera result at any zoom.
    const line = normalizeWheelDelta({ deltaX: 2, deltaY: -3, deltaMode: 1 }, vp);
    const pixel = normalizeWheelDelta({ deltaX: 48, deltaY: -72, deltaMode: 0 }, vp);
    expect(line).toEqual(pixel);
    const page = normalizeWheelDelta({ deltaX: 1, deltaY: -1, deltaMode: 2 }, vp);
    const pageAsPixel = normalizeWheelDelta({ deltaX: 1280, deltaY: -720, deltaMode: 0 }, vp);
    expect(page).toEqual(pageAsPixel);
  });
});
