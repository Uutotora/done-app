/**
 * Profile photos: any picture is center-cropped to a square, scaled to
 * 128×128 and stored inline as a small data URL (webp, or jpeg where the
 * browser cannot encode webp). The server accepts at most 70 000 characters.
 */

export const PHOTO_SIZE = 128;
/** Largest data URL we store, in characters. */
export const PHOTO_MAX_CHARS = 48 * 1024;
/** Largest source file we try to read. */
export const PHOTO_MAX_SOURCE_BYTES = 10 * 1024 * 1024;
export const PHOTO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
/** Encoder qualities tried in order until the result is small enough. */
export const PHOTO_QUALITIES = [0.85, 0.75, 0.65, 0.5, 0.35] as const;

export type PhotoError = 'type' | 'tooBig' | 'unreadable';
export class PhotoProblem extends Error {
  readonly reason: PhotoError;
  constructor(reason: PhotoError) {
    super(reason);
    this.reason = reason;
  }
}

/** Same shape the server accepts (see server/access.mjs). Checked on the prefix only, so rendering stays cheap. */
export const isSafePhoto = (value: unknown): value is string =>
  typeof value === 'string' && /^data:image\/(png|jpeg|webp|gif);base64,/.test(value) && value.length <= 70000;

/** Checks a picked file before it is decoded. */
export function photoFileProblem(file: { type: string; size: number }): PhotoError | undefined {
  if (!(PHOTO_TYPES as readonly string[]).includes(file.type)) return 'type';
  if (file.size > PHOTO_MAX_SOURCE_BYTES) return 'tooBig';
  return undefined;
}

/** The centered square of an image: where to cut it from the source. */
export function centerSquare(width: number, height: number): { sx: number; sy: number; side: number } {
  const side = Math.max(1, Math.min(width, height));
  return { sx: Math.max(0, Math.round((width - side) / 2)), sy: Math.max(0, Math.round((height - side) / 2)), side };
}

/**
 * Encodes with decreasing quality until the data URL fits. `encode` returns a
 * data URL for a type and quality, like canvas.toDataURL.
 */
export function encodeWithinLimit(encode: (type: string, quality: number) => string, limit = PHOTO_MAX_CHARS): string | undefined {
  const webp = encode('image/webp', PHOTO_QUALITIES[0]);
  // Browsers that cannot write webp fall back to png, which is far too large for photos.
  const type = webp.startsWith('data:image/webp') ? 'image/webp' : 'image/jpeg';
  for (const quality of PHOTO_QUALITIES) {
    const url = type === 'image/webp' && quality === PHOTO_QUALITIES[0] ? webp : encode(type, quality);
    if (url.startsWith(`data:${type};base64,`) && url.length <= limit) return url;
  }
  return undefined;
}

async function decode(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      /* try an image element below */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => undefined };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Reads a picked or dropped file into a square photo data URL. Throws PhotoProblem with a reason. */
export async function photoFromFile(file: File): Promise<string> {
  const problem = photoFileProblem(file);
  if (problem) throw new PhotoProblem(problem);
  let image: Awaited<ReturnType<typeof decode>>;
  try {
    image = await decode(file);
  } catch {
    throw new PhotoProblem('unreadable');
  }
  try {
    if (!image.width || !image.height) throw new PhotoProblem('unreadable');
    const canvas = document.createElement('canvas');
    canvas.width = PHOTO_SIZE;
    canvas.height = PHOTO_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new PhotoProblem('unreadable');
    const { sx, sy, side } = centerSquare(image.width, image.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const draw = (background?: string) => {
      ctx.clearRect(0, 0, PHOTO_SIZE, PHOTO_SIZE);
      // JPEG has no transparency: put transparent pictures on white instead of black.
      if (background) {
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, PHOTO_SIZE, PHOTO_SIZE);
      }
      ctx.drawImage(image.source, sx, sy, side, side, 0, 0, PHOTO_SIZE, PHOTO_SIZE);
    };
    let drawn: 'plain' | 'white' | undefined;
    const url = encodeWithinLimit((type, quality) => {
      const want = type === 'image/jpeg' ? 'white' : 'plain';
      if (drawn !== want) {
        draw(want === 'white' ? '#ffffff' : undefined);
        drawn = want;
      }
      return canvas.toDataURL(type, quality);
    });
    if (!url) throw new PhotoProblem('unreadable');
    return url;
  } finally {
    image.close();
  }
}
