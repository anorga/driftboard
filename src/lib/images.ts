/**
 * Turning pasted/dropped image files into board elements.
 *
 * Images are stored inline in the Yjs doc as data URLs, so they sync and
 * persist through the exact same CRDT pipeline as every other element — no
 * upload endpoint needed. The tradeoff is size: big images would bloat the
 * doc (and every client's IndexedDB mirror), so anything large is downscaled
 * and re-encoded before it enters the document.
 */

/** Longest edge an embedded image is allowed to keep, in pixels. */
export const MAX_IMAGE_DIM = 1600;
/** Data-URL budget per image; above this we re-encode more aggressively. */
export const MAX_DATA_URL_BYTES = 1_500_000;
/** Reject absurd files outright rather than decode them. */
export const MAX_FILE_BYTES = 25_000_000;
/** Widest an image element starts out on the board, in world units. */
export const IMAGE_DEFAULT_MAX_W = 480;

export interface LoadedImage {
  src: string;
  /** Natural (post-downscale) pixel size. */
  w: number;
  h: number;
}

export function isImageFile(file: File | null | undefined): file is File {
  return !!file && file.type.startsWith("image/");
}

/** Fit `w`x`h` inside `max` on the longest edge, preserving aspect ratio. */
export function fitDimensions(w: number, h: number, max: number): { w: number; h: number } {
  const scale = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Decode any image source (data URL, object URL) into an HTMLImageElement. */
export function decodeImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("could not decode image"));
    img.src = src;
  });
}

async function decode(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    return await decodeImage(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Decode, downscale to MAX_IMAGE_DIM, and encode to a data URL within the
 * size budget. Small files that already fit are embedded as-is (which also
 * keeps animated GIFs animated).
 */
export async function loadImage(file: Blob): Promise<LoadedImage> {
  if (file.size > MAX_FILE_BYTES) throw new Error("image is too large");
  const img = await decode(file);
  const { naturalWidth: w, naturalHeight: h } = img;

  if (file.size <= MAX_DATA_URL_BYTES * 0.75 && Math.max(w, h) <= MAX_IMAGE_DIM) {
    return { src: await blobToDataUrl(file), w, h };
  }

  const dims = fitDimensions(w, h, MAX_IMAGE_DIM);
  const canvas = document.createElement("canvas");
  canvas.width = dims.w;
  canvas.height = dims.h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, dims.w, dims.h);

  // WebP keeps transparency and compresses well; Safari's canvas can't encode
  // it and silently falls back to PNG, so fall through to JPEG if the result
  // blows the budget.
  let src = canvas.toDataURL("image/webp", 0.85);
  if (src.length > MAX_DATA_URL_BYTES) {
    // JPEG has no alpha and would composite transparency onto black — redraw
    // on a white underlay so transparent images degrade gracefully.
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, dims.w, dims.h);
    src = canvas.toDataURL("image/jpeg", 0.8);
    if (src.length > MAX_DATA_URL_BYTES) {
      src = canvas.toDataURL("image/jpeg", 0.5);
    }
  }
  return { src, w: dims.w, h: dims.h };
}
