import { getStroke } from "perfect-freehand";

/** Convert flat [x, y, pressure, ...] into a smooth filled SVG path. */
export function strokeToPath(flat: number[], size: number): string {
  const pts: Array<[number, number, number]> = [];
  for (let i = 0; i + 1 < flat.length; i += 3) {
    pts.push([flat[i], flat[i + 1], flat[i + 2] ?? 0.5]);
  }
  if (pts.length === 0) return "";
  const outline = getStroke(pts, {
    size,
    thinning: 0.55,
    smoothing: 0.6,
    streamline: 0.45,
    simulatePressure: true,
  });
  if (outline.length < 2) return "";
  const d = outline.reduce(
    (acc, [x, y], i, arr) => {
      const [nx, ny] = arr[(i + 1) % arr.length];
      acc.push(x.toFixed(2), y.toFixed(2), ((x + nx) / 2).toFixed(2), ((y + ny) / 2).toFixed(2));
      return acc;
    },
    ["M", outline[0][0].toFixed(2), outline[0][1].toFixed(2), "Q"],
  );
  d.push("Z");
  return d.join(" ");
}
