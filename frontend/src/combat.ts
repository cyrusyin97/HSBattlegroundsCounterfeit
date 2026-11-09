import { type Combat, type AttackImpact, type GameSnapshot } from './game-api';
import { byId, localPoint, piece } from './pieces';
import { showCombatHeroes, finishHeroCombat } from './hero-effects';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function motion(el: HTMLElement, frames: Keyframe[], duration: number) {
  await el.animate(frames, { duration, easing: 'ease-in-out' }).finished;
}

function shatter(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  const p = localPoint(r.x + r.width / 2, r.y + r.height / 2);
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    const shard = document.createElement('i');
    shard.className = 'shard';
    shard.style.left = p.x + Math.cos(a) * 45 + 'px';
    shard.style.top = p.y + Math.sin(a) * 50 + 'px';
    byId('table').append(shard);
    void motion(shard, [{}, { transform: 'translate(' + Math.cos(a)*55 + 'px,' + Math.sin(a)*55 + 'px) rotate(70deg)', opacity: 0 }], 420).then(() => shard.remove());
  }
}

// Keep each number on its recipient throughout recoil. Both badges change on contact,
// even when the defender is removed before the next board snapshot.
function showHit(el: HTMLElement, hit: AttackImpact['hits'][number]) {
  const health = el.querySelector<HTMLElement>('.health');
  if (health) {
    health.textContent = String(hit.hp);
    if (hit.damage > 0) {
      health.animate([{ transform: 'scale(1.55)', background: '#ff5642' }, {}], {duration: 480});
    }
  }
  if (hit.absorbed) shatter(el);
  el.classList.toggle('shield', hit.shield_hits > 0);
  if (!hit.damage && !hit.absorbed) return;
  const burst = document.createElement('span');
  burst.className = 'combat-burst' + (hit.absorbed ? ' absorbed' : '');
  const label = document.createElement('b');
  label.textContent = hit.absorbed ? '抵挡' : '−' + hit.damage;
  burst.append(label);
  el.append(burst);
  void motion(burst, [
    { opacity: 0, transform: 'scale(.48) rotate(-12deg)' },
    { opacity: 1, transform: 'scale(1.13) rotate(-4deg)', offset: .13 },
    { opacity: 1, transform: 'scale(1) rotate(-4deg)', offset: .78 },
    { opacity: 0, transform: 'translateY(-10px) scale(.95)' },
  ], 780).then(() => burst.remove());
}

