// Renderer-independent card text for tooltips and choice panels, in the UI language.
import type { Card } from '../game-api';
import { cardName, cardText, t, type Messages } from '../i18n/index.ts';

/** The name and rules text, then one line per attached card such as a Dark Gift. */
export function describe(card: Card): string[] {
  const m = t().card;
  const attached = (card.attached ?? []).map(a => m.attached(a.kind === 'dark_gift', cardName(a), cardText(a)));
  return [m.line(cardName(card), cardText(card)), ...attached];
}

/**
 * The two modes of a Choose One card, read from its text in the UI language, such as
 * "Choose One - A; or B." or "抉择：A；或者B。". The engine offers the same card twice, so
 * the text is the only description of each option.
 */
export function chooseOneModes(text: string, pattern: Messages['chooseOne'] = t().chooseOne): [string, string] | undefined {
  const body = text.replace(pattern.prefix, '');
  const split = body.indexOf(pattern.separator);
  if (split < 0 || body === text) return;
  const tidy = (s: string) => s.replace(/[。.]\s*$/, '').trim();
  const first = tidy(body.slice(0, split));
  let second = tidy(body.slice(split + pattern.separator.length));
  // "Give a minion +3/+1; or +1/+3": a second mode that starts with a number shares the
  // first mode's lead-in, up to where its numbers begin.
  const lead = first.search(/[+\d]/);
  if (/^[+\d]/.test(second) && lead > 0) second = first.slice(0, lead) + second;
  return [first, second];
}
