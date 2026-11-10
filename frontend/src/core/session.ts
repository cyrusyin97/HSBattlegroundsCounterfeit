// Command submission without presentation. The caller locks input, then plays the
// returned combat and effects before rendering the authoritative snapshot.
import { makeRequest, readGame, submitAction, type Action, type Combat, type GameSnapshot, type HeroState } from '../game-api';
import { heroBaseline, newCombat } from './replay';
import { t } from '../i18n';

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
    if (!response.ok) note = t().status.rejected;
  } catch {
    snapshot = await readGame(before.game_id);
    note = t().status.resynced;
  }
  const combat = newCombat(before, snapshot);
  return { snapshot, note, combat, hero: heroBaseline(before, combat) };
}
