import { memo } from "react";
import type { BoardElement } from "../lib/types";
import { getColor } from "../lib/constants";
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
}: Props) {
  const color = getColor(el.color);
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
    return (
      <div
        data-element-id={el.id}
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
      >
        {editing ? (
          <textarea
            autoFocus
            value={el.text ?? ""}
            onChange={(e) => onTextChange(el.id, e.target.value)}
            onBlur={onTextCommit}
            onKeyDown={(e) => {
              if (e.key === "Escape") onTextCommit();
              e.stopPropagation();
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className="h-full w-full resize-none bg-transparent p-3 font-medium outline-none"
            style={{ color: color.ink, fontSize: 15, lineHeight: 1.45 }}
            placeholder="Type something…"
          />
        ) : (
          <div
            className="h-full w-full overflow-hidden whitespace-pre-wrap p-3 font-medium"
            style={{ fontSize: 15, lineHeight: 1.45 }}
          >
            {el.text || <span style={{ opacity: 0.4 }}>Double-click to edit</span>}
          </div>
        )}
        {selectionRing}
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
