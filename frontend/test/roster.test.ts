import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ranked } from '../src/core/roster.ts';

test('standings sort by health plus armor, eliminated last', () => {
  const players = [
    { id: 0, health: 30, armor: 5, alive: true },
    { id: 1, health: 20, armor: 20, alive: true },
    { id: 2, health: 0, armor: 9, alive: false },
    { id: 3, health: 25, armor: 10, alive: true },
  ];
  assert.deepEqual(ranked(players).map(p => p.id), [1, 0, 3, 2]);
});
