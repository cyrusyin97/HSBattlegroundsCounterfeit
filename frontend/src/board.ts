import './board.css';
import { createGame, readGame, ServerBusy, type Action, type Card, type GameSnapshot } from './game-api';
import { withCardImage } from './demo-art';
import { badge, boardScale, byId, localPoint } from './pieces';
import { playCombat } from './combat';
import { animateHeroVitals, renderHeroPanel } from './hero-effects';
import { matchAction } from './core/intents';
import { combatSchedule, combatStart, startingHeroes } from './core/combat-timeline';
import { combatScript } from './core/combat-script';
import { chooseOneModes, describe } from './core/describe';
import { ranked } from './core/roster';
import { warbandType } from './core/warband';
import { cardName, cardText, initLocale, LANGUAGE_NAMES, LOCALES, locale, setLocale, t, type Locale } from './i18n';
import { execute } from './core/session';
import { createThreeView } from './three/view';
import { isShopAction, type CardView, type Transition, type ViewHost } from './view';

const table = byId('table'), status = byId('status'), scene = byId('scene') as HTMLSelectElement;
const language = byId('language') as HTMLSelectElement;
let snapshot: GameSnapshot;
let busy = false;
let spell: Card | undefined;
let view: CardView;
/** What opened the pending target choice, so its arrow starts there. */
let aimFrom: { zone: 'hand' | 'board'; id: number } | { power: number } | undefined;
/** The choice panel is folded to its title so the table stays visible. */
let folded = false;
const match = (kind: Action['kind'], fields?: Record<string, number>) => matchAction(snapshot, kind, fields);
const message = (s: string) => { status.textContent = s; };
const host: ViewHost = {
  get snapshot() { return snapshot; },
  get busy() { return busy; },
  commit: action => commit(action),
  message,
  tooltip: (card, x = 0, y = 0) => showTip(card && describe(card).join('\n'), x, y),
};

/** Shows `text` in the tooltip at a board coordinate, or hides it. A wide tip holds a player summary. */
function showTip(text: string | undefined, x = 0, y = 0, wide = false) {
  const tip = byId('tooltip');
  tip.hidden = !text;
  if (!text) return;
  tip.textContent = text;
  tip.classList.toggle('wide', wide);
  tip.style.left = Math.min(x+9,wide?1030:1180)+'px'; tip.style.top = Math.min(y,wide?480:615)+'px';
}

/** Hover or focus on a HUD control shows its explanation below it, or to its right. */
function explain(el: HTMLElement, text: string, side: 'below' | 'right' = 'below') {
  el.setAttribute('aria-description', text);
  const show = () => {
    const r = el.getBoundingClientRect();
    if (side === 'right') {
      const p = localPoint(r.right, r.top);
      return showTip(text, p.x + 8, Math.max(0, p.y - 20), true);
    }
    const p = localPoint(r.left, r.bottom);
    showTip(text, Math.max(0, p.x - 9), p.y + 6);
  };
  el.addEventListener('pointerenter', show);
  el.addEventListener('focus', show);
  el.addEventListener('pointerleave', () => showTip(undefined));
  el.addEventListener('blur', () => showTip(undefined));
}

