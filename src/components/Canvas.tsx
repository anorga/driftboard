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
  deleteElements,
  normalizeStroke,
  updateElement,
  updateElements,
} from "../lib/elements";
import { fitDimensions, isImageFile, loadImage, IMAGE_DEFAULT_MAX_W } from "../lib/images";
import { detachArrowPatches, hitTestBindTarget } from "../lib/arrows";
import { ElementView } from "./ElementView";
import { CursorsOverlay } from "./CursorsOverlay";
import { LaserOverlay } from "./LaserOverlay";
import { useRemotePeers } from "../lib/board";

type HandleId = "nw" | "ne" | "sw" | "se";

type Drag =
  | { mode: "pan"; startCam: Camera; startScreen: Point }
  | { mode: "move"; startWorld: Point; orig: Map<string, { x: number; y: number }>; moved: boolean }
  | { mode: "marquee"; startWorld: Point; additive: boolean; base: Set<string> }
  | { mode: "shape"; id: string; startWorld: Point }
  | { mode: "arrow"; id: string; startWorld: Point; startRef?: string; snapId?: string | null }
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
  // Shape an in-flight arrow would attach to on release (highlight only;
  // the binding decision reads drag.snapId, which updates synchronously)
  const [snapId, setSnapId] = useState<string | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const [chat, setChat] = useState<{ screen: Point; text: string } | null>(null);
  const chatClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastScreen = useRef<Point>({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  const peers = useRemotePeers(conn.awareness);

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

  // ---- Laser broadcast + cleanup when leaving the tool ----
  const lastLaserSent = useRef(0);
  const sendLaser = useCallback(
    (screen: Point) => {
      const now = performance.now();
      if (now - lastLaserSent.current < 30) return;
      lastLaserSent.current = now;
      const w = screenToWorld(screen, cameraRef.current);
      conn.awareness.setLocalStateField("laser", { x: w.x, y: w.y, t: Date.now() });
    },
    [conn],
  );
  useEffect(() => {
    if (tool !== "laser") conn.awareness.setLocalStateField("laser", null);
  }, [conn, tool]);

  // ---- Cursor chat (press / to talk at your cursor) ----
  const closeChat = useCallback(
    (keepMessage: boolean) => {
      setChat(null);
      if (chatClearTimer.current) clearTimeout(chatClearTimer.current);
      if (keepMessage) {
        chatClearTimer.current = setTimeout(
          () => conn.awareness.setLocalStateField("chat", null),
          4000,
        );
      } else {
        conn.awareness.setLocalStateField("chat", null);
      }
    },
    [conn],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.isContentEditable) return;
      if (e.key === "/") {
        e.preventDefault();
        setChat({ screen: lastScreen.current, text: "" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ---- Images: paste anywhere, or drop files onto the canvas ----
  const insertImages = useCallback(
    async (files: File[], screen: Point) => {
      let offset = 0;
      const ids: string[] = [];
      for (const file of files) {
        try {
          const img = await loadImage(file);
          const dims = fitDimensions(img.w, img.h, IMAGE_DEFAULT_MAX_W);
          const world = screenToWorld(screen, cameraRef.current);
          const id = addElement(conn.doc, conn.elements, {
            type: "image",
            x: world.x - dims.w / 2 + offset,
            y: world.y - dims.h / 2 + offset,
            w: dims.w,
            h: dims.h,
            color: "yellow",
            src: img.src,
          });
          ids.push(id);
          offset += 24;
        } catch {
          // not decodable as an image — skip it
        }
      }
      if (ids.length > 0) {
        setSelection(new Set(ids));
        setTool("select");
        conn.undo.stopCapturing();
      }
    },
    [conn, setSelection, setTool],
  );

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.isContentEditable) return;
      const files = [...(e.clipboardData?.files ?? [])].filter(isImageFile);
      if (files.length === 0) return;
      e.preventDefault();
      void insertImages(files, lastScreen.current);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [insertImages]);

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

  // ---- Touch: two fingers pinch-zoom / pan (single finger uses the tools) ----
  const touchesRef = useRef(new Map<number, Point>());
  const pinchRef = useRef<{ lastDist: number; lastCenter: Point } | null>(null);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "touch" || !touchesRef.current.has(e.pointerId)) return;
      touchesRef.current.set(e.pointerId, toScreen(e));
      const pinch = pinchRef.current;
      if (!pinch || touchesRef.current.size < 2) return;
      const [a, b] = [...touchesRef.current.values()];
      const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      setCamera((cam) => {
        const zoomed = zoomAt(cam, center, cam.z * (dist / pinch.lastDist));
        return {
          ...zoomed,
          x: zoomed.x - (center.x - pinch.lastCenter.x) / zoomed.z,
          y: zoomed.y - (center.y - pinch.lastCenter.y) / zoomed.z,
        };
      });
      pinch.lastDist = dist;
      pinch.lastCenter = center;
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      touchesRef.current.delete(e.pointerId);
      if (touchesRef.current.size < 2) pinchRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [setCamera, toScreen]);

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
          if (!drag.moved) {
            // The move is real (past the click threshold): arrows being pulled
            // away from their bound shapes detach now, inside the gesture's
            // undo group. A plain click never touches bindings.
            const ids = new Set(drag.orig.keys());
            const detach = detachArrowPatches(elsRef.current, ids, "move");
            if (detach.length > 0) updateElements(conn.doc, conn.elements, detach);
          }
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
        case "arrow": {
          updateElement(conn.doc, conn.elements, drag.id, {
            w: world.x - drag.startWorld.x,
            h: world.y - drag.startWorld.y,
          });
          // Hovering a shape? Highlight it as the attach target.
          const target = hitTestBindTarget(elsRef.current, world, drag.startRef);
          drag.snapId = target?.id ?? null;
          setSnapId(drag.snapId);
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
    if (drag.mode === "arrow") {
      const snap = drag.snapId;
      setSnapId(null);
      if (snap) {
        updateElement(conn.doc, conn.elements, drag.id, { endRef: snap });
      } else {
        const el = conn.elements.get(drag.id);
        const w = (el?.get("w") as number) ?? 0;
        const h = (el?.get("h") as number) ?? 0;
        if (Math.hypot(w, h) < 12) {
          updateElement(conn.doc, conn.elements, drag.id, { w: 160, h: 0 });
        }
      }
      setSelection(new Set([drag.id]));
      setTool("select");
    }
    // Each gesture is one undo step
    conn.undo.stopCapturing();
  }, [conn, onWindowMove, setSelection, setTool]);

  const dragPointerTypeRef = useRef<string>("mouse");
  const beginDrag = useCallback(
    (drag: Drag, pointerType = "mouse") => {
      // Never start a gesture under an active two-finger pinch, whichever
      // handler the second finger happened to land on.
      if (touchesRef.current.size >= 2) return;
      conn.undo.stopCapturing();
      dragRef.current = drag;
      dragPointerTypeRef.current = pointerType;
      window.addEventListener("pointermove", onWindowMove);
      window.addEventListener("pointerup", onWindowUp, { once: true });
    },
    [conn, onWindowMove, onWindowUp],
  );

  // Second touch lands anywhere on the canvas: abandon the single-finger
  // gesture (deleting a just-started element, which was accidental) and
  // switch to pinching. Capture phase, so element handlers can't swallow it.
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      // Palm rejection: while a stylus or mouse gesture is in flight, stray
      // touches must neither cancel it nor start a pinch.
      if (dragRef.current && dragPointerTypeRef.current !== "touch") return;
      if (touchesRef.current.size >= 2) return; // ignore third+ fingers
      touchesRef.current.set(e.pointerId, toScreen(e));
      if (touchesRef.current.size !== 2) return;
      const drag = dragRef.current;
      if (drag && (drag.mode === "pen" || drag.mode === "shape" || drag.mode === "arrow")) {
        deleteElements(conn.doc, conn.elements, [drag.id]);
      }
      dragRef.current = null;
      onWindowUp(); // detach drag listeners, reset panning
      setMarquee(null);
      setSnapId(null);
      const [a, b] = [...touchesRef.current.values()];
      pinchRef.current = {
        lastDist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
        lastCenter: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      };
    };
    vp.addEventListener("pointerdown", onDown, { capture: true });
    return () => vp.removeEventListener("pointerdown", onDown, { capture: true });
  }, [conn, onWindowUp, toScreen]);

  // ---- Canvas (empty space) pointer down ----
  const onCanvasPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // While pinching, single-pointer tools stay out of the way
      if (e.pointerType === "touch" && touchesRef.current.size >= 2) return;
      if (editingId) setEditingId(null);
      const screen = toScreen(e);
      const world = screenToWorld(screen, cameraRef.current);
      const t = toolRef.current;

      // Middle mouse, space, or hand tool pans
      if (e.button === 1 || spaceDown || t === "hand") {
        setPanning(true);
        beginDrag({ mode: "pan", startCam: cameraRef.current, startScreen: screen }, e.pointerType);
        return;
      }
      if (e.button !== 0) return;

      if (t === "select") {
        const additive = e.shiftKey;
        if (!additive) setSelection(new Set());
        beginDrag({ mode: "marquee", startWorld: world, additive, base: new Set(selectionRef.current) }, e.pointerType);
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
      if (t === "text") {
        const id = addElement(conn.doc, conn.elements, {
          type: "text",
          x: world.x,
          y: world.y - 16,
          w: 280,
          h: 96,
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
        beginDrag({ mode: "shape", id, startWorld: world }, e.pointerType);
        return;
      }
      if (t === "arrow") {
        // Starting on a shape binds the arrow's tail to it
        const startTarget = hitTestBindTarget(elsRef.current, world);
        const id = addElement(conn.doc, conn.elements, {
          type: "arrow",
          x: world.x,
          y: world.y,
          w: 0,
          h: 0,
          color: drawColorRef.current,
          startRef: startTarget?.id,
        });
        beginDrag({ mode: "arrow", id, startWorld: world, startRef: startTarget?.id }, e.pointerType);
        return;
      }
      if (t === "laser") return; // laser never creates elements
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
        beginDrag({ mode: "pen", id, lastWorld: world }, e.pointerType);
        return;
      }
    },
    [beginDrag, conn, editingId, setEditingId, setSelection, setTool, spaceDown, toScreen],
  );

  // ---- Element pointer down (select tool only) ----
  const onElementPointerDown = useCallback(
    (e: React.PointerEvent, id: string) => {
      if (e.pointerType === "touch" && touchesRef.current.size >= 2) return;
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
      beginDrag({ mode: "move", startWorld: world, orig, moved: false }, e.pointerType);
    },
    [beginDrag, editingId, setEditingId, setSelection, toScreen],
  );

  const onElementDoubleClick = useCallback(
    (id: string) => {
      const el = elsRef.current.find((x) => x.id === id);
      if (el?.type === "sticky" || el?.type === "text") setEditingId(id);
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
      beginDrag({ mode: "resize", id, handle, orig: elementBounds(el) }, e.pointerType);
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
    return el && el.type !== "stroke" && el.type !== "arrow" ? el : null;
  }, [els, selection]);

  // Remote selections: outline what collaborators have selected, in their color
  const remoteSelections = useMemo(() => {
    const byId = new Map(els.map((e) => [e.id, e]));
    const out: Array<{ key: string; color: string; x: number; y: number; w: number; h: number }> = [];
    for (const { clientId, state } of peers) {
      if (!state.selection?.length || !state.user) continue;
      for (const id of state.selection) {
        const el = byId.get(id);
        if (!el) continue;
        const b = elementBounds(el);
        out.push({ key: `${clientId}-${id}`, color: state.user.color, x: b.x, y: b.y, w: b.w, h: b.h });
      }
    }
    return out;
  }, [els, peers]);

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
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        // Always consume the drop — the default action would navigate the
        // browser to the dropped file, dumping the user out of the board.
        e.preventDefault();
        const files = [...e.dataTransfer.files].filter(isImageFile);
        if (files.length === 0) return;
        void insertImages(files, toScreen(e));
      }}
      onPointerMove={(e) => {
        const screen = toScreen(e);
        lastScreen.current = screen;
        if (!dragRef.current) sendCursor(screen);
        if (toolRef.current === "laser") sendLaser(screen);
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

        {snapId &&
          (() => {
            const el = els.find((x) => x.id === snapId);
            if (!el) return null;
            const b = elementBounds(el);
            return (
              <div
                className="absolute rounded-lg"
                style={{
                  left: 0,
                  top: 0,
                  width: b.w + 12,
                  height: b.h + 12,
                  transform: `translate(${b.x - 6}px, ${b.y - 6}px)`,
                  border: `${2 / camera.z}px dashed var(--accent)`,
                  pointerEvents: "none",
                }}
              />
            );
          })()}

        {remoteSelections.map((s) => (
          <div
            key={s.key}
            className="absolute rounded-md"
            style={{
              left: 0,
              top: 0,
              width: s.w,
              height: s.h,
              transform: `translate(${s.x}px, ${s.y}px)`,
              border: `${1.5 / camera.z}px solid ${s.color}`,
              opacity: 0.75,
              pointerEvents: "none",
            }}
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
      <LaserOverlay awareness={conn.awareness} camera={camera} />

      {chat && (
        <div
          className="absolute z-30"
          style={{
            left: Math.min(chat.screen.x, window.innerWidth - 280),
            top: Math.min(chat.screen.y + 18, window.innerHeight - 60),
          }}
        >
          <input
            autoFocus
            value={chat.text}
            placeholder="Say something…"
            onChange={(e) => {
              const text = e.target.value;
              setChat({ ...chat, text });
              conn.awareness.setLocalStateField("chat", { text, ts: Date.now() });
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") closeChat(chat.text.trim().length > 0);
              if (e.key === "Escape") closeChat(false);
            }}
            onBlur={() => closeChat(chat.text.trim().length > 0)}
            className="w-64 rounded-full px-4 py-2 text-sm font-medium text-white shadow-xl outline-none placeholder:text-white/60"
            style={{ background: user.color }}
          />
        </div>
      )}
    </div>
  );
}
