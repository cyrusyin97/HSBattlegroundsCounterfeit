import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Card } from '../src/game-api.ts';
import { traits } from '../src/core/traits.ts';

const card = (patch: Partial<Card>): Card => ({ id: 'X', name_zh: '', text_zh: '', ...patch });

test('engine flags become auras and face marks', () => {
  const t = traits(card({ keywords: ['TAUNT', 'REBORN', 'MEGA_WINDFURY', 'POISONOUS', 'STEALTH'] }));
  assert.deepEqual([...t.auras], ['taunt', 'stealth']);
  assert.deepEqual(t.marks, ['windfury', 'reborn', 'venomous']);
});

test('deathrattle comes from printed text', () => {
  assert.deepEqual(traits(card({ keywords: [], text: 'Deathrattle: Summon two 1/1 Skeletons.' })).marks, ['deathrattle']);
  assert.deepEqual(traits(card({ text: 'Taunt. Deathrattle: Deal 2 damage.' })).marks, ['deathrattle']);
  assert.deepEqual(traits(card({ text: 'After a friendly Deathrattle minion dies, gain +1 Attack.' })).marks, []);
});

test('shield hits decide the shield once they are known', () => {
  assert.ok(traits(card({ keywords: ['DIVINE_SHIELD'] })).auras.has('shield'));
  assert.ok(!traits(card({ keywords: ['DIVINE_SHIELD'], shield_hits: 0 })).auras.has('shield'));
  assert.ok(traits(card({ keywords: [], shield_hits: 1 })).auras.has('shield'));
});
