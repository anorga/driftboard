import { randomName, randomUserColor } from "./constants";
import type { UserInfo, RecentBoard } from "./types";

const USER_KEY = "driftboard:user";
const RECENT_KEY = "driftboard:recent";

export function getLocalUser(): UserInfo {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (raw) return JSON.parse(raw) as UserInfo;
  } catch {
    // fall through to a fresh identity
  }
  const user: UserInfo = { name: randomName(), color: randomUserColor() };
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    // private mode — identity just won't persist
  }
  return user;
}

export function getRecentBoards(): RecentBoard[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (raw) return (JSON.parse(raw) as RecentBoard[]).sort((a, b) => b.visitedAt - a.visitedAt);
  } catch {
    // corrupted entry — treat as empty
  }
  return [];
}

export function touchRecentBoard(id: string, name: string, thumb?: string) {
  const all = getRecentBoards();
  const existing = all.find((b) => b.id === id);
  const rest = all.filter((b) => b.id !== id);
  const entry: RecentBoard = { id, name, visitedAt: Date.now(), thumb: thumb ?? existing?.thumb };
  const next = [entry, ...rest].slice(0, 12);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Quota exceeded (thumbnails add up) — retry without them
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next.map(({ thumb: _thumb, ...b }) => b)));
    } catch {
      // still failing (private mode) — give up quietly
    }
  }
}

export function removeRecentBoard(id: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(getRecentBoards().filter((b) => b.id !== id)));
  } catch {
    // ignore
  }
}
