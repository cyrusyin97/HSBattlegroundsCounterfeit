// HTML/CSS card renderer: the original DOM tokens, drag ghost and insertion marker.
import type { Card } from './game-api';
import { badge, byId, localPoint, piece } from './pieces';
import { departingCards, playShopEffect } from './tavern-effects';
import { isZone, matchAction, resolveDrop, resolveTap, type CardRef, type Zone } from './core/intents';
import { DROP_HINTS, type CardView, type ViewHost } from './view';

type Token = CardRef & { el: HTMLElement };

export function createDomView(host: ViewHost): CardView {
  const table = byId('table');
  const tokens = new Map<HTMLElement, Token>();
  let ghosts: HTMLElement[] = [];
  let drag: { source: Token; pointer: number; x: number; y: number; version: number; ghost?: HTMLElement } | undefined;
  const insertion = document.createElement('div');
  insertion.className = 'insertion';
  const match = (kind: Parameters<typeof matchAction>[1], fields?: Record<string, number>) =>
    matchAction(host.snapshot, kind, fields);

  function addToken(zone: Zone, card: Card, id: number, index: number) {
    const me = host.snapshot.state.me;
    const el = piece(card, zone === 'hand');
    const token = { zone, card, id, el };
    tokens.set(el, token);
    if (zone === 'shop') {
      const item = me.shop[index];
      el.dataset.slot = String(id);
      if (item.frozen) el.append(badge('ice-shell',''));
      el.append(badge('price', (item.costs_health ? '♥' : '●') + (item.price ?? '–')));
      if (card.tier) el.append(badge('tier', '★' + card.tier));
    }
    if (zone === 'hand') el.style.setProperty('--tilt', Math.max(-10, Math.min(10,(index-(me.hand.length-1)/2)*4))+'deg');
    if (card.eid !== undefined && match('target',{target_id:card.eid})) el.classList.add('target');
    el.onpointerenter = () => {
      if (host.busy || drag || host.snapshot.state.me.pending?.kind === 'target') return;
      const r = el.getBoundingClientRect(), p = localPoint(r.right, r.top);
      host.tooltip(card, p.x, p.y);
    };
    el.onpointerleave = () => host.tooltip();
    el.onpointerdown = e => {
      if (host.busy || e.button !== 0 || drag) return;
      drag = {source:token,pointer:e.pointerId,x:e.clientX,y:e.clientY,version:host.snapshot.version};
      el.setPointerCapture(e.pointerId);
    };
    el.onclick = e => { if (!e.detail && !host.busy) tap(token); };
    byId(zone).append(el);
  }

  function tap(t: Token) {
    const action = resolveTap(host.snapshot, t);
    if (action) void host.commit(action);
  }
  function drop(source: Token, x: number, y: number, preview: boolean) {
    const row = document.elementFromPoint(x,y)?.closest('.row')?.id;
    const pieces = [...tokens.values()].filter(t => t.zone==='board' && t!==source);
    const center = (el: HTMLElement) => { const r=el.getBoundingClientRect();return r.left+r.width/2; };
    const pos = pieces.filter(t=>center(t.el)<x).length;
    const action = resolveDrop(host.snapshot, source, isZone(row) ? row : undefined, pos);
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
    if (host.busy || !host.snapshot || host.snapshot.state.me.pending?.kind === 'target') return;
    if (!drag || drag.pointer!==e.pointerId) return;
    const t=drag.source;
    if (!drag.ghost && Math.hypot(e.clientX-drag.x,e.clientY-drag.y)<6) return;
    if (!drag.ghost) {
      const ghost=t.el.cloneNode(true) as HTMLElement;
      ghost.className+=' ghost'; ghost.removeAttribute('data-eid'); ghost.ariaHidden='true';
      document.body.append(ghost); drag.ghost=ghost; t.el.classList.add('held'); host.tooltip();
    }
    drag.ghost.style.left=e.clientX+'px';drag.ghost.style.top=e.clientY+'px';
    clearDrop();
    const action=drop(t,e.clientX,e.clientY,true);
    if (action) {
      document.elementFromPoint(e.clientX,e.clientY)?.closest('.row')?.classList.add('drop');
      host.message(DROP_HINTS[action.kind] ?? '松手确认');
    } else host.message('移至合法落点，或松手返回');
  });
  function release(e: PointerEvent, cancel=false) {
    if (!drag || drag.pointer!==e.pointerId) return;
    const {source,ghost,version}=drag; drag=undefined; clearDrop();
    if (!ghost) { if(!cancel && !host.busy && version===host.snapshot.version && source.el.contains(document.elementFromPoint(e.clientX,e.clientY))) tap(source);return; }
    const action = !cancel && version===host.snapshot.version ? drop(source,e.clientX,e.clientY,false) : undefined;
    if (action) {ghost.remove();source.el.classList.remove('held');void host.commit(action);return;}
    const r=source.el.getBoundingClientRect();
    host.message('无法放置，已返回原位');
    void ghost.animate([{}, {left:r.left+r.width/2+'px',top:r.top+r.height/2+'px',opacity:.2}],{duration:180}).finished.then(()=>{ghost.remove();source.el.classList.remove('held');});
  }
  document.addEventListener('pointerup',e=>release(e));
  document.addEventListener('pointercancel',e=>release(e,true));

  return {
    render(transition) {
      // Capture the old shop before it is replaced. Kept slots retain their place.
      ghosts = transition?.action.kind === 'refresh' ? departingCards(host.snapshot) : [];
      tokens.clear();
      for (const id of ['board','shop','hand']) byId(id).replaceChildren();
      const me = host.snapshot.state.me;
      me.shop.forEach((c,i) => addToken('shop',c,c.sid,i));
      me.board.forEach((c,i) => addToken('board',c,c.eid,i));
      me.hand.forEach((c,i) => addToken('hand',c,c.hid,i));
    },
    beginCombat() {},
    shopEffect: (kind, before, after) => playShopEffect(kind, before, after, ghosts),
    castOrigin() {
      const source = [...tokens.values()].find(t => t.zone === 'hand' && t.id === host.snapshot.state.me.casting);
      const rect = source?.el.getBoundingClientRect();
      return rect && localPoint(rect.x+rect.width/2,rect.top);
    },
    resize() {},
  };
}
