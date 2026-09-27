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
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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

/**
 * Reactive list of board elements, sorted by z-order.
 *
 * Converted JSON is cached per element and only invalidated for elements a
 * change actually touched, so unchanged elements keep their object identity
 * and the memoized ElementView skips re-rendering them. Without this, every
 * appended pen-stroke point would re-serialize the whole board.
 */
export function useElements(elements: Y.Map<Y.Map<unknown>>): BoardElement[] {
  const cacheRef = useRef(new WeakMap<Y.Map<unknown>, BoardElement>());
  const [tick, setTick] = useState(0);
  useEffect(() => {
    // Cache validity is tied to this subscription: anything mutated while we
    // weren't observing (StrictMode remounts, the render-to-effect gap) must
    // not survive as a stale entry.
    cacheRef.current = new WeakMap();
    setTick((t) => t + 1);
    const onChange = (events: Y.YEvent<Y.Map<unknown>>[]) => {
      for (const ev of events) {
        // Walk up to the element-level Y.Map that owns this change (the
        // change may be inside a nested type, e.g. a stroke's points array).
        let target = ev.target as unknown as { parent: unknown } | null;
        while (target && target.parent !== elements) {
          target = (target.parent as { parent: unknown } | null) ?? null;
        }
        if (target) {
          cacheRef.current.delete(target as unknown as Y.Map<unknown>);
        } else if ((ev.target as unknown) !== elements) {
          // Couldn't attribute the change (detached parent chain): drop the
          // whole cache rather than risk a permanently stale element.
          cacheRef.current = new WeakMap();
        }
      }
      setTick((t) => t + 1);
    };
    elements.observeDeep(onChange);
    return () => elements.unobserveDeep(onChange);
  }, [elements]);
  // Rebuild only when the doc actually changed (tick), not on every render —
  // stable identity lets consumers (resolveArrows, thumbnail effect) memoize.
  return useMemo(() => {
    void tick; // the doc-change counter is this memo's invalidation signal
    const cache = cacheRef.current;
    const list: BoardElement[] = [];
    elements.forEach((el) => {
      let json = cache.get(el);
      if (!json) {
        json = el.toJSON() as BoardElement;
        cache.set(el, json);
      }
      list.push(json);
    });
    list.sort((a, b) => a.order - b.order);
    return list;
  }, [elements, tick]);
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

/**
 * True once the board's *content* has finished loading — the local IndexedDB
 * mirror AND, when online, the server's initial sync. This is the gate for the
 * empty-state hint: without it, a fresh device opening a populated remote
 * board would let the (empty) local mirror finish before the WebSocket stream
 * lands and briefly flash the "empty board" hint.
 *
 * Deliberate offline fallback: if the provider can't reach the server within a
 * bounded grace period (an offline start), readiness falls back to the local
 * mirror alone so a cached — or genuinely empty offline — board still resolves.
 * (The hint only ever shows while the board is empty, so a late-arriving
 * remote board can at worst flash the hint for a beat, never hide real content.)
 */
export function useBoardReady(conn: BoardConnection): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const { provider, idb } = conn;

    const settle = () => {
      if (cancelled) return;
      if (idbSettled && (provider.synced || offline)) setReady(true);
    };

    let idbSettled = false;
    let offline = false;
    idb.whenSynced.then(() => {
      idbSettled = true;
      settle();
    });

    // Online path: the provider's first full sync (its `synced` flag).
    const onSync = (synced: boolean) => {
      if (!synced || cancelled) return;
      settle();
    };
    if (!provider.synced) provider.on("sync", onSync);

    // Offline fallback: never synced and never connected within the grace
    // window means we started offline — trust the local mirror alone.
    const OFFLINE_GRACE_MS = 8000;
    const timer = setTimeout(() => {
      if (cancelled || provider.synced || provider.wsconnected) return;
      offline = true;
      settle();
    }, OFFLINE_GRACE_MS);

    settle(); // both signals may already be satisfied (cached + warm provider)

    return () => {
      cancelled = true;
      clearTimeout(timer);
      provider.off("sync", onSync);
    };
  }, [conn]);
  return ready;
}

/**
 * True once the local IndexedDB mirror has finished its initial load, i.e.
 * the board's contents are available offline. This is an initialization
 * signal, NOT a per-change durability ack — use it to say "available
 * offline", never "every change is saved".
 */
export function useIdbReady(idb: IndexeddbPersistence): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    idb.whenSynced.then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [idb]);
  return ready;
}

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
