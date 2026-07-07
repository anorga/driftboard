import { Copy, Trash2 } from "lucide-react";
import { PALETTE } from "../lib/constants";

interface Props {
  count: number;
  onColor: (colorId: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

/** Floating action bar shown while elements are selected. */
export function SelectionActions({ count, onColor, onDuplicate, onDelete }: Props) {
  if (count === 0) return null;
  return (
    <div className="pointer-events-auto absolute left-1/2 top-20 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--panel)] py-2 pl-4 pr-2 shadow-lg backdrop-blur-md">
      <span className="text-[12px] font-semibold text-[var(--muted)]">
        {count} selected
      </span>
      <div className="mx-1 h-5 w-px bg-[var(--border)]" />
      <div className="flex items-center gap-1.5">
        {PALETTE.map((c) => (
          <button
            key={c.id}
            title={`Color: ${c.id}`}
            onClick={() => onColor(c.id)}
            className="h-5 w-5 rounded-full transition-transform hover:scale-110"
            style={{ background: c.vivid }}
          />
        ))}
      </div>
      <div className="mx-1 h-5 w-px bg-[var(--border)]" />
      <button
        title="Duplicate (⌘D)"
        onClick={onDuplicate}
        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--text)] hover:bg-[var(--hover)]"
      >
        <Copy size={15} />
      </button>
      <button
        title="Delete (⌫)"
        onClick={onDelete}
        className="flex h-8 w-8 items-center justify-center rounded-full text-red-500 hover:bg-red-500/10"
      >
        <Trash2 size={15} />
      </button>
    </div>
  );
}
