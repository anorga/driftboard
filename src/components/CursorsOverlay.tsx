import type { Awareness } from "y-protocols/awareness";
import { useRemotePeers } from "../lib/board";
import type { Camera } from "../lib/types";
import { worldToScreen } from "../lib/geometry";

export function CursorsOverlay({ awareness, camera }: { awareness: Awareness; camera: Camera }) {
  const peers = useRemotePeers(awareness);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {peers.map(({ clientId, state }) => {
        if (!state.cursor || !state.user) return null;
        const p = worldToScreen(state.cursor, camera);
        return (
          <div
            key={clientId}
            className="absolute left-0 top-0 will-change-transform"
            style={{
              transform: `translate(${p.x}px, ${p.y}px)`,
              transition: "transform 90ms linear",
            }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" style={{ display: "block" }}>
              <path
                d="M5.5 3.2 19.2 11c.8.45.6 1.65-.3 1.83l-5.8 1.15-2.6 5.35c-.4.83-1.62.7-1.84-.2L4.2 4.4c-.2-.85.65-1.6 1.3-1.2Z"
                fill={state.user.color}
                stroke="white"
                strokeWidth="1.4"
              />
            </svg>
            <div
              className="ml-4 -mt-0.5 w-max rounded-full px-2 py-0.5 text-[11px] font-semibold text-white shadow-md"
              style={{ background: state.user.color }}
            >
              {state.user.name}
            </div>
            {state.chat?.text ? (
              <div
                className="ml-4 mt-1 w-max max-w-64 rounded-2xl rounded-tl-sm px-3.5 py-2 text-[13px] font-medium text-white shadow-lg"
                style={{ background: state.user.color }}
              >
                {state.chat.text}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
