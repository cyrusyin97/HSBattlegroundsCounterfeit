import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOGS, cardName, cardText, LOCALES, matchLanguage, resolveLocale } from '../src/i18n/index.ts';
import { chooseOneModes } from '../src/core/describe.ts';

test('browser languages map to the three locales', () => {
  assert.equal(matchLanguage('zh-TW'), 'zh-TW');
  assert.equal(matchLanguage('zh-HK'), 'zh-TW');
  assert.equal(matchLanguage('zh-Hant'), 'zh-TW');
  assert.equal(matchLanguage('zh-Hant-SG'), 'zh-TW');
  assert.equal(matchLanguage('zh-CN'), 'zh-CN');
  assert.equal(matchLanguage('zh-Hans-HK'), 'zh-CN');
  assert.equal(matchLanguage('zh'), 'zh-CN');
  assert.equal(matchLanguage('en-GB'), 'en');
  assert.equal(matchLanguage('fr-FR'), undefined);
});

test('the query beats the saved choice, which beats the browser', () => {
  assert.equal(resolveLocale('en', 'zh-TW', ['zh-CN']), 'en');
  assert.equal(resolveLocale(null, 'zh-TW', ['zh-CN']), 'zh-TW');
  assert.equal(resolveLocale('xx', 'yy', ['fr-FR', 'zh-HK']), 'zh-TW');
  assert.equal(resolveLocale(null, null, ['fr-FR']), 'en');
});

test('card strings follow the locale and fall back when a field is missing', () => {
  const card = { name: 'Alliance Flag', name_zh: '联盟旗帜', name_tw: '聯盟旗幟', text: 'Give +1/+1.', text_zh: '获得+1/+1。' };
  assert.equal(cardName(card, 'en'), 'Alliance Flag');
  assert.equal(cardName(card, 'zh-CN'), '联盟旗帜');
  assert.equal(cardName(card, 'zh-TW'), '聯盟旗幟');
  // No Traditional text: Simplified first, then English.
  assert.equal(cardText(card, 'zh-TW'), '获得+1/+1。');
  assert.equal(cardText({ text_zh: '', text: 'Give +1/+1.' }, 'zh-CN'), 'Give +1/+1.');
  assert.equal(cardName({ name_zh: '鱼人' }, 'en'), '鱼人');
});

/** Sample arguments for a message function, by its parameter count. */
const samples: Record<number, unknown[]> = { 0: [], 1: [3], 2: [3, 2], 3: [3, 2, 1], 6: [2, true, 'X', 1, 30, 'Y'] };

test('every catalog has every message, and each one yields text', () => {
  const walk = (zh: object, other: object, path: string) => {
    for (const [key, value] of Object.entries(zh)) {
      const theirs = (other as Record<string, unknown>)[key];
      const at = path + key;
      assert.ok(theirs !== undefined, `missing ${at}`);
      if (value instanceof RegExp) continue;
      if (typeof value === 'function') {
        const args = key === 'header' ? [1, 'X', ['a']] : key === 'attached' ? [true, 'X', 'Y'] : key === 'line' ? ['X', 'Y']
          : key === 'warband' || key === 'power' || key === 'trinket' ? ['X', 2] : samples[value.length];
        const text = (theirs as (...a: unknown[]) => unknown)(...args);
        assert.ok(typeof text === 'string' && text.length > 0, `empty ${at}`);
      } else if (typeof value === 'object') walk(value, theirs as object, at + '.');
      else assert.ok(typeof theirs === 'string' && theirs.length > 0, `empty ${at}`);
    }
  };
  for (const code of LOCALES) walk(CATALOGS['zh-CN'], CATALOGS[code], code + ':');
});

test('Choose One text splits in each language', () => {
  assert.deepEqual(chooseOneModes('Choose One - Give a minion +3/+1; or +1/+3.', CATALOGS.en.chooseOne),
    ['Give a minion +3/+1', 'Give a minion +1/+3']);
  assert.deepEqual(chooseOneModes('Choose One - Get 2 Blood Gems; or Get a Gem Day.', CATALOGS.en.chooseOne),
    ['Get 2 Blood Gems', 'Get a Gem Day']);
  assert.deepEqual(chooseOneModes('抉擇：使一個隨從獲得+3/+1；或者+1/+3。', CATALOGS['zh-TW'].chooseOne),
    ['使一個隨從獲得+3/+1', '使一個隨從獲得+1/+3']);
  assert.equal(chooseOneModes('Give a minion +2/+2.', CATALOGS.en.chooseOne), undefined);
});
