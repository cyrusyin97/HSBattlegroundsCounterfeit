// Card slots in board coordinates (1440 × 810), matching the DOM rows so the HUD
// keeps its place. The stage projects these points onto the table.
import type { Zone } from '../core/intents';

export interface Rect { left: number; top: number; right: number; bottom: number }
/** `roll` turns the card within its own plane, clockwise on screen, in radians. */
export interface Slot { x: number; y: number; roll: number }

export const ZONES: Record<Zone, Rect> = {
  shop: { left: 150, top: 164, right: 1290, bottom: 364 },
  board: { left: 150, top: 390, right: 1290, bottom: 592 },
  hand: { left: 275, top: 635, right: 1185, bottom: 787 },
};
/** During combat the hand stays in view, fanned to the right of the friendly hero panel. */
export const COMBAT_HAND: Rect = { left: 840, top: 650, right: 1300, bottom: 790 };
const PITCH: Record<Zone, number> = { shop: 136, board: 136, hand: 92 };
const CARD_WIDTH = 120;

export function slot(zone: Zone, index: number, count: number, r = ZONES[zone]): Slot {
  const offset = index - (count - 1) / 2;
  const fit = count > 1 ? (r.right - r.left - CARD_WIDTH) / (count - 1) : PITCH[zone];
  const x = (r.left + r.right) / 2 + offset * Math.min(PITCH[zone], fit);
  const y = (r.top + r.bottom) / 2;
  if (zone !== 'hand') return { x, y, roll: 0 };
  const degrees = Math.max(-10, Math.min(10, offset * 4));
  return { x, y: y + offset * offset * 2, roll: degrees * Math.PI / 180 };
}

/** A card's own width, and the clear space between neighbours in a row. */
export const CARD_FOOTPRINT = 116;
const ROW_GAP = 20;

/**
 * Slots for `count` cards. With `gapAt`, one extra slot stays empty at that index. `area`
 * replaces the zone's rectangle. In the shop and warband rows, `widths` gives each card's
 * footprint in board pixels (wider for layers such as a Taunt shield) and neighbours are
 * spaced so the footprints keep the usual gap; cards of plain width get the usual pitch.
 */
export function slots(zone: Zone, count: number, gapAt?: number, area = ZONES[zone], widths?: readonly number[]): Slot[] {
  const total = gapAt === undefined ? count : count + 1;
  if (zone === 'hand' || !widths) {
    const out: Slot[] = [];
    for (let i = 0; i < total; i++) if (i !== gapAt) out.push(slot(zone, i, total, area));
    return out;
  }
  const w: number[] = [];
  for (let i = 0, j = 0; i < total; i++) w.push(i === gapAt ? CARD_FOOTPRINT : widths[j++] ?? CARD_FOOTPRINT);
  const centers: number[] = [];
  let at = 0;
  w.forEach((width, i) => {
    if (i) at += (w[i - 1] + width) / 2 + ROW_GAP;
    centers.push(at);
  });
  // A row too wide for its zone squeezes toward the middle, as the plain layout does.
  const reach = (area.right - area.left - CARD_WIDTH) / 2, k = at / 2 > reach ? reach / (at / 2) : 1;
  const mid = (area.left + area.right) / 2, y = (area.top + area.bottom) / 2;
  return centers.flatMap((c, i) => i === gapAt ? [] : [{ x: mid + (c - at / 2) * k, y, roll: 0 }]);
}

export function zoneAt(x: number, y: number): Zone | undefined {
  return (Object.keys(ZONES) as Zone[]).find(zone => {
    const r = ZONES[zone];
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  });
}

/** Insertion index for a pointer at `x` among card centers. */
export const insertionIndex = (x: number, centers: number[]) => centers.filter(c => c < x).length;
