import type { Combat, GameSnapshot, HeroState } from './game-api';
import type { CombatSchedule, HeroSides } from './core/combat-timeline';
import { HERO } from './core/combat-timing';
import { play, Timeline, type Frames } from './core/timeline';
import { withCardImage } from './demo-art';
import { cardName, t } from './i18n';
import { badge, byId } from './pieces';

export function renderHeroPanel(parent: HTMLElement, state: HeroState, ghost = false) {
  parent.replaceChildren();
  const body = document.createElement('div');
  body.className = 'hero-body';
  const portrait = badge('hero-image', '');
  body.append(portrait);
  if (state.hero) withCardImage(state.hero.id, image => {
    image.alt = cardName(state.hero!);
    portrait.append(image);
  });
  body.append(badge('hero-armor', state.armor), badge('hero-health', state.health));
  parent.append(body, badge('hero-name', ghost ? t().hero.ghost : (state.hero && cardName(state.hero)) || t().hero.fallback));
  parent.classList.toggle('ghost-hero', ghost);
  return body;
}

const reduced = matchMedia('(prefers-reduced-motion: reduce)');

/**
 * A browser animation placed on `timeline`: it plays on its own (on the compositor where it
 * can), starting part-way when its cue ran late, after a background tab, and waiting when it
 * starts later than its cue. Browser animations run on real time, so it stays in step.
 * It is cancelled at `until` (its end by default), as a finished animation was before.
 */
function drive(timeline: Timeline, el: Element, frames: Keyframe[], start: number, ms: number,
  options: { fill?: FillMode; until?: number } = {}) {
  const still = reduced.matches;
  const animation = el.animate(frames, { duration: still ? 1 : ms, easing: 'ease-out', fill: options.fill ?? 'both' });
  const late = timeline.time - start;
  animation.currentTime = still && late >= 0 ? 1 : late;
  timeline.at(options.until ?? start + ms, () => animation.cancel());
  timeline.onDispose(() => animation.cancel());
}

/** Removes `el` at `at`, or when the timeline ends early. */
function removeAt(timeline: Timeline, el: Element, at: number) {
  timeline.at(at, () => el.remove());
  timeline.onDispose(() => el.remove());
}

function changeCounter(timeline: Timeline, body: HTMLElement, kind: 'armor' | 'health', before: number, after: number, at: number) {
  const counter = body.querySelector<HTMLElement>('.hero-' + kind)!;
  counter.textContent = String(after);
  if (before === after) return;
  const gain = after > before;
  const delta = badge('hero-delta ' + kind + (gain ? ' gain' : ''), (gain ? '+' : '−') + Math.abs(after - before));
  body.append(delta);
  drive(timeline, counter, [
    {transform:'scale(1.45)', filter:'brightness(1.8)'},
    {transform:'scale(1)', filter:'brightness(1)'},
  ], at, HERO.counterPulse);
  drive(timeline, delta, [
    {opacity:0, transform:'translateY(6px) scale(.6)'},
    {opacity:1, transform:'translateY(-12px) scale(1.15)', offset:.22},
    {opacity:1, transform:'translateY(-22px)', offset:.72},
    {opacity:0, transform:'translateY(-42px)'},
  ], at, HERO.delta);
  removeAt(timeline, delta, at + HERO.vitals);
  if (kind === 'armor' && before > 0 && after === 0) {
    for (let i = 0; i < 6; i++) {
      const shard = badge('armor-fragment', '');
      body.append(shard);
      drive(timeline, shard, [
        {opacity:1, transform:'translate3d(0,0,0)'},
        {opacity:0, transform:`perspective(500px) translate3d(${(i-2.5)*16}px,${20+i*6}px,45px) rotate(${i*61}deg)`},
      ], at, HERO.shards);
      removeAt(timeline, shard, at + HERO.shards);
    }
  }
}

/** Health and armor change on a hero panel, starting at `at` on the timeline. */
export function heroVitals(timeline: Timeline, parent: HTMLElement, before: HeroState, after: HeroState, at: number) {
  const body = parent.querySelector<HTMLElement>('.hero-body');
  if (!body || (before.health === after.health && before.armor === after.armor)) return;
  const damaged = after.health < before.health || after.armor < before.armor;
  const flash = damaged
    ? 'brightness(1.8) drop-shadow(0 0 12px #ff725c)'
    : 'brightness(1.5) drop-shadow(0 0 12px #85ebad)';
  changeCounter(timeline, body, 'armor', before.armor, after.armor, at);
  changeCounter(timeline, body, 'health', before.health, after.health, at);
  drive(timeline, body.querySelector<HTMLElement>('.hero-image')!, [{filter:flash}, {filter:'none'}], at, HERO.portraitFlash);
}

/** The same change on its own, outside a combat, on the page's frame clock. */
export async function animateHeroVitals(parent: HTMLElement, before: HeroState, after: HeroState) {
  if (before.health === after.health && before.armor === after.armor) return;
  const timeline = new Timeline();
  heroVitals(timeline, parent, before, after, 0);
  await play(timeline, HERO.vitals, performance.now(), animationFrames);
}

/** `requestAnimationFrame` as a frame source. */
export const animationFrames: Frames = frame => {
  let id = requestAnimationFrame(function tick(now) {
    id = requestAnimationFrame(tick);
    frame(now);
  });
  return () => cancelAnimationFrame(id);
};

