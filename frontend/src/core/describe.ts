// Renderer-independent card text for tooltips and choice panels.
import type { Card } from '../game-api';

/** The name and rules text, then one line per attached card such as a Dark Gift. */
export function describe(card: Card): string[] {
  const own = [card.name_zh, card.text_zh].filter(Boolean).join(' · ');
  const attached = (card.attached ?? []).map(a =>
    (a.kind === 'dark_gift' ? '黑暗之赐' : '附加') + ' · ' + [a.name_zh, a.text_zh].filter(Boolean).join('：'));
  return [own, ...attached];
}

/**
 * The two modes of a Choose One card, read from its text ("抉择：A；或者B。"). The engine
 * offers the same card twice, so the text is the only description of each option.
 */
export function chooseOneModes(text: string): [string, string] | undefined {
  const body = text.replace(/^\s*抉择[：:]\s*/, '');
  const split = body.indexOf('；或者');
  if (split < 0 || body === text) return;
  const tidy = (s: string) => s.replace(/[。.]\s*$/, '').trim();
  const first = tidy(body.slice(0, split));
  let second = tidy(body.slice(split + 3));
  // "使一个随从获得+3/+1；或者+1/+3": the second mode shares the first one's lead-in.
  const lead = first.indexOf('获得');
  if (/^[+\d]/.test(second) && lead >= 0) second = first.slice(0, lead + 2) + second;
  return [first, second];
}
