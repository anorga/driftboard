export type Tool =
  | "select"
  | "hand"
  | "sticky"
  | "text"
  | "rect"
  | "ellipse"
  | "arrow"
  | "pen"
  | "laser";

export type ElementType = "sticky" | "text" | "rect" | "ellipse" | "arrow" | "stroke";

export interface BoardElement {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  /** For arrows, w/h are the (signed) offset from start to end point */
  w: number;
  h: number;
  /** Palette color id, e.g. "yellow" */
  color: string;
  /** Sticky note text */
  text?: string;
  /** Stroke points, flat [x, y, pressure, ...] relative to (x, y) */
  points?: number[];
  /** Stroke brush size */
  size?: number;
  /** z-order */
  order: number;
}

export interface Camera {
  /** World coordinate at the top-left of the viewport */
  x: number;
  y: number;
  /** Zoom factor */
  z: number;
}

export interface UserInfo {
  name: string;
  color: string;
}

export interface AwarenessState {
  user?: UserInfo;
  cursor?: { x: number; y: number } | null;
  /** Cursor chat: live message shown next to the cursor */
  chat?: { text: string; ts: number } | null;
  /** Laser pointer position (world coords) */
  laser?: { x: number; y: number; t: number } | null;
  /** Element ids this user has selected */
  selection?: string[];
}

export interface RecentBoard {
  id: string;
  name: string;
  visitedAt: number;
}
