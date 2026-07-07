import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  useBoardConnection,
  useElements,
  useMetaField,
  useUndoState,
} from "../lib/board";
import { deleteElements, duplicateElements, updateElements } from "../lib/elements";
import { getLocalUser, touchRecentBoard } from "../lib/user";
import type { Camera, Tool } from "../lib/types";
import { Canvas } from "../components/Canvas";
import { Toolbar } from "../components/Toolbar";
import { TopBar } from "../components/TopBar";
import { ZoomControls } from "../components/ZoomControls";
import { SelectionActions } from "../components/SelectionActions";

const TOOL_KEYS: Record<string, Tool> = {
  v: "select",
  h: "hand",
  n: "sticky",
  r: "rect",
  o: "ellipse",
  p: "pen",
};

export function BoardPage() {
  const { roomId = "" } = useParams();
  const conn = useBoardConnection(roomId);
  const els = useElements(conn.elements);
  const boardName = useMetaField(conn.meta, "name", "");
  const { canUndo, canRedo } = useUndoState(conn.undo);
  const user = useMemo(getLocalUser, []);

  const [tool, setTool] = useState<Tool>("select");
  const [camera, setCamera] = useState<Camera>({ x: -100, y: -80, z: 1 });
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [drawColor, setDrawColor] = useState("yellow");

  // Remember this board on the landing page
  useEffect(() => {
    touchRecentBoard(roomId, boardName || "Untitled board");
  }, [roomId, boardName]);

  // Debug handle for dev tooling
  useEffect(() => {
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__driftboard = conn;
    }
  }, [conn]);

  // Drop selection entries for elements deleted by collaborators
  useEffect(() => {
    setSelection((sel) => {
      const alive = new Set(els.map((e) => e.id));
      let changed = false;
      const next = new Set<string>();
      sel.forEach((id) => {
        if (alive.has(id)) next.add(id);
        else changed = true;
      });
      return changed ? next : sel;
    });
  }, [els]);

  const doDelete = useCallback(() => {
    if (selection.size === 0) return;
    deleteElements(conn.doc, conn.elements, selection);
    setSelection(new Set());
  }, [conn, selection]);

  const doDuplicate = useCallback(() => {
    if (selection.size === 0) return;
    const ids = duplicateElements(conn.doc, conn.elements, selection);
    setSelection(new Set(ids));
  }, [conn, selection]);

  const doColor = useCallback(
    (colorId: string) => {
      updateElements(
        conn.doc,
        conn.elements,
        [...selection].map((id) => ({ id, patch: { color: colorId } })),
      );
      setDrawColor(colorId);
    },
    [conn, selection],
  );

  // ---- Keyboard shortcuts ----
  const stateRef = useRef({ doDelete, doDuplicate, editingId, selection });
  stateRef.current = { doDelete, doDuplicate, editingId, selection };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing =
        t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.isContentEditable;
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key.toLowerCase() === "z") {
        if (typing) return;
        e.preventDefault();
        if (e.shiftKey) conn.undo.redo();
        else conn.undo.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "d") {
        if (typing) return;
        e.preventDefault();
        stateRef.current.doDuplicate();
        return;
      }
      if (typing || mod) return;

      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        stateRef.current.doDelete();
        return;
      }
      if (e.key === "Escape") {
        if (stateRef.current.editingId) setEditingId(null);
        else setSelection(new Set());
        setTool("select");
        return;
      }
      const next = TOOL_KEYS[e.key.toLowerCase()];
      if (next) {
        setTool(next);
        setSelection(new Set());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [conn]);

  const viewportSize = useCallback(
    () => ({ width: window.innerWidth, height: window.innerHeight }),
    [],
  );

  return (
    <div className="fixed inset-0 overflow-hidden">
      <Canvas
        conn={conn}
        els={els}
        tool={tool}
        setTool={setTool}
        camera={camera}
        setCamera={setCamera}
        selection={selection}
        setSelection={setSelection}
        editingId={editingId}
        setEditingId={setEditingId}
        drawColor={drawColor}
        user={user}
      />
      <TopBar
        doc={conn.doc}
        meta={conn.meta}
        provider={conn.provider}
        awareness={conn.awareness}
        user={user}
        onBoardNameChange={(name) => touchRecentBoard(roomId, name || "Untitled board")}
      />
      <SelectionActions
        count={selection.size}
        onColor={doColor}
        onDuplicate={doDuplicate}
        onDelete={doDelete}
      />
      <Toolbar
        tool={tool}
        setTool={setTool}
        drawColor={drawColor}
        setDrawColor={setDrawColor}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={() => conn.undo.undo()}
        onRedo={() => conn.undo.redo()}
      />
      <ZoomControls camera={camera} setCamera={setCamera} els={els} viewportSize={viewportSize} />
    </div>
  );
}
