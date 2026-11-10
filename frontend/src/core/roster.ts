/** Standings: living players by health plus armor, highest first; eliminated players last. Ties keep their order. */
export function ranked<T extends { health: number; armor: number; alive: boolean }>(players: T[]): T[] {
  const total = (p: T) => p.alive ? p.health + p.armor : -Infinity;
  return players.map((p, i) => ({ p, i }))
    .sort((a, b) => total(b.p) - total(a.p) || a.i - b.i)
    .map(({ p }) => p);
}
