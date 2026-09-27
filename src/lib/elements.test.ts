import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { LOCAL_ORIGIN } from "./board";
import {
  addElement,
  appendStrokePoints,
  deleteElements,
  duplicateElements,
  normalizeStroke,
  updateElement,
} from "./elements";
import type { BoardElement } from "./types";

type Elements = Y.Map<Y.Map<unknown>>;

function makeDoc(): { doc: Y.Doc; els: Elements } {
  const doc = new Y.Doc();
  return { doc, els: doc.getMap<Y.Map<unknown>>("elements") };
}

function get(els: Elements, id: string): BoardElement {
  return els.get(id)!.toJSON() as BoardElement;
}

describe("addElement", () => {
  it("stores all fields and assigns increasing z-order", () => {
    const { doc, els } = makeDoc();
    const a = addElement(doc, els, { type: "sticky", x: 1, y: 2, w: 3, h: 4, color: "pink", text: "hi" });
    const b = addElement(doc, els, { type: "rect", x: 0, y: 0, w: 10, h: 10, color: "blue" });
    expect(get(els, a)).toMatchObject({ type: "sticky", x: 1, y: 2, w: 3, h: 4, color: "pink", text: "hi", order: 1 });
    expect(get(els, b).order).toBe(2);
  });
});

describe("updateElement", () => {
  it("patches fields and deletes keys set to undefined", () => {
    const { doc, els } = makeDoc();
    const id = addElement(doc, els, { type: "arrow", x: 0, y: 0, w: 5, h: 5, color: "blue", endRef: "target" });
    updateElement(doc, els, id, { x: 42, endRef: undefined });
    const el = get(els, id);
    expect(el.x).toBe(42);
    expect("endRef" in el).toBe(false);
  });
});

describe("duplicateElements", () => {
  it("offsets copies and remaps arrow bindings to co-duplicated shapes", () => {
    const { doc, els } = makeDoc();
    const shape = addElement(doc, els, { type: "rect", x: 0, y: 0, w: 50, h: 50, color: "blue" });
    const other = addElement(doc, els, { type: "rect", x: 200, y: 0, w: 50, h: 50, color: "blue" });
    const arrow = addElement(doc, els, {
      type: "arrow", x: 60, y: 25, w: 100, h: 0, color: "blue",
      startRef: shape, endRef: other,
    });

    // Duplicate the arrow and its start shape, but not the end shape
    const newIds = duplicateElements(doc, els, [shape, arrow]);
    expect(newIds).toHaveLength(2);
    const newArrow = newIds.map((id) => get(els, id)).find((el) => el.type === "arrow")!;
    const newShapeId = newIds.find((id) => get(els, id).type === "rect")!;
    expect(newArrow.startRef).toBe(newShapeId); // remapped to the copy
    expect(newArrow.endRef).toBe(other); // still points at the original
    expect(newArrow.x).toBe(60 + 24);
    expect(newArrow.y).toBe(25 + 24);
  });
});

describe("strokes", () => {
  it("appendStrokePoints extends the points array", () => {
    const { doc, els } = makeDoc();
    const id = addElement(doc, els, {
      type: "stroke", x: 0, y: 0, w: 0, h: 0, color: "green", size: 6,
      points: [10, 10, 0.5],
    });
    appendStrokePoints(doc, els, id, [20, 20, 0.6]);
    expect(get(els, id).points).toEqual([10, 10, 0.5, 20, 20, 0.6]);
  });

  it("normalizeStroke shifts the origin to the padded bounding box", () => {
    const { doc, els } = makeDoc();
    const id = addElement(doc, els, {
      type: "stroke", x: 0, y: 0, w: 0, h: 0, color: "green", size: 4,
      points: [100, 200, 0.5, 150, 260, 0.5],
    });
    normalizeStroke(doc, els, id);
    const el = get(els, id);
    const pad = 4 * 2;
    expect(el.x).toBe(100 - pad);
    expect(el.y).toBe(200 - pad);
    expect(el.w).toBe(50 + pad * 2);
    expect(el.h).toBe(60 + pad * 2);
    // First point is now relative to the element origin
    expect(el.points!.slice(0, 3)).toEqual([pad, pad, 0.5]);
  });
});

