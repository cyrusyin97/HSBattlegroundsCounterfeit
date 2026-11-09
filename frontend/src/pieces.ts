import type { Card } from './game-api';
import { loadCardImage } from './demo-art';

export function badge(cls: string, value: string | number) {
  const span = document.createElement('span');
  span.className = cls;
  span.textContent = String(value);
  return span;
}

export function piece(card: Card, full = false) {
  const el = document.createElement('button');
  el.className = 'piece';
  el.ariaLabel = card.name_zh;
  if (card.eid !== undefined) el.dataset.eid = String(card.eid);
  const portrait = document.createElement('span');
  const asCard = full || card.type === 'spell';
  portrait.className = asCard ? '' : 'portrait';
  if (card.type === 'spell') el.classList.add('spell');
  if (card.shield_hits) el.classList.add('shield');
  el.append(portrait);
  void loadCardImage(card.id).then(img => {
    img.alt = '';
    img.draggable = false;
    if (asCard) img.className = 'full';
    if (img.src.endsWith('unknown-card.svg')) el.classList.add('fallback');
    portrait.append(img);
  });
  if (!asCard) el.append(badge('attack', card.atk ?? 0), badge('health', card.hp ?? 0));
  el.append(badge('name', card.name_zh));
  return el;
}

export const byId = (id: string) => document.getElementById(id)!;
/** CSS scale that fits the 1440 × 810 board into the viewport. */
export const boardScale = () => Math.min(innerWidth / 1440, innerHeight / 810);
export function localPoint(x: number, y: number) {
  const bounds = byId('table').getBoundingClientRect();
  return { x: (x - bounds.left) * 1440 / bounds.width, y: (y - bounds.top) * 810 / bounds.height };
}
