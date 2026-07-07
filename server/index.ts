/**
 * Driftboard sync server.
 *
 * A WebSocket relay implementing the y-websocket wire protocol: each board is
 * a room (the URL path is the room name) holding one Yjs doc plus an
 * awareness instance (live cursors / presence). Document updates are applied
 * server-side and fanned out to every client in the room; awareness updates
 * are relayed the same way.
 *
 * Rooms live in memory; clients also persist boards locally via IndexedDB and
 * re-seed the server on reconnect, so a restart doesn't lose work for anyone
 * who comes back.
 *
 * In production it also serves the built client from ../dist, so the whole
 * app deploys as a single Node process.
 */
import http from "node:http";
import path from "node:path";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";

const PORT = Number(process.env.PORT) || 1234;
const HOST = process.env.HOST || "0.0.0.0";

// y-websocket message types
const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

class Room {
  doc = new Y.Doc();
  awareness = new awarenessProtocol.Awareness(this.doc);
  conns = new Map<WebSocket, Set<number>>();

  constructor(public name: string) {
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
        if (origin instanceof WebSocket) {
          const owned = this.conns.get(origin);
          if (owned) {
            added.forEach((id) => owned.add(id));
            removed.forEach((id) => owned.delete(id));
          }
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
      if (conn.readyState === WebSocket.OPEN) conn.send(msg);
    });
  }

  join(conn: WebSocket) {
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

  message(conn: WebSocket, data: Uint8Array) {
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

  leave(conn: WebSocket) {
    const owned = this.conns.get(conn);
    this.conns.delete(conn);
    if (owned && owned.size > 0) {
      awarenessProtocol.removeAwarenessStates(this.awareness, [...owned], null);
    }
  }
}

const rooms = new Map<string, Room>();

function getRoom(name: string): Room {
  let room = rooms.get(name);
  if (!room) {
    room = new Room(name);
    rooms.set(name, room);
  }
  return room;
}

// ---- HTTP: health check + static client in production ----
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, "../dist");
const hasDist = existsSync(path.join(distDir, "index.html"));

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
};

const server = http.createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }
  if (!hasDist) {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Driftboard sync server is running.");
    return;
  }
  // Static files with SPA fallback to index.html
  const urlPath = (req.url || "/").split("?")[0];
  let filePath = path.join(distDir, path.normalize(urlPath).replace(/^(\.\.[/\\])+/, ""));
  if (!filePath.startsWith(distDir)) filePath = path.join(distDir, "index.html");
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = path.join(distDir, "index.html");
  }
  const ext = path.extname(filePath);
  res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
  res.end(readFileSync(filePath));
});

const wss = new WebSocketServer({ server });

wss.on("connection", (conn, req) => {
  conn.binaryType = "arraybuffer";
  const roomName = (req.url || "/").slice(1).split("?")[0] || "default";
  const room = getRoom(roomName);
  room.join(conn);

  let alive = true;
  conn.on("pong", () => {
    alive = true;
  });
  const pinger = setInterval(() => {
    if (!alive) return conn.terminate();
    alive = false;
    conn.ping();
  }, 30_000);

  conn.on("message", (data: ArrayBuffer | Buffer) => {
    try {
      room.message(conn, new Uint8Array(data as ArrayBuffer));
    } catch (err) {
      console.error(`error handling message in room "${roomName}"`, err);
    }
  });

  conn.on("close", () => {
    clearInterval(pinger);
    room.leave(conn);
  });
});

server.listen(PORT, HOST, () => {
  console.log(
    `Driftboard sync server listening on ${HOST}:${PORT}${hasDist ? " (serving dist/)" : ""}`,
  );
});
