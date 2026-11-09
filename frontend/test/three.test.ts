import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Action, GameSnapshot } from '../src/game-api.ts';
import { insertionIndex, slot, slots, ZONES, zoneAt } from '../src/three/layout.ts';
import { diff, placements, transfers, type Placement } from '../src/three/reconciler.ts';

const card = { id: 'X', name_zh: '', text_zh: '' };
const minion = (eid: number) => ({ ...card, eid, atk: 1, hp: 1, keywords: [], shield_hits: 0 });

function snapshot(me: { shop?: number[]; board?: number[]; hand?: number[] }): GameSnapshot {
  return {
    game_id: 'g', version: 1, legal_actions: [], combat: null,
    state: {
      seat: 0, phase: 'recruit', turn: 1, opponents: [],
      me: {
        alive: true, placement: 0, hero: null, hero_powers: [], health: 30, armor: 0, gold: 3, tier: 1,
        frozen: false, upgrade_price: 5, refresh_price: 1, casting: null, pending: null,
        shop: (me.shop ?? []).map(sid => ({ ...card, sid, price: 3 })),
        board: (me.board ?? []).map(minion),
        hand: (me.hand ?? []).map(hid => ({ ...card, hid })),
      },
    },
  };
}

test('rows are centered, ordered and stay inside their zone', () => {
  const r = ZONES.board;
  assert.equal(slot('board', 0, 1).x, (r.left + r.right) / 2);
  for (const count of [1, 4, 7]) {
    const xs = slots('board', count).map(s => s.x);
    assert.deepEqual(xs, [...xs].sort((a, b) => a - b));
    assert.ok(xs[0] >= r.left && xs.at(-1)! <= r.right);
  }
  const hand = slots('hand', 10);
  assert.ok(hand[0].x >= ZONES.hand.left && hand[9].x <= ZONES.hand.right);
  assert.ok(hand[0].roll < 0 && hand[9].roll > 0);
});

test('a gap leaves one slot empty at the insertion index', () => {
  const full = slots('board', 3);
  const gapped = slots('board', 2, 1);
  assert.equal(gapped.length, 2);
  assert.deepEqual([gapped[0].x, gapped[1].x], [full[0].x, full[2].x]);
});

test('zone and insertion lookup', () => {
  assert.equal(zoneAt(720, 264), 'shop');
  assert.equal(zoneAt(720, 491), 'board');
  assert.equal(zoneAt(720, 711), 'hand');
  assert.equal(zoneAt(720, 377), undefined);
  assert.equal(insertionIndex(500, [400, 600, 800]), 1);
});

test('placements key cards by zone-local id', () => {
  const keys = placements(snapshot({ shop: [5], board: [10, 11], hand: [3] })).map(p => [p.key, p.index]);
  assert.deepEqual(keys, [['shop:5', 0], ['board:10', 0], ['board:11', 1], ['hand:3', 0]]);
});

test('buy and play connect the new id to the card that moved', () => {
  const buy: Action = { kind: 'buy', shop_id: 5 };
  assert.deepEqual([...transfers(snapshot({ shop: [5], hand: [1] }), snapshot({ hand: [1, 2] }), buy)], [['hand:2', 'shop:5']]);
  const play: Action = { kind: 'play', hand_id: 2, position: 0 };
  assert.deepEqual([...transfers(snapshot({ hand: [2] }), snapshot({ board: [9] }), play)], [['board:9', 'hand:2']]);
  // A play that also summons leaves the identity ambiguous, so nothing is transferred.
  assert.equal(transfers(snapshot({ hand: [2] }), snapshot({ board: [9, 10] }), play).size, 0);
});

test('diff reuses same keys first, then transfers, and exits the rest', () => {
  const next: Placement[] = placements(snapshot({ shop: [6], board: [10], hand: [2] }));
  const { place, exit } = diff(['shop:5', 'shop:6', 'board:10'], next, new Map([['hand:2', 'shop:5'], ['board:10', 'shop:6']]));
  assert.deepEqual(place.map(p => [p.placement.key, p.previous]), [
    ['shop:6', 'shop:6'], ['board:10', 'board:10'], ['hand:2', 'shop:5'],
  ]);
  assert.deepEqual(exit, []);
  assert.deepEqual(diff(['shop:5'], [], new Map()).exit, ['shop:5']);
});
