const fallback = '/assets/unknown-card.svg';
const unavailable = new Set<string>();

/** Load only visible card faces. The full provenance manifest stays out of the JS bundle. */
export async function loadCardImage(cardId: string): Promise<HTMLImageElement> {
  const image = new Image();
  if (!unavailable.has(cardId)) {
    image.src = '/assets/official/' + encodeURIComponent(cardId) + '.png';
    try {
      await image.decode();
      return image;
    } catch {
      unavailable.add(cardId);
    }
  }
  image.src = fallback;
  await image.decode();
  return image;
}
