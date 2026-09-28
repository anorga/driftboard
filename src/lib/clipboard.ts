import type { BoardElement, ElementType } from "./types";
import { PALETTE } from "./constants";

/**
 * Element clipboard format: plain text JSON with a marker key, so it survives
 * any OS clipboard, pastes across boards and browser tabs, and degrades to
 * harmless text anywhere else.
 */
export const CLIPBOARD_MARKER = "driftboard";

// Validation bounds. Paste is attacker-controllable (any clipboard content),
// so we reject anything that isn't a sane, known element: unknown types,
// non-finite or absurdly large geometry, oversized text/points, and image
// sources that aren't self-contained data URLs (a remote URL would trigger
// outbound requests and can taint PNG export).
const MAX_DIM = 1e6;
const MAX_TEXT = 100_000;
const MAX_POINTS = 200_000;
const MAX_SRC_BYTES = 5 * 1024 * 1024;
const KNOWN_TYPES: ReadonlySet<string> = new Set([
  "sticky", "text", "rect", "ellipse", "arrow", "stroke", "image",
]);
const KNOWN_COLORS: ReadonlySet<string> = new Set(PALETTE.map((c) => c.id));

function isFiniteNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Coerce one raw clipboard element into a valid BoardElement, or null. */
function sanitize(raw: unknown): BoardElement | null {
  if (typeof raw !== "object" || raw === null) return null;
  const el = raw as Record<string, unknown>;

  if (typeof el.id !== "string" || el.id.length === 0) return null;
  if (typeof el.type !== "string" || !KNOWN_TYPES.has(el.type)) return null;
  const type = el.type as ElementType;

  for (const k of ["x", "y", "w", "h"] as const) {
    if (!isFiniteNum(el[k]) || Math.abs(el[k] as number) > MAX_DIM) return null;
  }

  const out: BoardElement = {
    id: el.id,
    type,
    x: el.x as number,
    y: el.y as number,
    w: el.w as number,
    h: el.h as number,
    // Unknown colors fall back to a known one rather than corrupting the board.
    color: KNOWN_COLORS.has(el.color as string) ? (el.color as string) : "yellow",
    order: isFiniteNum(el.order) ? el.order : 0,
  };

  if (el.text !== undefined) {
    if (typeof el.text !== "string" || el.text.length > MAX_TEXT) return null;
    out.text = el.text;
  }
  if (el.size !== undefined) {
    if (!isFiniteNum(el.size) || el.size <= 0 || el.size > MAX_DIM) return null;
    out.size = el.size;
  }
  if (el.points !== undefined) {
    if (!Array.isArray(el.points) || el.points.length > MAX_POINTS) return null;
    if (el.points.some((p) => !isFiniteNum(p) || Math.abs(p as number) > MAX_DIM)) return null;
    out.points = el.points as number[];
  }
  if (el.src !== undefined) {
    // Only self-contained image data URLs — never a remote URL.
    if (typeof el.src !== "string" || !el.src.startsWith("data:image/") ||
        el.src.length > MAX_SRC_BYTES) {
      return null;
    }
    out.src = el.src;
  }
  if (el.startRef !== undefined) {
    if (typeof el.startRef !== "string") return null;
    out.startRef = el.startRef;
  }
  if (el.endRef !== undefined) {
    if (typeof el.endRef !== "string") return null;
    out.endRef = el.endRef;
  }
  return out;
}

export function parseClipboardElements(text: string): BoardElement[] | null {
  try {
    const data = JSON.parse(text) as Record<string, unknown>;
    if (data?.[CLIPBOARD_MARKER] !== 1 || !Array.isArray(data.elements)) return null;
    const els = (data.elements as unknown[])
      .map(sanitize)
      .filter((e): e is BoardElement => e !== null);
    return els.length > 0 ? els : null;
  } catch {
    return null;
  }
}
