import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Action, Combat, GameSnapshot } from '../src/game-api.ts';
import { matchAction, resolveDrop, resolveTap, type CardRef } from '../src/core/intents.ts';
import { friendlySide, heroBaseline, newCombat } from '../src/core/replay.ts';

const card = { id: 'X', name_zh: '', text_zh: '' };
const minion = (eid: number) => ({ ...card, eid, atk: 1, hp: 1, keywords: [], shield_hits: 0 });

function snapshot(legal: Action[], patch: Partial<GameSnapshot['state']['me']> = {}, combat: Combat | null = null): GameSnapshot {
  return {
    game_id: 'g', version: 1, legal_actions: legal, combat,
    state: {
      seat: 0, phase: 'recruit', turn: 1, opponents: [],
      me: {
        alive: true, placement: 0, hero: null, hero_powers: [], health: 30, armor: 5, gold: 3, tier: 1,
        frozen: false, upgrade_price: 5, refresh_price: 1, casting: null,
        board: [minion(10), minion(11)], shop: [], hand: [], pending: null, ...patch,
      },
    },
  };
}
const shop: CardRef = { zone: 'shop', id: 7, card };
const hand: CardRef = { zone: 'hand', id: 3, card };
const board: CardRef = { zone: 'board', id: 10, card: { ...card, eid: 10 } };

test('matchAction returns the legal object itself', () => {
  const buy: Action = { kind: 'buy', shop_id: 7 };
  const s = snapshot([{ kind: 'buy', shop_id: 8 }, buy]);
  assert.equal(matchAction(s, 'buy', { shop_id: 7 }), buy);
  assert.equal(matchAction(s, 'buy', { shop_id: 9 }), undefined);
});

test('tap buys, plays at the end, activates, and targets', () => {
  const play: Action = { kind: 'play', hand_id: 3, position: 2 };
  const s = snapshot([{ kind: 'buy', shop_id: 7 }, { kind: 'play', hand_id: 3, position: 0 }, play, { kind: 'activate', entity_id: 10 }]);
  assert.deepEqual(resolveTap(s, shop), { kind: 'buy', shop_id: 7 });
  assert.equal(resolveTap(s, hand), play);
  assert.deepEqual(resolveTap(s, board), { kind: 'activate', entity_id: 10 });

  const targeting = snapshot([{ kind: 'target', target_id: 10 }, { kind: 'buy', shop_id: 7 }], { pending: { kind: 'target' } });
  assert.deepEqual(resolveTap(targeting, board), { kind: 'target', target_id: 10 });
  assert.equal(resolveTap(targeting, shop), undefined);
});

test('tap prefers casting a spell over playing it', () => {
  const s = snapshot([{ kind: 'play', hand_id: 3, position: 2 }, { kind: 'cast', hand_id: 3 }]);
  assert.deepEqual(resolveTap(s, hand), { kind: 'cast', hand_id: 3 });
});

test('drop maps zones to buy, sell, play, move and cast', () => {
  const s = snapshot([
    { kind: 'buy', shop_id: 7 }, { kind: 'sell', entity_id: 10 },
    { kind: 'play', hand_id: 3, position: 1 }, { kind: 'move', entity_id: 10, position: 1 },
  ]);
  assert.deepEqual(resolveDrop(s, shop, 'hand', 0), { kind: 'buy', shop_id: 7 });
  assert.deepEqual(resolveDrop(s, board, 'shop', 0), { kind: 'sell', entity_id: 10 });
  assert.deepEqual(resolveDrop(s, hand, 'board', 1), { kind: 'play', hand_id: 3, position: 1 });
  assert.deepEqual(resolveDrop(s, board, 'board', 1), { kind: 'move', entity_id: 10, position: 1 });
  assert.equal(resolveDrop(s, hand, 'board', 0), undefined);
  assert.equal(resolveDrop(s, shop, 'board', 1), undefined);
  assert.equal(resolveDrop(s, board, 'hand', 0), undefined);
  assert.equal(resolveDrop(s, hand, undefined, 1), undefined);

  const spell = snapshot([{ kind: 'cast', hand_id: 3 }]);
  assert.deepEqual(resolveDrop(spell, hand, 'board', 0), { kind: 'cast', hand_id: 3 });
});

test('combat replay identity and hero baseline follow the local seat', () => {
  const hero = { hero: null, health: 29, armor: 0, tier: 1 };
  const enemy = { hero: null, health: 20, armor: 0, tier: 2 };
  const combat: Combat = {
    turn: 1, a: 3, b: 0, winner: 0, damage: 2, truncated: false, frames: [],
    heroes_after: [enemy, hero],
  };
  const before = snapshot([]);
  const after = snapshot([], {}, combat);
  assert.equal(friendlySide(combat, 0), 1);
  assert.equal(newCombat(before, after), combat);
  assert.equal(newCombat(after, after), null);
  assert.equal(heroBaseline(before, combat), hero);
  assert.equal(heroBaseline(before, null), before.state.me);
});
