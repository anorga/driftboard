import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BoardConnection } from "../lib/board";
import type { BoardElement, Camera, Tool, UserInfo } from "../lib/types";
import { GRID_SIZE, STICKY_DEFAULT } from "../lib/constants";
import {
  screenToWorld,
  zoomAt,
  normalizeRect,
  rectsIntersect,
  elementBounds,
  type Point,
  type Rect,
} from "../lib/geometry";
import {
  addElement,
  appendStrokePoints,
  normalizeStroke,
  updateElement,
  updateElements,
} from "../lib/elements";
import { ElementView } from "./ElementView";
import { CursorsOverlay } from "./CursorsOverlay";

type HandleId = "nw" | "ne" | "sw" | "se";

type Drag =
  | { mode: "pan"; startCam: Camera; startScreen: Point }
  | { mode: "move"; startWorld: Point; orig: Map<string, { x: number; y: number }>; moved: boolean }
  | { mode: "marquee"; startWorld: Point; additive: boolean; base: Set<string> }
  | { mode: "shape"; id: string; startWorld: Point }
  | { mode: "pen"; id: string; lastWorld: Point }
  | { mode: "resize"; id: string; handle: HandleId; orig: Rect };

interface CanvasProps {
  conn: BoardConnection;
  els: BoardElement[];
  tool: Tool;
  setTool: (t: Tool) => void;
  camera: Camera;
  setCamera: React.Dispatch<React.SetStateAction<Camera>>;
  selection: Set<string>;
  setSelection: React.Dispatch<React.SetStateAction<Set<string>>>;
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  drawColor: string;
  user: UserInfo;
}

