// WebGL card renderer: recruit rows, drag and drop, and minion combat. The HUD,
// hero panels and text stay in the DOM over the canvas.
import * as THREE from 'three';
import type { Action } from '../game-api';
import { byId, localPoint } from '../pieces';
import { magnetTargets, resolveDrop, resolveTap, matchAction, targetAction, type Zone } from '../core/intents';
import { DROP_HINTS, type CardView, type ViewHost } from '../view';
import { Stage } from './stage';
import { COMBAT_HAND, insertionIndex, slots, ZONES, zoneAt, type Rect } from './layout';
import { diff, placements, transfers, type Key, type Placement } from './reconciler';
import { CardKit, CardObject, faceOf } from './entities';
import { Clock } from './motion';
import { Labels, Particles } from './fx';
import { playCombat, type CombatTable } from './combat';
import * as effects from './effects';
import { showStats } from './stats';

const ZONE_LIST: Zone[] = ['shop', 'board', 'hand'];
const DRAG_LIFT = 0.7;
/** Board pixels from a minion's slot centre within which a Magnetic card attaches. */
const MAGNET_REACH = 44;
/** The hand is nearest the camera; this keeps its cards near the DOM hand's size. */
const HAND_SCALE = 0.78;
/** Board pixels the hand sinks below the screen while combat plays. */
/** A board drop opens a gap at `gapAt`; a moved card leaves its own slot. */
interface Gap { gapAt: number; skip?: Key }

