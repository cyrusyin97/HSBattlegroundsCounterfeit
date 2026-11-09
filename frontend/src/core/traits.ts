// Renderer-independent reading of the keyword effects a card shows on the table.
import type { Card } from '../game-api';

/** Effects with their own table presentation. */
export type Aura = 'taunt' | 'shield' | 'stealth';
/** Effects shown as marks on the card face. */
export type Mark = 'deathrattle' | 'windfury' | 'reborn' | 'venomous' | 'cleave';

export interface Traits { auras: Set<Aura>; marks: Mark[] }

const MARKS: [Mark, (kw: Set<string>, card: Card) => boolean][] = [
  // Deathrattle is printed text, not a runtime engine flag. The colon tells the
  // keyword apart from mentions such as "a friendly Deathrattle minion".
  ['deathrattle', (_, card) => /(^|[.\s])Deathrattle:/.test(card.text ?? '')],
  ['windfury', kw => kw.has('WINDFURY') || kw.has('MEGA_WINDFURY')],
  ['reborn', kw => kw.has('REBORN')],
  ['venomous', kw => kw.has('VENOMOUS') || kw.has('POISONOUS')],
  ['cleave', kw => kw.has('CLEAVE')],
];

export function traits(card: Card): Traits {
  const kw = new Set(card.keywords ?? []);
  const auras = new Set<Aura>();
  if (kw.has('TAUNT')) auras.add('taunt');
  // shield_hits tracks the shield during combat, after the flag list was taken.
  if ((card.shield_hits ?? (kw.has('DIVINE_SHIELD') ? 1 : 0)) > 0) auras.add('shield');
  if (kw.has('STEALTH')) auras.add('stealth');
  return { auras, marks: MARKS.filter(([, test]) => test(kw, card)).map(([mark]) => mark) };
}
