// The UI language: which locale is active, its message catalog, and card text in that
// language. Resolution is pure; only initLocale and setLocale touch the page.
import type { Card } from '../game-api';
import { en } from './en.ts';
import { zhCN, type Messages } from './zh-CN.ts';
import { zhTW } from './zh-TW.ts';

export type Locale = 'en' | 'zh-CN' | 'zh-TW';
export type { Messages };
export const LOCALES: readonly Locale[] = ['en', 'zh-CN', 'zh-TW'];
/** Each language named in itself, for the language menu. */
export const LANGUAGE_NAMES: Record<Locale, string> = { en: 'English', 'zh-CN': '简体中文', 'zh-TW': '繁體中文' };
export const CATALOGS: Record<Locale, Messages> = { en, 'zh-CN': zhCN, 'zh-TW': zhTW };
const STORE_KEY = 'locale';

const isLocale = (value: unknown): value is Locale => LOCALES.includes(value as Locale);

/** The locale for one BCP 47 tag: Traditional regions and scripts to zh-TW, other Chinese to zh-CN. */
export function matchLanguage(tag: string): Locale | undefined {
  const lower = tag.toLowerCase();
  if (!lower.startsWith('zh')) return lower.startsWith('en') ? 'en' : undefined;
  return /^zh(-hant|-(tw|hk|mo)\b)/.test(lower) ? 'zh-TW' : 'zh-CN';
}

/** Query parameter, then the saved choice, then the browser's languages, then English. */
export function resolveLocale(query: string | null, stored: string | null, languages: readonly string[]): Locale {
  if (isLocale(query)) return query;
  if (isLocale(stored)) return stored;
  for (const tag of languages) {
    const match = matchLanguage(tag);
    if (match) return match;
  }
  return 'en';
}

let current: Locale = 'zh-CN';

export const locale = () => current;
/** The active catalog. Read it at render time so a language switch takes effect on the next render. */
export const t = () => CATALOGS[current];

function stored() {
  try { return localStorage.getItem(STORE_KEY); } catch { return null; }
}

export function initLocale() {
  setLocale(resolveLocale(new URLSearchParams(location.search).get('lang'), stored(), navigator.languages ?? []), false);
}

export function setLocale(next: Locale, remember = true) {
  current = next;
  document.documentElement.lang = next;
  document.title = t().title;
  if (remember) try { localStorage.setItem(STORE_KEY, next); } catch { /* a convenience only */ }
}

/** The card's name in the active language, falling back to another language when a field is missing. */
export function cardName(card: Pick<Card, 'name' | 'name_zh' | 'name_tw'>, lang = current) {
  return pick(lang, card.name, card.name_zh, card.name_tw);
}

/** The card's rules text in the active language, with the same fallbacks as cardName. */
export function cardText(card: Pick<Card, 'text' | 'text_zh' | 'text_tw'>, lang = current) {
  return pick(lang, card.text, card.text_zh, card.text_tw);
}

function pick(lang: Locale, english?: string, simplified?: string, traditional?: string) {
  const order = lang === 'en' ? [english, simplified] : lang === 'zh-TW' ? [traditional, simplified, english] : [simplified, english];
  return order.find(Boolean) ?? '';
}

/** The UI font stack for a locale; the canvas card faces use it so they match the HUD. */
export function fontStack(lang = current) {
  if (lang === 'en') return 'system-ui,-apple-system,"Segoe UI",sans-serif';
  return lang === 'zh-TW' ? '"PingFang TC","Microsoft JhengHei",sans-serif' : '"PingFang SC","Microsoft YaHei",sans-serif';
}

/** A tribe name for an engine race code. */
export const tribeName = (race: string) => t().tribes[race] ?? race;
