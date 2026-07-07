import { useEffect, useRef, useState } from "react";

/**
 * The landing hero IS the product: a local mini-board with draggable sticky
 * notes and two simulated collaborator cursors roaming it. No sync — just a
 * taste of the real thing.
 */

interface NotePos {
  x: number;
  y: number;
}

const NOTES = [
  { id: 0, text: "Drag me around 👋", bg: "#fef08a", ink: "#713f12", tilt: -2.5, w: 150 },
  { id: 1, text: "Ship it 🚀", bg: "#fbcfe8", ink: "#831843", tilt: 2, w: 120 },
  { id: 2, text: "No sign-up.\nJust a link.", bg: "#bfdbfe", ink: "#1e3a8a", tilt: 1.5, w: 140 },
];

function FakeCursor({
  name,
  color,
  path,
  size,
}: {
  name: string;
  color: string;
  path: (t: number) => { x: number; y: number };
  size: { w: number; h: number };
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const start = performance.now() + Math.random() * 2000;
    const tick = () => {
      const t = (performance.now() - start) / 1000;
      const p = path(t);
      if (ref.current) {
        ref.current.style.transform = `translate(${p.x * size.w}px, ${p.y * size.h}px)`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [path, size.h, size.w]);

  return (
    <div ref={ref} className="pointer-events-none absolute left-0 top-0 z-20 will-change-transform">
      <svg width="20" height="20" viewBox="0 0 24 24">
        <path
          d="M5.5 3.2 19.2 11c.8.45.6 1.65-.3 1.83l-5.8 1.15-2.6 5.35c-.4.83-1.62.7-1.84-.2L4.2 4.4c-.2-.85.65-1.6 1.3-1.2Z"
          fill={color}
          stroke="white"
          strokeWidth="1.4"
        />
      </svg>
      <div
        className="ml-3.5 -mt-0.5 w-max rounded-full px-2 py-0.5 text-[10px] font-semibold text-white shadow"
        style={{ background: color }}
      >
        {name}
      </div>
    </div>
  );
}

export function HeroDemo() {
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 560, h: 400 });
  const [positions, setPositions] = useState<NotePos[]>([
    { x: 0.08, y: 0.14 },
    { x: 0.6, y: 0.12 },
    { x: 0.52, y: 0.58 },
  ]);
  const drag = useRef<{ id: number; dx: number; dy: number } | null>(null);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() =>
      setSize({ w: el.clientWidth, h: el.clientHeight }),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onNoteDown = (e: React.PointerEvent, id: number) => {
    const box = boxRef.current!.getBoundingClientRect();
    drag.current = {
      id,
      dx: e.clientX - box.left - positions[id].x * size.w,
      dy: e.clientY - box.top - positions[id].y * size.h,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const box = boxRef.current!.getBoundingClientRect();
    const { id, dx, dy } = drag.current;
    const x = Math.min(0.82, Math.max(0, (e.clientX - box.left - dx) / size.w));
    const y = Math.min(0.78, Math.max(0, (e.clientY - box.top - dy) / size.h));
    setPositions((prev) => prev.map((p, i) => (i === id ? { x, y } : p)));
  };
  const onUp = () => {
    drag.current = null;
  };

  return (
    <div
      ref={boxRef}
      className="relative h-[380px] w-full touch-none select-none overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--canvas)] shadow-2xl sm:h-[420px]"
      style={{
        backgroundImage: "radial-gradient(circle, var(--grid-dot) 1px, transparent 1px)",
        backgroundSize: "22px 22px",
      }}
      onPointerMove={onMove}
      onPointerUp={onUp}
    >
      {/* fake presence chrome */}
      <div className="absolute right-3 top-3 z-30 flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--panel)] py-1 pl-1 pr-3 shadow backdrop-blur-md">
        <div className="flex -space-x-1.5">
          {["#3b82f6", "#ec4899", "#22c55e"].map((c, i) => (
            <span
              key={i}
              className="h-5 w-5 rounded-full border-2 border-[var(--panel-solid)]"
              style={{ background: c }}
            />
          ))}
        </div>
        <span className="flex items-center gap-1 text-[10px] font-semibold text-[var(--muted)]">
          <span className="h-1.5 w-1.5 rounded-full bg-green-500" /> Live
        </span>
      </div>

      {/* pre-drawn pen stroke */}
      <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 560 420" preserveAspectRatio="none">
        <path
          d="M60 330 C 120 240, 170 350, 230 290 S 330 220, 380 280"
          fill="none"
          stroke="#f97316"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray="300"
          style={{ animation: "dash-draw 2.2s ease-out both" }}
        />
        <g stroke="#8b5cf6" strokeWidth="2.5" fill="none" strokeLinecap="round">
          <line x1="392" y1="150" x2="470" y2="118" />
          <path d="M461 112 L 472 117 L 465 127" fill="#8b5cf6" stroke="none" />
        </g>
      </svg>

      {/* draggable stickies */}
      {NOTES.map((n, i) => (
        <div
          key={n.id}
          className="absolute z-10 cursor-grab rounded-md p-3 text-[13px] font-semibold shadow-lg active:cursor-grabbing"
          style={{
            left: 0,
            top: 0,
            width: n.w,
            transform: `translate(${positions[i].x * size.w}px, ${positions[i].y * size.h}px) rotate(${n.tilt}deg)`,
            background: n.bg,
            color: n.ink,
            whiteSpace: "pre-line",
            ["--tilt" as string]: `${n.tilt}deg`,
          }}
          onPointerDown={(e) => onNoteDown(e, n.id)}
        >
          {n.text}
        </div>
      ))}

      {/* roaming collaborator cursors */}
      <FakeCursor
        name="Ava"
        color="#ec4899"
        size={size}
        path={(t) => ({
          x: 0.5 + 0.32 * Math.sin(t * 0.5) * Math.cos(t * 0.21),
          y: 0.45 + 0.28 * Math.sin(t * 0.34 + 1.2),
        })}
      />
      <FakeCursor
        name="Sam"
        color="#3b82f6"
        size={size}
        path={(t) => ({
          x: 0.42 + 0.3 * Math.sin(t * 0.38 + 2.4),
          y: 0.5 + 0.3 * Math.sin(t * 0.52 + 0.6) * Math.cos(t * 0.18),
        })}
      />
    </div>
  );
}
