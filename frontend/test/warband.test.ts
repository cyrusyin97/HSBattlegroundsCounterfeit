import { test } from 'node:test';
import assert from 'node:assert/strict';
import { warbandType } from '../src/core/warband.ts';

test('a warband is named after its leading tribe, or 混合', () => {
  assert.equal(warbandType({ size: 7, races: { MURLOC: 4, ELEMENTAL: 2, ABERRATION: 1 } }), '鱼人');
  assert.equal(warbandType({ size: 7, races: { ELEMENTAL: 3, MURLOC: 1, QUILBOAR: 1 } }), '元素');
  assert.equal(warbandType({ size: 6, races: { MURLOC: 3, DEMON: 3 } }), '鱼人/恶魔');
  assert.equal(warbandType({ size: 7, races: { MURLOC: 3, DEMON: 3, ELEMENTAL: 3 } }), '混合');
  assert.equal(warbandType({ size: 7, races: { MURLOC: 2, QUILBOAR: 2, MECHANICAL: 1 } }), '混合');
  assert.equal(warbandType({ size: 1, races: { BEAST: 1 } }), '野兽');
  assert.equal(warbandType({ size: 3, races: { BEAST: 1 } }), '混合');
  assert.equal(warbandType({ size: 2, races: {} }), '无种族');
  assert.equal(warbandType({ size: 0, races: {} }), undefined);
});
