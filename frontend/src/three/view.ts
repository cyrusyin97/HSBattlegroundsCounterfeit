// WebGL card renderer: recruit rows, drag and drop, and minion combat. The HUD,
// hero panels and text stay in the DOM over the canvas.
import * as THREE from 'three';
import type { Action } from '../game-api';
import { byId, localPoint } from '../pieces';
import { resolveDrop, resolveTap, matchAction, type Zone } from '../core/intents';
import { DROP_HINTS, type CardView, type ViewHost } from '../view';
import { Stage } from './stage';
import { insertionIndex, slots, ZONES, zoneAt } from './layout';
import { diff, placements, transfers, type Key, type Placement } from './reconciler';
import { CardKit, CardObject, faceOf } from './entities';
import { Clock } from './motion';
import { Labels, Particles } from './fx';
import { playCombat, type CombatTable } from './combat';

const ZONE_LIST: Zone[] = ['shop', 'board', 'hand'];
const DRAG_LIFT = 0.7;
/** The hand is nearest the camera; this keeps its cards near the DOM hand's size. */
const HAND_SCALE = 0.78;
/** Board pixels the hand sinks below the screen while combat plays. */
const HAND_AWAY = 300;
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
  let placed = new Map<Key, Placement>();
  let hover: CardObject | undefined;
  let drag: { obj: CardObject; pointer: number; x: number; y: number; version: number; active: boolean; action?: Action } | undefined;

  stage.onFrame(dt => {
    for (const [key, obj] of cards) {
      obj.step(dt);
      if (!obj.gone) continue;
      root.remove(obj.root, obj.shadow);
      obj.dispose();
      cards.delete(key);
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

  function arrange(zone: Zone, list: Placement[], gapAt?: number, sink = 0) {
    const spots = slots(zone, list.length, gapAt);
    list.forEach((p, i) => {
      const pos = stage.boardToWorld(spots[i].x, spots[i].y + sink, kit.centerY);
      // Later hand cards sit slightly in front so overlapping faces never z-fight.
      if (zone === 'hand') pos.addScaledVector(kit.normal, i * 0.03);
      cards.get(p.key)?.setRest(pos, spots[i].roll, zone === 'hand' ? HAND_SCALE : 1);
    });
  }

  function layout(gap?: Gap) {
    for (const zone of ZONE_LIST) {
      const list = zoneCards(zone).filter(p => !(zone === 'board' && gap?.skip === p.key));
      arrange(zone, list, zone === 'board' ? gap?.gapAt : undefined);
    }
  }

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

  function setHover(obj: CardObject | undefined) {
    if (obj === hover) return;
    if (hover) hover.hovered = false;
    hover = obj;
    canvas.style.cursor = obj ? 'pointer' : '';
    if (!obj) return host.tooltip();
    obj.hovered = true;
    const p = placed.get(obj.key);
    if (!p || host.snapshot.state.me.pending?.kind === 'target') return host.tooltip();
    const corner = obj.anchor(1, 1);
    host.tooltip(p.card, corner.x, corner.y);
  }

  function dragTo(x: number, y: number) {
    const d = drag!;
    if (host.snapshot.state.me.pending?.kind === 'target') return;
    if (!d.active) {
      if (Math.hypot(x - d.x, y - d.y) < 6) return;
      d.active = true;
      setHover(undefined);
    }
    d.obj.hold(stage.boardToWorld(x, y, kit.centerY + DRAG_LIFT));
    const source = placed.get(d.obj.key)!;
    const board = zoneCards('board');
    const base = slots('board', board.length);
    const centers = board.flatMap((p, i) => p.key === source.key ? [] : [base[i].x]);
    const position = insertionIndex(x, centers);
    const zone = zoneAt(x, y);
    d.action = resolveDrop(host.snapshot, source, zone, position);
    const kind = d.action?.kind;
    layout(kind === 'play' || kind === 'move' ? { gapAt: position, skip: kind === 'move' ? source.key : undefined } : undefined);
    for (const z of ZONE_LIST) marks[z].visible = !!d.action && z === zone;
    host.message(d.action ? DROP_HINTS[d.action.kind] ?? '松手确认' : '移至合法落点，或松手返回');
  }

  /** Settle cards into the confirmed layout once a command finishes or is rejected. */
  async function send(action: Action, obj?: CardObject) {
    try { await host.commit(action); } finally { obj?.hold(undefined); layout(); }
  }

  function release(e: PointerEvent, cancel: boolean) {
    if (!drag || drag.pointer !== e.pointerId) return;
    const { obj, active, version, action } = drag;
    drag = undefined;
    for (const z of ZONE_LIST) marks[z].visible = false;
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
      for (const key of exit) cards.get(key)!.remove();
      for (const { placement, previous } of place) {
        const reused = previous && previous !== placement.key && cards.get(previous);
        if (reused) {
          cards.delete(previous!);
          cards.set(placement.key, reused);
        }
        const obj = obtain(placement.key);
        obj.show(placement, faceOf(placement));
        const eid = placement.card.eid;
        obj.targetable = eid !== undefined && !!matchAction(snapshot, 'target', { target_id: eid });
      }
      placed = new Map(next.map(p => [p.key, p]));
      setHover(undefined);
      layout();
    },
    async playCombat(script) {
      setHover(undefined);
      // The hand sinks out of view and the shop clears for the opposing warband.
      arrange('hand', zoneCards('hand'), undefined, HAND_AWAY);
      for (const p of zoneCards('shop')) cards.get(p.key)?.remove();
      placed = new Map();
      await playCombat(combatTable, script);
    },
    // Refresh, freeze and upgrade effects are not ported yet. The face redraw shows the new state.
    shopEffect: async () => {},
    castOrigin() {
      const casting = host.snapshot.state.me.casting;
      const obj = casting === null ? undefined : cards.get(`hand:${casting}`);
      return obj && !obj.removing ? obj.anchor(0, 1) : undefined;
    },
    resize: scale => stage.resize(scale),
  };
}
