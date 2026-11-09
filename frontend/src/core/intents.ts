// Renderer-independent input rules. Each function maps a gesture on a card to an
// object from the snapshot's legal_actions, or undefined when the gesture is illegal.
// Type-only imports keep this module free of DOM and network code.
import type { Action, Card, GameSnapshot } from '../game-api';

export type Zone = 'shop' | 'board' | 'hand';
export const isZone = (value: unknown): value is Zone =>
  value === 'shop' || value === 'board' || value === 'hand';

/** A displayed card: its zone, its zone-local id (sid, eid or hid) and its definition. */
export interface CardRef { zone: Zone; id: number; card: Card }

/** Returns the legal action itself, so callers can check membership by identity. */
export function matchAction(snapshot: GameSnapshot, kind: Action['kind'], fields: Record<string, number> = {}) {
  return snapshot.legal_actions.find(a =>
    a.kind === kind && Object.entries(fields).every(([k, v]) => Reflect.get(a, k) === v));
}

export function resolveTap(snapshot: GameSnapshot, { zone, id, card }: CardRef): Action | undefined {
  const match = (kind: Action['kind'], fields?: Record<string, number>) => matchAction(snapshot, kind, fields);
  const me = snapshot.state.me;
  if (me.pending?.kind === 'target') return card.eid === undefined ? undefined : match('target', { target_id: card.eid });
  if (zone === 'shop') return match('buy', { shop_id: id });
  if (zone === 'hand') return match('cast', { hand_id: id }) ?? match('play', { hand_id: id, position: me.board.length });
  return match('activate', { entity_id: id });
}

/**
 * `zone` is the row under the pointer. `position` is the insertion index among the
 * friendly minions other than the dragged one, and is read only for board drops.
 * `over` is the friendly minion directly under the pointer: a Magnetic hand minion
 * dropped on a legal one attaches to it instead of being played beside it.
 */
export function resolveDrop(snapshot: GameSnapshot, source: CardRef, zone: Zone | undefined, position: number, over?: number): Action | undefined {
  const match = (kind: Action['kind'], fields?: Record<string, number>) => matchAction(snapshot, kind, fields);
  const { id } = source;
  if (zone === 'hand' && source.zone === 'shop') return match('buy', { shop_id: id });
  if (zone === 'shop' && source.zone === 'board') return match('sell', { entity_id: id });
  if (zone !== 'board' || source.zone === 'shop') return;
  if (source.zone === 'hand') {
    const attach = over === undefined ? undefined : match('magnetize', { hand_id: id, target_id: over });
    return attach ?? match('cast', { hand_id: id }) ?? match('play', { hand_id: id, position });
  }
  return match('move', { entity_id: id, position });
}

/** Friendly minions the hand card `hid` may magnetize onto. */
export const magnetTargets = (snapshot: GameSnapshot, hid: number) => snapshot.legal_actions.flatMap(a =>
  a.kind === 'magnetize' && a.hand_id === hid ? [a.target_id] : []);