describe("scoped undo across two synced clients", () => {
  it("undo only reverts local changes, never a collaborator's", () => {
    const a = makeDoc();
    const b = makeDoc();
    // Wire the docs together like the relay does
    a.doc.on("update", (u: Uint8Array) => Y.applyUpdate(b.doc, u, "remote"));
    b.doc.on("update", (u: Uint8Array) => Y.applyUpdate(a.doc, u, "remote"));
    const undoA = new Y.UndoManager(a.els, { trackedOrigins: new Set([LOCAL_ORIGIN]) });

    const mine = addElement(a.doc, a.els, { type: "sticky", x: 0, y: 0, w: 10, h: 10, color: "yellow" });
    const theirs = addElement(b.doc, b.els, { type: "sticky", x: 50, y: 0, w: 10, h: 10, color: "pink" });
    expect(a.els.has(mine)).toBe(true);
    expect(a.els.has(theirs)).toBe(true);

    undoA.undo();
    expect(a.els.has(mine)).toBe(false); // my edit reverted...
    expect(a.els.has(theirs)).toBe(true); // ...their edit untouched
    expect(b.els.has(mine)).toBe(false); // and the undo synced across
  });

  it("concurrent edits to different fields of the same element both win", () => {
    const a = makeDoc();
    const b = makeDoc();
    const id = addElement(a.doc, a.els, { type: "sticky", x: 0, y: 0, w: 10, h: 10, color: "yellow" });
    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc));

    // Offline: A moves the note while B recolors it
    updateElement(a.doc, a.els, id, { x: 99 });
    updateElement(b.doc, b.els, id, { color: "pink" });

    // Reconnect: exchange updates both ways
    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc));
    Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(b.doc));

    for (const side of [a, b]) {
      const el = get(side.els, id);
      expect(el.x).toBe(99);
      expect(el.color).toBe("pink");
    }
  });
});

describe("deleteElements", () => {
  it("removes the given ids", () => {
    const { doc, els } = makeDoc();
    const id = addElement(doc, els, { type: "rect", x: 0, y: 0, w: 1, h: 1, color: "blue" });
    deleteElements(doc, els, [id]);
    expect(els.has(id)).toBe(false);
  });
});

describe("collaborative text (Y.Text)", () => {
  function sync(a: ReturnType<typeof makeDoc>, b: ReturnType<typeof makeDoc>) {
    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc));
    Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(b.doc));
  }

  it("stores text as a Y.Text that serializes back to a plain string", () => {
    const { doc, els } = makeDoc();
    const id = addElement(doc, els, { type: "sticky", x: 0, y: 0, w: 10, h: 10, color: "yellow", text: "hello" });
    // toJSON() must flatten the nested Y.Text so render/export/clipboard see a string.
    const json = els.get(id)!.toJSON() as BoardElement;
    expect(json.text).toBe("hello");
    expect(json.text).not.toBeInstanceOf(Y.Text);
  });

  it("migrates a legacy string field to a Y.Text on first update", () => {
    const { doc, els } = makeDoc();
    const raw = new Y.Map<unknown>();
    raw.set("id", "legacy");
    raw.set("type", "sticky");
    raw.set("text", "old"); // a plain string, as an old board would store it
    els.set("legacy", raw);
    updateElement(doc, els, "legacy", { text: "old!" });
    // The raw value is now a Y.Text (in-place upgrade), and JSON is a string.
    expect(els.get("legacy")!.get("text")).toBeInstanceOf(Y.Text);
    expect((els.get("legacy")!.toJSON() as BoardElement).text).toBe("old!");
  });

  it("merges concurrent character edits from two clients", () => {
    const a = makeDoc();
    const b = makeDoc();
    const id = addElement(a.doc, a.els, { type: "sticky", x: 0, y: 0, w: 10, h: 10, color: "yellow", text: "hi" });
    sync(a, b);

    // Both type at the end while offline — a merge, not last-write-wins.
    updateElement(a.doc, a.els, id, { text: "hi there" });
    updateElement(b.doc, b.els, id, { text: "hi bob" });

    sync(a, b);
    // The order of two concurrent inserts is decided by client id (a
    // legitimate CRDT tie-break) — the invariant we care about is that BOTH
    // edits are merged, nothing is lost to last-write-wins.
    for (const side of [a, b]) {
      const text = get(side.els, id).text ?? "";
      expect(text).toContain("there");
      expect(text).toContain("bob");
      // "hi" + " there" + " bob" — both appends present, nothing lost.
      expect(text.length).toBe(2 + 6 + 4);
    }
  });

  it("undoing a local append preserves a remote edit in the middle", () => {
    const a = makeDoc();
    const b = makeDoc();
    a.doc.on("update", (u: Uint8Array) => Y.applyUpdate(b.doc, u, "remote"));
    b.doc.on("update", (u: Uint8Array) => Y.applyUpdate(a.doc, u, "remote"));
    // One manager per client, created before any edits (as board.ts does),
    // tracking only that client's local origin. captureTimeout:0 so each
    // transaction is its own undo item (real users gesture >350ms apart, so
    // this is the same isolation they get in the app).
    const undoA = new Y.UndoManager(a.els, { trackedOrigins: new Set([LOCAL_ORIGIN]), captureTimeout: 0 });

    const id = addElement(a.doc, a.els, { type: "sticky", x: 0, y: 0, w: 10, h: 10, color: "yellow", text: "hi" });
    // A's local create is one undo item. B's remote edit is not tracked by A.
    updateElement(b.doc, b.els, id, { text: "hi there" }); // B's remote middle edit
    // A appends locally in a SEPARATE transaction (captureTimeout:0), so it's
    // a distinct undo item from the element-creation above.
    updateElement(a.doc, a.els, id, { text: "hi there!" });

    undoA.undo(); // revert only A's local "!" append

    expect(get(a.els, id).text).toBe("hi there"); // A's "!" gone, B's "there" kept
  });
});