/** The hero panels for a combat, showing the heroes as they were before it. */
export function showCombatHeroes(replay: Combat, before: GameSnapshot, starting: HeroSides) {
  const friendly = replay.a === before.state.seat ? 0 : 1;
  const opponentId = friendly === 0 ? replay.b : replay.a;
  renderHeroPanel(byId('hero'), starting[friendly] ?? before.state.me);
  const enemy = byId('enemy-hero');
  renderHeroPanel(enemy, starting[1 - friendly] ?? { hero:null, health:0, armor:0, tier:1 }, opponentId === null);
  enemy.hidden = false;
  byId('table').classList.add('in-combat');
}

/** The hero phase after the minion fight, on the combat's timeline. */
export function stageHeroCombat(timeline: Timeline, replay: Combat, seat: number, schedule: CombatSchedule, starting: HeroSides) {
  const friendly = replay.a === seat ? 0 : 1;
  const panel = (side: number) => byId(side === friendly ? 'hero' : 'enemy-hero');
  const vitals = schedule.events.find(e => e.kind === 'heroVitals');
  // End-of-turn and in-combat hero effects can change the values shown before the hit.
  if (vitals) timeline.at(vitals.at, () => (replay.heroes_before ?? []).forEach((hero, side) => {
    const shown = starting[side];
    if (hero && shown) heroVitals(timeline, panel(side), shown, hero, vitals.at);
  }));
  const attack = schedule.events.find(e => e.kind === 'heroAttack');
  if (!attack) return;
  const defeat = schedule.events.find(e => e.kind === 'heroDefeat');
  const winner = replay.winner, loser = 1 - winner;
  const lunge = attack.at + HERO.badge, contactAt = lunge + HERO.lunge;
  const end = attack.at + attack.ms + (defeat?.ms ?? 0);
  timeline.at(attack.at, () => {
    const attackerPanel = panel(winner), defenderPanel = panel(loser);
    const attacker = attackerPanel.querySelector<HTMLElement>('.hero-body')!;
    const defender = defenderPanel.querySelector<HTMLElement>('.hero-body')!;
    const damage = badge('hero-attack', replay.damage);
    attacker.append(damage);
    const a = attacker.getBoundingClientRect();
    const b = defender.getBoundingClientRect();
    const scale = byId('table').getBoundingClientRect().width / 1440;
    const x = (b.x + b.width/2 - a.x - a.width/2) / scale;
    const y = (b.y + b.height/2 - a.y - a.height/2) / scale;
    const direction = Math.sign(y);
    const pose = (x: number, y: number, z: number, pitch: number) =>
      `perspective(850px) translate3d(${x}px,${y}px,${z}px) rotateX(${pitch}deg)`;
    const contact = pose(x, y - direction * 64, 8, -direction * 12);
    attackerPanel.style.zIndex = '20';
    let burst: HTMLElement | undefined;
    const cleanup = () => {
      damage.remove();
      burst?.remove();
      attacker.style.transform = '';
      attackerPanel.style.zIndex = '';
    };
    timeline.at(end, cleanup);
    timeline.onDispose(cleanup);
    drive(timeline, damage, [{opacity:0, transform:'scale(.25)'}, {opacity:1, transform:'scale(1.3)'}, {transform:'scale(1)'}], attack.at, HERO.badge);
    // The lunge holds the contact pose until the return, which starts at contact, takes over.
    drive(timeline, attacker, [
      {transform:pose(0,0,0,0)},
      {transform:pose(0,-direction*24-22,85,direction*22), offset:.45},
      {transform:pose(0,-direction*24-22,85,direction*22), offset:.7},
      {transform:contact},
    ], lunge, HERO.lunge, { fill: 'forwards', until: contactAt + HERO.back });
    drive(timeline, attacker, [
      {transform:contact, offset:0},
      {transform:contact, offset:.12},
      {transform:pose(x*.4,y*.4,65,direction*14),offset:.5},
      {transform:pose(0,3,0,6),offset:.88},
      {transform:pose(0,0,0,0)},
    ], contactAt, HERO.back, { fill: 'forwards' });
    timeline.at(contactAt, () => {
      const before = replay.heroes_before?.[loser];
      const after = replay.heroes_after?.[loser];
      const actual = before && after ? Math.max(0, before.health + before.armor - after.health - after.armor) : replay.damage;
      burst = badge('combat-burst hero-hit' + (actual === 0 ? ' absorbed' : ''), '');
      // Use the same outlined number styling as minion contact.
      const label = document.createElement('b');
      label.textContent = actual > 0 ? '−' + actual : t().combat.blocked;
      burst.append(label);
      defender.append(burst);
      drive(timeline, burst, [{opacity:0, transform:'scale(.4) rotate(-12deg)'}, {opacity:1, transform:'scale(1.2)', offset:.15}, {opacity:1, transform:'scale(1)', offset:.8}, {opacity:0}],
        contactAt, HERO.contact, { until: end });
      drive(timeline, defender, [{transform:pose(0,0,0,0)}, {transform:pose(0,direction*14,15,-direction*22),offset:.2}, {transform:pose(0,0,0,0)}], contactAt, HERO.recoil);
      if (before && after) heroVitals(timeline, defenderPanel, before, after, contactAt);
    });
    if (defeat) timeline.at(defeat.at, () => {
      defenderPanel.classList.add('hero-defeated');
      drive(timeline, defender, [{filter:'brightness(1.7)'}, {filter:'grayscale(1) brightness(.5)',transform:'rotateZ(7deg) scale(.88)'}], defeat.at, HERO.defeat);
    });
  });
}
