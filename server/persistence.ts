/**
 * File-based snapshot persistence: each room's Yjs doc is stored as a single
 * encoded update at <dir>/<room>.yjs. Loading is one readFile + applyUpdate;
 * saves are debounced while a board is being edited and forced on room
 * eviction / shutdown.
 *
 * Debounced saves (the hot path — they fire continuously while a board is
 * edited) write asynchronously so a multi-MB snapshot never blocks the relay
 * loop; writes are chained per room so an older snapshot can never land after
 * a newer one. Eviction and shutdown use the synchronous path: they must
 * complete before the doc is destroyed or the process exits.
 *
 * This deliberately isn't a database — a board is one small binary blob, and
 * clients also hold full copies in IndexedDB. It keeps boards alive across
 * server restarts (on hosts with a persistent disk) with zero dependencies.
 */
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { writeFile, rename } from "node:fs/promises";
import path from "node:path";
import * as Y from "yjs";

const SAVE_DEBOUNCE_MS = 2_000;

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

  private enqueueWrite(room: string, data: Uint8Array) {
    const file = this.file(room);
    const prev = this.writeChains.get(room) ?? Promise.resolve();
    const next = prev
      .then(async () => {
        // Write-then-rename so a crash mid-write can't corrupt the snapshot.
        await writeFile(`${file}.tmp`, data);
        await rename(`${file}.tmp`, file);
      })
      .catch((err) => {
        console.error(`failed to save snapshot for room "${room}"`, err);
      });
    this.writeChains.set(room, next);
  }

  /** Synchronous save for eviction and shutdown, where the doc is about to go away. */
  saveNow(room: string, doc: Y.Doc) {
    const timer = this.timers.get(room);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(room);
    }
    try {
      const file = this.file(room);
      writeFileSync(`${file}.tmp`, Y.encodeStateAsUpdate(doc));
      renameSync(`${file}.tmp`, file);
    } catch (err) {
      console.error(`failed to save snapshot for room "${room}"`, err);
    }
  }
}
