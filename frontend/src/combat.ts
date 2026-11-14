// Combat presentation: hero panels, phase and result text around the minion fight that
// the card renderer draws. One timeline drives all of it on real time, so a combat lasts
// as long as its schedule says whether or not the tab is drawing frames.
import type { Combat, GameSnapshot } from './game-api';
import { byId } from './pieces';
import { showCombatHeroes, stageHeroCombat } from './hero-effects';
import { combatScript } from './core/combat-script';
import { combatSchedule, startingHeroes } from './core/combat-timeline';
import { play, Timeline } from './core/timeline';
import type { CardView } from './view';
import { t } from './i18n';

/** Plays `replay` from `start`, a `performance.now()` time that may lie in the past. */
export async function playCombat(replay: Combat, before: GameSnapshot, view: CardView, start: number) {
  const seat = before.state.seat;
  const script = combatScript(replay, seat);
  const starting = startingHeroes(replay, before);
  const schedule = combatSchedule(script, replay, starting);
  const timeline = new Timeline();
  showCombatHeroes(replay, before, starting);
  const m = t();
  byId('phase').textContent = m.phase.combat(replay.turn);
  for (const id of ['tools', 'end', 'choices']) byId(id).replaceChildren();
  byId('choices').hidden = true;
  byId('status').textContent = m.combat.fighting;
  view.stageCombat(script, schedule, timeline);
  timeline.at(schedule.minionsEnd, () => {
    byId('status').textContent = replay.winner === 2 ? m.combat.draw
      : (replay.winner === script.friendly ? m.combat.won : m.combat.lost)(replay.damage);
  });
  stageHeroCombat(timeline, replay, seat, schedule, starting);
  await play(timeline, schedule.duration, start, view.onFrame);
}
