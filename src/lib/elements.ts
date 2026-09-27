import * as Y from "yjs";
import { nanoid } from "nanoid";
import { LOCAL_ORIGIN } from "./board";
import type { BoardElement, ElementType } from "./types";

/**
 * Each element is its own Y.Map so concurrent edits merge per-field:
 * one person can recolor a note while another moves it, and both edits win.
 */

function nextOrder(elements: Y.Map<Y.Map<unknown>>): number {
  let max = 0;
  elements.forEach((el) => {
    const o = (el.get("order") as number) ?? 0;
    if (o > max) max = o;
  });
  return max + 1;
}

export interface NewElement {
  type: ElementType;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  text?: string;
  points?: number[];
  size?: number;
  src?: string;
  startRef?: string;
  endRef?: string;
}

/**
 * Serialize an element into a fresh Y.Map. The single source of truth for
 * which fields an element carries — addElement and duplicateElements both
 * write through here, so a new field can never silently drop on duplicate.
 */
function writeElement(fields: NewElement & { id: string; order: number }): Y.Map<unknown> {
  const ymap = new Y.Map<unknown>();
  ymap.set("id", fields.id);
  ymap.set("type", fields.type);
  ymap.set("x", fields.x);
  ymap.set("y", fields.y);
  ymap.set("w", fields.w);
  ymap.set("h", fields.h);
  ymap.set("color", fields.color);
  ymap.set("order", fields.order);
  for (const key of ["size", "src", "startRef", "endRef"] as const) {
    if (fields[key] !== undefined) ymap.set(key, fields[key]);
  }
  // Text is a Y.Text so two people typing into the same note merge
  // character-for-character instead of last-write-wins on a scalar field.
  if (fields.text !== undefined) {
    const yt = new Y.Text();
    if (fields.text.length > 0) yt.insert(0, fields.text);
    ymap.set("text", yt);
  }
  if (fields.points !== undefined) {
    const arr = new Y.Array<number>();
    arr.push([...fields.points]);
    ymap.set("points", arr);
  }
  return ymap;
}

export function addElement(doc: Y.Doc, elements: Y.Map<Y.Map<unknown>>, el: NewElement): string {
  const id = nanoid(10);
  doc.transact(() => {
    elements.set(id, writeElement({ ...el, id, order: nextOrder(elements) }));
  }, LOCAL_ORIGIN);
  return id;
}

export function updateElement(
  doc: Y.Doc,
  elements: Y.Map<Y.Map<unknown>>,
  id: string,
  patch: Partial<BoardElement>,
) {
  updateElements(doc, elements, [{ id, patch }]);
}

/**
 * Apply field patches. A key explicitly set to `undefined` is DELETED from
 * the element (used to clear arrow bindings) — don't spread optional fields
 * into a patch unless that's what you mean. `text` is special: it's stored as
 * a Y.Text so concurrent edits merge character-for-character, so it's routed
 * through the diff path instead of a plain `el.set` (which would clobber the
 * shared type with a scalar).
 */
export function updateElements(
  doc: Y.Doc,
  elements: Y.Map<Y.Map<unknown>>,
  patches: Array<{ id: string; patch: Partial<BoardElement> }>,
) {
  doc.transact(() => {
    for (const { id, patch } of patches) {
      const el = elements.get(id);
      if (!el) continue;
      for (const [k, v] of Object.entries(patch)) {
        if (k === "points") continue; // points are append-only via appendStrokePoints
        if (k === "text") {
          writeTextInto(el, typeof v === "string" ? v : "");
          continue;
        }
        if (v === undefined) el.delete(k);
        else el.set(k, v);
      }
    }
  }, LOCAL_ORIGIN);
}

/**
 * Make an element's `text` field a Y.Text and diff it to `to`, so two people
 * typing into the same note merge instead of last-write-wins. The migration
 * (scalar → Y.Text) and the diff happen in one transaction, so a legacy note
 * is upgraded and edited in a single undo step. Callers must be inside a
 * `doc.transact` (see updateElements / setText).
 */
