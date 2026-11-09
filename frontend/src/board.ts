import './board.css';
import { createGame, type Action, type Card, type GameSnapshot } from './game-api';
import { loadCardImage } from './demo-art';
import { badge, byId, localPoint, piece } from './pieces';
import { playCombat } from './combat';
import { isShopAction, departingCards, playShopEffect } from './tavern-effects';
import { animateHeroVitals, renderHeroPanel } from './hero-effects';
import { isZone, matchAction, resolveDrop, resolveTap, type CardRef, type Zone } from './core/intents';
import { execute } from './core/session';

type Token = CardRef & { el: HTMLElement };
const table = byId('table'), status = byId('status'), scene = byId('scene') as HTMLSelectElement;
const tokens = new Map<HTMLElement, Token>();
let snapshot: GameSnapshot;
let busy = false;
let spell: Card | undefined;
let drag: { source: Token; pointer: number; x: number; y: number; version: number; ghost?: HTMLElement } | undefined;
const insertion = document.createElement('div');
insertion.className = 'insertion';
const match = (kind: Action['kind'], fields?: Record<string, number>) => matchAction(snapshot, kind, fields);
const message = (s: string) => { status.textContent = s; };

function lock(value: boolean) {
  busy = value;
  scene.disabled = value;
  (byId('restart') as HTMLButtonElement).disabled = value;
  for (const id of ['tools','end','board','hand','shop','choices','hero']) byId(id).inert = value;
}
function clearArrow() { byId('curve').removeAttribute('d'); }
function drawArrow(x: number, y: number) {
  const source = [...tokens.values()].find(t => t.zone === 'hand' && t.id === snapshot.state.me.casting);
  const rect = source?.el.getBoundingClientRect();
  const start = rect ? localPoint(rect.x+rect.width/2,rect.top) : { x: 770, y: 685 };
  byId('curve').setAttribute('d', 'M ' + start.x + ' ' + start.y + ' Q ' + (start.x+105) + ' ' + (y+20) + ' ' + x + ' ' + y);
}
async function commit(action: Action) {
  if (busy || !snapshot.legal_actions.includes(action)) return;
  const before = snapshot;
  if (action.kind === 'cast') spell = before.state.me.hand.find(c => c.hid === action.hand_id);
  lock(true); clearArrow(); byId('tooltip').hidden = true;
  message('正在结算…');
  try {
    const { snapshot: result, note, combat, hero } = await execute(before, action);
    if (combat) await playCombat(combat, before);
    const ghosts = !note && action.kind === 'refresh' ? departingCards(result) : [];
    snapshot = result;
    render();
    if (hero) await animateHeroVitals(byId('hero'), hero, result.state.me);
    if (!note && isShopAction(action.kind)) {
      await playShopEffect(action.kind, before, result, ghosts);
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

function addToken(zone: Zone, card: Card, id: number, index: number) {
  const el = piece(card, zone === 'hand');
  const token = { zone, card, id, el };
  tokens.set(el, token);
  if (zone === 'shop') {
    const item = snapshot.state.me.shop[index];
    el.dataset.slot = String(id);
    if (item.frozen) el.append(badge('ice-shell',''));
    el.append(badge('price', (item.costs_health ? '♥' : '●') + (item.price ?? '–')));
    if (card.tier) el.append(badge('tier', '★' + card.tier));
  }
  if (zone === 'hand') el.style.setProperty('--tilt', Math.max(-10, Math.min(10,(index-(snapshot.state.me.hand.length-1)/2)*4))+'deg');
  if (card.eid !== undefined && match('target',{target_id:card.eid})) el.classList.add('target');
  el.onpointerenter = () => {
    if (busy || drag || snapshot.state.me.pending?.kind === 'target') return;
    const tip = byId('tooltip');
    tip.textContent = [card.name_zh, card.text_zh].filter(Boolean).join(' · ');
    const r = el.getBoundingClientRect(), p = localPoint(r.right, r.top);
    tip.style.left = Math.min(p.x+9,1180)+'px'; tip.style.top = Math.min(p.y,615)+'px'; tip.hidden = false;
  };
  el.onpointerleave = () => { byId('tooltip').hidden = true; };
  el.onpointerdown = e => {
    if (busy || e.button !== 0 || drag) return;
    drag = {source:token,pointer:e.pointerId,x:e.clientX,y:e.clientY,version:snapshot.version};
    el.setPointerCapture(e.pointerId);
  };
  el.onclick = e => { if (!e.detail && !busy) tap(token); };
  byId(zone).append(el);
}

function render() {
  const { me, turn, phase } = snapshot.state;
  clearArrow(); tokens.clear();
  for (const id of ['board','shop','hand','tools','end','hero','seats','choices']) byId(id).replaceChildren();
  byId('tooltip').hidden = true;
  table.classList.toggle('frozen',me.frozen);
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
  me.shop.forEach((c,i) => addToken('shop',c,c.sid,i));
  me.board.forEach((c,i) => addToken('board',c,c.eid,i));
  me.hand.forEach((c,i) => addToken('hand',c,c.hid,i));
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
    message([casting?.name_zh,casting?.text_zh,'请选择目标'].filter(Boolean).join('　'));
  } else {
    spell=undefined;
    message(!me.alive || phase==='game_over' ? '对局结束 · 第 '+ me.placement +' 名' : '拖入手牌购买 · 拖至战团出牌 · 拖回酒馆出售');
  }
}
function tap(t: Token) {
  const action = resolveTap(snapshot, t);
  if (action) void commit(action);
}
function drop(source: Token, x: number, y: number, preview: boolean) {
  const row = document.elementFromPoint(x,y)?.closest('.row')?.id;
  const pieces = [...tokens.values()].filter(t => t.zone==='board' && t!==source);
  const center = (el: HTMLElement) => { const r=el.getBoundingClientRect();return r.left+r.width/2; };
  const pos = pieces.filter(t=>center(t.el)<x).length;
  const action = resolveDrop(snapshot, source, isZone(row) ? row : undefined, pos);
  if (preview && (action?.kind==='play' || action?.kind==='move')) {
    const r = (pieces[pos]?.el ?? pieces.at(-1)?.el ?? byId('board')).getBoundingClientRect();
    const point = localPoint(!pieces.length ? center(byId('board')) : pos===pieces.length ? r.right+5 : r.left-5,r.top);
    insertion.style.left=point.x+'px'; insertion.style.top=point.y+'px'; table.append(insertion);
  }
  return action;
}
function clearDrop() {
  insertion.remove();
  document.querySelectorAll('.drop').forEach(el=>el.classList.remove('drop'));
}
document.addEventListener('pointermove', e => {
  if (busy || !snapshot) return;
  if (snapshot.state.me.pending?.kind === 'target') {
    const p = localPoint(e.clientX,e.clientY); drawArrow(p.x,p.y); return;
  }
  if (!drag || drag.pointer!==e.pointerId) return;
  const t=drag.source;
  if (!drag.ghost && Math.hypot(e.clientX-drag.x,e.clientY-drag.y)<6) return;
  if (!drag.ghost) {
    const ghost=t.el.cloneNode(true) as HTMLElement;
    ghost.className+=' ghost'; ghost.removeAttribute('data-eid'); ghost.ariaHidden='true';
    document.body.append(ghost); drag.ghost=ghost; t.el.classList.add('held'); byId('tooltip').hidden=true;
  }
  drag.ghost.style.left=e.clientX+'px';drag.ghost.style.top=e.clientY+'px';
  clearDrop();
  const action=drop(t,e.clientX,e.clientY,true);
  if (action) {
    document.elementFromPoint(e.clientX,e.clientY)?.closest('.row')?.classList.add('drop');
    const hints: Partial<Record<Action['kind'], string>> = {buy:'松手购买', sell:'松手出售', cast:'松手施法', move:'松手确认站位', play:'松手出牌'};
    message(hints[action.kind] ?? '松手确认');
  } else message('移至合法落点，或松手返回');
});
function release(e: PointerEvent, cancel=false) {
  if (!drag || drag.pointer!==e.pointerId) return;
  const {source,ghost,version}=drag; drag=undefined; clearDrop();
  if (!ghost) { if(!cancel && !busy && version===snapshot.version && source.el.contains(document.elementFromPoint(e.clientX,e.clientY))) tap(source);return; }
  const action = !cancel && version===snapshot.version ? drop(source,e.clientX,e.clientY,false) : undefined;
  if (action) {ghost.remove();source.el.classList.remove('held');void commit(action);return;}
  const r=source.el.getBoundingClientRect();
  message('无法放置，已返回原位');
  void ghost.animate([{}, {left:r.left+r.width/2+'px',top:r.top+r.height/2+'px',opacity:.2}],{duration:180}).finished.then(()=>{ghost.remove();source.el.classList.remove('held');});
}
document.addEventListener('pointerup',e=>release(e));
document.addEventListener('pointercancel',e=>release(e,true));
document.addEventListener('keydown',e=>{if(e.key==='Escape' && snapshot && !busy){const a=match('cancel');if(a)void commit(a);}});
async function start() {
  if(busy)return;
  lock(true); message('酒馆准备中…');
  try {snapshot=await createGame(scene.value==='random'?undefined:scene.value);spell=undefined;render();}
  catch {message('无法连接游戏服务，请启动后端并点击重开');}
  finally {lock(false);}
}
const initial=new URLSearchParams(location.search).get('scenario');
if (initial && [...scene.options].some(o=>o.value===initial))scene.value=initial;
scene.onchange=start;byId('restart').onclick=start;
function resize(){table.style.setProperty('--scale',String(Math.min(innerWidth/1440,innerHeight/810)));}
window.addEventListener('resize',resize);resize();void start();
