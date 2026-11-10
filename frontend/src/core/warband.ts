/** Chinese tribe names, keyed by the engine's race codes. */
export const RACE_ZH: Record<string, string> = {
  BEAST: '野兽', DEMON: '恶魔', DRAGON: '龙', ELEMENTAL: '元素', MECHANICAL: '机械', MURLOC: '鱼人',
  NAGA: '纳迦', PIRATE: '海盗', QUILBOAR: '野猪人', UNDEAD: '亡灵', ABERRATION: '畸变怪',
};

export interface Warband { size: number; races: Record<string, number> }

/**
 * A warband's tribe in one word: the tribe with the most minions once it holds at least
 * two-fifths of the warband, two tribes tied for that lead as
 * "A/B", and otherwise 混合. Undefined for an empty warband; 无种族 when no minion has a tribe.
 */
export function warbandType({ size, races }: Warband): string | undefined {
  if (!size) return;
  const counts = Object.entries(races);
  if (!counts.length) return '无种族';
  const top = Math.max(...counts.map(([, n]) => n));
  const leaders = counts.filter(([, n]) => n === top).map(([race]) => RACE_ZH[race] ?? race);
  return top >= Math.ceil(size * 0.4) && leaders.length <= 2 ? leaders.join('/') : '混合';
}
