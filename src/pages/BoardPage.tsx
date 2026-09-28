import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  useBoardConnection,
  useElements,
  useMetaField,
  useIdbReady,
  useUndoState,
} from "../lib/board";
import {
  bringToFront,
  deleteElements,
  duplicateElements,
  sendToBack,
  updateElements,
} from "../lib/elements";
import { CLIPBOARD_MARKER } from "../lib/clipboard";
import { useCameraController } from "../lib/useCameraController";
import { detachArrowPatches, resolveArrows } from "../lib/arrows";
import { getLocalUser, touchRecentBoard } from "../lib/user";
import type { Camera, Tool } from "../lib/types";
import { Canvas } from "../components/Canvas";
import { Toolbar } from "../components/Toolbar";
import { TopBar } from "../components/TopBar";
import { ZoomControls } from "../components/ZoomControls";
import { SelectionActions } from "../components/SelectionActions";
import { HelpModal } from "../components/HelpModal";
import { exportBoardPng, renderBoardThumbnail } from "../lib/exportPng";
import type { AwarenessState } from "../lib/types";
import { HelpCircle } from "lucide-react";

const TOOL_KEYS: Record<string, Tool> = {
  v: "select",
  h: "hand",
  n: "sticky",
  t: "text",
  r: "rect",
  o: "ellipse",
  a: "arrow",
  p: "pen",
  l: "laser",
};