function writeTextInto(el: Y.Map<unknown>, to: string) {
  const existing = el.get("text");
  let t: Y.Text;
  if (existing instanceof Y.Text) {
    t = existing;
  } else {
    const legacy = typeof existing === "string" ? existing : "";
    t = new Y.Text();
    if (legacy.length > 0) t.insert(0, legacy);
    el.set("text", t);
  }
  applyTextDiff(t, to);
}

/** Set an element's text with collaborative (character-level) semantics. */
export function setText(doc: Y.Doc, elements: Y.Map<Y.Map<unknown>>, id: string, to: string) {
  const el = elements.get(id);
  if (!el) return;
  doc.transact(() => writeTextInto(el, to), LOCAL_ORIGIN);
}

/**
 * Minimal Y.Text edit to turn the current text into `to`: delete the changed
 * middle, insert the new middle. Common prefix/suffix are kept, so an append
 * (the common typing case) is a single insert and a deletion is a single
 * delete. Applied to a Y.Text so concurrent edits from peers merge.
 */
function applyTextDiff(yt: Y.Text, to: string) {
  const from = yt.toString();
  if (from === to) return;
  let i = 0;
  while (i < from.length && i < to.length && from[i] === to[i]) i++;
  let j = 0;
  while (j < from.length - i && j < to.length - i && from[from.length - 1 - j] === to[to.length - 1 - j]) j++;
  const deleteLen = from.length - i - j;
  if (deleteLen > 0) yt.delete(i, deleteLen);
  const insert = to.slice(i, to.length - j);
  if (insert.length > 0) yt.insert(i, insert);
}

export function deleteElements(doc: Y.Doc, elements: Y.Map<Y.Map<unknown>>, ids: Iterable<string>) {
  doc.transact(() => {
    for (const id of ids) elements.delete(id);
  }, LOCAL_ORIGIN);
}

export function duplicateElements(
  doc: Y.Doc,
  elements: Y.Map<Y.Map<unknown>>,
  ids: Iterable<string>,
): string[] {
  const newIds: string[] = [];
  // Map old ids to new so arrow bindings follow shapes duplicated with them.
  const idMap = new Map<string, string>();
  for (const id of ids) {
    if (elements.has(id)) idMap.set(id, nanoid(10));
  }
  doc.transact(() => {
    for (const [id, newId] of idMap) {
      const src = elements.get(id);
      if (!src) continue;
      const json = src.toJSON() as BoardElement;
      const copy = writeElement({
        ...json,
        id: newId,
        x: json.x + 24,
        y: json.y + 24,
        order: nextOrder(elements),
        startRef: json.startRef && (idMap.get(json.startRef) ?? json.startRef),
        endRef: json.endRef && (idMap.get(json.endRef) ?? json.endRef),
      });
      elements.set(newId, copy);
      newIds.push(newId);
    }
  }, LOCAL_ORIGIN);
  return newIds;
}

/**
 * Insert copied elements (e.g. from the clipboard) so their combined center
 * lands at `at`. Ids are regenerated; arrow bindings are remapped when the
 * bound shape was copied too and stripped otherwise (the copied geometry is
 * already the resolved fallback).
 */
