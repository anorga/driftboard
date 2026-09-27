import { memo, useCallback, useEffect, useRef } from "react";
import type { BoardElement } from "../lib/types";
import { getColor, MAX_TEXT_H } from "../lib/constants";
import { strokeToPath } from "../lib/stroke";

interface Props {
  el: BoardElement;
  selected: boolean;
  editing: boolean;
  interactive: boolean;
  zoom: number;
  onPointerDown: (e: React.PointerEvent, id: string) => void;
  onDoubleClick: (id: string) => void;
  onTextChange: (id: string, text: string) => void;
  onTextCommit: () => void;
  /**
   * Called after text changes (edit or remote) with the natural content
   * height. The board grows the element's stored height to fit — so nothing
   * is ever silently clipped — up to a sane max, beyond which it scrolls.
   */
  onGrow: (id: string, naturalH: number) => void;
  /** Focus a board element via keyboard: select it (so the action bar works). */
  onFocusEl: (id: string) => void;
}

/** Screen-reader label for a board element (used by its focusable wrapper). */
function elementLabel(el: BoardElement): string {
  switch (el.type) {
    case "sticky":
    case "text":
      return `${el.type} note: ${el.text || "empty"}`;
    case "image":
      return "Image";
    case "arrow":
      return "Arrow";
    case "stroke":
      return "Drawing";
    default:
      return el.type;
  }
}

/**
 * Measure how tall the text content really is. We measure the ACTUAL
 * content node (which renders at the element's stored width), not a hidden
 * twin: scrollHeight reports the full content height even when the node is
 * clipped with overflow:hidden, and reusing the real node avoids duplicating
 * the text in the DOM (which would confuse text-based locators and screen
 * readers).
 */
function useAutoGrow(
  enabled: boolean,
  contentRef: React.RefObject<HTMLElement | null>,
  text: string,
  width: number,
  onGrow: (naturalH: number) => void,
) {
  useEffect(() => {
    if (!enabled) return;
    const node = contentRef.current;
    if (node) onGrow(node.scrollHeight);
  }, [enabled, text, width, contentRef, onGrow]);
}

