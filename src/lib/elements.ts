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

export function addElement(doc: Y.Doc, elements: Y.Map<Y.Map<unknown>>, el: NewElement): string {
  const id = nanoid(10);
  doc.transact(() => {
    const ymap = new Y.Map<unknown>();
    ymap.set("id", id);
    ymap.set("type", el.type);
    ymap.set("x", el.x);
    ymap.set("y", el.y);
    ymap.set("w", el.w);
    ymap.set("h", el.h);
    ymap.set("color", el.color);
    ymap.set("order", nextOrder(elements));
    if (el.text !== undefined) ymap.set("text", el.text);
    if (el.size !== undefined) ymap.set("size", el.size);
    if (el.src !== undefined) ymap.set("src", el.src);
    if (el.startRef !== undefined) ymap.set("startRef", el.startRef);
    if (el.endRef !== undefined) ymap.set("endRef", el.endRef);
    if (el.points !== undefined) {
      const arr = new Y.Array<number>();
      arr.push(el.points);
      ymap.set("points", arr);
    }
    elements.set(id, ymap);
  }, LOCAL_ORIGIN);
  return id;
}

export function updateElement(
  doc: Y.Doc,
  elements: Y.Map<Y.Map<unknown>>,
  id: string,
  patch: Partial<BoardElement>,
) {
  const el = elements.get(id);
  if (!el) return;
  doc.transact(() => {
    for (const [k, v] of Object.entries(patch)) {
      if (k === "points") continue; // points are append-only via appendStrokePoints
      if (v === undefined) el.delete(k);
      else el.set(k, v);
    }
  }, LOCAL_ORIGIN);
}

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
        if (k === "points") continue;
        if (v === undefined) el.delete(k);
        else el.set(k, v);
      }
    }
  }, LOCAL_ORIGIN);
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
      const ymap = new Y.Map<unknown>();
      ymap.set("id", newId);
      ymap.set("type", json.type);
      ymap.set("x", json.x + 24);
      ymap.set("y", json.y + 24);
      ymap.set("w", json.w);
      ymap.set("h", json.h);
      ymap.set("color", json.color);
      ymap.set("order", nextOrder(elements));
      if (json.text !== undefined) ymap.set("text", json.text);
      if (json.size !== undefined) ymap.set("size", json.size);
      if (json.src !== undefined) ymap.set("src", json.src);
      if (json.startRef !== undefined) ymap.set("startRef", idMap.get(json.startRef) ?? json.startRef);
      if (json.endRef !== undefined) ymap.set("endRef", idMap.get(json.endRef) ?? json.endRef);
      if (json.points !== undefined) {
        const arr = new Y.Array<number>();
        arr.push([...json.points]);
        ymap.set("points", arr);
      }
      elements.set(newId, ymap);
      newIds.push(newId);
    }
  }, LOCAL_ORIGIN);
  return newIds;
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
