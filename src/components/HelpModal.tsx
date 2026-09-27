import { useEffect, useRef } from "react";
import { X } from "lucide-react";

const SHORTCUTS: Array<[string, string]> = [
  ["V / H", "Select / Hand"],
  ["N · T", "Sticky note · Text"],
  ["R · O · A", "Rectangle · Ellipse · Arrow"],
  ["P · L", "Pen · Laser pointer"],
  ["/", "Cursor chat (talk at your cursor)"],
  ["⌘Z / ⇧⌘Z", "Undo / Redo (your changes only)"],
  ["⌘C · ⌘X · ⌘V", "Copy · Cut · Paste (elements & images)"],
  ["⌘A", "Select all"],
  ["⌘D", "Duplicate selection"],
  ["⌫", "Delete selection"],
  ["Arrows / ⇧ arrows", "Nudge selection 1px / 10px"],
  ["] / [", "Bring to front / Send to back"],
  ["Space + drag", "Pan the canvas"],
  ["⌘ scroll / pinch", "Zoom"],
  ["Double-click", "Quick sticky note / edit text"],
  ["Shift + click", "Add to selection"],
  ["?", "Toggle this help"],
];

export function HelpModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Dialog semantics: focus the panel while open, trap Tab inside it, restore
  // focus to the trigger when closed, and close on Escape.
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    panel?.focus();

    const getFocusable = () =>
      panel
        ? [...panel.querySelectorAll<HTMLElement>("button, [href], input, textarea, [tabindex]:not([tabindex='-1'])")]
        : [];

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const items = getFocusable();
      if (items.length === 0) {
        e.preventDefault(); // nowhere to move: hold focus inside
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      // Focusable *items* live inside the dialog, but the dialog panel itself
      // (tabIndex=-1, the initial focus) is NOT one of them. A raw
      // Tab/Shift+Tab from the panel — or from anything that has escaped
      // behind the modal — walks the surrounding DOM order and leaves the
      // trap, so both cases must be routed back in explicitly.
      const inTrap = active instanceof Element && panel.contains(active) && active !== panel;
      if (!inTrap) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      previouslyFocused?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-dialog-title"
        tabIndex={-1}
        className="w-[420px] max-w-[calc(100vw-32px)] rounded-2xl border border-[var(--border)] bg-[var(--panel-solid)] p-6 shadow-2xl outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id="help-dialog-title" className="text-lg font-bold text-[var(--text)]">
            Keyboard shortcuts
          </h2>
          <button
            onClick={onClose}
            aria-label="Close help"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-[var(--hover)]"
          >
            <X aria-hidden="true" size={16} />
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
