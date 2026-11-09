// Renderer-independent reading of a combat replay as ordered playback steps, with
// the local player's side first. Type-only imports keep it runnable under Node.
import type { AttackImpact, Combat, Minion } from '../game-api';
import { friendlySide } from './replay.ts';

export interface CombatStep {
  /** Contacts to play against the currently displayed bodies, in order. */
  impacts: AttackImpact[];
  /** Boards after the step resolves. */
  friendly: Minion[];
  enemy: Minion[];
  /** Displayed before the step but absent after it. */
  deaths: number[];
  /** Absent before the step but present after it. The opening step summons nothing. */
  summons: number[];
  /** Shields still shown after the contacts that the resolved board no longer has. */
  shieldBreaks: number[];
}

export interface CombatScript { friendly: 0 | 1; steps: CombatStep[] }

export function combatScript(combat: Combat, seat: number): CombatScript {
  const friendly = friendlySide(combat, seat);
  const shields = new Map<number, number>();
  let shown: number[] | undefined;
  const steps = combat.frames.map((frame): CombatStep => {
    // Older saved replays have attack IDs only. Contact plays without invented damage.
    const impacts = frame.impacts ?? frame.attacks.map(([from, to]) => ({ from, to, hits: [] }));
    for (const impact of impacts) for (const hit of impact.hits) shields.set(hit.target, hit.shield_hits);
    const mine = frame.boards[friendly], theirs = frame.boards[1 - friendly];
    const next = [...mine, ...theirs];
    const ids = next.map(m => m.eid);
    const step: CombatStep = {
      impacts, friendly: mine, enemy: theirs,
      deaths: shown?.filter(id => !ids.includes(id)) ?? [],
      summons: shown ? ids.filter(id => !shown!.includes(id)) : [],
      shieldBreaks: next.filter(m => !m.shield_hits && (shields.get(m.eid) ?? 0) > 0).map(m => m.eid),
    };
    for (const m of next) shields.set(m.eid, m.shield_hits);
    shown = ids;
    return step;
  });
  return { friendly, steps };
}
