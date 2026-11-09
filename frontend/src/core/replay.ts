// Renderer-independent reading of combat records relative to the local seat.
import type { Combat, GameSnapshot, HeroState } from '../game-api';

/** Combat side index (0 = a, 1 = b) of the local player. */
export const friendlySide = (combat: Combat, seat: number): 0 | 1 => combat.a === seat ? 0 : 1;

/** The snapshot carries the latest combat repeatedly; a new turn marks a new replay. */
export function newCombat(before: GameSnapshot, after: GameSnapshot): Combat | null {
  return after.combat && after.combat.turn !== before.combat?.turn ? after.combat : null;
}

/** Hero values displayed just before the confirmed snapshot is rendered. */
export function heroBaseline(before: GameSnapshot, combat: Combat | null): HeroState | null | undefined {
  return combat ? combat.heroes_after?.[friendlySide(combat, before.state.seat)] : before.state.me;
}
