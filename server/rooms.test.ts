import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { MESSAGE_AWARENESS, MESSAGE_SYNC, ROOM_NAME_RE, Room, RoomManager, type Conn } from "./rooms.ts";
import { SnapshotStore, SAVE_DEBOUNCE_MS } from "./persistence.ts";

/**
 * A minimal y-websocket client wired straight into a Room: it answers the
 * server's SyncStep1, applies updates, and pushes local edits — exactly what
 * WebsocketProvider does over a real socket.
 */
class FakeClient {
  doc = new Y.Doc();
  awareness = new awarenessProtocol.Awareness(this.doc);
  conn: Conn;
  private room: Room;

  constructor(room: Room) {
    this.room = room;
    this.conn = { readyState: 1, send: (data) => this.receive(data) };
    this.doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin === "server") return;
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      this.room.message(this.conn, encoding.toUint8Array(encoder));
    });
    this.awareness.on("update", ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      if (origin === "server") return;
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, added.concat(updated, removed)),
      );
      this.room.message(this.conn, encoding.toUint8Array(encoder));
    });
  }

  join() {
    this.room.join(this.conn);
    // Like WebsocketProvider on connect: ask the server what it has
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.doc);
    this.room.message(this.conn, encoding.toUint8Array(encoder));
  }

  private receive(data: Uint8Array) {
    const decoder = decoding.createDecoder(data);
    switch (decoding.readVarUint(decoder)) {
      case MESSAGE_SYNC: {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        syncProtocol.readSyncMessage(decoder, encoder, this.doc, "server");
        if (encoding.length(encoder) > 1) this.room.message(this.conn, encoding.toUint8Array(encoder));
        break;
      }
      case MESSAGE_AWARENESS: {
        awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(decoder), "server");
        break;
      }
    }
  }
}

describe("Room protocol relay", () => {
  it("syncs existing state to a joining client", () => {
    const room = new Room("r");
    room.doc.getMap("elements").set("a", "hello");
    const client = new FakeClient(room);
    client.join();
    expect(client.doc.getMap("elements").get("a")).toBe("hello");
  });

  it("fans a client's edits out to the other clients", () => {
    const room = new Room("r");
    const alice = new FakeClient(room);
    const bob = new FakeClient(room);
    alice.join();
    bob.join();

    alice.doc.getMap("elements").set("note", "from alice");
    expect(room.doc.getMap("elements").get("note")).toBe("from alice");
    expect(bob.doc.getMap("elements").get("note")).toBe("from alice");
  });

  it("relays awareness (presence) and clears it when the client leaves", () => {
    const room = new Room("r");
    const alice = new FakeClient(room);
    const bob = new FakeClient(room);
    alice.join();
    bob.join();

    alice.awareness.setLocalState({ user: { name: "Alice" } });
    const bobSees = bob.awareness.getStates().get(alice.doc.clientID);
    expect(bobSees).toEqual({ user: { name: "Alice" } });

    room.leave(alice.conn);
    expect(bob.awareness.getStates().has(alice.doc.clientID)).toBe(false);
  });
});

describe("room names", () => {
  it("accepts nanoid-style and percent-encoded ids, rejects path tricks", () => {
    expect(ROOM_NAME_RE.test("V1StGXR8_Z")).toBe(true);
    expect(ROOM_NAME_RE.test("team%20plan")).toBe(true);
    expect(ROOM_NAME_RE.test("a/b")).toBe(false);
    expect(ROOM_NAME_RE.test("a\\b")).toBe(false);
    expect(ROOM_NAME_RE.test("")).toBe(false);
    expect(ROOM_NAME_RE.test("x".repeat(129))).toBe(false);
  });
});

describe("RoomManager", () => {
  let dir: string;
  let store: SnapshotStore;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "driftboard-test-"));
    store = new SnapshotStore(dir);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(dir, { recursive: true, force: true });
  });

  it("evicts an empty room after the grace period and persists it", async () => {
    const manager = new RoomManager(store, 10, 1000);
    const room = manager.get("board1")!;
    const client = new FakeClient(room);
    client.join();
    client.doc.getMap("elements").set("k", "v");

    room.leave(client.conn);
    manager.onLeave(room);
    expect(manager.rooms.has("board1")).toBe(true); // still in grace

    // The eviction callback awaits any in-flight async write, so flush the
    // microtasks with the async timer advance (not the sync one).
    await vi.advanceTimersByTimeAsync(1500);
    expect(manager.rooms.has("board1")).toBe(false);

    // A fresh room instance restores the snapshot from disk
    const revived = manager.get("board1")!;
    expect(revived.doc.getMap("elements").get("k")).toBe("v");
  });

  it("cancels eviction when someone rejoins during the grace period", () => {
    const manager = new RoomManager(store, 10, 1000);
    const room = manager.get("board1")!;
    manager.onLeave(room);
    expect(manager.get("board1")).toBe(room); // rejoin keeps the instance
    vi.advanceTimersByTime(5000);
    expect(manager.rooms.get("board1")).toBe(room);
  });

  it("returns null at the room cap", () => {
    const manager = new RoomManager(null, 2);
    expect(manager.get("a")).not.toBeNull();
    expect(manager.get("b")).not.toBeNull();
    expect(manager.get("c")).toBeNull();
    expect(manager.get("a")).not.toBeNull(); // existing rooms still reachable
  });

  it("keeps rooms alive forever in pure in-memory mode (no store)", () => {
    const manager = new RoomManager(null, 10, 1000);
    const room = manager.get("board1")!;
    manager.onLeave(room);
    vi.advanceTimersByTime(60_000);
    expect(manager.rooms.get("board1")).toBe(room);
  });

  it("survives a corrupt snapshot instead of crashing", () => {
    writeFileSync(path.join(dir, "board1.yjs"), Buffer.from("not a yjs update"));
    const manager = new RoomManager(store, 10, 1000);
    const room = manager.get("board1");
    expect(room).not.toBeNull();
    expect(room!.doc.getMap("elements").size).toBe(0); // starts empty, but alive
  });
});

describe("SnapshotStore", () => {
  it("round-trips a doc through disk", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "driftboard-snap-"));
    try {
      const store = new SnapshotStore(dir);
      const doc = new Y.Doc();
      doc.getMap("elements").set("x", 42);
      store.saveNow("room", doc);

      const restored = new Y.Doc();
      Y.applyUpdate(restored, store.load("room")!);
      expect(restored.getMap("elements").get("x")).toBe(42);
      expect(store.load("nope")).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps a valid snapshot when an async write and a sync save race", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "driftboard-snap-"));
    try {
      const store = new SnapshotStore(dir);
      const doc = new Y.Doc();
      doc.getMap("elements").set("v", 1);

      // Queue a debounced (async) write, then let it fire and start in flight.
      store.scheduleSave("room", doc);
      await new Promise((r) => setTimeout(r, SAVE_DEBOUNCE_MS + 50));

      // A newer value lands while the async write is still pending — the
      // eviction/shutdown path must wait for it (awaitSettled) before saving,
      // or the sync rename could clobber/torn the snapshot.
      doc.getMap("elements").set("v", 2);
      await store.awaitSettled("room");
      store.saveNow("room", doc);

      // The on-disk snapshot must be a valid update holding the newest value.
      const restored = new Y.Doc();
      Y.applyUpdate(restored, store.load("room")!);
      expect(restored.getMap("elements").get("v")).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