function lock(value: boolean) {
  busy = value;
  scene.disabled = value;
  language.disabled = value;
  (byId('restart') as HTMLButtonElement).disabled = value;
  for (const id of ['tools','end','choices','hero']) byId(id).inert = value;
}
function clearArrow() { byId('curve').removeAttribute('d'); }
/** The arrow starts at whatever opened the target choice: a hand card, a minion or a hero power. */
function arrowStart() {
  if (aimFrom && 'power' in aimFrom) {
    const button = byId('hero').querySelector(`[data-slot="${aimFrom.power}"]`);
    if (button) {
      const r = button.getBoundingClientRect();
      return localPoint(r.left + r.width / 2, r.top);
    }
  }
  return view.castOrigin(aimFrom && !('power' in aimFrom) ? aimFrom : undefined) ?? { x: 770, y: 685 };
}
function drawArrow(x: number, y: number) {
  const start = arrowStart();
  // Bow the curve upward by a quarter of its length, whichever way it points.
  const bow = Math.hypot(x - start.x, y - start.y) / 4;
  const cx = (start.x + x) / 2, cy = Math.min(start.y, y) - bow;
  byId('curve').setAttribute('d', 'M ' + start.x + ' ' + start.y + ' Q ' + cx + ' ' + cy + ' ' + x + ' ' + y);
}
async function commit(action: Action) {
  if (busy || !snapshot.legal_actions.includes(action)) return;
  const before = snapshot;
  if (action.kind === 'cast') spell = before.state.me.hand.find(c => c.hid === action.hand_id);
  if (action.kind === 'cast') aimFrom = { zone: 'hand', id: action.hand_id };
  else if (action.kind === 'activate') aimFrom = { zone: 'board', id: action.entity_id };
  else if (action.kind === 'hero_power') aimFrom = { power: action.slot };
  lock(true); clearArrow(); host.tooltip();
  message(t().status.resolving);
  try {
    const { snapshot: result, note, combat, hero } = await execute(before, action);
    if (combat) await playCombat(combat, before, view, combatStart(result, combat));
    snapshot = result;
    render(note ? undefined : { action, before });
    if (hero) await animateHeroVitals(byId('hero'), hero, result.state.me);
    if (!note && isShopAction(action.kind)) {
      byId('tools').querySelector(`[data-action="${action.kind}"]`)?.animate(
        [{transform:'perspective(450px) translateZ(-18px) rotateX(16deg)'},{transform:'none'}], 340);
      await view.shopEffect(action.kind, before, result);
    }
    if (note) message(note);
  } catch {
    message(t().status.disconnected);
  } finally { lock(false); }
}
function control(parent: string, label: string, action?: Action) {
  const btn = document.createElement('button');
  btn.className = 'control'; btn.textContent = label; btn.disabled = !action;
  if (action) btn.onclick = () => void commit(action);
  byId(parent).append(btn);
  return btn;
}

const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l3 7 7.5.6-5.7 4.8 1.8 7.3L12 17.8l-6.6 3.9 1.8-7.3L1.5 9.6 9 9z" fill="#ffd34d" stroke="#7a4a10" stroke-width="1.2"/></svg>';

type Player = GameSnapshot['state']['opponents'][number];

/** The public facts about one player: standing, tier, form, warband, hero power and trinkets. */
function summary(s: Player, rank: number) {
  const m = t().player;
  const you = s.id === snapshot.state.seat;
  const tags = [you && m.you, s.is_next_opponent && m.next, !s.alive && m.out].filter((tag): tag is string => !!tag);
  const form = [s.win_streak ? m.streak(s.win_streak) : '', s.last_damage ? m.lastCombat(s.last_damage) : ''].filter(Boolean);
  return [
    m.header(rank, heroName(s), tags),
    m.stats(s.tier, s.health, s.armor),
    form.join(' · '),
    s.warband?.size ? m.warband(warbandType(s.warband)!, s.warband.size) : m.noWarband,
    ...(s.hero_powers ?? []).map(p => m.power(cardName(p), cardText(p))),
    ...(s.trinkets?.length ? s.trinkets.map(c => m.trinket(cardName(c), cardText(c))) : [m.noTrinket]),
  ].filter(Boolean).join('\n');
}

const heroName = (s: Player) => (s.hero ? cardName(s.hero) : '') || t().player.picking;

/** A roster entry: rank, hero portrait, armor and health. Hover or focus shows the player's summary. */
function seat(s: Player, rank: number) {
  const you = s.id === snapshot.state.seat;
  const el = badge('seat' + (you ? ' you' : '') + (s.alive ? '' : ' out') + (s.is_next_opponent ? ' next' : ''), '');
  el.dataset.id = String(s.id);
  el.tabIndex = 0;
  el.setAttribute('role', 'img');
  const tribe = s.alive && s.warband ? warbandType(s.warband) : undefined;
  el.ariaLabel = t().player.label(rank, you, heroName(s), s.armor, s.health, tribe);
  const face = badge('seat-face', '');
  if (s.hero) withCardImage(s.hero.id, img => { img.alt = ''; face.append(img); });
  el.append(badge('seat-rank', rank), face, badge('seat-armor', s.armor), badge('seat-health', s.health));
  if (tribe) el.append(badge('seat-tribe' + (tribe === t().tribeMixed ? ' mixed' : ''), tribe));
  explain(el, summary(s, rank), 'right');
  return el;
}

