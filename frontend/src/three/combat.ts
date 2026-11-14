// Minion combat on the table, drawn from the combat schedule. The friendly warband keeps
// its recruit objects (`board:eid`), the opposing warband takes the shop row as
// `enemy:eid`. State changes (hits, deaths, settled boards) are cues on the timeline;
// attack poses are a function of the current time, so any frame can show any moment.
import * as THREE from 'three';
import type { AttackImpact, Minion } from '../game-api';
import type { CombatScript, CombatStep } from '../core/combat-script';
import type { AttackEvent, CombatSchedule } from '../core/combat-timeline';
import { ATTACK, EFFECT } from '../core/combat-timing';
import type { Timeline } from '../core/timeline';
import { CardKit, CardObject, faceOf } from './entities';
import { easeIn, pose, reducedMotion, samplePose, type Key as Frame, type Pose } from './motion';
import { burstLabel, Labels, Particles } from './fx';
import { t as messages } from '../i18n';
import type { Key, Placement } from './reconciler';

export interface CombatTable {
  kit: CardKit;
  particles: Particles;
  labels: Labels;
  cards: ReadonlyMap<Key, CardObject>;
  /** The object for `key`, created above its slot when absent. */
  obtain(key: Key): CardObject;
  /** Rest positions for a row, laid out like the recruit rows. */
  arrange(zone: 'shop' | 'board', list: Placement[]): void;
  /** Every card jumps to its goal pose. */
  snap(): void;
}

const GOLD = 0xffd36b;
const up = (v: THREE.Vector3, y: number) => v.clone().setY(v.y + y);
const HIT_AT = ATTACK.lunge;
const BACK_AT = HIT_AT + ATTACK.hold;
const LABEL_FRAMES: Keyframe[] = [
  { opacity: 0, transform: 'scale(.48) rotate(-12deg)' },
  { opacity: 1, transform: 'scale(1.13) rotate(-4deg)', offset: .13 },
  { opacity: 1, transform: 'scale(1) rotate(-4deg)', offset: .78 },
  { opacity: 0, transform: 'translateY(-10px) scale(.95)' },
];

/** The poses of one drawn attack, fixed when it starts from the rest positions of that step. */
interface Choreography {
  attacker: CardObject;
  defender: CardObject;
  lunge: Frame<Pose>[];
  hit: Pose;
  back: Frame<Pose>[];
  recoil: Frame<Pose>[];
}

