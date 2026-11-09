// Matches displayed card objects to a new snapshot. Objects persist across snapshots
// so a card can move instead of being rebuilt.
import type { Action, Card, GameSnapshot } from '../game-api';
import type { Zone } from '../core/intents';

/** Enemy keys exist only while combat shows the opposing warband. */
export type Key = `${Zone | 'enemy'}:${number}`;
export interface Placement {
  key: Key; zone: Zone; id: number; card: Card; index: number;
  price?: number | null; frozen?: boolean;
}

export function placements(snapshot: GameSnapshot): Placement[] {
  const { shop, board, hand } = snapshot.state.me;
  return [
    ...shop.map((card, index): Placement => ({ key: `shop:${card.sid}`, zone: 'shop', id: card.sid, card, index, price: card.price, frozen: card.frozen })),
    ...board.map((card, index): Placement => ({ key: `board:${card.eid}`, zone: 'board', id: card.eid, card, index })),
    ...hand.map((card, index): Placement => ({ key: `hand:${card.hid}`, zone: 'hand', id: card.hid, card, index })),
  ];
}

/**
 * Buying and playing give the card a new zone-local id, so identity alone cannot
 * connect it. Returns new key → previous key for the card the action moved.
 */
export function transfers(before: GameSnapshot, after: GameSnapshot, action: Action): Map<Key, Key> {
  const map = new Map<Key, Key>();
  const added = (old: number[], next: number[]) => next.filter(id => !old.includes(id));
  if (action.kind === 'buy') {
    const hids = added(before.state.me.hand.map(c => c.hid), after.state.me.hand.map(c => c.hid));
    if (hids.length === 1) map.set(`hand:${hids[0]}`, `shop:${action.shop_id}`);
  } else if (action.kind === 'play') {
    const eids = added(before.state.me.board.map(c => c.eid), after.state.me.board.map(c => c.eid));
    if (eids.length === 1) map.set(`board:${eids[0]}`, `hand:${action.hand_id}`);
  }
  return map;
}

/** `previous` names the displayed object to reuse; absent means a new object. */
export interface Placed { placement: Placement; previous?: Key }

export function diff(current: Iterable<Key>, next: Placement[], from: ReadonlyMap<Key, Key>) {
  const available = new Set(current);
  const place: Placed[] = next.map(placement => {
    if (!available.delete(placement.key)) return { placement };
    return { placement, previous: placement.key };
  });
  // Same-key matches win before transfers claim a source.
  for (const item of place) {
    const source = item.previous ? undefined : from.get(item.placement.key);
    if (source && available.delete(source)) item.previous = source;
  }
  return { place, exit: [...available] };
}
