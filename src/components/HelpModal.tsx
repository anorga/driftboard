import { X } from "lucide-react";

const SHORTCUTS: Array<[string, string]> = [
  ["V / H", "Select / Hand"],
  ["N · T", "Sticky note · Text"],
  ["R · O · A", "Rectangle · Ellipse · Arrow"],
  ["P · L", "Pen · Laser pointer"],
  ["/", "Cursor chat — talk at your cursor"],
  ["⌘Z / ⇧⌘Z", "Undo / Redo (your changes only)"],
  ["⌘D", "Duplicate selection"],
  ["⌫", "Delete selection"],
  ["Space + drag", "Pan the canvas"],
  ["⌘ scroll / pinch", "Zoom"],
  ["Double-click", "Quick sticky note / edit text"],
  ["Shift + click", "Add to selection"],
  ["?", "Toggle this help"],
];

export function HelpModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-[420px] max-w-[calc(100vw-32px)] rounded-2xl border border-[var(--border)] bg-[var(--panel-solid)] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-[var(--text)]">Keyboard shortcuts</h2>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-[var(--hover)]"
          >
            <X size={16} />
          </button>
        </div>
        <div className="space-y-2.5">
          {SHORTCUTS.map(([keys, label]) => (
            <div key={keys} className="flex items-center justify-between gap-4">
              <span className="text-sm text-[var(--muted)]">{label}</span>
              <kbd className="rounded-md border border-[var(--border)] bg-[var(--hover)] px-2 py-0.5 text-[12px] font-semibold text-[var(--text)]">
                {keys}
              </kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