export function BoardPage() {
  const { roomId = "" } = useParams();
  const conn = useBoardConnection(roomId);
  const rawEls = useElements(conn.elements);
  // Arrows bound to shapes get their endpoints computed from live geometry
  const els = useMemo(() => resolveArrows(rawEls), [rawEls]);
  const boardName = useMetaField(conn.meta, "name", "");
  const { canUndo, canRedo } = useUndoState(conn.undo);
  const idbReady = useIdbReady(conn.idb);
  const user = useMemo(getLocalUser, []);

  const [tool, setTool] = useState<Tool>("select");
  const [camera, setCamera] = useState<Camera>({ x: -100, y: -80, z: 1 });
  // Discrete camera moves tween; gestures write instantly; follow mode
  // eases toward a retargetable goal (see useCameraController).
  const cam = useCameraController(camera, setCamera);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [drawColor, setDrawColor] = useState("yellow");
  const [helpOpen, setHelpOpen] = useState(false);

  // Remember this board on the landing page
  useEffect(() => {
    touchRecentBoard(roomId, boardName || "Untitled board");
  }, [roomId, boardName]);

  // Keep the recents thumbnail fresh (debounced so drawing doesn't thrash it).
  // The generation token guards against an older render (e.g. one containing a
  // slow image) finishing after a newer one and overwriting the thumbnail with
  // obsolete content.
  const thumbGen = useRef(0);
  useEffect(() => {
    if (els.length === 0) return;
    const gen = ++thumbGen.current;
    const timer = setTimeout(() => {
      void renderBoardThumbnail(els).then((thumb) => {
        if (thumb && gen === thumbGen.current) {
          touchRecentBoard(roomId, boardName || "Untitled board", thumb);
        }
      });
    }, 2000);
    return () => clearTimeout(timer);
  }, [els, roomId, boardName]);

  // Debug handle for dev tooling
  useEffect(() => {
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__driftboard = conn;
    }
  }, [conn]);

  // Share what we have selected so collaborators see it outlined in our color
  useEffect(() => {
    conn.awareness.setLocalStateField("selection", [...selection]);
  }, [conn, selection]);

  // ---- Follow mode ----
  // Broadcast our camera (throttled) so collaborators can follow us
  const viewThrottle = useRef({ last: 0, timer: null as ReturnType<typeof setTimeout> | null });
  useEffect(() => {
    const send = () => {
      viewThrottle.current.last = performance.now();
      conn.awareness.setLocalStateField("view", camera);
    };
    const elapsed = performance.now() - viewThrottle.current.last;
    if (elapsed >= 80) {
      send();
    } else {
      if (viewThrottle.current.timer) clearTimeout(viewThrottle.current.timer);
      viewThrottle.current.timer = setTimeout(send, 80 - elapsed);
    }
  }, [conn, camera]);

  const [followingId, setFollowingId] = useState<number | null>(null);

  // While following, ease toward the followed user's camera as it streams in
  // (one retargetable loop — new snapshots move the goal, they don't stack
  // new tweens, so we don't trail behind the followed peer).
  useEffect(() => {
    if (followingId == null) return;
    const apply = () => {
      const state = conn.awareness.getStates().get(followingId) as AwarenessState | undefined;
      if (!state?.user) {
        setFollowingId(null); // they left
        return;
      }
      if (state.view) {
        cam.followTarget(state.view);
      }
    };
    apply();
    conn.awareness.on("change", apply);
    return () => conn.awareness.off("change", apply);
  }, [conn, followingId, cam]);

  // Leaving follow mode stops the easing loop.
  useEffect(() => {
    if (followingId == null) cam.cancel();
  }, [followingId, cam]);

  // Taking control back (any interaction outside the presence UI) stops following
  useEffect(() => {
    if (followingId == null) return;
    const stop = (e: Event) => {
      if ((e.target as HTMLElement | null)?.closest?.("[data-follow-ui]")) return;
      setFollowingId(null);
    };
    window.addEventListener("pointerdown", stop, { capture: true });
    window.addEventListener("wheel", stop, { capture: true, passive: true });
    window.addEventListener("keydown", stop, { capture: true });
    return () => {
      window.removeEventListener("pointerdown", stop, { capture: true });
      window.removeEventListener("wheel", stop, { capture: true });
      window.removeEventListener("keydown", stop, { capture: true });
    };
  }, [followingId]);

  const toggleFollow = useCallback(
    (clientId: number) => setFollowingId((cur) => (cur === clientId ? null : clientId)),
    [],
  );

  const doExport = useCallback(
    () => exportBoardPng(els, boardName),
    [els, boardName],
  );

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
    // Surviving arrows bound to a deleted shape keep their current geometry
    const detach = detachArrowPatches(els, selection, "delete");
    if (detach.length > 0) updateElements(conn.doc, conn.elements, detach);
    deleteElements(conn.doc, conn.elements, selection);
    setSelection(new Set());
  }, [conn, els, selection]);

  const doDuplicate = useCallback(() => {
    if (selection.size === 0) return;
    const ids = duplicateElements(conn.doc, conn.elements, selection);
    setSelection(new Set(ids));
  }, [conn, selection]);

  // Copy resolved elements so bound arrows carry usable fallback geometry.
  // We write through the native copy/cut event's clipboardData (synchronous)
  // rather than a fire-and-forget writeText — the async write can lose to an
  // immediate ⌘V, leaving the paste empty.
  const writeSelectionToClipboard = useCallback(
    (e: ClipboardEvent) => {
      const target = e.target as HTMLElement;
      const typing =
        target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.isContentEditable;
      if (typing || selection.size === 0 || !e.clipboardData) return false;
      const copied = els.filter((el) => selection.has(el.id));
      e.clipboardData.setData(
        "text/plain",
        JSON.stringify({ [CLIPBOARD_MARKER]: 1, elements: copied }),
      );
      e.preventDefault();
      return true;
    },
    [els, selection],
  );

  useEffect(() => {
    const onCopy = (e: ClipboardEvent) => {
      writeSelectionToClipboard(e);
    };
    const onCut = (e: ClipboardEvent) => {
      if (writeSelectionToClipboard(e)) doDelete();
    };
    window.addEventListener("copy", onCopy);
    window.addEventListener("cut", onCut);
    return () => {
      window.removeEventListener("copy", onCopy);
      window.removeEventListener("cut", onCut);
    };
  }, [doDelete, writeSelectionToClipboard]);

  const doFront = useCallback(() => {
    if (selection.size > 0) bringToFront(conn.doc, conn.elements, selection);
  }, [conn, selection]);
  const doBack = useCallback(() => {
    if (selection.size > 0) sendToBack(conn.doc, conn.elements, selection);
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
  const stateRef = useRef({ doDelete, doDuplicate, doFront, doBack, editingId, selection, els });
  stateRef.current = { doDelete, doDuplicate, doFront, doBack, editingId, selection, els };

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
      if (mod && e.key.toLowerCase() === "a") {
        if (typing) return;
        e.preventDefault();
        setSelection(new Set(stateRef.current.els.map((el) => el.id)));
        return;
      }
      if (typing || mod) return;

      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        stateRef.current.doDelete();
        return;
      }
      const nudge: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      if (nudge[e.key] && stateRef.current.selection.size > 0) {
        e.preventDefault();
        const { selection: sel, els: current } = stateRef.current;
        const [dx, dy] = nudge[e.key];
        const step = e.shiftKey ? 10 : 1;
        // Same semantics as a drag: arrows nudged away from their shapes detach
        const detach = detachArrowPatches(current, sel, "move");
        if (detach.length > 0) updateElements(conn.doc, conn.elements, detach);
        const byId = new Map(current.map((el) => [el.id, el]));
        updateElements(
          conn.doc,
          conn.elements,
          [...sel].flatMap((id) => {
            const el = byId.get(id);
            return el ? [{ id, patch: { x: el.x + dx * step, y: el.y + dy * step } }] : [];
          }),
        );
        return;
      }
      if (e.key === "]") {
        stateRef.current.doFront();
        return;
      }
      if (e.key === "[") {
        stateRef.current.doBack();
        return;
      }
      if (e.key === "?") {
        setHelpOpen((v) => !v);
        return;
      }
      if (e.key === "Escape") {
        setHelpOpen(false);
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
        setCamera={cam.instant}
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
        idbReady={idbReady}
        onBoardNameChange={(name) => touchRecentBoard(roomId, name || "Untitled board")}
        onExport={doExport}
        followingId={followingId}
        onToggleFollow={toggleFollow}
      />
      <SelectionActions
        count={selection.size}
        onColor={doColor}
        onDuplicate={doDuplicate}
        onDelete={doDelete}
        onFront={doFront}
        onBack={doBack}
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
      <ZoomControls camera={camera} animateTo={cam.tweenTo} els={els} viewportSize={viewportSize} />
      <button
        title="Keyboard shortcuts (?)"
        onClick={() => setHelpOpen(true)}
        className="absolute bottom-5 left-4 z-20 flex h-10 w-10 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--panel)] text-[var(--muted)] shadow-lg backdrop-blur-md transition-colors hover:bg-[var(--hover)] hover:text-[var(--text)]"
      >
        <HelpCircle size={18} />
      </button>
      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
