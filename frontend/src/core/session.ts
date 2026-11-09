// Command submission without presentation. The caller locks input, then plays the
// returned combat and effects before rendering the authoritative snapshot.
import { makeRequest, readGame, submitAction, type Action, type Combat, type GameSnapshot, type HeroState } from '../game-api';
import { heroBaseline, newCombat } from './replay';

export interface Outcome {
  snapshot: GameSnapshot;
  /** Non-empty when the action did not apply and the board was resynchronized. */
  note: string;
  combat: Combat | null;
  hero: HeroState | null | undefined;
}

export async function execute(before: GameSnapshot, action: Action): Promise<Outcome> {
  let snapshot: GameSnapshot;
  let note = '';
  try {
    const response = await submitAction(before.game_id, makeRequest(before, action));
    snapshot = response;
    if (!response.ok) note = '操作未生效，已同步棋盘';
  } catch {
    snapshot = await readGame(before.game_id);
    note = '已重新读取对局状态';
  }
  const combat = newCombat(before, snapshot);
  return { snapshot, note, combat, hero: heroBaseline(before, combat) };
}