export function createThreeView(host: ViewHost): CardView {
  const table = byId('table');
  const canvas = document.createElement('canvas');
  canvas.className = 'stage';
  table.prepend(canvas);
  const stage = new Stage(canvas);
  const kit = new CardKit(stage);
  const clock = new Clock(stage);
  const particles = new Particles(stage);
  const labels = new Labels(stage, table);
  canvas.after(labels.layer);
  const root = new THREE.Group();
  stage.scene.add(root);
  const mark = (zone: Zone) => {
    const mesh = stage.zoneQuad(ZONES[zone], 0x81bd54, 0.2);
    mesh.visible = false;
    return mesh;
  };
  const marks: Record<Zone, THREE.Mesh> = { shop: mark('shop'), board: mark('board'), hand: mark('hand') };

  const cards = new Map<Key, CardObject>();
  /** Objects no longer keyed to a card, kept until their exit effect ends. */
  const loose = new Set<CardObject>();
  let placed = new Map<Key, Placement>();
  /** Shop changes from the last refresh render, played by shopEffect. */
  let refreshed: { departing: CardObject[]; arriving: CardObject[] } | undefined;
  if (new URLSearchParams(location.search).has('stats')) {
    showStats(stage, table);
    Object.assign(window, { three: { stage, cards } });
  }
  let hover: CardObject | undefined;
  /** While combat plays, input is locked but hovering still explains cards. */
  let fighting = false;
  /** `aiming`: a targeted spell left the hand, so the gesture now picks its target. */
  let drag: {
    obj: CardObject; pointer: number; x: number; y: number; version: number;
    active: boolean; aiming?: boolean; action?: Action;
  } | undefined;

  const discard = (obj: CardObject) => {
    root.remove(obj.root, obj.shadow);
    obj.dispose();
  };
  stage.onFrame(dt => {
    for (const [key, obj] of cards) {
      obj.step(dt);
      if (!obj.gone) continue;
      discard(obj);
      cards.delete(key);
    }
    for (const obj of loose) {
      obj.step(dt);
      if (!obj.gone) continue;
      discard(obj);
      loose.delete(obj);
    }
  });

  const zoneCards = (zone: Zone) => [...placed.values()].filter(p => p.zone === zone).sort((a, b) => a.index - b.index);

  function obtain(key: Key) {
    let obj = cards.get(key);
    if (!obj) {
      obj = new CardObject(kit);
      root.add(obj.root, obj.shadow);
      cards.set(key, obj);
    }
    return obj;
  }

  function arrange(zone: Zone, list: Placement[], gapAt?: number, area?: Rect) {
    const spots = slots(zone, list.length, gapAt, area);
    list.forEach((p, i) => {
      const pos = stage.boardToWorld(spots[i].x, spots[i].y, kit.centerY);
      // Later hand cards sit slightly in front so overlapping faces never z-fight.
      if (zone === 'hand') pos.addScaledVector(kit.normal, i * 0.03);
      // Distance shrinks the shop row; scale it back so its text reads like the warband's.
      const scale = zone === 'hand' ? HAND_SCALE : zone === 'shop' ? kit.scaleAt(spots[i].y) : 1;
      cards.get(p.key)?.setRest(pos, spots[i].roll, scale);
    });
  }

  function layout(gap?: Gap) {
    for (const zone of ZONE_LIST) {
      const list = zoneCards(zone).filter(p => !(zone === 'board' && gap?.skip === p.key));
      arrange(zone, list, zone === 'board' ? gap?.gapAt : undefined);
    }
  }

  const effectTable: effects.EffectTable = { stage, kit, clock, particles };
  const shopObjects = () => zoneCards('shop').flatMap(p => cards.get(p.key) ?? []);
  const combatTable: CombatTable = {
    kit, clock, particles, labels, cards, obtain,
    arrange: (zone, list) => arrange(zone, list),
  };

  function pick(x: number, y: number) {
    const hits = stage.ray(x, y).intersectObjects(root.children, true);
    for (const hit of hits) {
      let node: THREE.Object3D | null = hit.object;
      while (node && !node.userData.card) node = node.parent;
      const obj = node?.userData.card as CardObject | undefined;
      if (obj && !obj.removing && !obj.isHeld) return obj;
    }
  }

  /** `lift` raises the card; combat hover only explains it, so attack poses stay untouched. */
  function setHover(obj: CardObject | undefined, lift = true) {
    if (obj === hover) return;
    if (hover) hover.hovered = false;
    hover = obj;
    canvas.style.cursor = obj && lift ? 'pointer' : '';
    if (!obj) return host.tooltip();
    obj.hovered = lift;
    const card = fighting ? obj.card : placed.get(obj.key)?.card;
    if (!card || host.snapshot.state.me.pending?.kind === 'target') return host.tooltip();
    const corner = obj.anchor(1, 1);
    host.tooltip(card, corner.x, corner.y);
  }

  function dragTo(x: number, y: number) {
    const d = drag!;
    // The board controller draws the arrow; the view lights the target under the pointer.
    if (d.aiming) return setHover(pick(x, y));
    if (host.snapshot.state.me.pending?.kind === 'target') return;
    if (!d.active) {
      if (Math.hypot(x - d.x, y - d.y) < 6) return;
      d.active = true;
      setHover(undefined);
    }
    const source = placed.get(d.obj.key)!;
    const cast = source.zone === 'hand' && source.card.targeted && zoneAt(x, y) !== 'hand'
      ? matchAction(host.snapshot, 'cast', { hand_id: source.id }) : undefined;
    if (cast) {
      // Leaving the hand casts at once; the card returns and the arrow takes over.
      d.aiming = true;
      d.obj.hold(undefined);
      for (const z of ZONE_LIST) marks[z].visible = false;
      layout();
      return void send(cast);
    }
    d.obj.hold(stage.boardToWorld(x, y, kit.centerY + DRAG_LIFT));
    const board = zoneCards('board');
    const base = slots('board', board.length);
    const centers = board.flatMap((p, i) => p.key === source.key ? [] : [base[i].x]);
    const position = insertionIndex(x, centers);
    const zone = zoneAt(x, y);
    // A hand card held over the middle of a friendly minion's slot may attach to it
    // (Magnetic). Slots, not animated positions, decide it, so an opening gap cannot
    // slide the minion out from under the pointer.
    const overIndex = source.zone === 'hand' && zone === 'board' ? base.findIndex(b => Math.abs(b.x - x) < MAGNET_REACH) : -1;
    const over = overIndex < 0 ? undefined : board[overIndex].id;
    const under = overIndex < 0 ? undefined : cards.get(board[overIndex].key);
    d.action = resolveDrop(host.snapshot, source, zone, position, over);
    const kind = d.action?.kind;
    markMagnets(source.zone === 'hand' ? source.id : undefined, kind === 'magnetize' ? under : undefined);
    layout(kind === 'play' || kind === 'move' ? { gapAt: position, skip: kind === 'move' ? source.key : undefined } : undefined);
    for (const z of ZONE_LIST) marks[z].visible = !!d.action && z === zone;
    host.message(d.action ? DROP_HINTS[d.action.kind] ?? '松手确认' : '移至合法落点，或松手返回');
  }

  /** Outlines the minions a dragged Magnetic card can attach to; the one under it lights gold. */
  function markMagnets(hid: number | undefined, over?: CardObject) {
    const targets = hid === undefined ? [] : magnetTargets(host.snapshot, hid);
    for (const p of zoneCards('board')) {
      const obj = cards.get(p.key);
      if (!obj) continue;
      // Spell targets keep their outline; magnet targets add theirs while dragging.
      obj.targetable = targets.includes(p.id) || !!targetAction(host.snapshot, p);
      obj.hovered = obj === over;
    }
  }

  /** Settle cards into the confirmed layout once a command finishes or is rejected. */
  async function send(action: Action, obj?: CardObject) {
    try { await host.commit(action); } finally { obj?.hold(undefined); layout(); }
  }

  function release(e: PointerEvent, cancel: boolean) {
    if (!drag || drag.pointer !== e.pointerId) return;
    const { obj, active, aiming, version, action } = drag;
    drag = undefined;
    for (const z of ZONE_LIST) marks[z].visible = false;
    markMagnets(undefined);
    if (aiming) return aim(e, cancel);
    const valid = !cancel && !host.busy && version === host.snapshot.version;
    if (!active) {
      const p = localPoint(e.clientX, e.clientY);
      const ref = placed.get(obj.key);
      const tap = valid && ref && pick(p.x, p.y) === obj ? resolveTap(host.snapshot, ref) : undefined;
      if (tap) void send(tap);
      return;
    }
    // A dropped card waits where it was released until the confirmed snapshot places it.
    if (valid && action) return void send(action, obj);
    obj.hold(undefined);
    layout();
    host.message('无法放置，已返回原位');
  }

  /**
   * Ends an aiming drag: over a legal target it casts there, back over the hand it
   * cancels, and anywhere else the arrow stays for a click (right-click cancels).
   */
  function aim(e: PointerEvent, cancel: boolean) {
    if (cancel || host.busy || host.snapshot.state.me.pending?.kind !== 'target') return;
    const p = localPoint(e.clientX, e.clientY);
    const back = zoneAt(p.x, p.y) === 'hand' ? matchAction(host.snapshot, 'cancel') : undefined;
    const obj = pick(p.x, p.y), ref = obj && placed.get(obj.key);
    const target = ref ? resolveTap(host.snapshot, ref) : undefined;
    const action = back ?? (target?.kind === 'target' ? target : undefined);
    if (action) void send(action);
  }

  canvas.addEventListener('pointerdown', e => {
    if (host.busy || e.button !== 0 || drag || !host.snapshot) return;
    const p = localPoint(e.clientX, e.clientY);
    const obj = pick(p.x, p.y);
    if (!obj) return;
    drag = { obj, pointer: e.pointerId, x: p.x, y: p.y, version: host.snapshot.version, active: false };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {
    const p = localPoint(e.clientX, e.clientY);
    if (drag?.pointer === e.pointerId) {
      if (!host.busy) dragTo(p.x, p.y);
      return;
    }
    if (fighting) return setHover(pick(p.x, p.y), false);
    setHover(host.busy || drag || !host.snapshot ? undefined : pick(p.x, p.y));
  });
  canvas.addEventListener('pointerup', e => release(e, false));
  canvas.addEventListener('pointercancel', e => release(e, true));
  canvas.addEventListener('pointerleave', () => { if (!drag) setHover(undefined); });

  return {
    render(transition) {
      const snapshot = host.snapshot;
      const next = placements(snapshot);
      const from = transition ? transfers(transition.before, snapshot, transition.action) : new Map<Key, Key>();
      const { place, exit } = diff(cards.keys(), next, from);
      // A refresh hands its old shop cards to the effect instead of shrinking them here.
      const refreshing = transition?.action.kind === 'refresh';
      refreshed = refreshing ? { departing: [], arriving: [] } : undefined;
      for (const key of exit) {
        const obj = cards.get(key)!;
        if (refreshed && obj.zone === 'shop' && !obj.removing) {
          cards.delete(key);
          loose.add(obj);
          refreshed.departing.push(obj);
        } else obj.remove();
      }
      for (const { placement, previous } of place) {
        const reused = previous && previous !== placement.key && cards.get(previous);
        if (reused) {
          cards.delete(previous!);
          cards.set(placement.key, reused);
        }
        const fresh = !cards.has(placement.key);
        const obj = obtain(placement.key);
        if (refreshed && fresh && placement.zone === 'shop') {
          obj.visible = false;
          refreshed.arriving.push(obj);
        }
        obj.show(placement, faceOf(placement));
        obj.targetable = !!targetAction(snapshot, placement);
      }
      placed = new Map(next.map(p => [p.key, p]));
      setHover(undefined);
      layout();
    },
    async playCombat(script) {
      setHover(undefined);
      // The hand moves beside the friendly hero and stays readable; the shop clears for the opposing warband.
      arrange('hand', zoneCards('hand'), undefined, COMBAT_HAND);
      for (const p of zoneCards('shop')) cards.get(p.key)?.remove();
      placed = new Map();
      fighting = true;
      try { await playCombat(combatTable, script); } finally {
        fighting = false;
        setHover(undefined);
      }
    },
    async shopEffect(kind, before, after) {
      if (kind === 'refresh') {
        const { departing, arriving } = refreshed ?? { departing: [], arriving: [] };
        refreshed = undefined;
        return effects.refresh(effectTable, departing, arriving);
      }
      if (kind === 'freeze') {
        const wasFrozen = new Set(before.state.me.shop.filter(c => c.frozen).flatMap(c => cards.get(`shop:${c.sid}`) ?? []));
        return effects.freeze(effectTable, after.state.me.frozen, shopObjects(), wasFrozen);
      }
      return effects.upgrade(effectTable, after.state.me.tier, shopObjects());
    },
    castOrigin() {
      const casting = host.snapshot.state.me.casting;
      const obj = casting === null ? undefined : cards.get(`hand:${casting}`);
      return obj && !obj.removing ? obj.anchor(0, 1) : undefined;
    },
    resize: scale => stage.resize(scale),
  };
}
