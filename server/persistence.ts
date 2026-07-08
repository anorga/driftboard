/**
 * File-based snapshot persistence: each room's Yjs doc is stored as a single
 * encoded update at <dir>/<room>.yjs. Loading is one readFile + applyUpdate;
 * saves are debounced while a board is being edited and forced on room
 * eviction / shutdown.
 *
 * This deliberately isn't a database — a board is one small binary blob, and
 * clients also hold full copies in IndexedDB. It keeps boards alive across
 * server restarts (on hosts with a persistent disk) with zero dependencies.
 */
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import path from "node:path";
import * as Y from "yjs";

const SAVE_DEBOUNCE_MS = 2_000;

export class SnapshotStore {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private dir: string;

  constructor(dir: string) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
  }

  private file(room: string): string {
    return path.join(this.dir, `${room}.yjs`);
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

  /** Debounced save: at most one write per room per debounce window. */
  scheduleSave(room: string, doc: Y.Doc) {
    if (this.timers.has(room)) return;
    const timer = setTimeout(() => {
      this.timers.delete(room);
      this.saveNow(room, doc);
    }, SAVE_DEBOUNCE_MS);
    timer.unref?.();
    this.timers.set(room, timer);
  }

  saveNow(room: string, doc: Y.Doc) {
    const timer = this.timers.get(room);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(room);
    }
    try {
      // Write-then-rename so a crash mid-write can't corrupt the snapshot.
      const file = this.file(room);
      writeFileSync(`${file}.tmp`, Y.encodeStateAsUpdate(doc));
      renameSync(`${file}.tmp`, file);
    } catch (err) {
      console.error(`failed to save snapshot for room "${room}"`, err);
    }
  }
}
