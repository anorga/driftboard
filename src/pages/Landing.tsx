import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { nanoid } from "nanoid";
import {
  ArrowRight,
  CloudOff,
  MousePointer2,
  Moon,
  Sun,
  Users,
  X,
  Zap,
} from "lucide-react";
import { getRecentBoards, removeRecentBoard, touchRecentBoard } from "../lib/user";
import { useTheme } from "../lib/theme";
import { Logo } from "../components/Logo";

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const FEATURES = [
  {
    icon: Users,
    title: "Multiplayer by default",
    body: "Share a link and collaborate instantly — live cursors, presence, and edits that appear as they happen. No accounts, no setup.",
  },
  {
    icon: Zap,
    title: "Conflict-free sync",
    body: "Built on CRDTs (Yjs), so simultaneous edits always merge cleanly — even after working offline. Undo only touches your changes.",
  },
  {
    icon: CloudOff,
    title: "Offline-ready",
    body: "Boards persist locally in IndexedDB. Lose your connection, keep working, and everything reconciles when you're back.",
  },
];

export function Landing() {
  const navigate = useNavigate();
  const { dark, toggle } = useTheme();
  const [recent, setRecent] = useState(getRecentBoards);

  const createBoard = () => {
    const id = nanoid(10);
    touchRecentBoard(id, "Untitled board");
    navigate(`/b/${id}`);
  };

  const forget = (id: string) => {
    removeRecentBoard(id);
    setRecent(getRecentBoards());
  };

  return (
    <div className="min-h-dvh bg-[var(--bg)] text-[var(--text)]">
      {/* soft background glow */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            "radial-gradient(600px 400px at 20% 0%, color-mix(in srgb, #6366f1 14%, transparent), transparent), radial-gradient(700px 500px at 90% 20%, color-mix(in srgb, #ec4899 10%, transparent), transparent)",
        }}
      />

      <header className="relative z-10 mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2.5">
          <Logo size={30} />
          <span className="text-lg font-bold tracking-tight">Driftboard</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={toggle}
            title="Toggle theme"
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--panel)] hover:bg-[var(--hover)]"
          >
            {dark ? <Sun size={17} /> : <Moon size={17} />}
          </button>
          <button
            onClick={createBoard}
            className="rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            New board
          </button>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-5xl px-6">
        {/* Hero */}
        <section className="pb-16 pt-16 text-center sm:pt-24">
          <div className="mx-auto mb-5 flex w-max items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--panel)] px-3.5 py-1.5 text-[12px] font-medium text-[var(--muted)]">
            <MousePointer2 size={13} className="text-[var(--accent)]" />
            Real-time collaborative whiteboard
          </div>
          <h1 className="mx-auto max-w-3xl text-balance text-5xl font-extrabold tracking-tight sm:text-6xl">
            Think together,{" "}
            <span className="bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 bg-clip-text text-transparent">
              in real time
            </span>
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-pretty text-lg text-[var(--muted)]">
            Sticky notes, shapes, and freehand sketching on an infinite canvas.
            Share a link and watch everyone's cursors light up — no sign-up required.
          </p>
          <div className="mt-9 flex items-center justify-center gap-4">
            <button
              onClick={createBoard}
              className="group flex items-center gap-2 rounded-2xl bg-[var(--accent)] px-7 py-3.5 text-base font-semibold text-white shadow-lg shadow-indigo-500/25 transition-all hover:opacity-90"
            >
              Create a board
              <ArrowRight size={18} className="transition-transform group-hover:translate-x-0.5" />
            </button>
          </div>
          <p className="mt-4 text-[13px] text-[var(--muted)]">
            Free · No account · Boards live at a shareable URL
          </p>
        </section>

        {/* Recent boards */}
        {recent.length > 0 && (
          <section className="pb-14">
            <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-[var(--muted)]">
              Recent boards
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {recent.map((b) => (
                <div key={b.id} className="group relative">
                  <Link
                    to={`/b/${b.id}`}
                    className="block rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4 transition-colors hover:border-[var(--accent)]"
                  >
                    <div className="truncate pr-6 font-semibold">{b.name || "Untitled board"}</div>
                    <div className="mt-1 text-[12px] text-[var(--muted)]">
                      Opened {timeAgo(b.visitedAt)}
                    </div>
                  </Link>
                  <button
                    title="Remove from recents"
                    onClick={() => forget(b.id)}
                    className="absolute right-3 top-3 hidden h-6 w-6 items-center justify-center rounded-md text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)] group-hover:flex"
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Features */}
        <section className="grid grid-cols-1 gap-4 pb-20 sm:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-6"
            >
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent)]/12 text-[var(--accent)]">
                <Icon size={19} />
              </div>
              <h3 className="mb-1.5 font-bold">{title}</h3>
              <p className="text-sm leading-relaxed text-[var(--muted)]">{body}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="relative z-10 border-t border-[var(--border)] py-8 text-center text-sm text-[var(--muted)]">
        Built by{" "}
        <a
          href="https://anorga.xyz"
          target="_blank"
          rel="noreferrer"
          className="font-semibold text-[var(--accent)] hover:underline"
        >
          Chris Anorga
        </a>{" "}
        · React, TypeScript, Yjs & WebSockets
      </footer>
    </div>
  );
}
