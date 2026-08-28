/**
 * Downscale and re-encode a camera capture before sending it to Gemini.
 * Phone photos are 4-12MB; without this the round trip feels slow on stage.
 */
export async function compressImage(file: File, maxEdge = 1280, quality = 0.8): Promise<{ base64: string; mimeType: string }> {
  const bitmap = await createImageBitmap(file);

  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get a 2D canvas context.");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  return { base64: dataUrl.split(",")[1], mimeType: "image/jpeg" };
}
