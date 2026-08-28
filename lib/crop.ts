/**
 * Deskewing a badge photographed at an angle.
 *
 * Canvas 2D has no projective transform, so the quad is subdivided into a mesh
 * and each cell drawn as two affine-mapped triangles. With enough subdivision
 * that approximates the perspective correction closely enough for flat card
 * stock, at a fraction of the complexity of a real homography + WebGL pass.
 */

export type Quad = [number, number][];

/** Gemini returns corners normalized to 0-1000; convert to source pixels. */
export function quadToPixels(quad: Quad, width: number, height: number): Quad {
  return quad.map(([x, y]) => [(x / 1000) * width, (y / 1000) * height]) as Quad;
}

function dist(a: [number, number], b: [number, number]) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/** Output size derived from the quad's own edge lengths, so the badge keeps its aspect. */
export function outputSize(quad: Quad, maxWidth: number) {
  const [tl, tr, br, bl] = quad;
  const width = Math.max(dist(tl, tr), dist(bl, br));
  const height = Math.max(dist(tl, bl), dist(tr, br));
  if (width <= 0 || height <= 0) return null;
  const scale = Math.min(1, maxWidth / width);
  return { w: Math.round(width * scale), h: Math.round(height * scale) };
}

function lerp(a: [number, number], b: [number, number], t: number): [number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Bilinear position within the quad. u,v in [0,1], origin at top-left corner. */
function pointOnQuad(quad: Quad, u: number, v: number): [number, number] {
  const [tl, tr, br, bl] = quad;
  return lerp(lerp(tl, tr, u), lerp(bl, br, u), v);
}

/** Draw one source triangle into one destination triangle via an affine solve. */
function drawTriangle(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  s: [number, number][],
  d: [number, number][],
) {
  const [[sx0, sy0], [sx1, sy1], [sx2, sy2]] = s;
  const [[dx0, dy0], [dx1, dy1], [dx2, dy2]] = d;

  const denom = sx0 * (sy2 - sy1) - sx1 * sy2 + sx2 * sy1 + (sx1 - sx2) * sy0;
  if (denom === 0) return;

  const m11 = -(sy0 * (dx2 - dx1) - sy1 * dx2 + sy2 * dx1 + (sy1 - sy2) * dx0) / denom;
  const m12 = (sy1 * dy2 + sy0 * (dy1 - dy2) - sy2 * dy1 + (sy2 - sy1) * dy0) / denom;
  const m21 = (sx0 * (dx2 - dx1) - sx1 * dx2 + sx2 * dx1 + (sx1 - sx2) * dx0) / denom;
  const m22 = -(sx1 * dy2 + sx0 * (dy1 - dy2) - sx2 * dy1 + (sx2 - sx1) * dy0) / denom;
  const dx = (sx0 * (sy2 * dx1 - sy1 * dx2) + sy0 * (sx1 * dx2 - sx2 * dx1) + (sx2 * sy1 - sx1 * sy2) * dx0) / denom;
  const dy = (sx0 * (sy2 * dy1 - sy1 * dy2) + sy0 * (sx1 * dy2 - sx2 * dy1) + (sx2 * sy1 - sx1 * sy2) * dy0) / denom;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(dx0, dy0);
  ctx.lineTo(dx1, dy1);
  ctx.lineTo(dx2, dy2);
  ctx.closePath();
  // Overdraw by a hair so seams between cells don't show as hairlines.
  ctx.clip();
  ctx.transform(m11, m12, m21, m22, dx, dy);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

/**
 * @param pad fraction of the badge to keep beyond each edge, so corner detection
 *            that lands slightly inside doesn't shave off text.
 */
export function warpQuad(
  img: CanvasImageSource,
  quad: Quad,
  outW: number,
  outH: number,
  { grid = 12, pad = 0.015 }: { grid?: number; pad?: number } = {},
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get a 2D canvas context.");

  const span = 1 + pad * 2;
  const at = (u: number, v: number) => pointOnQuad(quad, -pad + u * span, -pad + v * span);

  for (let i = 0; i < grid; i++) {
    for (let j = 0; j < grid; j++) {
      const u0 = i / grid;
      const u1 = (i + 1) / grid;
      const v0 = j / grid;
      const v1 = (j + 1) / grid;

      const s00 = at(u0, v0);
      const s10 = at(u1, v0);
      const s11 = at(u1, v1);
      const s01 = at(u0, v1);

      // Expand destination cells by half a pixel to hide seams.
      const e = 0.5;
      const d00: [number, number] = [u0 * outW - e, v0 * outH - e];
      const d10: [number, number] = [u1 * outW + e, v0 * outH - e];
      const d11: [number, number] = [u1 * outW + e, v1 * outH + e];
      const d01: [number, number] = [u0 * outW - e, v1 * outH + e];

      drawTriangle(ctx, img, [s00, s10, s11], [d00, d10, d11]);
      drawTriangle(ctx, img, [s00, s11, s01], [d00, d11, d01]);
    }
  }

  return canvas;
}

/** Small JPEG data URL, sized to sit comfortably inside a Firestore document. */
export function toThumbnail(source: HTMLCanvasElement, maxWidth = 420, quality = 0.6): string {
  const scale = Math.min(1, maxWidth / source.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(source.width * scale);
  canvas.height = Math.round(source.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get a 2D canvas context.");
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

/**
 * Crop a badge out of the original photo. Returns null when no usable quad was
 * detected, in which case callers should fall back to the uncropped image.
 */
export async function cropBadge(file: File, quad: Quad | null): Promise<string | null> {
  if (!quad || quad.length !== 4) return null;
  const bitmap = await createImageBitmap(file);
  try {
    const pixels = quadToPixels(quad, bitmap.width, bitmap.height);
    const size = outputSize(pixels, 900);
    if (!size) return null;
    return toThumbnail(warpQuad(bitmap, pixels, size.w, size.h));
  } finally {
    bitmap.close();
  }
}
