/**
 * Driftboard sync server.
 *
 * A WebSocket relay implementing the y-websocket wire protocol: each board is
 * a room (the URL path is the room name); see server/rooms.ts. Snapshots are
 * persisted to disk (server/persistence.ts) so boards survive restarts, and
 * clients additionally re-seed from IndexedDB on reconnect.
 *
 * In production it also serves the built client from ../dist, so the whole
 * app deploys as a single Node process.
 */
import http from "node:http";
import path from "node:path";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { RoomManager, ROOM_NAME_RE } from "./rooms.ts";
import { SnapshotStore } from "./persistence.ts";

const PORT = Number(process.env.PORT) || 1234;
const HOST = process.env.HOST || "0.0.0.0";
const MAX_ROOMS = Number(process.env.MAX_ROOMS) || 1000;
// Must fit a full-document SyncStep2 (a re-seeding client sends the whole
// board in one message, and image-heavy boards run large) while still
// bounding what a hostile client can make the server buffer.
const MAX_MESSAGE_BYTES = 32 * 1024 * 1024;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Persistence is on by default; set DATA_DIR="" to run purely in-memory.
const dataDir = process.env.DATA_DIR ?? path.resolve(__dirname, "../data");
const store = dataDir ? new SnapshotStore(dataDir) : null;
const rooms = new RoomManager(store, MAX_ROOMS);

// ---- HTTP: health check + static client in production ----
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

// Vite output is content-hashed, so /assets/* can be cached forever;
// index.html must always revalidate so deploys take effect.
function cacheControl(filePath: string): string {
  if (filePath.includes(`${path.sep}assets${path.sep}`)) return "public, max-age=31536000, immutable";
  if (filePath.endsWith(".html")) return "no-cache";
  return "public, max-age=3600";
}

// Only content-hashed files are safe to cache for the process lifetime; an
// in-place rebuild of dist/ rewrites index.html, which must be read fresh so
// it never references bundles that no longer exist.
const fileCache = new Map<string, Buffer>();
function readStatic(filePath: string): Buffer {
  if (!filePath.includes(`${path.sep}assets${path.sep}`)) return readFileSync(filePath);
  let data = fileCache.get(filePath);
  if (!data) {
    data = readFileSync(filePath);
    fileCache.set(filePath, data);
  }
  return data;
}

const server = http.createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, rooms: rooms.rooms.size, connections: wss.clients.size }));
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
  res.writeHead(200, {
    "Content-Type": MIME[ext] || "application/octet-stream",
    "Cache-Control": cacheControl(filePath),
  });
  res.end(readStatic(filePath));
});

// Optional browser-origin allowlist (comma-separated). Unset = allow all,
// which split client/server deploys need. Non-browser clients (no Origin
// header) always pass — this is CSRF-style protection, not auth.
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const wss = new WebSocketServer({
  server,
  maxPayload: MAX_MESSAGE_BYTES,
  // Sync payloads (especially image-heavy SyncStep2) compress well
  perMessageDeflate: { threshold: 1024 },
});

wss.on("connection", (conn, req) => {
  conn.binaryType = "arraybuffer";
  const origin = req.headers.origin;
  if (allowedOrigins.length > 0 && origin && !allowedOrigins.includes(origin)) {
    conn.close(1008, "origin not allowed");
    return;
  }
  const roomName = (req.url || "/").slice(1).split("?")[0] || "default";
  if (!ROOM_NAME_RE.test(roomName)) {
    conn.close(1008, "invalid room name");
    return;
  }
  const room = rooms.get(roomName);
  if (!room) {
    conn.close(1013, "server at capacity");
    return;
  }
  room.join(conn);

  // Liveness: any message counts, so a client busy drawing (which can starve
  // pong delivery) is never mistaken for a dead connection.
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
    alive = true;
    try {
      room.message(conn, new Uint8Array(data as ArrayBuffer));
    } catch (err) {
      console.error(`error handling message in room "${roomName}"`, err);
    }
  });

  conn.on("close", () => {
    clearInterval(pinger);
    room.leave(conn);
    rooms.onLeave(room);
  });
});

// Persist everything before going down (deploys, ctrl-c).
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    rooms.flush();
    process.exit(0);
  });
}

server.listen(PORT, HOST, () => {
  console.log(
    `Driftboard sync server listening on ${HOST}:${PORT}` +
      `${hasDist ? " (serving dist/)" : ""}${store ? ` (snapshots in ${dataDir})` : ""}`,
  );
});
