import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, Link2, Moon, Sun } from "lucide-react";
import type { WebsocketProvider } from "y-websocket";
import type { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { useConnectionStatus, useMetaField, useRemotePeers } from "../lib/board";
import { LOCAL_ORIGIN } from "../lib/board";
import { useTheme } from "../lib/theme";
import type { UserInfo } from "../lib/types";
import { Logo } from "./Logo";

interface Props {
  doc: Y.Doc;
  meta: Y.Map<unknown>;
  provider: WebsocketProvider;
  awareness: Awareness;
  user: UserInfo;
  onBoardNameChange?: (name: string) => void;
}

function Avatar({ name, color, ring }: { name: string; color: string; ring?: boolean }) {
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <div
      title={name}
      className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-[var(--panel-solid)] text-[11px] font-bold text-white"
      style={{ background: color, boxShadow: ring ? "0 0 0 2px var(--accent)" : undefined }}
    >
      {initials}
    </div>
  );
}

export function TopBar({ doc, meta, provider, awareness, user, onBoardNameChange }: Props) {
  const name = useMetaField(meta, "name", "");
  const peers = useRemotePeers(awareness);
  const status = useConnectionStatus(provider);
  const { dark, toggle } = useTheme();
  const [copied, setCopied] = useState(false);

  const setName = (value: string) => {
    doc.transact(() => meta.set("name", value), LOCAL_ORIGIN);
    onBoardNameChange?.(value);
  };

  const share = async () => {
    try {
      await navigator.clipboard.writeText(location.href);
    } catch {
      // Clipboard API can be unavailable (http, permissions) — fall back
      const ta = document.createElement("textarea");
      ta.value = location.href;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const statusColor =
    status === "connected" ? "#22c55e" : status === "connecting" ? "#eab308" : "#ef4444";
  const statusLabel =
    status === "connected" ? "Live" : status === "connecting" ? "Connecting" : "Offline";

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between p-4">
      {/* Left: logo + board name + status */}
      <div className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--panel)] py-2 pl-3 pr-4 shadow-lg backdrop-blur-md">
        <Link to="/" title="Driftboard home" className="shrink-0">
          <Logo size={26} />
        </Link>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Untitled board"
          className="w-44 bg-transparent text-sm font-semibold text-[var(--text)] outline-none placeholder:text-[var(--muted)]"
        />
        <div className="flex items-center gap-1.5" title={`Sync: ${statusLabel}`}>
          <span
            className="h-2 w-2 rounded-full"
            style={{ background: statusColor, boxShadow: `0 0 6px ${statusColor}` }}
          />
          <span className="text-[11px] font-medium text-[var(--muted)]">{statusLabel}</span>
        </div>
      </div>

      {/* Right: presence + share + theme */}
      <div className="pointer-events-auto flex items-center gap-3">
        <div className="flex items-center rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-1.5 shadow-lg backdrop-blur-md">
          <div className="flex -space-x-2 pr-1">
            <Avatar name={user.name} color={user.color} ring />
            {peers.slice(0, 4).map(({ clientId, state }) => (
              <Avatar key={clientId} name={state.user!.name} color={state.user!.color} />
            ))}
            {peers.length > 4 && (
              <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-[var(--panel-solid)] bg-[var(--hover)] text-[11px] font-bold text-[var(--text)]">
                +{peers.length - 4}
              </div>
            )}
          </div>
          <button
            onClick={share}
            className="ml-1 flex items-center gap-1.5 rounded-xl bg-[var(--accent)] px-3.5 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            {copied ? <Check size={15} /> : <Link2 size={15} />}
            {copied ? "Copied!" : "Share"}
          </button>
        </div>
        <button
          onClick={toggle}
          title="Toggle theme"
          className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--panel)] text-[var(--text)] shadow-lg backdrop-blur-md transition-colors hover:bg-[var(--hover)]"
        >
          {dark ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </div>
    </div>
  );
}
