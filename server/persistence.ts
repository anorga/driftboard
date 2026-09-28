/**
 * File-based snapshot persistence: each room's Yjs doc is stored as a single
 * encoded update at <dir>/<room>.yjs. Loading is one readFile + applyUpdate;
 * saves are debounced while a board is being edited and forced on room
 * eviction / shutdown.
 *
 * Debounced saves (the hot path — they fire continuously while a board is
 * edited) write asynchronously so a multi-MB snapshot never blocks the relay
 * loop. Every write for a room is chained, so an older snapshot can never
 * land after a newer one. Each write goes to a unique tmp file that is
 * fsynced, then atomically renamed over the snapshot (and the directory is
 * fsynced), so neither a mid-write crash nor a concurrent sync save can leave
 * a stale or torn snapshot. Eviction and shutdown go through the synchronous
 * path, but they first `awaitSettled` the room's in-flight async writes so the
 * two never rename the same file at once.
 *
 * This deliberately isn't a database — a board is one small binary blob, and
 * clients also hold full copies in IndexedDB. It keeps boards alive across
 * server restarts (on hosts with a persistent disk) with zero dependencies.
 */
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { open, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import * as Y from "yjs";

export const SAVE_DEBOUNCE_MS = 2_000;

/** Best-effort fsync — some filesystems don't support it and that's fine. */
function fsyncFdSync(fd: number) {
  try {
    fsyncSync(fd);
  } catch {
    /* no-op */
  }
}
async function fsyncFdAsync(fd: Awaited<ReturnType<typeof open>>) {
  try {
    await fd.sync();
  } catch {
    /* no-op */
  }
}

export class SnapshotStore {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private writeChains = new Map<string, Promise<void>>();
  private dir: string;

  constructor(dir: string) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
  }

  private file(room: string): string {
    // Room names are already validated, but encode anyway so the name can
    // never be interpreted by the filesystem (e.g. "%2F").
    return path.join(this.dir, `${encodeURIComponent(room)}.yjs`);
  }

  load(room: string): Uint8Array | null {
    const file = this.file(room);
    try {
      if (!existsSync(file)) return null;
      return new Uint8Array(readFileSync(file));
    } catch (err) {
      console.error(`failed to load snapshot for room "${room}"`, err);
      return null;
    }
  }

  /** Debounced async save: at most one write per room per debounce window. */
  scheduleSave(room: string, doc: Y.Doc) {
    if (this.timers.has(room)) return;
    const timer = setTimeout(() => {
      this.timers.delete(room);
      this.enqueueWrite(room, Y.encodeStateAsUpdate(doc));
    }, SAVE_DEBOUNCE_MS);
    timer.unref?.();
    this.timers.set(room, timer);
  }

  /**
   * Resolve once any in-flight async write for this room has finished, so a
   * following synchronous save (eviction / shutdown) can't rename over it.
   * Resolves immediately when nothing is in flight.
   */
  awaitSettled(room: string): Promise<void> {
    return this.writeChains.get(room) ?? Promise.resolve();
  }

  private enqueueWrite(room: string, data: Uint8Array) {
    const file = this.file(room);
    const prev = this.writeChains.get(room) ?? Promise.resolve();
    const next = prev
      .then(() => this.writeDurable(file, data))
      .catch((err) => {
        console.error(`failed to save snapshot for room "${room}"`, err);
      });
    this.writeChains.set(room, next);
    // Drop the chain entry once it settles (and is still the current one), so
    // rooms that churn through the store don't grow this map without bound.
    void next.finally(() => {
      if (this.writeChains.get(room) === next) this.writeChains.delete(room);
    });
  }

  /**
   * Synchronous save for eviction and shutdown, where the doc is about to go
   * away. Callers must `awaitSettled(room)` first so a queued async write
   * can't rename over this one.
   */
  saveNow(room: string, doc: Y.Doc) {
    const timer = this.timers.get(room);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(room);
    }
    try {
      const file = this.file(room);
      const tmp = this.writeTmpSync(file, Y.encodeStateAsUpdate(doc));
      renameSync(tmp, file);
      this.syncDirSync();
    } catch (err) {
      console.error(`failed to save snapshot for room "${room}"`, err);
    }
  }

  // ---- durable-write primitives (unique tmp + fsync + atomic rename) ----

  /** Write `data` to a unique tmp file and fsync it; returns the tmp path. */
  private writeTmpSync(file: string, data: Uint8Array): string {
    const tmp = `${file}.tmp.${randomUUID()}`;
    writeFileSync(tmp, data);
    const fd = openSync(tmp, "r");
    fsyncFdSync(fd);
    closeSync(fd);
    return tmp;
  }
  private async writeTmpAsync(file: string, data: Uint8Array): Promise<string> {
    const tmp = `${file}.tmp.${randomUUID()}`;
    const fh = await open(tmp, "w");
    try {
      await fh.writeFile(data);
      await fsyncFdAsync(fh);
    } finally {
      await fh.close();
    }
    return tmp;
  }

  private syncDirSync() {
    const fd = openSync(this.dir, "r");
    fsyncFdSync(fd);
    closeSync(fd);
  }
  private async syncDirAsync() {
    const fh = await open(this.dir, "r");
    try {
      await fsyncFdAsync(fh);
    } finally {
      await fh.close();
    }
  }

  private async writeDurable(file: string, data: Uint8Array) {
    const tmp = await this.writeTmpAsync(file, data);
    await rename(tmp, file);
    await this.syncDirAsync();
  }
}
