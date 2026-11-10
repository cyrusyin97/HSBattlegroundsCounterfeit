const fallback = '/assets/unknown-card.svg';
const unavailable = new Set<string>();
/** Decoded images by card ID; copies of these paint in the same frame they are inserted. */
const decoded = new Map<string, HTMLImageElement>();

/** Load only visible card faces. The full provenance manifest stays out of the JS bundle. */
export async function loadCardImage(cardId: string): Promise<HTMLImageElement> {
  const image = new Image();
  if (!unavailable.has(cardId)) {
    image.src = '/assets/official/' + encodeURIComponent(cardId) + '.png';
    try {
      await image.decode();
      decoded.set(cardId, image);
      return image;
    } catch {
      unavailable.add(cardId);
    }
  }
  image.src = fallback;
  await image.decode();
  decoded.set(cardId, image);
  return image;
}

/**
 * Hands `place` an image of the card: synchronously when it was loaded before, so a panel
 * rebuilt on every render never shows an empty portrait for a frame; otherwise once loaded.
 */
export function withCardImage(cardId: string, place: (image: HTMLImageElement) => void) {
  const ready = decoded.get(cardId);
  if (ready) place(ready.cloneNode() as HTMLImageElement);
  else void loadCardImage(cardId).then(place);
}