async function collide(impact: AttackImpact, bodies: Map<number, HTMLElement>) {
  const attacker = bodies.get(impact.from), defender = bodies.get(impact.to);
  const applyHits = () => {
    for (const hit of impact.hits) {
      const el = bodies.get(hit.target);
      if (el) showHit(el, hit);
    }
  };
  if (!attacker || !defender) {
    applyHits();
    await delay(780);
    return;
  }

  const a = attacker.getBoundingClientRect(), b = defender.getBoundingClientRect();
  const scale = byId('table').getBoundingClientRect().width / 1440;
  const dx = (b.left - a.left) / scale, dy = (b.top - a.top) / scale;
  const distance = Math.hypot(dx, dy) || 1;
  const ux = dx / distance, uy = dy / distance;
  const fraction = 1 - 1 / Math.max(1, Math.hypot(dx / 96, dy / 124));
  const x = dx * fraction, y = dy * fraction;
  const pose = (x: number, y: number, z: number, pitch: number, roll: number) =>
    `perspective(780px) translate3d(${x}px,${y}px,${z}px) rotateX(${pitch}deg) rotateZ(${roll}deg)`;
  const rest = pose(0, 0, 0, 8, 0);
  const bank = ux * 8 + uy * 5;
  const hover = pose(-ux * 15, -uy * 14 - 36, 86, 8 + uy * 24, -bank);
  const contact = pose(x, y, 4, 8 - uy * 13, bank * .5);
  const approachMs = 450;
  const shadow = document.createElement('i');
  shadow.className = 'flight-shadow';
  shadow.style.left = attacker.offsetLeft + attacker.offsetWidth / 2 + 'px';
  shadow.style.top = attacker.offsetTop + attacker.offsetHeight * .78 + 'px';
  attacker.parentElement!.append(shadow);
  const hoverShadow = {transform: 'translate(14px,9px) scale(1.38)', opacity: .34, filter: 'blur(10px)'};
  const contactShadow = {transform: `translate(${x}px,${y}px) scale(.95)`, opacity: .62, filter:'blur(3px)'};
  attacker.style.zIndex = '8';
  try {
    shadow.animate([{}, {...hoverShadow, offset:.48}, {...hoverShadow,offset:.72}, contactShadow],
      {duration:approachMs,fill:'forwards'});
    await motion(attacker, [
      {transform:rest}, {transform:hover, offset:.48}, {transform:hover, offset:.72},
      {transform:contact, easing:'ease-in'}
    ], approachMs);
    attacker.style.transform = contact;
    applyHits();
    const recoil = pose(ux * 13, uy * 11, 8, 8 - uy * 20, bank);
    defender.animate([{transform:rest}, {transform:recoil, offset:.22}, {transform:rest}],
      {duration:310,easing:'ease-out'});
    defender.querySelector('.portrait')?.animate([{filter:'brightness(1.55)'}, {}], {duration:200});
    await delay(80);
    const returning = pose(x*.36, y*.36-20, 44, 8 + uy*10, -bank*.5);
    shadow.animate([contactShadow, {transform:'translate(6px,4px) scale(1.15)',opacity:.38}, {opacity:0}],
      {duration:330,fill:'forwards'});
    await motion(attacker, [{transform:contact}, {transform:returning,offset:.5},
      {transform:pose(0,3,0,11,0),offset:.88}, {transform:rest}], 330);
  } finally {
    shadow.remove();
    attacker.style.transform = '';
    attacker.style.zIndex = '';
  }
  await delay(380);
}

export async function playCombat(replay: Combat, before: GameSnapshot) {
  const seat = before.state.seat;
  const friendly = replay.a === seat ? 0 : 1;
  showCombatHeroes(replay, before);
  let bodies = new Map<number, HTMLElement>();
  byId('phase').textContent = '战斗 · 第 ' + replay.turn + ' 回合';
  for (const id of ['tools','end','hand','choices']) byId(id).replaceChildren();
  byId('choices').hidden = true;
  byId('status').textContent = '交战中';
  for (const frame of replay.frames) {
    // Older saved replays have attack IDs only. Animate contact without invented damage.
    const impacts = frame.impacts ?? frame.attacks.map(([from, to]) => ({ from, to, hits: [] }));
    for (const impact of impacts) await collide(impact, bodies);
    const next = new Map<number, HTMLElement>();
    const rows = frame.boards.map(board => board.map(card => {
      const el = piece(card);
      const before = bodies.get(card.eid);
      if (before?.classList.contains('shield') && !card.shield_hits) shatter(before);
      el.classList.add('combat-token');
      el.tabIndex = -1;
      next.set(card.eid, el);
      return el;
    }));
    await Promise.all([...bodies].filter(([id]) => !next.has(id)).map(([, el]) =>
      motion(el, [{}, { opacity: 0, transform: 'scale(.62) rotate(8deg)' }], 230)));
    byId('shop').replaceChildren(...rows[1-friendly]);
    byId('board').replaceChildren(...rows[friendly]);
    if (bodies.size) await Promise.all([...next].filter(([id]) => !bodies.has(id)).map(([, el]) =>
      motion(el, [{ opacity: 0, transform: 'scale(.55) translateY(20px)' }, {}], 290)));
    bodies = next;
    await delay(280);
  }
  byId('status').textContent = replay.winner === 2 ? '战斗平局' : (replay.winner === friendly ? '战斗胜利' : '战斗落败') + ' · ' + replay.damage + ' 点伤害';
  await finishHeroCombat(replay, before);
  await delay(850);
}
