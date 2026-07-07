/**
 * Sync engine: one Yjs document per board.
 *
 * - `WebsocketProvider` syncs the doc with everyone in the room and carries
 *   the awareness protocol (live cursors, presence).
 * - `IndexeddbPersistence` mirrors the doc locally so boards load instantly
 *   and keep working offline; changes merge conflict-free on reconnect.
 * - `Y.UndoManager` is scoped to LOCAL_ORIGIN so undo/redo only affects
 *   *your* changes, never a collaborator's.
 *
 * Connections are refcounted per room so React StrictMode remounts and
 * multiple consumers share one socket.
 */
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { IndexeddbPersistence } from "y-indexeddb";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { Awareness } from "y-protocols/awareness";
import type { AwarenessState, BoardElement } from "./types";

export const LOCAL_ORIGIN = "local";

function wsUrl(): string {
  const env = import.meta.env.VITE_WS_URL as string | undefined;
  if (env) return env;
  if (import.meta.env.DEV) return `ws://${location.hostname}:1234`;
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;
}

export interface BoardConnection {
  doc: Y.Doc;
  provider: WebsocketProvider;
  idb: IndexeddbPersistence;
  awareness: Awareness;
  elements: Y.Map<Y.Map<unknown>>;
  meta: Y.Map<unknown>;
  undo: Y.UndoManager;
}

const cache = new Map<string, { conn: BoardConnection; refs: number }>();

export function acquireBoard(roomId: string): BoardConnection {
  const existing = cache.get(roomId);
  if (existing) {
    existing.refs++;
    return existing.conn;
  }
  const doc = new Y.Doc();
  const elements = doc.getMap<Y.Map<unknown>>("elements");
  const meta = doc.getMap<unknown>("meta");
  const idb = new IndexeddbPersistence(`driftboard:${roomId}`, doc);
  const provider = new WebsocketProvider(wsUrl(), roomId, doc);
  const undo = new Y.UndoManager(elements, {
    trackedOrigins: new Set([LOCAL_ORIGIN]),
    captureTimeout: 350,
  });
  const conn: BoardConnection = { doc, provider, idb, awareness: provider.awareness, elements, meta, undo };
  cache.set(roomId, { conn, refs: 1 });
  return conn;
}

export function releaseBoard(roomId: string) {
  const entry = cache.get(roomId);
  if (!entry) return;
  entry.refs--;
  if (entry.refs > 0) return;
  cache.delete(roomId);
  entry.conn.undo.destroy();
  entry.conn.provider.destroy();
  entry.conn.idb.destroy();
  entry.conn.doc.destroy();
}

export function useBoardConnection(roomId: string): BoardConnection {
  const conn = useMemo(() => acquireBoard(roomId), [roomId]);
  useEffect(() => {
    // Balance the render-time acquire: take a ref for the effect's lifetime,
    // then drop the render's ref. StrictMode double-invokes stay balanced.
    acquireBoard(roomId);
    releaseBoard(roomId);
    return () => releaseBoard(roomId);
  }, [roomId]);
  return conn;
}

/** Reactive list of board elements, sorted by z-order. */
export function useElements(elements: Y.Map<Y.Map<unknown>>): BoardElement[] {
  const [, setTick] = useState(0);
  useEffect(() => {
    const onChange = () => setTick((t) => t + 1);
    elements.observeDeep(onChange);
    return () => elements.unobserveDeep(onChange);
  }, [elements]);
  const list: BoardElement[] = [];
  elements.forEach((el) => {
    list.push(el.toJSON() as BoardElement);
  });
  list.sort((a, b) => a.order - b.order);
  return list;
}

/** Reactive value of a meta field (e.g. the board name). */
export function useMetaField<T>(meta: Y.Map<unknown>, key: string, fallback: T): T {
  const [, setTick] = useState(0);
  useEffect(() => {
    const onChange = () => setTick((t) => t + 1);
    meta.observe(onChange);
    return () => meta.unobserve(onChange);
  }, [meta]);
  return (meta.get(key) as T) ?? fallback;
}

/** All remote awareness states (excludes the local client). */
export function useRemotePeers(awareness: Awareness): Array<{ clientId: number; state: AwarenessState }> {
  const [peers, setPeers] = useState<Array<{ clientId: number; state: AwarenessState }>>([]);
  useEffect(() => {
    const update = () => {
      const out: Array<{ clientId: number; state: AwarenessState }> = [];
      awareness.getStates().forEach((state, clientId) => {
        if (clientId !== awareness.clientID && state?.user) {
          out.push({ clientId, state: state as AwarenessState });
        }
      });
      setPeers(out);
    };
    update();
    awareness.on("change", update);
    return () => awareness.off("change", update);
  }, [awareness]);
  return peers;
}

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

export function useConnectionStatus(provider: WebsocketProvider): ConnectionStatus {
  return useSyncExternalStore(
    (cb) => {
      provider.on("status", cb);
      return () => provider.off("status", cb);
    },
    () => (provider.wsconnected ? "connected" : provider.wsconnecting ? "connecting" : "disconnected"),
  );
}

/** Reactive undo/redo stack depths so buttons can enable/disable. */
export function useUndoState(undo: Y.UndoManager): { canUndo: boolean; canRedo: boolean } {
  const [, setTick] = useState(0);
  useEffect(() => {
    const onChange = () => setTick((t) => t + 1);
    undo.on("stack-item-added", onChange);
    undo.on("stack-item-popped", onChange);
    undo.on("stack-cleared", onChange);
    return () => {
      undo.off("stack-item-added", onChange);
      undo.off("stack-item-popped", onChange);
      undo.off("stack-cleared", onChange);
    };
  }, [undo]);
  return { canUndo: undo.canUndo(), canRedo: undo.canRedo() };
}
