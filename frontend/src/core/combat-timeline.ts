// The combat schedule: every event of a combat's playback with its start time and
// duration, computed from the replay and the timing constants alone. Rendering only
// samples it, so the state at any time is known without playing up to it.
import type { AttackImpact, Combat, GameSnapshot, HeroState } from '../game-api';
import type { CombatScript } from './combat-script.ts';
import { friendlySide } from './replay.ts';
import {
  ATTACK, ATTACK_MS, DEATHS_MS, HERO, HERO_ATTACK_MS, MISSING_ATTACK_MS, OPENING_MS, RESULT_HOLD_MS, SETTLE_MS, SUMMONS_MS,
} from './combat-timing.ts';

export interface AttackEvent {
  kind: 'attack';
  at: number;
  ms: number;
  step: number;
  impact: AttackImpact;
  /** Both minions were on the table before this step, so the attack is drawn. */
  shown: boolean;
  /** When the hits land. */
  contact: number;
}
export interface StepEvent { kind: 'deaths' | 'settle'; at: number; ms: number; step: number }
export interface PhaseEvent { kind: 'result' | 'heroVitals' | 'heroAttack' | 'heroDefeat' | 'hold'; at: number; ms: number }
export type CombatEvent = AttackEvent | StepEvent | PhaseEvent;

export interface CombatSchedule {
  events: CombatEvent[];
  /** When the minion fight ends and the result text shows. */
  minionsEnd: number;
  duration: number;
}

/** Hero values just before the combat, by combat side (0 = a, 1 = b). Null for a ghost. */
export type HeroSides = [HeroState | null, HeroState | null];

const changed = (a: HeroState, b: HeroState) => a.health !== b.health || a.armor !== b.armor;

/**
 * The heroes as the player last saw them before the combat. The server sends them with
 * the combat; older responses fall back to the snapshot before the action.
 */
export function startingHeroes(combat: Combat, before: GameSnapshot): HeroSides {
  if (combat.heroes_start) return combat.heroes_start;
  const friendly = friendlySide(combat, before.state.seat);
  const opponentId = friendly === 0 ? combat.b : combat.a;
  const opponent = before.state.opponents.find(p => p.id === opponentId) ?? null;
  return friendly === 0 ? [before.state.me, opponent] : [opponent, before.state.me];
}

export function combatSchedule(script: CombatScript, combat: Combat, starting: HeroSides): CombatSchedule {
  const events: CombatEvent[] = [];
  let at = 0;
  // Minions on the table before the current step: the previous step's resolved boards.
  let shown = new Set<number>();
  script.steps.forEach((step, i) => {
    for (const impact of step.impacts) {
      const drawn = shown.has(impact.from) && shown.has(impact.to);
      const ms = drawn ? ATTACK_MS : MISSING_ATTACK_MS;
      events.push({ kind: 'attack', at, ms, step: i, impact, shown: drawn, contact: at + (drawn ? ATTACK.lunge : 0) });
      at += ms;
    }
    if (step.deaths.length) {
      events.push({ kind: 'deaths', at, ms: DEATHS_MS, step: i });
      at += DEATHS_MS;
    }
    const wait = (i === 0 ? OPENING_MS : step.summons.length ? SUMMONS_MS : 0) + SETTLE_MS;
    events.push({ kind: 'settle', at, ms: wait, step: i });
    at += wait;
    shown = new Set([...step.friendly, ...step.enemy].map(m => m.eid));
  });
  const minionsEnd = at;
  events.push({ kind: 'result', at, ms: 0 });

  const before = combat.heroes_before ?? [null, null];
  if (before.some((hero, side) => hero && starting[side] && changed(starting[side]!, hero))) {
    events.push({ kind: 'heroVitals', at, ms: HERO.vitals });
    at += HERO.vitals;
  }
  const loser = 1 - combat.winner;
  // A tie or no damage ends here, and a defeated ghost has no hero to hit.
  if (combat.winner !== 2 && combat.damage > 0 && !(loser === 1 && combat.b === null)) {
    events.push({ kind: 'heroAttack', at, ms: HERO_ATTACK_MS });
    at += HERO_ATTACK_MS;
    const after = combat.heroes_after?.[loser];
    if (after && after.health <= 0) {
      events.push({ kind: 'heroDefeat', at, ms: HERO.defeat });
      at += HERO.defeat;
    }
  }
  events.push({ kind: 'hold', at, ms: RESULT_HOLD_MS });
  at += RESULT_HOLD_MS;
  return { events, minionsEnd, duration: at };
}

/**
 * Where a combat starts on this page's clock (`performance.now()`), from the server's
 * start time. The response took about half its round trip to arrive, so the server's
 * clock read `server_now + rtt / 2` when it was received. Without those fields it starts now.
 */
export function combatStart(snapshot: GameSnapshot, combat: Combat, now = performance.now()): number {
  const client = snapshot.client;
  if (combat.started_at === undefined || snapshot.server_now === undefined || !client) return now;
  const elapsed = Math.max(0, snapshot.server_now - combat.started_at + client.rtt / 2);
  return client.received - elapsed;
}
