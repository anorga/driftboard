import { BringToFront, Copy, SendToBack, Trash2 } from "lucide-react";
import { PALETTE } from "../lib/constants";

interface Props {
  count: number;
  onColor: (colorId: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onFront: () => void;
  onBack: () => void;
}

/** Floating action bar shown while elements are selected. */
export function SelectionActions({ count, onColor, onDuplicate, onDelete, onFront, onBack }: Props) {
  if (count === 0) return null;
  return (
    <div
      role="toolbar"
      aria-label="Selection actions"
      className="pointer-events-auto absolute left-1/2 top-20 z-20 flex -translate-x-1/2 items-center gap-2 overflow-x-auto rounded-full border border-[var(--border)] bg-[var(--panel)] py-2 pl-4 pr-2 shadow-lg backdrop-blur-md max-w-[calc(100vw-1rem)]"
    >
      <span aria-live="polite" className="text-[12px] font-semibold text-[var(--muted)]">
        {count} selected
      </span>
      <div aria-hidden="true" className="mx-1 h-5 w-px bg-[var(--border)]" />
      <div role="group" aria-label="Selection color" className="flex items-center gap-1.5">
        {PALETTE.map((c) => (
          <button
            key={c.id}
            aria-label={`Color: ${c.id}`}
            onClick={() => onColor(c.id)}
            className="h-5 w-5 rounded-full transition-transform hover:scale-110"
            style={{ background: c.vivid }}
          />
        ))}
      </div>
      <div aria-hidden="true" className="mx-1 h-5 w-px bg-[var(--border)]" />
      <button
        title="Bring to front (])"
        aria-label="Bring to front"
        aria-keyshortcuts="]"
        onClick={onFront}
        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--text)] hover:bg-[var(--hover)]"
      >
        <BringToFront aria-hidden="true" size={15} />
      </button>
      <button
        title="Send to back ([)"
        aria-label="Send to back"
        aria-keyshortcuts="["
        onClick={onBack}
        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--text)] hover:bg-[var(--hover)]"
      >
        <SendToBack aria-hidden="true" size={15} />
      </button>
      <button
        title="Duplicate (⌘D)"
        aria-label="Duplicate selection"
        aria-keyshortcuts="Meta+D"
        onClick={onDuplicate}
        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--text)] hover:bg-[var(--hover)]"
      >
        <Copy aria-hidden="true" size={15} />
      </button>
      <button
        title="Delete (⌫)"
        aria-label="Delete selection"
        aria-keyshortcuts="Delete"
        onClick={onDelete}
        className="flex h-8 w-8 items-center justify-center rounded-full text-red-500 hover:bg-red-500/10"
      >
        <Trash2 aria-hidden="true" size={15} />
      </button>
    </div>
  );
}
