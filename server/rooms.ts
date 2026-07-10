/**
 * Room state and lifecycle for the sync server.
 *
 * Each board is a room holding one Yjs doc plus an awareness instance (live
 * cursors / presence). Document updates are applied server-side and fanned
 * out to every client in the room; awareness updates are relayed the same
 * way.
 *
 * `Conn` is the minimal surface the room needs from a socket, so rooms can
 * be driven by fake connections in tests.
 */
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import type { SnapshotStore } from "./persistence.ts";

// y-websocket message types
export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;

const CONN_OPEN = 1; // WebSocket.OPEN

/**
 * Board room names are nanoid(10) ids, but hand-typed URLs (percent-encoded
 * spaces, dots) worked historically, so allow them too. No path separators;
 * the snapshot store additionally encodes names before touching the disk.
 */
export const ROOM_NAME_RE = /^[A-Za-z0-9_%.~-]{1,128}$/;

export interface Conn {
  send(data: Uint8Array): void;
  readyState: number;
}

export class Room {
  doc = new Y.Doc();
  awareness = new awarenessProtocol.Awareness(this.doc);
  conns = new Map<Conn, Set<number>>();
  name: string;

  constructor(name: string) {
    this.name = name;
    this.awareness.setLocalState(null);

    // Fan document updates out to the room (origin included: applying an
    // update a client already has is a cheap no-op in Yjs).
    this.doc.on("update", (update: Uint8Array) => {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      this.broadcast(encoding.toUint8Array(encoder));
    });

    this.awareness.on(
      "update",
      ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
        const changed = added.concat(updated, removed);
        const owned = this.conns.get(origin as Conn);
        if (owned) {
          added.forEach((id) => owned.add(id));
          removed.forEach((id) => owned.delete(id));
        }
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(
          encoder,
          awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed),
        );
        this.broadcast(encoding.toUint8Array(encoder));
      },
    );
  }

  broadcast(msg: Uint8Array) {
    this.conns.forEach((_, conn) => {
      if (conn.readyState === CONN_OPEN) conn.send(msg);
    });
  }

  join(conn: Conn) {
    this.conns.set(conn, new Set());

    // Step 1: ask the client what it has; it replies with SyncStep2.
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.doc);
    conn.send(encoding.toUint8Array(encoder));

    // Share current presence with the newcomer.
    const states = this.awareness.getStates();
    if (states.size > 0) {
      const awEncoder = encoding.createEncoder();
      encoding.writeVarUint(awEncoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        awEncoder,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, [...states.keys()]),
      );
      conn.send(encoding.toUint8Array(awEncoder));
    }
  }

  message(conn: Conn, data: Uint8Array) {
    const decoder = decoding.createDecoder(data);
    switch (decoding.readVarUint(decoder)) {
      case MESSAGE_SYNC: {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        syncProtocol.readSyncMessage(decoder, encoder, this.doc, conn);
        // A reply is only pending if more than the type byte was written.
        if (encoding.length(encoder) > 1) conn.send(encoding.toUint8Array(encoder));
        break;
      }
      case MESSAGE_AWARENESS: {
        awarenessProtocol.applyAwarenessUpdate(
          this.awareness,
          decoding.readVarUint8Array(decoder),
          conn,
        );
        break;
      }
    }
  }

  leave(conn: Conn) {
    const owned = this.conns.get(conn);
    this.conns.delete(conn);
    if (owned && owned.size > 0) {
      awarenessProtocol.removeAwarenessStates(this.awareness, [...owned], null);
    }
  }

  destroy() {
    this.awareness.destroy();
    this.doc.destroy();
  }
}

/**
 * Owns the room registry: creates rooms on demand (seeded from the snapshot
 * store), evicts them after everyone leaves, and enforces the room cap so a
 * public instance can't be grown without bound.
 */
export class RoomManager {
  rooms = new Map<string, Room>();
  private evictTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private store: SnapshotStore | null;
  private maxRooms: number;
  private evictGraceMs: number;

  constructor(store: SnapshotStore | null = null, maxRooms = 1000, evictGraceMs = 30_000) {
    this.store = store;
    this.maxRooms = maxRooms;
    this.evictGraceMs = evictGraceMs;
  }

  /** Returns null when the server is at its room cap. */
  get(name: string): Room | null {
    const existing = this.rooms.get(name);
    if (existing) {
      const timer = this.evictTimers.get(name);
      if (timer) {
        clearTimeout(timer);
        this.evictTimers.delete(name);
      }
      return existing;
    }
    if (this.rooms.size >= this.maxRooms) return null;
    const room = new Room(name);
    const snapshot = this.store?.load(name);
    if (snapshot) {
      try {
        Y.applyUpdate(room.doc, snapshot);
      } catch (err) {
        // A corrupt snapshot must not crash the server (clients re-seed from
        // IndexedDB); start the room empty instead.
        console.error(`corrupt snapshot for room "${name}" — starting empty`, err);
      }
    }
    if (this.store) {
      room.doc.on("update", () => this.store!.scheduleSave(name, room.doc));
    }
    this.rooms.set(name, room);
    return room;
  }

  /**
   * Call when a connection leaves. Empty rooms are persisted and dropped
   * after a grace period (so a refresh doesn't tear the room down). Without
   * a snapshot store there is nowhere to persist to, so rooms live for the
   * process lifetime instead of being destroyed.
   */
  onLeave(room: Room) {
    if (!this.store) return;
    if (room.conns.size > 0 || this.evictTimers.has(room.name)) return;
    const timer = setTimeout(() => {
      this.evictTimers.delete(room.name);
      if (room.conns.size > 0) return;
      this.store?.saveNow(room.name, room.doc);
      room.destroy();
      this.rooms.delete(room.name);
    }, this.evictGraceMs);
    timer.unref?.();
    this.evictTimers.set(room.name, timer);
  }

  /** Persist every room immediately (shutdown path). */
  flush() {
    if (!this.store) return;
    this.rooms.forEach((room, name) => this.store!.saveNow(name, room.doc));
  }
}
