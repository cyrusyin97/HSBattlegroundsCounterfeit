import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AttackImpact, Combat, Minion } from '../src/game-api.ts';
import { combatScript } from '../src/core/combat-script.ts';

const minion = (eid: number, shield_hits = 0): Minion => ({ id: 'X', name_zh: '', text_zh: '', eid, atk: 1, hp: 1, keywords: [], shield_hits });
const hit = (target: number, patch: Partial<AttackImpact['hits'][number]> = {}) =>
  ({ target, damage: 2, hp: 0, shield_hits: 0, absorbed: false, lethal: true, ...patch });

// Frame boards follow the reborn scenario: side B is the local seat.
function combat(frames: Combat['frames']): Combat {
  return { turn: 1, a: 1, b: 0, winner: 1, damage: 2, truncated: false, frames };
}
const frame = (a: Minion[], b: Minion[], impacts: AttackImpact[] = []): Combat['frames'][number] =>
  ({ boards: [a, b], attacks: impacts.map(i => [i.from, i.to] as [number, number]), impacts });

test('steps put the local side first and track deaths and summons', () => {
  const script = combatScript(combat([
    frame([minion(34)], [minion(33)]),
    frame([minion(34)], [minion(33)]),
    frame([minion(34)], [minion(35)], [{ from: 33, to: 34, hits: [hit(33), hit(34, { hp: 1, lethal: false })] }]),
    frame([minion(34)], [], [{ from: 34, to: 35, hits: [hit(35)] }]),
  ]), 0);
  assert.equal(script.friendly, 1);
  assert.deepEqual(script.steps.map(s => [s.friendly.map(m => m.eid), s.enemy.map(m => m.eid)]),
    [[[33], [34]], [[33], [34]], [[35], [34]], [[], [34]]]);
  assert.deepEqual(script.steps.map(s => [s.deaths, s.summons]), [[[], []], [[], []], [[33], [35]], [[35], []]]);
});

test('a shield lost without an absorbed contact breaks when the board settles', () => {
  const script = combatScript(combat([
    frame([minion(2, 1)], [minion(1, 1)]),
    // Minion 1 absorbs at contact; minion 2 loses its shield to a later trigger.
    frame([minion(2)], [minion(1)], [{ from: 2, to: 1, hits: [hit(1, { damage: 0, hp: 1, absorbed: true, lethal: false })] }]),
  ]), 0);
  assert.deepEqual(script.steps.map(s => s.shieldBreaks), [[], [2]]);
});

test('legacy frames without impacts still attack, without damage', () => {
  const legacy = combat([{ boards: [[minion(2)], [minion(1)]], attacks: [[1, 2]] }]);
  assert.deepEqual(combatScript(legacy, 0).steps[0].impacts, [{ from: 1, to: 2, hits: [] }]);
});
