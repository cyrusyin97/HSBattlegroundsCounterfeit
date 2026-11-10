import './board.css';
import { createGame, type Action, type Card, type GameSnapshot } from './game-api';
import { loadCardImage } from './demo-art';
import { badge, boardScale, byId, localPoint } from './pieces';
import { playCombat } from './combat';
import { animateHeroVitals, renderHeroPanel } from './hero-effects';
import { matchAction } from './core/intents';
import { chooseOneModes, describe } from './core/describe';
import { ranked } from './core/roster';
import { execute } from './core/session';
import { createThreeView } from './three/view';
import { isShopAction, type CardView, type Transition, type ViewHost } from './view';

const table = byId('table'), status = byId('status'), scene = byId('scene') as HTMLSelectElement;
let snapshot: GameSnapshot;
let busy = false;
let spell: Card | undefined;
let view: CardView;
const match = (kind: Action['kind'], fields?: Record<string, number>) => matchAction(snapshot, kind, fields);
const message = (s: string) => { status.textContent = s; };
const host: ViewHost = {
  get snapshot() { return snapshot; },
  get busy() { return busy; },
  commit: action => commit(action),
  message,
  tooltip: (card, x = 0, y = 0) => showTip(card && describe(card).join('\n'), x, y),
};

/** Shows `text` in the tooltip at a board coordinate, or hides it. */
function showTip(text: string | undefined, x = 0, y = 0) {
  const tip = byId('tooltip');
  tip.hidden = !text;
  if (!text) return;
  tip.textContent = text;
  tip.style.left = Math.min(x+9,1180)+'px'; tip.style.top = Math.min(y,615)+'px';
}

