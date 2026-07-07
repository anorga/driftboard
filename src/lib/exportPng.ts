import type { BoardElement } from "./types";
import { getColor } from "./constants";
import { strokeToPath } from "./stroke";
import { elementBounds } from "./geometry";

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    let line = "";
    for (const word of raw.split(" ")) {
      const probe = line ? `${line} ${word}` : word;
      if (ctx.measureText(probe).width > maxWidth && line) {
        out.push(line);
        line = word;
      } else {
        line = probe;
      }
    }
    out.push(line);
  }
  return out;
}

/** Render the board to a PNG and trigger a download. */
export function exportBoardPng(els: BoardElement[], boardName: string) {
  if (els.length === 0) return;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const el of els) {
    const b = elementBounds(el);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  const pad = 64;
  const w = maxX - minX + pad * 2;
  const h = maxY - minY + pad * 2;
  const scale = Math.min(2, 8000 / Math.max(w, h));

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.translate(pad - minX, pad - minY);

  const sorted = [...els].sort((a, b) => a.order - b.order);
  for (const el of sorted) {
    const color = getColor(el.color);
    switch (el.type) {
      case "sticky": {
        ctx.fillStyle = color.fill;
        ctx.beginPath();
        ctx.roundRect(el.x, el.y, el.w, el.h, 6);
        ctx.fill();
        if (el.text) {
          ctx.fillStyle = color.ink;
          ctx.font = "500 15px Inter, system-ui, sans-serif";
          ctx.textBaseline = "top";
          const lines = wrapText(ctx, el.text, el.w - 24);
          lines.forEach((line, i) => {
            const y = el.y + 12 + i * 22;
            if (y < el.y + el.h - 16) ctx.fillText(line, el.x + 12, y);
          });
        }
        break;
      }
      case "text": {
        ctx.fillStyle = color.vivid;
        ctx.font = "700 22px Inter, system-ui, sans-serif";
        ctx.textBaseline = "top";
        wrapText(ctx, el.text ?? "", el.w).forEach((line, i) => {
          ctx.fillText(line, el.x, el.y + i * 29);
        });
        break;
      }
      case "rect": {
        ctx.fillStyle = color.wash;
        ctx.strokeStyle = color.vivid;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(el.x + 1, el.y + 1, Math.max(1, el.w - 2), Math.max(1, el.h - 2), 8);
        ctx.fill();
        ctx.stroke();
        break;
      }
      case "ellipse": {
        ctx.fillStyle = color.wash;
        ctx.strokeStyle = color.vivid;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(el.x + el.w / 2, el.y + el.h / 2, Math.max(1, el.w / 2 - 1), Math.max(1, el.h / 2 - 1), 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        break;
      }
      case "arrow": {
        const x2 = el.x + el.w;
        const y2 = el.y + el.h;
        ctx.strokeStyle = color.vivid;
        ctx.fillStyle = color.vivid;
        ctx.lineWidth = 2.5;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(el.x, el.y);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        const angle = Math.atan2(el.h, el.w);
        const size = 10;
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - size * Math.cos(angle - 0.45), y2 - size * Math.sin(angle - 0.45));
        ctx.lineTo(x2 - size * Math.cos(angle + 0.45), y2 - size * Math.sin(angle + 0.45));
        ctx.closePath();
        ctx.fill();
        break;
      }
      case "stroke": {
        if (!el.points?.length) break;
        ctx.save();
        ctx.translate(el.x, el.y);
        ctx.fillStyle = color.vivid;
        ctx.fill(new Path2D(strokeToPath(el.points, el.size ?? 6)));
        ctx.restore();
        break;
      }
    }
  }

  const a = document.createElement("a");
  a.href = canvas.toDataURL("image/png");
  a.download = `${(boardName || "driftboard").replace(/[^\w\- ]+/g, "").trim() || "driftboard"}.png`;
  a.click();
}
