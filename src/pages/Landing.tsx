import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { nanoid } from "nanoid";
import {
  ArrowRight,
  CloudOff,
  MessageCircle,
  Moon,
  Sun,
  Undo2,
  Wand2,
  X,
} from "lucide-react";
import { GithubIcon } from "../components/Logo";
import { getRecentBoards, removeRecentBoard, touchRecentBoard } from "../lib/user";
import { useTheme } from "../lib/theme";
import { Logo } from "../components/Logo";
import { HeroDemo } from "../components/HeroDemo";

const REPO = "https://github.com/anorga/driftboard";

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

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
      {/* ambient gradient wash */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            "radial-gradient(700px 480px at 12% -8%, color-mix(in srgb, #6366f1 16%, transparent), transparent), radial-gradient(800px 560px at 105% 12%, color-mix(in srgb, #ec4899 11%, transparent), transparent), radial-gradient(600px 500px at 50% 115%, color-mix(in srgb, #06b6d4 9%, transparent), transparent)",
        }}
      />

      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2.5">
          <Logo size={30} />
          <span className="font-display text-lg font-bold tracking-tight">Driftboard</span>
        </div>
        <div className="flex items-center gap-2.5">
          <a
            href={REPO}
            target="_blank"
            rel="noreferrer"
            title="View source on GitHub"
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--panel)] transition-colors hover:bg-[var(--hover)]"
          >
            <GithubIcon size={17} />
          </a>
          <button
            onClick={toggle}
            title="Toggle theme"
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--panel)] transition-colors hover:bg-[var(--hover)]"
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

      <main className="relative z-10 mx-auto max-w-6xl px-6">
        {/* ---- Hero ---- */}
        <section className="grid items-center gap-10 pb-20 pt-10 lg:grid-cols-2 lg:gap-14 lg:pt-16">
          <div>
            <div
              className="rise mb-5 flex w-max items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--panel)] px-3.5 py-1.5 text-[12px] font-medium text-[var(--muted)]"
              style={{ animationDelay: "0ms" }}
            >
              <span className="relative flex h-2 w-2">
                <span className="absolute h-full w-full animate-ping rounded-full bg-green-500 opacity-60" />
                <span className="h-2 w-2 rounded-full bg-green-500" />
              </span>
              Real-time · conflict-free · open source
            </div>
            <h1
              className="rise font-display text-balance text-5xl font-bold leading-[1.04] tracking-tight sm:text-6xl"
              style={{ animationDelay: "80ms" }}
            >
              The whiteboard that{" "}
              <span className="bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 bg-clip-text text-transparent">
                thinks in sync
              </span>
            </h1>
            <p
              className="rise mt-5 max-w-md text-pretty text-lg leading-relaxed text-[var(--muted)]"
              style={{ animationDelay: "160ms" }}
            >
              Sticky notes, shapes, and freehand ink on an infinite canvas. Share a
              link and every cursor, sketch, and edit appears live. Even offline
              edits merge cleanly when you're back.
            </p>
            <div className="rise mt-8 flex flex-wrap items-center gap-3" style={{ animationDelay: "240ms" }}>
              <button
                onClick={createBoard}
                className="group flex items-center gap-2 rounded-2xl bg-[var(--accent)] px-6 py-3.5 text-base font-semibold text-white shadow-lg shadow-indigo-500/25 transition-all hover:opacity-90"
              >
                Create a board
                <ArrowRight size={18} className="transition-transform group-hover:translate-x-0.5" />
              </button>
              <a
                href={REPO}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--panel)] px-5 py-3.5 text-base font-semibold transition-colors hover:bg-[var(--hover)]"
              >
                <GithubIcon size={17} />
                Source
              </a>
            </div>
            <p className="rise mt-4 text-[13px] text-[var(--muted)]" style={{ animationDelay: "300ms" }}>
              Free forever · No accounts · Boards live at a shareable URL
            </p>
          </div>
          <div className="rise" style={{ animationDelay: "200ms" }}>
            <HeroDemo />
            <p className="mt-3 text-center text-[12px] text-[var(--muted)]">
              ↑ Go ahead, drag the notes. The real board syncs this across everyone.
            </p>
          </div>
        </section>

        {/* ---- Recent boards ---- */}
        {recent.length > 0 && (
          <section className="pb-16">
            <h2 className="mb-4 font-display text-sm font-bold uppercase tracking-wider text-[var(--muted)]">
              Jump back in
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {recent.slice(0, 8).map((b) => (
                <div key={b.id} className="group relative">
                  <Link
                    to={`/b/${b.id}`}
                    className="block rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4 transition-all hover:-translate-y-0.5 hover:border-[var(--accent)]"
                  >
                    <div className="truncate pr-6 font-semibold">{b.name || "Untitled board"}</div>
                    <div className="mt-1 text-[12px] text-[var(--muted)]">Opened {timeAgo(b.visitedAt)}</div>
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

        {/* ---- Bento features ---- */}
        <section className="pb-20">
          <h2 className="mb-2 font-display text-3xl font-bold tracking-tight">
            Small tool, serious engineering
          </h2>
          <p className="mb-8 max-w-lg text-[var(--muted)]">
            Everything is built on CRDTs, the same conflict-free tech behind Figma-class
            multiplayer, with a hand-rolled WebSocket sync server.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* CRDT card (wide) */}
            <div className="rounded-3xl border border-[var(--border)] bg-[var(--panel)] p-6 sm:col-span-2">
              <h3 className="font-display mb-1.5 text-lg font-bold">Conflict-free by design</h3>
              <p className="mb-5 text-sm leading-relaxed text-[var(--muted)]">
                Every element is a CRDT. Two people edit the same note at once: one
                recolors, one moves, and both edits win. No locks, no "someone else is
                editing", no lost work.
              </p>
              <div className="flex items-center justify-center gap-3 text-[12px] font-semibold">
                <div className="rounded-lg bg-[#fef08a] px-3 py-2 text-[#713f12] shadow" style={{ transform: "rotate(-2deg)" }}>
                  moves it ↘
                </div>
                <span className="text-[var(--muted)]">+</span>
                <div className="rounded-lg bg-[#fbcfe8] px-3 py-2 text-[#831843] shadow" style={{ transform: "rotate(2deg)" }}>
                  recolors it 🎨
                </div>
                <span className="text-[var(--muted)]">=</span>
                <div className="rounded-lg bg-[#fbcfe8] px-3 py-2 text-[#831843] shadow ring-2 ring-green-500/60" style={{ transform: "rotate(-1deg) translateY(4px)" }}>
                  both ✓
                </div>
              </div>
            </div>

            {/* Cursor chat / laser */}
            <div className="rounded-3xl border border-[var(--border)] bg-[var(--panel)] p-6">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent)]/12 text-[var(--accent)]">
                <MessageCircle size={19} />
              </div>
              <h3 className="font-display mb-1.5 font-bold">Cursor chat & laser</h3>
              <p className="text-sm leading-relaxed text-[var(--muted)]">
                Press <kbd className="rounded border border-[var(--border)] bg-[var(--hover)] px-1.5 text-[11px]">/</kbd> to
                talk at your cursor. Grab the laser <Wand2 size={13} className="inline" /> to
                present and everyone sees the trail live.
              </p>
            </div>

            {/* Offline */}
            <div className="rounded-3xl border border-[var(--border)] bg-[var(--panel)] p-6">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent)]/12 text-[var(--accent)]">
                <CloudOff size={19} />
              </div>
              <h3 className="font-display mb-1.5 font-bold">Offline-first</h3>
              <p className="text-sm leading-relaxed text-[var(--muted)]">
                Boards persist in IndexedDB. Lose your connection, keep sketching.
                Everything reconciles the moment you're back.
              </p>
            </div>

            {/* Undo */}
            <div className="rounded-3xl border border-[var(--border)] bg-[var(--panel)] p-6">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent)]/12 text-[var(--accent)]">
                <Undo2 size={19} />
              </div>
              <h3 className="font-display mb-1.5 font-bold">Polite undo</h3>
              <p className="text-sm leading-relaxed text-[var(--muted)]">
                <kbd className="rounded border border-[var(--border)] bg-[var(--hover)] px-1.5 text-[11px]">⌘Z</kbd> only
                reverts <em>your</em> changes, never a teammate's. The undo stack is
                CRDT-aware.
              </p>
            </div>

            {/* Presence (wide-ish) */}
            <div className="rounded-3xl border border-[var(--border)] bg-[var(--panel)] p-6 sm:col-span-2 lg:col-span-3">
              <h3 className="font-display mb-1.5 text-lg font-bold">Presence everywhere</h3>
              <p className="max-w-xl text-sm leading-relaxed text-[var(--muted)]">
                Named live cursors, avatar stacks, remote selection outlines in each
                person's color, and click-to-jump to any collaborator. You always know
                who's looking at what, with zero configuration.
              </p>
            </div>
          </div>
        </section>

        {/* ---- How it works ---- */}
        <section className="pb-20">
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              ["1", "Create a board", "One click. The URL is the board. No account, no setup."],
              ["2", "Share the link", "Anyone who opens it is instantly in, cursor and all."],
              ["3", "Think together", "Sketch, arrange, present. Export to PNG when you're done."],
            ].map(([n, title, body]) => (
              <div key={n} className="rounded-3xl border border-[var(--border)] bg-[var(--panel)] p-6">
                <div className="font-display mb-2 text-3xl font-bold text-[var(--accent)]">{n}</div>
                <h3 className="font-display mb-1 font-bold">{title}</h3>
                <p className="text-sm text-[var(--muted)]">{body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ---- CTA ---- */}
        <section className="pb-24">
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-600 px-8 py-14 text-center text-white">
            <div
              aria-hidden
              className="absolute inset-0 opacity-20"
              style={{
                backgroundImage: "radial-gradient(circle, #fff 1px, transparent 1px)",
                backgroundSize: "22px 22px",
              }}
            />
            <h2 className="font-display relative text-balance text-3xl font-bold tracking-tight sm:text-4xl">
              Your next idea deserves a bigger canvas
            </h2>
            <p className="relative mx-auto mt-3 max-w-md text-white/85">
              Start a board in one click. Share it in two.
            </p>
            <button
              onClick={createBoard}
              className="relative mt-7 rounded-2xl bg-white px-7 py-3.5 text-base font-bold text-indigo-700 shadow-xl transition-transform hover:scale-[1.03]"
            >
              Create a free board
            </button>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-[var(--border)] py-8 text-center text-sm text-[var(--muted)]">
        Built by{" "}
        <a href="https://anorga.xyz" target="_blank" rel="noreferrer" className="font-semibold text-[var(--accent)] hover:underline">
          Chris Anorga
        </a>{" "}
        · React, TypeScript, Yjs & WebSockets ·{" "}
        <a href={REPO} target="_blank" rel="noreferrer" className="font-semibold text-[var(--accent)] hover:underline">
          GitHub
        </a>
      </footer>
    </div>
  );
}
