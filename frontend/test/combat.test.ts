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

// Playback timing: the schedule and the timeline that plays it.
import { combatSchedule, combatStart, type HeroSides } from '../src/core/combat-timeline.ts';
import { Timeline } from '../src/core/timeline.ts';
import {
  ATTACK, ATTACK_MS, DEATHS_MS, HERO, HERO_ATTACK_MS, MISSING_ATTACK_MS, OPENING_MS, RESULT_HOLD_MS, SETTLE_MS, SUMMONS_MS,
} from '../src/core/combat-timing.ts';
import type { GameSnapshot, HeroState } from '../src/game-api.ts';

const hero = (health: number, armor = 0): HeroState => ({ hero: null, health, armor, tier: 1 });
const fight = (patch: Partial<Combat> = {}) => ({ ...combat([
  frame([minion(34)], [minion(33)]),
  frame([minion(34)], [minion(35)], [{ from: 33, to: 34, hits: [hit(33), hit(34, { hp: 1, lethal: false })] }]),
  frame([minion(34)], [], [{ from: 34, to: 35, hits: [hit(35)] }, { from: 33, to: 34, hits: [] }]),
]), ...patch });
const quiet: HeroSides = [hero(30), hero(30)];
const schedule = (c: Combat, starting = quiet) => combatSchedule(combatScript(c, 0), c, starting);

test('the schedule follows the timing constants step by step', () => {
  const s = schedule(fight({ winner: 2, damage: 0 }));
  const minions = OPENING_MS + SETTLE_MS          // opening step, no attacks
    + ATTACK_MS + DEATHS_MS + SUMMONS_MS + SETTLE_MS  // 33 hits 34 and dies; 35 is summoned
    + ATTACK_MS + MISSING_ATTACK_MS + DEATHS_MS + SETTLE_MS; // 34 hits 35; dead 33 cannot be drawn attacking
  assert.equal(s.minionsEnd, minions);
  assert.equal(s.duration, minions + RESULT_HOLD_MS);
  const attacks = s.events.filter(e => e.kind === 'attack');
  assert.deepEqual(attacks.map(e => e.kind === 'attack' && e.shown), [true, true, false]);
  assert.deepEqual(attacks.map(e => e.kind === 'attack' && e.contact - e.at), [ATTACK.lunge, ATTACK.lunge, 0]);
});

test('the schedule is the same every time and starts every event where the previous ends', () => {
  const a = schedule(fight()), b = schedule(fight());
  assert.deepEqual(a, b);
  let at = 0;
  for (const e of a.events) {
    assert.equal(e.at, at);
    at += e.ms;
  }
  assert.equal(at, a.duration);
});

test('the hero phase depends only on the replay and the starting heroes', () => {
  const base = schedule(fight({ winner: 2, damage: 0 })).minionsEnd;
  // Side B (the local seat) wins; side A loses 2 and has 1 health left.
  const won = fight({ winner: 1, damage: 2, heroes_before: [hero(3), hero(30)], heroes_after: [hero(1), hero(30)] });
  assert.equal(schedule(won, [hero(3), hero(30)]).duration, base + HERO_ATTACK_MS + RESULT_HOLD_MS);
  // An end-of-turn effect changed side A before the hit.
  assert.equal(schedule(won, [hero(5), hero(30)]).duration, base + HERO.vitals + HERO_ATTACK_MS + RESULT_HOLD_MS);
  const lethal = { ...won, heroes_after: [hero(0), hero(30)] as [HeroState, HeroState] };
  assert.equal(schedule(lethal, [hero(3), hero(30)]).duration, base + HERO_ATTACK_MS + HERO.defeat + RESULT_HOLD_MS);
  // A defeated ghost has no hero to hit.
  const ghost = fight({ a: 0, b: null, winner: 0, damage: 4 });
  assert.equal(combatSchedule(combatScript(ghost, 0), ghost, [hero(30), null]).duration,
    schedule(fight({ winner: 2, damage: 0 })).duration);
});

test('a timeline seek runs every cue it passes, in order, and says how late each is', () => {
  const timeline = new Timeline();
  const ran: [string, number][] = [];
  timeline.at(500, late => ran.push(['b', late]));
  timeline.at(100, late => {
    ran.push(['a', late]);
    // A cue added while seeking still runs in the same seek when it is due.
    timeline.at(300, l => ran.push(['added', l]));
  });
  timeline.at(2000, late => ran.push(['c', late]));
  const jumps: boolean[] = [];
  timeline.every((_t, jumped) => jumps.push(jumped));
  timeline.seek(16);
  timeline.seek(1200);
  assert.deepEqual(ran, [['a', 1100], ['added', 900], ['b', 700]]);
  assert.deepEqual(jumps, [false, true]);
  timeline.dispose();
  timeline.seek(3000);
  assert.equal(ran.length, 3);
});

test('a combat starts on this clock where the server says it started', () => {
  const snapshot = { server_now: 10_000, client: { received: 500, rtt: 40 } } as GameSnapshot;
  // The server had been playing for 300 ms, plus half the round trip on the way here.
  assert.equal(combatStart(snapshot, { started_at: 9_700 } as Combat), 500 - 320);
  assert.equal(combatStart({} as GameSnapshot, {} as Combat, 1234), 1234);
});
