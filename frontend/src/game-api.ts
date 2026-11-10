import type { Warband } from './core/warband';
/** Local player protocol. Submit an object from the current snapshot's legal_actions. */
export type Action =
  | { kind: 'end_turn' | 'refresh' | 'freeze' | 'upgrade' | 'dark_gift' | 'cancel' }
  | { kind: 'choose'; option: number }
  | { kind: 'target'; target_id: number }
  | { kind: 'hero_power'; slot: number }
  | { kind: 'buy'; shop_id: number }
  | { kind: 'activate' | 'sell'; entity_id: number }
  | { kind: 'cast'; hand_id: number }
  | { kind: 'play'; hand_id: number; position: number }
  | { kind: 'move'; entity_id: number; position: number }
  | { kind: 'magnetize'; hand_id: number; target_id: number };

export interface Card {
  id: string;
  name_zh: string;
  text_zh: string;
  /** English rules text; marks such as Deathrattle are read from it. */
  text?: string;
  type?: string;
  /** Engine keyword flags in effect now, such as TAUNT or REBORN. */
  keywords?: string[] | null;
  /** On hand spells: casting opens a target choice. */
  targeted?: boolean;
  /** Engine card kind, such as minion, tavern_spell or dark_gift. */
  kind?: string;
  /** Cards attached to a minion, such as its Dark Gift. */
  attached?: Card[];
  /** A tripled minion. */
  golden?: boolean;
  tier?: number;
  eid?: number;
  shield_hits?: number;
  costs_health?: boolean;
  atk?: number;
  hp?: number;
}
export interface Minion extends Card {
  eid: number;
  atk: number;
  hp: number;
  keywords: string[];
  shield_hits: number;
}
export interface AttackImpact {
  from: number;
  to: number;
  hits: { target: number; damage: number; hp: number; shield_hits: number; absorbed: boolean; lethal: boolean }[];
}

export interface HeroState {
  hero: Card | null;
  health: number;
  armor: number;
  tier: number;
}
export interface Combat {
  turn: number;
  a: number;
  b: number | null;
  winner: 0 | 1 | 2;
  damage: number;
  heroes_before?: [HeroState | null, HeroState | null];
  heroes_after?: [HeroState | null, HeroState | null];
  truncated: boolean;
  frames: { boards: [Minion[], Minion[]]; attacks: [number, number][]; impacts?: AttackImpact[] }[];
}
export interface GameSnapshot {
  game_id: string;
  version: number;
  legal_actions: Action[];
  combat: Combat | null;
  state: {
    seat: number;
    phase: 'hero_select' | 'recruit' | 'game_over';
    turn: number;
    me: {
      alive: boolean;
      placement: number;
      hero: Card | null;
      hero_powers: Card[];
      health: number;
      armor: number;
      gold: number;
      tier: number;
      frozen: boolean;
      upgrade_price: number;
      refresh_price: number;
      casting: number | null;
      board: Minion[];
      shop: (Card & { sid: number; frozen?: boolean; price: number | null })[];
      hand: (Card & { hid: number })[];
      pending: { kind: string; source?: Card; options?: Card[]; targets?: number[]; leave?: number } | null;
      dark_gift?: { available: boolean; uses: number; max_uses: number; cost: number; unlock_turn: number };
      trinkets?: Card[];
      win_streak?: number;
      warband?: Warband;
    };
    opponents: (HeroState & {
      id: number; alive: boolean; placement?: number; win_streak?: number; last_damage?: number;
      is_next_opponent?: boolean; hero_powers?: Card[]; trinkets?: Card[]; warband?: Warband;
    })[];
  };
}

export interface ActionRequest {
  request_id: string;
  version: number;
  action: Action;
}
export type ActionResult = GameSnapshot & { request_id: string } & (
  | { ok: true }
  | { ok: false; error: { code: 'illegal_action' | 'stale_version' | 'duplicate_request' | 'engine_error'; applied_version?: number } }
);

export async function createGame(scenario?: string): Promise<GameSnapshot> {
  const response = await fetch('/api/games' + (scenario === undefined ? '' : '?scenario=' + encodeURIComponent(scenario)), { method: 'POST' });
  if (!response.ok) throw new Error('Create game failed: ' + response.status);
  return response.json();
}

export async function readGame(gameId: string): Promise<GameSnapshot> {
  const response = await fetch('/api/games/' + encodeURIComponent(gameId));
  if (!response.ok) throw new Error('Read game failed: ' + response.status);
  return response.json();
}

/** Reuse the returned request (including its ID and version) on a network retry. */
export function makeRequest(snapshot: GameSnapshot, action: Action): ActionRequest {
  return { request_id: crypto.randomUUID(), version: snapshot.version, action };
}

export async function submitAction(gameId: string, request: ActionRequest): Promise<ActionResult> {
  const response = await fetch('/api/games/' + encodeURIComponent(gameId) + '/actions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request),
  });
  const result = await response.json();
  if (!response.ok && result.ok !== false) throw new Error('Action request failed: ' + response.status);
  return result;
}
