/** Shared color palette. Sticky notes use the soft fill; shapes and pen strokes use the vivid tone. */
export interface PaletteColor {
  id: string;
  /** Sticky note background */
  fill: string;
  /** Sticky note text */
  ink: string;
  /** Shape stroke / pen color */
  vivid: string;
  /** Translucent shape fill */
  wash: string;
}

export const PALETTE: PaletteColor[] = [
  { id: "yellow", fill: "#fef08a", ink: "#713f12", vivid: "#eab308", wash: "rgba(234,179,8,0.14)" },
  { id: "orange", fill: "#fed7aa", ink: "#7c2d12", vivid: "#f97316", wash: "rgba(249,115,22,0.14)" },
  { id: "pink",   fill: "#fbcfe8", ink: "#831843", vivid: "#ec4899", wash: "rgba(236,72,153,0.14)" },
  { id: "purple", fill: "#ddd6fe", ink: "#4c1d95", vivid: "#8b5cf6", wash: "rgba(139,92,246,0.14)" },
  { id: "blue",   fill: "#bfdbfe", ink: "#1e3a8a", vivid: "#3b82f6", wash: "rgba(59,130,246,0.14)" },
  { id: "green",  fill: "#bbf7d0", ink: "#14532d", vivid: "#22c55e", wash: "rgba(34,197,94,0.14)" },
];

export const paletteById = Object.fromEntries(PALETTE.map((c) => [c.id, c]));

export function getColor(id: string): PaletteColor {
  return paletteById[id] ?? PALETTE[0];
}

/** Cursor / avatar colors assigned to collaborators */
export const USER_COLORS = [
  "#ef4444", "#f97316", "#eab308", "#22c55e",
  "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899",
];

const ADJECTIVES = [
  "Swift", "Bright", "Clever", "Bold", "Quiet", "Lucky",
  "Cosmic", "Golden", "Electric", "Mellow", "Brave", "Zesty",
];

const ANIMALS = [
  "Fox", "Otter", "Panda", "Falcon", "Lynx", "Dolphin",
  "Koala", "Raven", "Tiger", "Heron", "Gecko", "Orca",
];

export function randomName(): string {
  const a = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const b = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  return `${a} ${b}`;
}

export function randomUserColor(): string {
  return USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)];
}

export const GRID_SIZE = 24;
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;
export const STICKY_DEFAULT = 190;
