// Combat presentation around the table: hero panels, phase and result text. The
// card renderer plays the minion fight in between.
import type { Combat, GameSnapshot } from './game-api';
import { byId } from './pieces';
import { showCombatHeroes, finishHeroCombat } from './hero-effects';
import { combatScript, type CombatScript } from './core/combat-script';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function playCombat(replay: Combat, before: GameSnapshot, minions: (script: CombatScript) => Promise<void>) {
  const script = combatScript(replay, before.state.seat);
  showCombatHeroes(replay, before);
  byId('phase').textContent = '战斗 · 第 ' + replay.turn + ' 回合';
  for (const id of ['tools', 'end', 'choices']) byId(id).replaceChildren();
  byId('choices').hidden = true;
  byId('status').textContent = '交战中';
  await minions(script);
  byId('status').textContent = replay.winner === 2 ? '战斗平局'
    : (replay.winner === script.friendly ? '战斗胜利' : '战斗落败') + ' · ' + replay.damage + ' 点伤害';
  await finishHeroCombat(replay, before);
  await delay(850);
}
