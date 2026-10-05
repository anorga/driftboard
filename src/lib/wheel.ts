/**
 * Wheel-event unit normalization.
 *
 * `WheelEvent.deltaMode` reports the UNIT of `deltaX`/`deltaY` — pixels (0),
 * lines (1) or pages (2) — so the mode must be read BEFORE the values are
 * interpreted: the same physical mouse notch arrives as "3" in one unit on
 * one browser and "3" in another unit elsewhere, and raw numbers are not
 * comparable across modes. MDN documents the modes but does NOT standardize
 * a notch magnitude.
 *
 * Application policy (a documented UX conversion choice, not a
 * standards-mandated or hardware-exact value):
 *  - mode 0 (pixels): deltas pass through numerically UNCHANGED — no extra
 *    sensitivity, clamp or smoothing; existing pixel feel is bit-identical.
 *  - mode 1 (lines): 24 logical/CSS pixels per line on both axes (matches
 *    the board's 24px grid scale).
 *  - mode 2 (pages): one page is the canvas viewport width for x and height
 *    for y (the actual viewport, not the window).
 *  - unknown modes: conservative fallback to pixel behavior.
 */

export const WHEEL_PIXELS_PER_LINE = 24;

export interface RawWheelDelta {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
}

export interface WheelViewport {
  width: number;
  height: number;
}

/** Convert a wheel event's deltas to CSS pixels under the policy above. */
export function normalizeWheelDelta(
  raw: RawWheelDelta,
  viewport: WheelViewport,
): { deltaX: number; deltaY: number } {
  switch (raw.deltaMode) {
    case 1: // DOM_DELTA_LINE
      return {
        deltaX: raw.deltaX * WHEEL_PIXELS_PER_LINE,
        deltaY: raw.deltaY * WHEEL_PIXELS_PER_LINE,
      };
    case 2: // DOM_DELTA_PAGE
      return {
        deltaX: raw.deltaX * viewport.width,
        deltaY: raw.deltaY * viewport.height,
      };
    default:
      // DOM_DELTA_PIXEL returns the exact same numbers (no arithmetic at
      // all, so even -0 survives); unknown modes conservatively behave as
      // pixels rather than inventing a factor.
      return { deltaX: raw.deltaX, deltaY: raw.deltaY };
  }
}
