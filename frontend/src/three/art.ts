// Card artwork for faces. Local images are whole printed cards (404 × 558); faces
// show only the illustration, cropped from inside the printed frame, so the engine's
// numbers and the face layout stay authoritative.
import { loadCardImage } from '../demo-art';

const PRINT_W = 404, PRINT_H = 558;
/** Source rectangles inside the printed card: the minion oval and the spell window. */
const CROP = {
  minion: { x: 98, y: 100, w: 200, h: 161 },
  spell: { x: 100, y: 90, w: 200, h: 161 },
};

const images = new Map<string, HTMLImageElement | null>();
const waiting = new Map<string, Promise<HTMLImageElement | null>>();

/** The loaded art for `id`, `null` when it has none, or undefined while unknown. */
export const artFor = (id: string) => images.get(id);

/** Resolves once `id` is known; missing art resolves to null. */
export function requestArt(id: string): Promise<HTMLImageElement | null> {
  if (images.has(id)) return Promise.resolve(images.get(id)!);
  let pending = waiting.get(id);
  if (!pending) {
    pending = loadCardImage(id).then(image => {
      const art = image.src.endsWith('unknown-card.svg') ? null : image;
      images.set(id, art);
      waiting.delete(id);
      return art;
    });
    waiting.set(id, pending);
  }
  return pending;
}

/** Draws the illustration of `image` to fill the destination rectangle. */
export function drawArt(g: CanvasRenderingContext2D, image: HTMLImageElement, spell: boolean,
  x: number, y: number, w: number, h: number) {
  const crop = spell ? CROP.spell : CROP.minion;
  // Scale in case a print was saved at another resolution.
  const sx = image.naturalWidth / PRINT_W, sy = image.naturalHeight / PRINT_H;
  g.drawImage(image, crop.x * sx, crop.y * sy, crop.w * sx, crop.h * sy, x, y, w, h);
}