/** Hover or focus on a HUD control shows its explanation beside it. */
function explain(el: HTMLElement, text: string) {
  el.setAttribute('aria-description', text);
  const show = () => {
    const r = el.getBoundingClientRect();
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
  (byId('restart') as HTMLButtonElement).disabled = value;
  for (const id of ['tools','end','choices','hero']) byId(id).inert = value;
}
function clearArrow() { byId('curve').removeAttribute('d'); }
function drawArrow(x: number, y: number) {
  const start = view.castOrigin() ?? { x: 770, y: 685 };
  byId('curve').setAttribute('d', 'M ' + start.x + ' ' + start.y + ' Q ' + (start.x+105) + ' ' + (y+20) + ' ' + x + ' ' + y);
}
async function commit(action: Action) {
  if (busy || !snapshot.legal_actions.includes(action)) return;
  const before = snapshot;
  if (action.kind === 'cast') spell = before.state.me.hand.find(c => c.hid === action.hand_id);
  lock(true); clearArrow(); host.tooltip();
  message('正在结算…');
  try {
    const { snapshot: result, note, combat, hero } = await execute(before, action);
    if (combat) await playCombat(combat, before, script => view.playCombat(script));
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
    message('连接中断，请检查服务后重试');
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

/** A roster entry: hero portrait with armor and health. The name is in the title only. */
function seat(s: { id: number; hero: Card | null; health: number; armor: number; alive: boolean }) {
  const you = s.id === snapshot.state.seat;
  const el = badge('seat' + (you ? ' you' : '') + (s.alive ? '' : ' out'), '');
  el.dataset.id = String(s.id);
  el.title = (you ? '你 · ' : '') + (s.hero?.name_zh || '选将中') + (s.alive ? '' : ' · 出局');
  el.setAttribute('role', 'img');
  el.ariaLabel = el.title + '，护甲 ' + s.armor + '，生命 ' + s.health;
  const face = badge('seat-face', '');
  if (s.hero) void loadCardImage(s.hero.id).then(img => { img.alt = ''; face.append(img); });
  el.append(face, badge('seat-armor', s.armor), badge('seat-health', s.health));
  return el;
}

/** Rebuilds the roster in standings order; a player whose rank changed slides from its old row. */
function standings() {
  const seats = byId('seats');
  const was = new Map([...seats.children].map(el => [(el as HTMLElement).dataset.id, el.getBoundingClientRect().top]));
  const { me, seat: id, opponents } = snapshot.state;
  const roster = [{ id, hero: me.hero, health: me.health, armor: me.armor, alive: me.alive }, ...opponents];
  seats.replaceChildren(...ranked(roster).map(seat));
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
  byId('phase').textContent = (phase === 'hero_select' ? '选择英雄' : (!me.alive || phase==='game_over') ? '对局结束' : '招募') + ' · 第 ' + turn + ' 回合';
  byId('gold').textContent = '◉ ' + me.gold + ' 金币';
  standings();
  const tier = byId('tier');
  tier.innerHTML = STAR.repeat(me.tier);
  tier.ariaLabel = '酒馆等级 ' + me.tier;
  if (me.hero) {
    const parent = byId('hero');
    renderHeroPanel(parent, me);
    me.hero_powers.forEach((p,i) => explain(control('hero',p.name_zh,match('hero_power',{slot:i})), p.name_zh+' · '+p.text_zh));
  }
  view.render(transition);
  control('tools','升本 '+me.upgrade_price,match('upgrade')).dataset.action='upgrade';
  control('tools','⟳ 刷新 '+me.refresh_price,match('refresh')).dataset.action='refresh';
  control('tools',me.frozen?'❄ 解冻':'❄ 冻结',match('freeze')).dataset.action='freeze';
  const gift = me.dark_gift;
  if (gift && match('dark_gift')) {
    explain(control('tools','黑暗之赐 '+gift.cost,match('dark_gift')),
      '黑暗之赐 · 花费'+gift.cost+'枚铸币，从三张各带一个不同黑暗之赐的随从中发现一张。每回合一次，本局还剩 '+(gift.max_uses-gift.uses)+'/'+gift.max_uses+' 次。');
  }
  control('end','结束回合',match('end_turn'));
  if (match('cancel')) control('end','取消',match('cancel'));
  const choosing = snapshot.legal_actions.filter(a=>a.kind==='choose');
  byId('choices').hidden = !choosing.length;
  if (choosing.length) {
    const pending = me.pending;
    // Choose One offers the same card twice; its text names the two modes.
    const modes = pending?.kind === 'choose_one' ? chooseOneModes(pending.source?.text_zh ?? '') : undefined;
    const title = phase === 'hero_select' ? '选择英雄'
      : modes ? '抉择 · ' + (pending?.source?.name_zh ?? '')
      : pending?.source?.kind === 'dark_gift' ? '黑暗之赐 · 选择一张随从' : '请选择一项';
    byId('choices').append(badge('choice-title', title));
    for (const a of choosing) {
      const c = pending?.options?.[a.option];
      const btn = control('choices', '', a);
      btn.classList.add('choice');
      if (modes) {
        btn.append(badge('choice-name', a.option === 0 ? '选项一' : '选项二'), badge('choice-text', modes[a.option] ?? ''));
      } else if (c) {
        const attached = describe(c).slice(1);
        btn.append(badge('choice-name', c.name_zh), badge('choice-text', [c.text_zh, ...attached].filter(Boolean).join('\n')));
        void loadCardImage(c.id).then(img => { img.className = 'full'; btn.prepend(img); });
      } else btn.append(badge('choice-name', '选项 ' + (a.option + 1)));
    }
  }
  if (me.pending?.kind === 'target') {
    const casting = me.hand.find(c=>c.hid===me.casting) ?? spell;
    message([casting?.name_zh,casting?.text_zh,'请选择目标 · 右键取消'].filter(Boolean).join('　'));
  } else {
    spell=undefined;
    message(!me.alive || phase==='game_over' ? '对局结束 · 第 '+ me.placement +' 名' : '拖入手牌购买 · 拖至战团出牌 · 拖回酒馆出售');
  }
}
document.addEventListener('pointermove', e => {
  if (busy || !snapshot || snapshot.state.me.pending?.kind !== 'target') return;
  const p = localPoint(e.clientX,e.clientY); drawArrow(p.x,p.y);
});
document.addEventListener('keydown',e=>{if(e.key==='Escape' && snapshot && !busy){const a=match('cancel');if(a)void commit(a);}});
// Right-click cancels a pending choice such as spell targeting; the table never shows a context menu.
table.addEventListener('contextmenu',e=>{e.preventDefault();if(snapshot && !busy){const a=match('cancel');if(a)void commit(a);}});
async function start() {
  if(busy)return;
  lock(true); message('酒馆准备中…');
  try {snapshot=await createGame(scene.value==='random'?undefined:scene.value);spell=undefined;render();}
  catch {message('无法连接游戏服务，请启动后端并点击重开');}
  finally {lock(false);}
}
function resize(){const scale=boardScale();table.style.setProperty('--scale',String(scale));view.resize(scale);}

const params=new URLSearchParams(location.search);
const initial=params.get('scenario');
if (initial && [...scene.options].some(o=>o.value===initial))scene.value=initial;
view = createThreeView(host);
scene.onchange=start;byId('restart').onclick=start;
window.addEventListener('resize',resize);resize();void start();