export function Canvas({
  conn,
  els,
  tool,
  setTool,
  camera,
  setCamera,
  selection,
  setSelection,
  editingId,
  setEditingId,
  drawColor,
  user,
}: CanvasProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [panning, setPanning] = useState(false);
  const [spaceDown, setSpaceDown] = useState(false);

  // Refs so window-level drag handlers never see stale state
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const elsRef = useRef(els);
  elsRef.current = els;
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const drawColorRef = useRef(drawColor);
  drawColorRef.current = drawColor;

  // ---- Presence: broadcast identity once, cursor on move (throttled) ----
  useEffect(() => {
    conn.awareness.setLocalStateField("user", user);
  }, [conn, user]);

  const lastCursorSent = useRef(0);
  const sendCursor = useCallback(
    (screen: Point | null) => {
      const now = performance.now();
      if (screen && now - lastCursorSent.current < 40) return;
      lastCursorSent.current = now;
      conn.awareness.setLocalStateField(
        "cursor",
        screen ? screenToWorld(screen, cameraRef.current) : null,
      );
    },
    [conn],
  );

  const toScreen = useCallback((e: { clientX: number; clientY: number }): Point => {
    const rect = viewportRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  // ---- Space-to-pan ----
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const t = e.target as HTMLElement;
      if (t.tagName === "TEXTAREA" || t.tagName === "INPUT") return;
      e.preventDefault();
      setSpaceDown(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpaceDown(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // ---- Wheel: pinch/ctrl = zoom, otherwise pan (non-passive to preventDefault) ----
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const screen = { x: e.clientX - vp.getBoundingClientRect().left, y: e.clientY - vp.getBoundingClientRect().top };
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * 0.01);
        setCamera((cam) => zoomAt(cam, screen, cam.z * factor));
      } else {
        setCamera((cam) => ({ ...cam, x: cam.x + e.deltaX / cam.z, y: cam.y + e.deltaY / cam.z }));
      }
    };
    vp.addEventListener("wheel", onWheel, { passive: false });
    return () => vp.removeEventListener("wheel", onWheel);
  }, [setCamera]);

  // ---- Drag machinery: window listeners live only during a gesture ----
  const onWindowMove = useCallback(
    (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const screen = toScreen(e);
      sendCursor(screen);
      const world = screenToWorld(screen, cameraRef.current);

      switch (drag.mode) {
        case "pan": {
          const dx = (screen.x - drag.startScreen.x) / cameraRef.current.z;
          const dy = (screen.y - drag.startScreen.y) / cameraRef.current.z;
          setCamera({ ...drag.startCam, x: drag.startCam.x - dx, y: drag.startCam.y - dy });
          break;
        }
        case "move": {
          const dx = world.x - drag.startWorld.x;
          const dy = world.y - drag.startWorld.y;
          if (!drag.moved && Math.hypot(dx, dy) * cameraRef.current.z < 3) return;
          drag.moved = true;
          const patches: Array<{ id: string; patch: Partial<BoardElement> }> = [];
          drag.orig.forEach((pos, id) => {
            patches.push({ id, patch: { x: pos.x + dx, y: pos.y + dy } });
          });
          updateElements(conn.doc, conn.elements, patches);
          break;
        }
        case "marquee": {
          const rect = normalizeRect(drag.startWorld, world);
          setMarquee(rect);
          const hit = new Set<string>(drag.additive ? drag.base : undefined);
          for (const el of elsRef.current) {
            if (rectsIntersect(rect, elementBounds(el))) hit.add(el.id);
          }
          setSelection(hit);
          break;
        }
        case "shape": {
          const rect = normalizeRect(drag.startWorld, world);
          updateElement(conn.doc, conn.elements, drag.id, {
            x: rect.x,
            y: rect.y,
            w: Math.max(2, rect.w),
            h: Math.max(2, rect.h),
          });
          break;
        }
        case "pen": {
          if (Math.hypot(world.x - drag.lastWorld.x, world.y - drag.lastWorld.y) < 0.75 / cameraRef.current.z) return;
          drag.lastWorld = world;
          const pressure = e.pressure && e.pressure > 0 ? e.pressure : 0.5;
          appendStrokePoints(conn.doc, conn.elements, drag.id, [world.x, world.y, pressure]);
          break;
        }
        case "resize": {
          const { orig, handle } = drag;
          const anchor = {
            x: handle.includes("w") ? orig.x + orig.w : orig.x,
            y: handle.includes("n") ? orig.y + orig.h : orig.y,
          };
          const rect = normalizeRect(anchor, world);
          updateElement(conn.doc, conn.elements, drag.id, {
            x: rect.x,
            y: rect.y,
            w: Math.max(24, rect.w),
            h: Math.max(24, rect.h),
          });
          break;
        }
      }
    },
    [conn, sendCursor, setCamera, setSelection, toScreen],
  );

  const onWindowUp = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    window.removeEventListener("pointermove", onWindowMove);
    setPanning(false);
    if (!drag) return;

    if (drag.mode === "marquee") setMarquee(null);
    if (drag.mode === "pen") {
      normalizeStroke(conn.doc, conn.elements, drag.id);
    }
    if (drag.mode === "shape") {
      const el = conn.elements.get(drag.id);
      const w = (el?.get("w") as number) ?? 0;
      const h = (el?.get("h") as number) ?? 0;
      if (w < 8 && h < 8) {
        // A click without a drag still yields a usable shape
        updateElement(conn.doc, conn.elements, drag.id, { w: 140, h: 140 });
      }
      setSelection(new Set([drag.id]));
      setTool("select");
    }
    // Each gesture is one undo step
    conn.undo.stopCapturing();
  }, [conn, onWindowMove, setSelection, setTool]);

  const beginDrag = useCallback(
    (drag: Drag) => {
      conn.undo.stopCapturing();
      dragRef.current = drag;
      window.addEventListener("pointermove", onWindowMove);
      window.addEventListener("pointerup", onWindowUp, { once: true });
    },
    [conn, onWindowMove, onWindowUp],
  );

  // ---- Canvas (empty space) pointer down ----
  const onCanvasPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (editingId) setEditingId(null);
      const screen = toScreen(e);
      const world = screenToWorld(screen, cameraRef.current);
      const t = toolRef.current;

      // Middle mouse, space, or hand tool pans
      if (e.button === 1 || spaceDown || t === "hand") {
        setPanning(true);
        beginDrag({ mode: "pan", startCam: cameraRef.current, startScreen: screen });
        return;
      }
      if (e.button !== 0) return;

      if (t === "select") {
        const additive = e.shiftKey;
        if (!additive) setSelection(new Set());
        beginDrag({ mode: "marquee", startWorld: world, additive, base: new Set(selectionRef.current) });
        return;
      }
      if (t === "sticky") {
        const id = addElement(conn.doc, conn.elements, {
          type: "sticky",
          x: world.x - STICKY_DEFAULT / 2,
          y: world.y - STICKY_DEFAULT / 2,
          w: STICKY_DEFAULT,
          h: STICKY_DEFAULT,
          color: drawColorRef.current,
          text: "",
        });
        setSelection(new Set([id]));
        setEditingId(id);
        setTool("select");
        return;
      }
      if (t === "rect" || t === "ellipse") {
        const id = addElement(conn.doc, conn.elements, {
          type: t,
          x: world.x,
          y: world.y,
          w: 2,
          h: 2,
          color: drawColorRef.current,
        });
        beginDrag({ mode: "shape", id, startWorld: world });
        return;
      }
      if (t === "pen") {
        const pressure = e.pressure && e.pressure > 0 ? e.pressure : 0.5;
        const id = addElement(conn.doc, conn.elements, {
          type: "stroke",
          x: 0,
          y: 0,
          w: 0,
          h: 0,
          color: drawColorRef.current,
          size: 6,
          points: [world.x, world.y, pressure],
        });
        beginDrag({ mode: "pen", id, lastWorld: world });
        return;
      }
    },
    [beginDrag, conn, editingId, setEditingId, setSelection, setTool, spaceDown, toScreen],
  );

  // ---- Element pointer down (select tool only) ----
  const onElementPointerDown = useCallback(
    (e: React.PointerEvent, id: string) => {
      if (toolRef.current !== "select" || e.button !== 0) return;
      e.stopPropagation();
      if (editingId === id) return;
      if (editingId) setEditingId(null);

      let next: Set<string>;
      if (e.shiftKey) {
        next = new Set(selectionRef.current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setSelection(next);
        return; // shift-click adjusts selection without dragging
      }
      next = selectionRef.current.has(id) ? new Set(selectionRef.current) : new Set([id]);
      setSelection(next);

      const orig = new Map<string, { x: number; y: number }>();
      for (const el of elsRef.current) {
        if (next.has(el.id)) orig.set(el.id, { x: el.x, y: el.y });
      }
      const world = screenToWorld(toScreen(e), cameraRef.current);
      beginDrag({ mode: "move", startWorld: world, orig, moved: false });
    },
    [beginDrag, editingId, setEditingId, setSelection, toScreen],
  );

  const onElementDoubleClick = useCallback(
    (id: string) => {
      const el = elsRef.current.find((x) => x.id === id);
      if (el?.type === "sticky") setEditingId(id);
    },
    [setEditingId],
  );

  const onTextChange = useCallback(
    (id: string, text: string) => updateElement(conn.doc, conn.elements, id, { text }),
    [conn],
  );
  const onTextCommit = useCallback(() => setEditingId(null), [setEditingId]);

  // Double-click empty canvas -> quick sticky
  const onCanvasDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (toolRef.current !== "select") return;
      if ((e.target as HTMLElement).closest("[data-element-id]")) return;
      const world = screenToWorld(toScreen(e), cameraRef.current);
      const id = addElement(conn.doc, conn.elements, {
        type: "sticky",
        x: world.x - STICKY_DEFAULT / 2,
        y: world.y - STICKY_DEFAULT / 2,
        w: STICKY_DEFAULT,
        h: STICKY_DEFAULT,
        color: drawColorRef.current,
        text: "",
      });
      setSelection(new Set([id]));
      setEditingId(id);
    },
    [conn, setEditingId, setSelection, toScreen],
  );

  const onResizeHandleDown = useCallback(
    (e: React.PointerEvent, id: string, handle: HandleId) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      const el = elsRef.current.find((x) => x.id === id);
      if (!el) return;
      beginDrag({ mode: "resize", id, handle, orig: elementBounds(el) });
    },
    [beginDrag],
  );

  // ---- Cursor & grid styling ----
  const cursor = panning
    ? "grabbing"
    : spaceDown || tool === "hand"
      ? "grab"
      : tool === "select"
        ? "default"
        : "crosshair";

  const gridStep = GRID_SIZE * camera.z;
  const viewportStyle: React.CSSProperties = {
    cursor,
    backgroundImage: "radial-gradient(circle, var(--grid-dot) 1px, transparent 1px)",
    backgroundSize: `${gridStep}px ${gridStep}px`,
    backgroundPosition: `${(-camera.x * camera.z) % gridStep}px ${(-camera.y * camera.z) % gridStep}px`,
    touchAction: "none",
  };

  const worldStyle: React.CSSProperties = {
    transformOrigin: "0 0",
    transform: `translate(${-camera.x * camera.z}px, ${-camera.y * camera.z}px) scale(${camera.z})`,
  };

  const interactive = tool === "select" && !spaceDown;

  // Resize handles for a single selected, resizable element
  const single = useMemo(() => {
    if (selection.size !== 1) return null;
    const el = els.find((x) => selection.has(x.id));
    return el && el.type !== "stroke" ? el : null;
  }, [els, selection]);

  const handleSize = 10 / camera.z;
  const handles: Array<{ id: HandleId; x: number; y: number; cursor: string }> = single
    ? [
        { id: "nw", x: single.x, y: single.y, cursor: "nwse-resize" },
        { id: "ne", x: single.x + single.w, y: single.y, cursor: "nesw-resize" },
        { id: "sw", x: single.x, y: single.y + single.h, cursor: "nesw-resize" },
        { id: "se", x: single.x + single.w, y: single.y + single.h, cursor: "nwse-resize" },
      ]
    : [];

  return (
    <div
      ref={viewportRef}
      className="absolute inset-0 overflow-hidden bg-[var(--canvas)]"
      style={viewportStyle}
      onPointerDown={onCanvasPointerDown}
      onDoubleClick={onCanvasDoubleClick}
      onPointerMove={(e) => {
        if (!dragRef.current) sendCursor(toScreen(e));
      }}
      onPointerLeave={() => sendCursor(null)}
    >
      <div className="absolute left-0 top-0" style={worldStyle}>
        {els.map((el) => (
          <ElementView
            key={el.id}
            el={el}
            selected={selection.has(el.id)}
            editing={editingId === el.id}
            interactive={interactive}
            zoom={camera.z}
            onPointerDown={onElementPointerDown}
            onDoubleClick={onElementDoubleClick}
            onTextChange={onTextChange}
            onTextCommit={onTextCommit}
          />
        ))}

        {handles.map((h) => (
          <div
            key={h.id}
            className="absolute rounded-sm border bg-white"
            style={{
              left: 0,
              top: 0,
              width: handleSize,
              height: handleSize,
              transform: `translate(${h.x - handleSize / 2}px, ${h.y - handleSize / 2}px)`,
              borderColor: "var(--accent)",
              borderWidth: 1.5 / camera.z,
              cursor: h.cursor,
              pointerEvents: interactive ? "auto" : "none",
            }}
            onPointerDown={(e) => onResizeHandleDown(e, single!.id, h.id)}
          />
        ))}

        {marquee && (
          <div
            className="absolute"
            style={{
              left: 0,
              top: 0,
              width: marquee.w,
              height: marquee.h,
              transform: `translate(${marquee.x}px, ${marquee.y}px)`,
              border: `${1.5 / camera.z}px solid var(--accent)`,
              background: "color-mix(in srgb, var(--accent) 10%, transparent)",
              pointerEvents: "none",
            }}
          />
        )}
      </div>

      <CursorsOverlay awareness={conn.awareness} camera={camera} />
    </div>
  );
}
