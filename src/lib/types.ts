export type Tool = "select" | "hand" | "sticky" | "rect" | "ellipse" | "pen";

export type ElementType = "sticky" | "rect" | "ellipse" | "stroke";

export interface BoardElement {
  id: string;
  type: ElementType;
  x: number;
  y: number;
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
}

export interface RecentBoard {
  id: string;
  name: string;
  visitedAt: number;
}
