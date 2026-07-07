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

export function touchRecentBoard(id: string, name: string) {
  const rest = getRecentBoards().filter((b) => b.id !== id);
  const next = [{ id, name, visitedAt: Date.now() }, ...rest].slice(0, 12);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // ignore quota errors
  }
}

export function removeRecentBoard(id: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(getRecentBoards().filter((b) => b.id !== id)));
  } catch {
    // ignore
  }
}
