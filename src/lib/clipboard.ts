import type { BoardElement } from "./types";

/**
 * Element clipboard format: plain text JSON with a marker key, so it survives
 * any OS clipboard, pastes across boards and browser tabs, and degrades to
 * harmless text anywhere else.
 */
export const CLIPBOARD_MARKER = "driftboard";

export function parseClipboardElements(text: string): BoardElement[] | null {
  try {
    const data = JSON.parse(text) as Record<string, unknown>;
    if (data?.[CLIPBOARD_MARKER] !== 1 || !Array.isArray(data.elements)) return null;
    const els = data.elements as BoardElement[];
    // Minimal shape check — reject anything that would corrupt the doc
    if (!els.every((el) => typeof el?.id === "string" && typeof el.type === "string" &&
        typeof el.x === "number" && typeof el.y === "number" &&
        typeof el.w === "number" && typeof el.h === "number")) {
      return null;
    }
    return els;
  } catch {
    return null;
  }
}
