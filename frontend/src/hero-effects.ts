import type { Combat, GameSnapshot, HeroState } from './game-api';
import { loadCardImage } from './demo-art';
import { badge, byId } from './pieces';

async function animate(el: HTMLElement, frames: Keyframe[], duration: number) {
  const animation = el.animate(frames, {
    duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : duration,
    easing: 'ease-out', fill: 'both',
  });
  try { await animation.finished; } finally { animation.cancel(); }
}

export function renderHeroPanel(parent: HTMLElement, state: HeroState, ghost = false) {
  parent.replaceChildren();
  const body = document.createElement('div');
  body.className = 'hero-body';
  const portrait = badge('hero-image', '');
  body.append(portrait);
  if (state.hero) void loadCardImage(state.hero.id).then(image => {
    image.alt = state.hero!.name_zh;
    portrait.append(image);
  });
  body.append(badge('hero-armor', state.armor), badge('hero-health', state.health));
  parent.append(body, badge('hero-name', ghost ? '幽灵' : state.hero?.name_zh ?? '英雄'));
  parent.classList.toggle('ghost-hero', ghost);
  return body;
}

async function changeCounter(body: HTMLElement, kind: 'armor' | 'health', before: number, after: number) {
  const counter = body.querySelector<HTMLElement>('.hero-' + kind)!;
  counter.textContent = String(after);
  if (before === after) return;
  const gain = after > before;
  const delta = badge('hero-delta ' + kind + (gain ? ' gain' : ''), (gain ? '+' : '−') + Math.abs(after - before));
  body.append(delta);
  const effects: Promise<unknown>[] = [
    animate(counter, [
      {transform:'scale(1.45)', filter:'brightness(1.8)'},
      {transform:'scale(1)', filter:'brightness(1)'},
    ], 560),
    animate(delta, [
      {opacity:0, transform:'translateY(6px) scale(.6)'},
      {opacity:1, transform:'translateY(-12px) scale(1.15)', offset:.22},
      {opacity:1, transform:'translateY(-22px)', offset:.72},
      {opacity:0, transform:'translateY(-42px)'},
    ], 850),
  ];
  if (kind === 'armor' && before > 0 && after === 0) {
    for (let i = 0; i < 6; i++) {
      const shard = badge('armor-fragment', '');
      body.append(shard);
      effects.push(animate(shard, [
        {opacity:1, transform:'translate3d(0,0,0)'},
        {opacity:0, transform:`perspective(500px) translate3d(${(i-2.5)*16}px,${20+i*6}px,45px) rotate(${i*61}deg)`},
      ], 600).finally(() => shard.remove()));
    }
  }
  try { await Promise.all(effects); } finally { delta.remove(); }
}

export async function animateHeroVitals(parent: HTMLElement, before: HeroState, after: HeroState) {
  const body = parent.querySelector<HTMLElement>('.hero-body');
  if (!body || (before.health === after.health && before.armor === after.armor)) return;
  const damaged = after.health < before.health || after.armor < before.armor;
  const flash = damaged
    ? 'brightness(1.8) drop-shadow(0 0 12px #ff725c)'
    : 'brightness(1.5) drop-shadow(0 0 12px #85ebad)';
  await Promise.all([
    changeCounter(body, 'armor', before.armor, after.armor),
    changeCounter(body, 'health', before.health, after.health),
    animate(body.querySelector<HTMLElement>('.hero-image')!, [{filter:flash}, {filter:'none'}], 560),
  ]);
}

export function showCombatHeroes(replay: Combat, before: GameSnapshot) {
  const friendly = replay.a === before.state.seat ? 0 : 1;
  const opponentId = friendly === 0 ? replay.b : replay.a;
  const opponent = before.state.opponents.find(p => p.id === opponentId);
  renderHeroPanel(byId('hero'), before.state.me);
  const enemy = byId('enemy-hero');
  renderHeroPanel(enemy, opponent ?? {
    hero:null, health:0, armor:0, tier:1,
  }, opponentId === null);
  enemy.hidden = false;
  byId('table').classList.add('in-combat');
  byId('table').classList.remove('frozen');
}

export async function finishHeroCombat(replay: Combat, snapshot: GameSnapshot) {
  const friendly = replay.a === snapshot.state.seat ? 0 : 1;
  const opponentId = friendly === 0 ? replay.b : replay.a;
  const opponent = snapshot.state.opponents.find(player => player.id === opponentId);
  // End-of-turn and in-combat hero effects can change the pre-hit values.
  const starting = friendly === 0 ? [snapshot.state.me, opponent] : [opponent, snapshot.state.me];
  await Promise.all((replay.heroes_before ?? []).map(async (hero, side) => {
    if (hero && starting[side]) {
      await animateHeroVitals(byId(side === friendly ? 'hero' : 'enemy-hero'), starting[side], hero);
    }
  }));
  if (replay.winner === 2 || replay.damage <= 0) return;
  const winner = replay.winner;
  const loser = 1 - winner;
  // A defeated ghost has no hero to damage.
  if (loser === 1 && replay.b === null) return;
  const attackerPanel = byId(winner === friendly ? 'hero' : 'enemy-hero');
  const defenderPanel = byId(loser === friendly ? 'hero' : 'enemy-hero');
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
  try {
    await animate(damage, [{opacity:0, transform:'scale(.25)'}, {opacity:1, transform:'scale(1.3)'}, {transform:'scale(1)'}], 400);
    await animate(attacker, [
      {transform:pose(0,0,0,0)},
      {transform:pose(0,-direction*24-22,85,direction*22), offset:.45},
      {transform:pose(0,-direction*24-22,85,direction*22), offset:.7},
      {transform:contact},
    ], 600);
    attacker.style.transform = contact;
    const before = replay.heroes_before?.[loser];
    const after = replay.heroes_after?.[loser];
    const actual = before && after ? Math.max(0, before.health + before.armor - after.health - after.armor) : replay.damage;
    burst = badge('combat-burst hero-hit' + (actual === 0 ? ' absorbed' : ''), '');
    // Use the same outlined number styling as minion contact.
    const label = document.createElement('b');
    label.textContent = actual > 0 ? '−' + actual : '抵挡';
    burst.append(label);
    defender.append(burst);
    const effects = [
      animate(burst, [{opacity:0, transform:'scale(.4) rotate(-12deg)'}, {opacity:1, transform:'scale(1.2)', offset:.15}, {opacity:1, transform:'scale(1)', offset:.8}, {opacity:0}], 950),
      animate(defender, [{transform:pose(0,0,0,0)}, {transform:pose(0,direction*14,15,-direction*22),offset:.2}, {transform:pose(0,0,0,0)}], 420),
    ];
    if (before && after) effects.push(animateHeroVitals(defenderPanel, before, after));
    effects.push(animate(attacker, [
      {transform:contact, offset:0},
      {transform:contact, offset:.12},
      {transform:pose(x*.4,y*.4,65,direction*14),offset:.5},
      {transform:pose(0,3,0,6),offset:.88},
      {transform:pose(0,0,0,0)},
    ], 500));
    await Promise.all(effects);
    if (after && after.health <= 0) {
      defenderPanel.classList.add('hero-defeated');
      await animate(defender, [{filter:'brightness(1.7)'}, {filter:'grayscale(1) brightness(.5)',transform:'rotateZ(7deg) scale(.88)'}], 400);
    }
  } finally {
    damage.remove();
    burst?.remove();
    attacker.style.transform = '';
    attackerPanel.style.zIndex = '';
  }
}