export function stageCombat(t: CombatTable, script: CombatScript, schedule: CombatSchedule, timeline: Timeline) {
  const keys = new Map<number, Key>();
  const keyOf = (eid: number) => keys.get(eid);
  const objectOf = (eid: number) => {
    const key = keyOf(eid);
    return key ? t.cards.get(key) : undefined;
  };

  function settle(step: CombatStep) {
    const rows: ['board' | 'shop', Minion[], 'board' | 'enemy'][] = [
      ['board', step.friendly, 'board'], ['shop', step.enemy, 'enemy'],
    ];
    const present = new Set<Key>();
    for (const [zone, list, prefix] of rows) {
      const placements = list.map((card, index): Placement => {
        const key: Key = `${prefix}:${card.eid}`;
        keys.set(card.eid, key);
        present.add(key);
        return { key, zone, id: card.eid, card, index };
      });
      for (const p of placements) t.obtain(p.key).show(p, faceOf(p));
      t.arrange(zone, placements);
    }
    // After a jump over several steps, minions that died in a skipped step leave too.
    for (const [key, obj] of t.cards) {
      if ((key.startsWith('board:') || key.startsWith('enemy:')) && !present.has(key) && !obj.removing) obj.remove();
    }
  }

  function shatter(obj: CardObject) {
    t.particles.burst(obj.position, { count: 9, color: GOLD, speed: 2.6, up: 0.6, size: 0.14, life: 0.45 });
  }

  function hit(h: AttackImpact['hits'][number], late: number) {
    const obj = objectOf(h.target);
    if (!obj) return;
    obj.restat({ hp: h.hp });
    obj.shield = h.shield_hits > 0;
    if (h.absorbed && late < EFFECT.shatter) shatter(obj);
    if ((!h.damage && !h.absorbed) || late >= EFFECT.label) return;
    void t.labels.show(burstLabel(h.absorbed ? messages().combat.blocked : '−' + h.damage, h.absorbed),
      () => obj.anchor(0, 0.16), LABEL_FRAMES, EFFECT.label, late);
  }

  for (const event of schedule.events) {
    if (event.kind === 'attack') {
      timeline.at(event.contact, late => {
        for (const h of event.impact.hits) hit(h, late);
        if (event.shown && late < EFFECT.flash) objectOf(event.impact.to)?.flash();
      });
    } else if (event.kind === 'deaths') {
      const step = script.steps[event.step];
      timeline.at(event.at, () => {
        for (const eid of step.deaths) objectOf(eid)?.remove();
      });
    } else if (event.kind === 'settle') {
      const step = script.steps[event.step];
      timeline.at(event.at, late => {
        if (late < EFFECT.shatter) {
          for (const eid of step.shieldBreaks) {
            const obj = objectOf(eid);
            if (obj) shatter(obj);
          }
        }
        settle(step);
      });
    }
  }

  const choreographies = new Map<AttackEvent, Choreography | null>();
  function choreograph(event: AttackEvent): Choreography | null {
    const attacker = objectOf(event.impact.from), defender = objectOf(event.impact.to);
    if (!attacker || !defender || attacker.removing || defender.removing) return null;
    const start = attacker.restPosition.clone(), target = defender.restPosition.clone();
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
    const recoil = pose(up(target.clone().addScaledVector(u, 0.24), 0.1), toward * 0.3, bank);
    const lift = pose(up(start.clone().lerp(contact, 0.36), 0.4), toward * 0.1, -bank * 0.5);
    return {
      attacker, defender, hit: hitPose,
      lunge: [{ at: 0, value: rest }, { at: 0.48, value: hover }, { at: 0.72, value: hover }, { at: 1, value: hitPose, ease: easeIn }],
      back: [{ at: 0, value: hitPose }, { at: 0.5, value: lift }, { at: 0.88, value: pose(up(start, 0.02), -0.05) }, { at: 1, value: rest }],
      recoil: [{ at: 0, value: pose(target) }, { at: 0.22, value: recoil }, { at: 1, value: pose(target) }],
    };
  }

  const attacks = schedule.events.filter((e): e is AttackEvent => e.kind === 'attack' && e.shown);
  const attackerPose = pose(new THREE.Vector3()), defenderPose = pose(new THREE.Vector3());
  let driven: CardObject[] = [];
  let next = 0;
  // Progress through a segment; reduced motion shows each segment's end pose.
  const progress = (elapsed: number, ms: number) => reducedMotion.matches ? 1 : Math.min(1, Math.max(0, elapsed / ms));

  function poses(time: number) {
    while (next < attacks.length && time >= attacks[next].at + attacks[next].ms) next++;
    const event = attacks[next];
    const now: CardObject[] = [];
    if (event && time >= event.at) {
      if (!choreographies.has(event)) choreographies.set(event, choreograph(event));
      const c = choreographies.get(event);
      const elapsed = time - event.at;
      if (c && !c.attacker.removing) {
        if (elapsed < HIT_AT) c.attacker.override = samplePose(c.lunge, progress(elapsed, ATTACK.lunge), attackerPose);
        else if (elapsed < BACK_AT) c.attacker.override = c.hit;
        else if (elapsed < BACK_AT + ATTACK.back) c.attacker.override = samplePose(c.back, progress(elapsed - BACK_AT, ATTACK.back), attackerPose);
        if (elapsed < BACK_AT + ATTACK.back) now.push(c.attacker);
      }
      if (c && !c.defender.removing && elapsed >= HIT_AT && elapsed < HIT_AT + ATTACK.recoil) {
        c.defender.override = samplePose(c.recoil, progress(elapsed - HIT_AT, ATTACK.recoil), defenderPose);
        now.push(c.defender);
      }
    }
    for (const obj of driven) if (!now.includes(obj)) obj.override = undefined;
    driven = now;
  }

  timeline.every((time, jumped) => {
    poses(time);
    // After a jump the springs would ease from a stale position; the table shows the present.
    if (jumped) t.snap();
  });
  timeline.onDispose(() => {
    for (const obj of driven) obj.override = undefined;
    driven = [];
  });
}
