// Combat presentation around the table: hero panels, phase and result text. The
// card renderer plays the minion fight in between.
import type { Combat, GameSnapshot } from './game-api';
import { byId } from './pieces';
import { showCombatHeroes, finishHeroCombat } from './hero-effects';
import { combatScript, type CombatScript } from './core/combat-script';
import { t } from './i18n';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function playCombat(replay: Combat, before: GameSnapshot, minions: (script: CombatScript) => Promise<void>) {
  const script = combatScript(replay, before.state.seat);
  showCombatHeroes(replay, before);
  const m = t();
  byId('phase').textContent = m.phase.combat(replay.turn);
  for (const id of ['tools', 'end', 'choices']) byId(id).replaceChildren();
  byId('choices').hidden = true;
  byId('status').textContent = m.combat.fighting;
  await minions(script);
  byId('status').textContent = replay.winner === 2 ? m.combat.draw
    : (replay.winner === script.friendly ? m.combat.won : m.combat.lost)(replay.damage);
  await finishHeroCombat(replay, before);
  await delay(850);
}
