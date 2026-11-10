import { t, tribeName } from '../i18n/index.ts';

export interface Warband { size: number; races: Record<string, number> }

/**
 * A warband's tribe in one word: the tribe with the most minions once it holds at least
 * two-fifths of the warband, two tribes tied for that lead as
 * "A/B", and otherwise mixed. Undefined for an empty warband; "no tribe" when no minion has one.
 * Names come from the active catalog.
 */
export function warbandType({ size, races }: Warband): string | undefined {
  if (!size) return;
  const counts = Object.entries(races);
  if (!counts.length) return t().tribeNone;
  const top = Math.max(...counts.map(([, n]) => n));
  const leaders = counts.filter(([, n]) => n === top).map(([race]) => tribeName(race));
  return top >= Math.ceil(size * 0.4) && leaders.length <= 2 ? leaders.join('/') : t().tribeMixed;
}
