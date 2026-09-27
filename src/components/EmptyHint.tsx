import { useEffect, useState } from "react";
import { MousePointerClick, Hand, Keyboard } from "lucide-react";

interface Props {
  /** Current board elements — the hint only shows while the board is empty. */
  count: number;
  /** True once local/server content has finished loading, so a board that's
   *  about to populate never flashes the "empty" hint. */
  ready: boolean;
}

/**
 * First-run onboarding for an empty board: a faint, non-interactive hint that
 * names the two most useful gestures. It uses touch-specific wording on
 * coarse pointers (double-tap has no meaning for a mouse, and vice versa) and
 * fades away the moment any element exists, so a loaded board never flashes it.
 */
export function EmptyHint({ count, ready }: Props) {
  // Defer the pointer media query to an effect so the first paint (and SSR /
  // jsdom tests) don't read `window` during render.
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    setCoarse(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setCoarse(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  if (!ready || count > 0) return null;

  const tip = coarse
    ? { icon: <Hand size={18} />, text: "Tap twice to add a note · pinch to zoom" }
    : { icon: <MousePointerClick size={18} />, text: "Double-click to add a note · scroll to zoom" };

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-3"
    >
      <div className="rise flex items-center gap-2.5 rounded-full border border-[var(--border)] bg-[var(--panel)] px-4 py-2.5 shadow-lg backdrop-blur-md">
        <span className="text-[var(--accent)]">{tip.icon}</span>
        <span className="text-sm font-medium text-[var(--muted)]">{tip.text}</span>
      </div>
      <div className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--muted)] opacity-70">
        <Keyboard size={13} />
        Press ? for all shortcuts
      </div>
    </div>
  );
}