/** Rebuilds the roster in standings order; a player whose rank changed slides from its old row. */
function standings() {
  const seats = byId('seats');
  const was = new Map([...seats.children].map(el => [(el as HTMLElement).dataset.id, el.getBoundingClientRect().top]));
  const { me, seat: id, opponents } = snapshot.state;
  const roster: Player[] = [{ id, hero: me.hero, health: me.health, armor: me.armor, alive: me.alive, tier: me.tier,
    placement: me.placement, win_streak: me.win_streak, hero_powers: me.hero_powers, trinkets: me.trinkets, warband: me.warband }, ...opponents];
  // Eliminated players keep the place they finished in.
  seats.replaceChildren(...ranked(roster).map((p, i) => seat(p, p.alive || !p.placement ? i + 1 : p.placement)));
  const scale = boardScale();
  for (const el of seats.children as HTMLCollectionOf<HTMLElement>) {
    const top = was.get(el.dataset.id);
    const dy = top === undefined ? 0 : (top - el.getBoundingClientRect().top) / scale;
    if (dy) el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }],
      { duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 450, easing: 'ease-in-out' });
  }
}

function render(transition?: Transition) {
  const { me, turn, phase } = snapshot.state;
  clearArrow();
  for (const id of ['tools','end','hero','choices']) byId(id).replaceChildren();
  host.tooltip();
  table.classList.remove('in-combat');
  byId('enemy-hero').hidden = true;
  byId('hero').classList.remove('hero-defeated');
  byId('enemy-hero').classList.remove('hero-defeated');
  const m = t();
  byId('phase').textContent = (phase === 'hero_select' ? m.phase.heroSelect : (!me.alive || phase==='game_over') ? m.phase.over : m.phase.recruit)(turn);
  byId('gold').textContent = m.gold(me.gold);
  standings();
  const tier = byId('tier');
  tier.innerHTML = STAR.repeat(me.tier);
  tier.ariaLabel = m.tier(me.tier);
  if (me.hero) {
    const parent = byId('hero');
    renderHeroPanel(parent, me);
    me.hero_powers.forEach((p,i) => {
      const button = control('hero',cardName(p),match('hero_power',{slot:i}));
      button.dataset.slot = String(i);
      explain(button, m.card.line(cardName(p), cardText(p)));
    });
  }
  view.render(transition);
  control('tools',m.tools.upgrade(me.upgrade_price),match('upgrade')).dataset.action='upgrade';
  control('tools',m.tools.refresh(me.refresh_price),match('refresh')).dataset.action='refresh';
  control('tools',me.frozen?m.tools.unfreeze:m.tools.freeze,match('freeze')).dataset.action='freeze';
  const gift = me.dark_gift;
  if (gift && match('dark_gift')) {
    explain(control('tools',m.tools.darkGift(gift.cost),match('dark_gift')), m.tools.darkGiftHelp(gift.cost, gift.max_uses-gift.uses, gift.max_uses));
  }
  control('end',m.tools.endTurn,match('end_turn'));
  if (match('cancel')) control('end',m.tools.cancel,match('cancel'));
  const choosing = snapshot.legal_actions.filter(a=>a.kind==='choose');
  const panel = byId('choices');
  panel.hidden = !choosing.length;
  // A new choice opens unfolded; folding lasts until it is answered.
  if (!choosing.length) folded = false;
  panel.classList.toggle('folded', folded);
  if (choosing.length) {
    const pending = me.pending;
    // Choose One offers the same card twice; its text names the two modes.
    const modes = pending?.kind === 'choose_one' && pending.source ? chooseOneModes(cardText(pending.source)) : undefined;
    const title = phase === 'hero_select' ? m.choice.heroSelect
      : modes ? m.choice.chooseOne(pending?.source ? cardName(pending.source) : '')
      : pending?.source?.kind === 'dark_gift' ? m.choice.darkGift : m.choice.generic;
    const head = badge('choice-head', '');
    const fold = document.createElement('button');
    fold.className = 'fold';
    const label = () => {
      fold.textContent = folded ? m.choice.unfold : m.choice.fold;
      fold.ariaExpanded = String(!folded);
      panel.classList.toggle('folded', folded);
    };
    label();
    fold.onclick = () => { folded = !folded; label(); };
    head.append(badge('choice-title', title), fold);
    panel.append(head);
    for (const a of choosing) {
      const c = pending?.options?.[a.option];
      const btn = control('choices', '', a);
      btn.classList.add('choice');
      if (modes) {
        btn.append(badge('choice-name', m.choice.mode(a.option)), badge('choice-text', modes[a.option] ?? ''));
      } else if (c) {
        const attached = describe(c).slice(1);
        btn.append(badge('choice-name', cardName(c)), badge('choice-text', [cardText(c), ...attached].filter(Boolean).join('\n')));
        withCardImage(c.id, img => { img.className = 'full'; btn.prepend(img); });
      } else btn.append(badge('choice-name', m.choice.option(a.option + 1)));
    }
  }
  if (me.pending?.kind === 'target') {
    const hand = new Set(me.hand.map(c => c.hid));
    if (me.pending.targets?.length && me.pending.targets.every(t => hand.has(t))) {
      message(m.status.discard);
    } else {
      const casting = me.hand.find(c=>c.hid===me.casting) ?? spell;
      message([casting && cardName(casting), casting && cardText(casting), m.status.target].filter(Boolean).join(m.status.join));
    }
  } else {
    spell=undefined;
    aimFrom=undefined;
    message(!me.alive || phase==='game_over' ? m.status.over(me.placement) : m.status.idle);
  }
}
document.addEventListener('pointermove', e => {
  if (busy || !snapshot || snapshot.state.me.pending?.kind !== 'target') return;
  const p = localPoint(e.clientX,e.clientY); drawArrow(p.x,p.y);
});
document.addEventListener('keydown',e=>{if(e.key==='Escape' && snapshot && !busy){const a=match('cancel');if(a)void commit(a);}});
// Right-click cancels a pending choice such as spell targeting; the table never shows a context menu.
table.addEventListener('contextmenu',e=>{e.preventDefault();if(snapshot && !busy){const a=match('cancel');if(a)void commit(a);}});
/** The game this browser last played, so a page refresh resumes it while the server keeps it. */
const SAVED_GAME = 'battlegrounds.game';
function remembered() { try { return localStorage.getItem(SAVED_GAME); } catch { return null; } }
function remember(id: string) { try { localStorage.setItem(SAVED_GAME, id); } catch { /* private mode */ } }

