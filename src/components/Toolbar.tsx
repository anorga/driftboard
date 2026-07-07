import {
  MousePointer2,
  Hand,
  StickyNote,
  Type,
  Square,
  Circle,
  MoveUpRight,
  Pen,
  Wand2,
  Undo2,
  Redo2,
} from "lucide-react";
import type { Tool } from "../lib/types";
import { PALETTE } from "../lib/constants";

interface Props {
  tool: Tool;
  setTool: (t: Tool) => void;
  drawColor: string;
  setDrawColor: (c: string) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

const TOOLS: Array<{ id: Tool; icon: React.ElementType; label: string; kbd: string }> = [
  { id: "select", icon: MousePointer2, label: "Select", kbd: "V" },
  { id: "hand", icon: Hand, label: "Hand", kbd: "H" },
  { id: "sticky", icon: StickyNote, label: "Sticky note", kbd: "N" },
  { id: "text", icon: Type, label: "Text", kbd: "T" },
  { id: "rect", icon: Square, label: "Rectangle", kbd: "R" },
  { id: "ellipse", icon: Circle, label: "Ellipse", kbd: "O" },
  { id: "arrow", icon: MoveUpRight, label: "Arrow", kbd: "A" },
  { id: "pen", icon: Pen, label: "Pen", kbd: "P" },
  { id: "laser", icon: Wand2, label: "Laser pointer", kbd: "L" },
];

const DRAW_TOOLS: Tool[] = ["sticky", "text", "rect", "ellipse", "arrow", "pen"];

export function Toolbar({ tool, setTool, drawColor, setDrawColor, canUndo, canRedo, onUndo, onRedo }: Props) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-5 z-20 flex flex-col items-center gap-2">
      {DRAW_TOOLS.includes(tool) && (
        <div className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--panel)] px-3 py-2 shadow-lg backdrop-blur-md">
          {PALETTE.map((c) => (
            <button
              key={c.id}
              title={c.id}
              onClick={() => setDrawColor(c.id)}
              className="h-5.5 w-5.5 rounded-full transition-transform hover:scale-110"
              style={{
                background: c.vivid,
                outline: drawColor === c.id ? "2px solid var(--accent)" : "none",
                outlineOffset: 2,
              }}
            />
          ))}
        </div>
      )}
      <div className="pointer-events-auto flex items-center gap-1 rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-1.5 shadow-xl backdrop-blur-md">
        {TOOLS.map(({ id, icon: Icon, label, kbd }) => (
          <button
            key={id}
            title={`${label} (${kbd})`}
            onClick={() => setTool(id)}
            className={`group relative flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${
              tool === id
                ? "bg-[var(--accent)] text-white"
                : "text-[var(--text)] hover:bg-[var(--hover)]"
            }`}
          >
            <Icon size={19} strokeWidth={2.1} />
            <span className="pointer-events-none absolute -top-8 hidden whitespace-nowrap rounded-md bg-[var(--tooltip)] px-2 py-1 text-[11px] font-medium text-[var(--tooltip-text)] shadow group-hover:block">
              {label} · {kbd}
            </span>
          </button>
        ))}
        <div className="mx-1 h-6 w-px bg-[var(--border)]" />
        <button
          title="Undo (⌘Z)"
          onClick={onUndo}
          disabled={!canUndo}
          className="flex h-10 w-10 items-center justify-center rounded-xl text-[var(--text)] transition-colors hover:bg-[var(--hover)] disabled:opacity-30"
        >
          <Undo2 size={19} strokeWidth={2.1} />
        </button>
        <button
          title="Redo (⇧⌘Z)"
          onClick={onRedo}
          disabled={!canRedo}
          className="flex h-10 w-10 items-center justify-center rounded-xl text-[var(--text)] transition-colors hover:bg-[var(--hover)] disabled:opacity-30"
        >
          <Redo2 size={19} strokeWidth={2.1} />
        </button>
      </div>
    </div>
  );
}