export const ElementView = memo(function ElementView({
  el,
  selected,
  editing,
  interactive,
  zoom,
  onPointerDown,
  onDoubleClick,
  onTextChange,
  onTextCommit,
  onGrow,
  onFocusEl,
}: Props) {
  const color = getColor(el.color);
  // ---- Auto-grow (sticky + text elements) ----
  // Measure the node actually showing the text — the display div normally,
  // the textarea while editing (both share the same font/width/padding, so
  // scrollHeight is the true content height even when clipped). A grow-only
  // callback routed through a ref keeps the memoized view's effect stable.
  const isTextLike = el.type === "sticky" || el.type === "text";
  const contentRef = useRef<HTMLElement | null>(null);
  const growCbRef = useRef<(h: number) => void>(() => {});
  growCbRef.current = (naturalH) => {
    if (naturalH > el.h) onGrow(el.id, Math.min(naturalH, MAX_TEXT_H));
  };
  const onAutoGrow = useCallback((h: number) => growCbRef.current(h), []);
  useAutoGrow(isTextLike, contentRef, el.text ?? "", el.w, onAutoGrow);
  const base: React.CSSProperties = {
    position: "absolute",
    left: 0,
    top: 0,
    width: el.w,
    height: el.h,
    transform: `translate(${el.x}px, ${el.y}px)`,
    pointerEvents: interactive ? "auto" : "none",
    touchAction: "none",
  };

  const selectionRing = selected ? (
    <div
      className="absolute rounded-[inherit]"
      style={{
        inset: -2 / zoom,
        border: `${2 / zoom}px solid var(--accent)`,
        borderRadius: el.type === "ellipse" ? "9999px" : 6,
        pointerEvents: "none",
      }}
    />
  ) : null;

  if (el.type === "sticky") {
    const scrollable = el.h >= MAX_TEXT_H;
    return (
      <div
        data-element-id={el.id}
        role="group"
        aria-label={elementLabel(el)}
        tabIndex={interactive ? 0 : -1}
        style={{
          ...base,
          background: color.fill,
          color: color.ink,
          borderRadius: 6,
          boxShadow: "0 6px 16px rgba(0,0,0,0.18), 0 1px 3px rgba(0,0,0,0.12)",
        }}
        className="select-none"
        onPointerDown={(e) => onPointerDown(e, el.id)}
        onDoubleClick={() => onDoubleClick(el.id)}
        onFocus={() => onFocusEl(el.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !editing) {
            e.preventDefault();
            onDoubleClick(el.id); // keyboard: Enter edits, like double-click
          }
        }}
      >
        {editing ? (
          <textarea
            ref={contentRef as React.RefObject<HTMLTextAreaElement | null>}
            autoFocus
            value={el.text ?? ""}
            onChange={(e) => onTextChange(el.id, e.target.value)}
            onBlur={onTextCommit}
            onKeyDown={(e) => {
              if (e.key === "Escape") onTextCommit();
              e.stopPropagation();
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className={`h-full w-full resize-none bg-transparent p-3 font-medium outline-none ${
              scrollable ? "overflow-y-auto" : "overflow-hidden"
            }`}
            style={{ color: color.ink, fontSize: 15, lineHeight: 1.45 }}
            placeholder="Type something…"
          />
        ) : (
          <div
            ref={contentRef as React.RefObject<HTMLDivElement | null>}
            className={`h-full w-full whitespace-pre-wrap p-3 font-medium ${
              scrollable ? "overflow-y-auto" : "overflow-hidden"
            }`}
            style={{ fontSize: 15, lineHeight: 1.45 }}
          >
            {el.text || <span style={{ opacity: 0.4 }}>Double-click to edit</span>}
          </div>
        )}
        {selectionRing}
      </div>
    );
  }

  if (el.type === "text") {
    const scrollable = el.h >= MAX_TEXT_H;
    return (
      <div
        data-element-id={el.id}
        role="group"
        aria-label={elementLabel(el)}
        tabIndex={interactive ? 0 : -1}
        style={{ ...base }}
        onPointerDown={(e) => onPointerDown(e, el.id)}
        onDoubleClick={() => onDoubleClick(el.id)}
        onFocus={() => onFocusEl(el.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !editing) {
            e.preventDefault();
            onDoubleClick(el.id);
          }
        }}
      >
        {editing ? (
          <textarea
            ref={contentRef as React.RefObject<HTMLTextAreaElement | null>}
            autoFocus
            value={el.text ?? ""}
            onChange={(e) => onTextChange(el.id, e.target.value)}
            onBlur={onTextCommit}
            onKeyDown={(e) => {
              if (e.key === "Escape") onTextCommit();
              e.stopPropagation();
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className={`h-full w-full resize-none bg-transparent font-bold outline-none ${
              scrollable ? "overflow-y-auto" : "overflow-hidden"
            }`}
            style={{ color: color.vivid, fontSize: 22, lineHeight: 1.3 }}
            placeholder="Type…"
          />
        ) : (
          <div
            className={`h-full w-full select-none whitespace-pre-wrap font-bold ${
              scrollable ? "overflow-y-auto" : "overflow-hidden"
            }`}
            style={{ color: color.vivid, fontSize: 22, lineHeight: 1.3 }}
          >
            {el.text || <span style={{ opacity: 0.4 }}>Double-click to edit</span>}
          </div>
        )}
        {selectionRing}
      </div>
    );
  }

  if (el.type === "image") {
    return (
      <div
        data-element-id={el.id}
        style={{
          ...base,
          borderRadius: 6,
          overflow: "hidden",
          boxShadow: "0 6px 16px rgba(0,0,0,0.15), 0 1px 3px rgba(0,0,0,0.1)",
        }}
        className="select-none"
        onPointerDown={(e) => onPointerDown(e, el.id)}
      >
        <img
          src={el.src}
          alt=""
          draggable={false}
          className="h-full w-full select-none"
          style={{ objectFit: "fill" }}
        />
        {selectionRing}
      </div>
    );
  }

  if (el.type === "arrow") {
    // w/h hold the signed end offset; the wrapper sits at the start point
    const pad = 8;
    return (
      <div
        data-element-id={el.id}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: 0,
          height: 0,
          transform: `translate(${el.x}px, ${el.y}px)`,
          pointerEvents: interactive ? "auto" : "none",
          touchAction: "none",
        }}
        onPointerDown={(e) => onPointerDown(e, el.id)}
      >
        <svg style={{ overflow: "visible", display: "block", pointerEvents: "none" }} width={1} height={1}>
          <defs>
            <marker
              id={`head-${el.id}`}
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill={color.vivid} />
            </marker>
          </defs>
          {/* wide invisible line for easier grabbing */}
          <line x1={0} y1={0} x2={el.w} y2={el.h} stroke="transparent" strokeWidth={14} style={{ pointerEvents: "stroke" }} />
          <line
            x1={0}
            y1={0}
            x2={el.w}
            y2={el.h}
            stroke={color.vivid}
            strokeWidth={2.5}
            strokeLinecap="round"
            markerEnd={`url(#head-${el.id})`}
          />
        </svg>
        {selected && (
          <div
            className="absolute"
            style={{
              left: Math.min(0, el.w) - pad,
              top: Math.min(0, el.h) - pad,
              width: Math.abs(el.w) + pad * 2,
              height: Math.abs(el.h) + pad * 2,
              border: `${1.5 / zoom}px dashed var(--accent)`,
              borderRadius: 6,
              pointerEvents: "none",
            }}
          />
        )}
      </div>
    );
  }

  if (el.type === "rect" || el.type === "ellipse") {
    const strokeW = 2;
    return (
      <div
        data-element-id={el.id}
        style={base}
        onPointerDown={(e) => onPointerDown(e, el.id)}
        onDoubleClick={() => onDoubleClick(el.id)}
      >
        <svg width={el.w} height={el.h} style={{ overflow: "visible", display: "block" }}>
          {el.type === "rect" ? (
            <rect
              x={strokeW / 2}
              y={strokeW / 2}
              width={Math.max(1, el.w - strokeW)}
              height={Math.max(1, el.h - strokeW)}
              rx={8}
              fill={color.wash}
              stroke={color.vivid}
              strokeWidth={strokeW}
            />
          ) : (
            <ellipse
              cx={el.w / 2}
              cy={el.h / 2}
              rx={Math.max(1, (el.w - strokeW) / 2)}
              ry={Math.max(1, (el.h - strokeW) / 2)}
              fill={color.wash}
              stroke={color.vivid}
              strokeWidth={strokeW}
            />
          )}
        </svg>
        {selectionRing}
      </div>
    );
  }

  // Freehand stroke
  const path = strokeToPath(el.points ?? [], el.size ?? 6);
  return (
    <div
      data-element-id={el.id}
      style={base}
      onPointerDown={(e) => onPointerDown(e, el.id)}
    >
      <svg width={Math.max(1, el.w)} height={Math.max(1, el.h)} style={{ overflow: "visible", display: "block" }}>
        <path d={path} fill={color.vivid} />
      </svg>
      {selected && (
        <div
          className="absolute"
          style={{
            inset: -2 / zoom,
            border: `${2 / zoom}px dashed var(--accent)`,
            borderRadius: 6,
            pointerEvents: "none",
          }}
        />
      )}
    </div>
  );
});
