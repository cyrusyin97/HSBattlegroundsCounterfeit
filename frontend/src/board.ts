import './board.css';
import { createGame, type Action, type Card, type GameSnapshot } from './game-api';
import { loadCardImage } from './demo-art';
import { badge, boardScale, byId, localPoint } from './pieces';
import { playCombat } from './combat';
import { animateHeroVitals, renderHeroPanel } from './hero-effects';
import { matchAction } from './core/intents';
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
  tooltip(card, x = 0, y = 0) {
    const tip = byId('tooltip');
    tip.hidden = !card;
    if (!card) return;
    tip.textContent = [card.name_zh, card.text_zh].filter(Boolean).join(' · ');
    tip.style.left = Math.min(x+9,1180)+'px'; tip.style.top = Math.min(y,615)+'px';
  },
};

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

function render(transition?: Transition) {
  const { me, turn, phase } = snapshot.state;
  clearArrow();
  for (const id of ['tools','end','hero','seats','choices']) byId(id).replaceChildren();
  host.tooltip();
  table.classList.remove('in-combat');
  byId('enemy-hero').hidden = true;
  byId('hero').classList.remove('hero-defeated');
  byId('enemy-hero').classList.remove('hero-defeated');
  byId('phase').textContent = (phase === 'hero_select' ? '选择英雄' : (!me.alive || phase==='game_over') ? '对局结束' : '招募') + ' · 第 ' + turn + ' 回合';
  byId('gold').textContent = '◉ ' + me.gold + ' 金币';
  const roster = [{id:snapshot.state.seat,hero:me.hero,health:me.health,alive:me.alive}, ...snapshot.state.opponents];
  roster.forEach(s => byId('seats').append(badge('seat'+(s.id===snapshot.state.seat?' you':''), (s.id===snapshot.state.seat?'你 · ':'')+(s.hero?.name_zh || '选将中')+(s.alive?'　'+s.health:'　出局'))));
  if (me.hero) {
    const parent = byId('hero');
    renderHeroPanel(parent, me);
    me.hero_powers.forEach((p,i) => {const btn=control('hero',p.name_zh,match('hero_power',{slot:i}));btn.title=p.text_zh;});
  }
  view.render(transition);
  control('tools','★ '+me.tier+'　升本 '+me.upgrade_price,match('upgrade')).dataset.action='upgrade';
  control('tools','⟳ 刷新 '+me.refresh_price,match('refresh')).dataset.action='refresh';
  control('tools',me.frozen?'❄ 解冻':'❄ 冻结',match('freeze')).dataset.action='freeze';
  if (match('dark_gift')) control('tools','黑暗之赐',match('dark_gift'));
  control('end','结束回合',match('end_turn'));
  if (match('cancel')) control('end','取消',match('cancel'));
  const choosing = snapshot.legal_actions.filter(a=>a.kind==='choose');
  byId('choices').hidden = !choosing.length;
  if (choosing.length) {
    byId('choices').append(badge('',phase==='hero_select'?'选择英雄':'请选择一项'));
    for (const a of choosing) {
      const c=me.pending?.options?.[a.option];
      const btn=control('choices',c?.name_zh || '选项 '+(a.option+1),a);
      if(c){btn.title=c.text_zh;void loadCardImage(c.id).then(img=>{img.className='full';btn.prepend(img);});}
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
