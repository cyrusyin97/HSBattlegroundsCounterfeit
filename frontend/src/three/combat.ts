// Minion combat on the table. The friendly warband keeps its recruit objects
// (`board:eid`), the opposing warband takes the shop row as `enemy:eid`, and each
// step plays its contacts before the resolved boards settle.
import * as THREE from 'three';
import type { AttackImpact, Minion } from '../game-api';
import type { CombatScript, CombatStep } from '../core/combat-script';
import { CardKit, CardObject, faceOf } from './entities';
import { Clock, easeIn, pose, samplePose, type Key as Frame, type Pose } from './motion';
import { burstLabel, Labels, Particles } from './fx';
import type { Key, Placement } from './reconciler';

export interface CombatTable {
  kit: CardKit;
  clock: Clock;
  particles: Particles;
  labels: Labels;
  cards: ReadonlyMap<Key, CardObject>;
  /** The object for `key`, created above its slot when absent. */
  obtain(key: Key): CardObject;
  /** Rest positions for a row, laid out like the recruit rows. */
  arrange(zone: 'shop' | 'board', list: Placement[]): void;
}

const GOLD = 0xffd36b;
const up = (v: THREE.Vector3, y: number) => v.clone().setY(v.y + y);

export async function playCombat(t: CombatTable, script: CombatScript) {
  const { clock } = t;
  const keys = new Map<number, Key>();
  const keyOf = (eid: number) => keys.get(eid);

  function settle(step: CombatStep) {
    const rows: ['board' | 'shop', Minion[], 'board' | 'enemy'][] = [
      ['board', step.friendly, 'board'], ['shop', step.enemy, 'enemy'],
    ];
    for (const [zone, list, prefix] of rows) {
      const placements = list.map((card, index): Placement => {
        const key: Key = `${prefix}:${card.eid}`;
        keys.set(card.eid, key);
        return { key, zone, id: card.eid, card, index };
      });
      for (const p of placements) t.obtain(p.key).show(p, faceOf(p));
      t.arrange(zone, placements);
    }
  }

  function shatter(obj: CardObject) {
    t.particles.burst(obj.position, { count: 9, color: GOLD, speed: 2.6, up: 0.6, size: 0.14, life: 0.45 });
  }

  function hit(h: AttackImpact['hits'][number]) {
    const key = keyOf(h.target);
    const obj = key && t.cards.get(key);
    if (!obj) return;
    obj.restat({ hp: h.hp });
    obj.shield = h.shield_hits > 0;
    if (h.absorbed) shatter(obj);
    if (!h.damage && !h.absorbed) return;
    void t.labels.show(burstLabel(h.absorbed ? '抵挡' : '−' + h.damage, h.absorbed), () => obj.anchor(0, 0.16), [
      { opacity: 0, transform: 'scale(.48) rotate(-12deg)' },
      { opacity: 1, transform: 'scale(1.13) rotate(-4deg)', offset: .13 },
      { opacity: 1, transform: 'scale(1) rotate(-4deg)', offset: .78 },
      { opacity: 0, transform: 'translateY(-10px) scale(.95)' },
    ], 780);
  }

  /** Runs keyed poses on `obj`, then hands it back to its spring. */
  async function move(obj: CardObject, frames: Frame<Pose>[], ms: number) {
    const current = pose(new THREE.Vector3());
    obj.override = current;
    try { await clock.tween(ms, k => samplePose(frames, k, current)); } finally {
      if (obj.override === current) obj.override = undefined;
    }
  }

  async function attack(impact: AttackImpact) {
    const a = t.cards.get(keyOf(impact.from)!), d = t.cards.get(keyOf(impact.to)!);
    const hits = () => impact.hits.forEach(hit);
    if (!a || !d || a.removing || d.removing) {
      hits();
      await clock.wait(780);
      return;
    }
    const start = a.restPosition.clone(), target = d.restPosition.clone();
    const flat = target.clone().sub(start).setY(0);
    const distance = flat.length() || 1;
    const u = flat.divideScalar(distance);
    // Stop about one card short so the faces meet edge to edge.
    const contact = start.clone().addScaledVector(u, Math.max(0, distance - t.kit.height * 0.8));
    // Toward the target is positive pitch when it lies up the table (away from the camera).
    const toward = -Math.sign(u.z) || 1;
    const bank = (u.x * 8 - u.z * 5) * Math.PI / 180;
    const rest = pose(start);
    // Rise toward the camera rather than straight up, so an enemy card rearing back
    // stays clear of the enemy hero panel.
    const hover = pose(start.clone().addScaledVector(u, -0.12).addScaledVector(t.kit.normal, 0.75), -toward * 0.35, -bank);
    const hitPose = pose(up(contact, 0.04), toward * 0.22, bank * 0.5);

    await move(a, [
      { at: 0, value: rest }, { at: 0.48, value: hover }, { at: 0.72, value: hover },
      { at: 1, value: hitPose, ease: easeIn },
    ], 450);
    a.override = hitPose;
    hits();
    d.flash();
    const back = pose(up(target.clone().addScaledVector(u, 0.24), 0.1), toward * 0.3, bank);
    void move(d, [{ at: 0, value: pose(target) }, { at: 0.22, value: back }, { at: 1, value: pose(target) }], 310);
    await clock.wait(80);
    const lift = pose(up(start.clone().lerp(contact, 0.36), 0.4), toward * 0.1, -bank * 0.5);
    await move(a, [
      { at: 0, value: hitPose }, { at: 0.5, value: lift },
      { at: 0.88, value: pose(up(start, 0.02), -0.05) }, { at: 1, value: rest },
    ], 330);
    await clock.wait(380);
  }

  for (const [i, step] of script.steps.entries()) {
    for (const impact of step.impacts) await attack(impact);
    const dying = step.deaths.map(keyOf).flatMap(key => (key && t.cards.get(key)) || []);
    for (const obj of dying) obj.remove();
    if (dying.length) await clock.wait(230);
    for (const eid of step.shieldBreaks) {
      const obj = t.cards.get(keyOf(eid)!);
      if (obj) shatter(obj);
    }
    settle(step);
    // The opening step drops the enemy warband in; later summons grow into place.
    if (i === 0) await clock.wait(520);
    else if (step.summons.length) await clock.wait(290);
    await clock.wait(280);
  }
}