export function pasteElements(
  doc: Y.Doc,
  elements: Y.Map<Y.Map<unknown>>,
  copied: BoardElement[],
  at: { x: number; y: number },
): string[] {
  if (copied.length === 0) return [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const el of copied) {
    minX = Math.min(minX, el.x);
    minY = Math.min(minY, el.y);
    maxX = Math.max(maxX, el.x + el.w);
    maxY = Math.max(maxY, el.y + el.h);
  }
  const dx = at.x - (minX + maxX) / 2;
  const dy = at.y - (minY + maxY) / 2;
  const idMap = new Map(copied.map((el) => [el.id, nanoid(10)]));
  doc.transact(() => {
    for (const el of copied) {
      const newId = idMap.get(el.id)!;
      elements.set(
        newId,
        writeElement({
          ...el,
          id: newId,
          x: el.x + dx,
          y: el.y + dy,
          order: nextOrder(elements),
          startRef: el.startRef ? idMap.get(el.startRef) : undefined,
          endRef: el.endRef ? idMap.get(el.endRef) : undefined,
        }),
      );
    }
  }, LOCAL_ORIGIN);
  return [...idMap.values()];
}

/** Raise the given elements above everything else, preserving their relative order. */
export function bringToFront(doc: Y.Doc, elements: Y.Map<Y.Map<unknown>>, ids: Iterable<string>) {
  doc.transact(() => {
    const sorted = [...ids]
      .map((id) => elements.get(id))
      .filter((el): el is Y.Map<unknown> => !!el)
      .sort((a, b) => (((a.get("order") as number) ?? 0) - ((b.get("order") as number) ?? 0)));
    for (const el of sorted) el.set("order", nextOrder(elements));
  }, LOCAL_ORIGIN);
}

/** Lower the given elements below everything else, preserving their relative order. */
export function sendToBack(doc: Y.Doc, elements: Y.Map<Y.Map<unknown>>, ids: Iterable<string>) {
  doc.transact(() => {
    let min = Infinity;
    elements.forEach((el) => {
      const o = (el.get("order") as number) ?? 0;
      if (o < min) min = o;
    });
    const sorted = [...ids]
      .map((id) => elements.get(id))
      .filter((el): el is Y.Map<unknown> => !!el)
      .sort((a, b) => (((a.get("order") as number) ?? 0) - ((b.get("order") as number) ?? 0)));
    if (!Number.isFinite(min) || sorted.length === 0) return;
    let order = min - sorted.length;
    for (const el of sorted) el.set("order", order++);
  }, LOCAL_ORIGIN);
}

/** Append points to a stroke while drawing, so peers watch it appear live. */
export function appendStrokePoints(
  doc: Y.Doc,
  elements: Y.Map<Y.Map<unknown>>,
  id: string,
  pts: number[],
) {
  const el = elements.get(id);
  if (!el) return;
  const arr = el.get("points") as Y.Array<number> | undefined;
  if (!arr) return;
  doc.transact(() => {
    arr.push(pts);
  }, LOCAL_ORIGIN);
}

/**
 * After a pen stroke finishes: shift its origin to the stroke's bounding box
 * so selection and movement work like any other element.
 */
export function normalizeStroke(doc: Y.Doc, elements: Y.Map<Y.Map<unknown>>, id: string) {
  const el = elements.get(id);
  if (!el) return;
  const arr = el.get("points") as Y.Array<number> | undefined;
  if (!arr || arr.length < 3) return;
  const pts = arr.toArray();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < pts.length; i += 3) {
    minX = Math.min(minX, pts[i]);
    maxX = Math.max(maxX, pts[i]);
    minY = Math.min(minY, pts[i + 1]);
    maxY = Math.max(maxY, pts[i + 1]);
  }
  const pad = ((el.get("size") as number) ?? 4) * 2;
  minX -= pad; minY -= pad; maxX += pad; maxY += pad;
  const rel: number[] = [];
  for (let i = 0; i < pts.length; i += 3) {
    rel.push(pts[i] - minX, pts[i + 1] - minY, pts[i + 2]);
  }
  doc.transact(() => {
    const fresh = new Y.Array<number>();
    fresh.push(rel);
    el.set("points", fresh);
    el.set("x", ((el.get("x") as number) ?? 0) + minX);
    el.set("y", ((el.get("y") as number) ?? 0) + minY);
    el.set("w", maxX - minX);
    el.set("h", maxY - minY);
  }, LOCAL_ORIGIN);
}
