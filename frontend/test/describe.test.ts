import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseOneModes, describe } from '../src/core/describe.ts';

test('Choose One text splits into its two modes', () => {
  assert.deepEqual(chooseOneModes('抉择：使一只野兽获得+1/+1和复生；或者+4攻击力和风怒。'), ['使一只野兽获得+1/+1和复生', '使一只野兽获得+4攻击力和风怒']);
  assert.deepEqual(chooseOneModes('抉择：本随从的攻击力翻倍；或者生命值翻倍。'), ['本随从的攻击力翻倍', '生命值翻倍']);
  assert.deepEqual(chooseOneModes('抉择：获取3张 鲜血宝石；或者 获得“亡语：获取2张鲜血宝石。”'), ['获取3张 鲜血宝石', '获得“亡语：获取2张鲜血宝石。”']);
  assert.equal(chooseOneModes('使一个随从获得+2/+2。'), undefined);
});

test('attached Dark Gifts follow the card text', () => {
  const lines = describe({
    id: 'M', name_zh: '鱼人', text_zh: '战吼：…',
    attached: [{ id: 'G', name_zh: '腐化之力', text_zh: '获得+2/+2。', kind: 'dark_gift' }],
  });
  assert.deepEqual(lines, ['鱼人 · 战吼：…', '黑暗之赐 · 腐化之力：获得+2/+2。']);
});