async function start(resume = false) {
  if(busy)return;
  lock(true); message(t().status.loading);
  try {
    const saved = resume ? remembered() : null;
    // A game the server no longer has (finished and cleaned up, or never saved) starts a new one.
    const resumed = saved ? await readGame(saved).catch(() => undefined) : undefined;
    snapshot = resumed ?? await createGame(scene.value==='random'?undefined:scene.value);
    remember(snapshot.game_id); spell=undefined; render();
    // A reload during a combat picks the combat up where the server's clock says it is.
    if (resumed?.combat && combatRunning(resumed, resumed.combat)) {
      await playCombat(resumed.combat, resumed, view, combatStart(resumed, resumed.combat));
      render();
    }
  }
  catch (error) {message(error instanceof ServerBusy ? t().status.full : t().status.offline);}
  finally {lock(false);}
}
/** The combat started on the server and its schedule has not ended yet. */
function combatRunning(s: GameSnapshot, combat: NonNullable<GameSnapshot['combat']>) {
  if (combat.started_at === undefined) return false;
  const schedule = combatSchedule(combatScript(combat, s.state.seat), combat, startingHeroes(combat, s));
  return performance.now() - combatStart(s, combat) < schedule.duration;
}
function resize(){const scale=boardScale();table.style.setProperty('--scale',String(scale));view.resize(scale);}

/** Text that lives in the page shell rather than in a render: menus and landmark names. */
function applyShellText() {
  const m = t();
  table.ariaLabel = m.board;
  scene.ariaLabel = m.menu.newGame;
  for (const option of scene.options) option.textContent = m.scenarios[option.value] ?? option.value;
  const restart = byId('restart');
  restart.textContent = m.menu.restart;
  restart.title = m.menu.restartTitle;
  language.ariaLabel = m.menu.language;
  byId('seats').ariaLabel = m.regions.roster;
  byId('hero').ariaLabel = m.regions.hero;
  byId('enemy-hero').ariaLabel = m.regions.enemyHero;
}

/** Switching language redraws the shell and the current snapshot; the game keeps going. */
function switchLanguage(next: Locale) {
  setLocale(next);
  applyShellText();
  if (snapshot && !busy) render();
}

initLocale();
language.replaceChildren(...LOCALES.map(code => new Option(LANGUAGE_NAMES[code], code, false, code === locale())));
language.onchange = () => switchLanguage(language.value as Locale);
applyShellText();
const params=new URLSearchParams(location.search);
const initial=params.get('scenario');
if (initial && [...scene.options].some(o=>o.value===initial))scene.value=initial;
view = createThreeView(host);
scene.onchange=()=>void start();byId('restart').onclick=()=>void start();
// A scenario in the address starts that scenario; otherwise the last game resumes.
window.addEventListener('resize',resize);resize();void start(!initial);
