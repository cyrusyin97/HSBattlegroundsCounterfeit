// Tavern effects after a confirmed refresh, freeze or upgrade. The snapshot is
// already rendered; these play over it and resolve when the table is at rest.
import * as THREE from 'three';
import { CardKit, CardObject, ICE_OPACITY } from './entities';
import { Clock, drive, easeOut, pose, smooth } from './motion';
import type { Particles } from './fx';
import { ZONES } from './layout';
import type { Stage } from './stage';

export interface EffectTable { stage: Stage; kit: CardKit; clock: Clock; particles: Particles }

const shopCenter = (stage: Stage, height = 0) =>
  stage.boardToWorld((ZONES.shop.left + ZONES.shop.right) / 2, (ZONES.shop.top + ZONES.shop.bottom) / 2, height);
const after = (clock: Clock, ms: number, run: () => Promise<void>) => clock.wait(ms).then(run);

/** A brief lift of one card, with the top tipping toward the camera. */
const hop = (t: EffectTable, obj: CardObject, height: number, ms: number) => {
  const rest = obj.restPosition.clone();
  return drive(t.clock, obj, [
    { at: 0, value: pose(rest) },
    { at: 0.45, value: pose(rest.clone().addScaledVector(t.kit.normal, height * 0.6).setY(rest.y + height), -0.3) },
    { at: 1, value: pose(rest) },
  ], ms);
};

/** Old cards tumble toward the back of the table; new ones flip in one by one. */
export async function refresh(t: EffectTable, departing: CardObject[], arriving: CardObject[]) {
  const leaving = departing.map((obj, i) => after(t.clock, i * 30, async () => {
    const from = obj.position.clone();
    await drive(t.clock, obj, [
      { at: 0, value: pose(from) },
      { at: 1, value: pose(from.clone().add(new THREE.Vector3(-0.35, 0.5, -0.9)), 1.3, -0.25), ease: easeOut },
    ], 260);
    obj.remove();
  }));
  const coming = arriving.map((obj, i) => after(t.clock, 170 + i * 62, async () => {
    const rest = obj.restPosition.clone();
    obj.visible = true;
    await drive(t.clock, obj, [
      { at: 0, value: pose(rest.clone().add(new THREE.Vector3(0.6, 0.7, 0.5)), -1.2, 0.35) },
      { at: 0.78, value: pose(rest.clone().setY(rest.y + 0.05), 0.12) },
      { at: 1, value: pose(rest) },
    ], 460);
  }));
  await Promise.all([...leaving, ...coming]);
}

export async function freeze(t: EffectTable, freezing: boolean, shop: CardObject[], wasFrozen: Set<CardObject>) {
  const wave = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshBasicMaterial({
    color: 0xd8fbff, transparent: true, opacity: 0, depthWrite: false, toneMapped: false,
  }));
  wave.rotation.x = -Math.PI / 2;
  wave.position.copy(shopCenter(t.stage, 0.01));
  const reach = Math.abs(t.stage.boardToWorld(ZONES.shop.right, ZONES.shop.bottom).x);
  t.stage.scene.add(wave);
  // Shells appear on cue, card by card.
  if (freezing) for (const obj of shop) obj.ice.material.opacity = 0;
  const sweep = t.clock.tween(650, k => {
    wave.scale.set(reach * (0.08 + 0.92 * k), 1, reach * 0.35 * (0.08 + 0.92 * k));
    wave.material.opacity = 0.55 * (k < 0.35 ? k / 0.35 : 1 - (k - 0.35) / 0.65);
  });
  const cards = shop.map((obj, i) => after(t.clock, 55 * i, async () => {
    if (freezing) {
      const ice = obj.ice;
      await Promise.all([
        t.clock.tween(440, k => {
          const e = smooth(Math.min(1, k / 0.76));
          ice.scale.setScalar(1.38 - 0.42 * e + (k > 0.76 ? 0.04 * (k - 0.76) / 0.24 : 0));
          ice.material.opacity = ICE_OPACITY * e;
        }),
        hop(t, obj, 0.18, 400),
      ]);
    } else if (wasFrozen.has(obj)) {
      t.particles.burst(obj.position, { count: 10, color: 0xbff4ff, speed: 2.2, up: 0.7, size: 0.13, life: 0.46 });
    }
  }));
  try { await Promise.all([sweep, ...cards]); } finally {
    t.stage.scene.remove(wave);
    wave.geometry.dispose();
    wave.material.dispose();
  }
}

export async function upgrade(t: EffectTable, tier: number, shop: CardObject[]) {
  const center = shopCenter(t.stage);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 64), new THREE.MeshBasicMaterial({
    color: 0xffe088, transparent: true, depthWrite: false, toneMapped: false, opacity: 0,
  }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.copy(center).setY(0.012);
  const radius = Math.abs(t.stage.boardToWorld(ZONES.shop.right, ZONES.shop.bottom).x) * 0.8;
  const crest = new THREE.Sprite(new THREE.SpriteMaterial({ map: crestTexture(tier), transparent: true, depthTest: false, toneMapped: false }));
  crest.renderOrder = 10;
  t.stage.scene.add(ring, crest);
  // Raised off the table but shown over the middle of the shop row, clear of the phase label.
  const rise = t.stage.boardToWorld((ZONES.shop.left + ZONES.shop.right) / 2, 250, 1.4);
  const crestPlay = t.clock.tween(980, k => {
    const enter = smooth(Math.min(1, k / 0.3));
    const leave = k > 0.75 ? (k - 0.75) / 0.25 : 0;
    crest.position.copy(center).setY(0.2).lerp(rise, enter).y += leave * 0.6;
    crest.scale.set(2.2, 1.3, 1).multiplyScalar((0.3 + 0.7 * enter) * (1 - 0.18 * leave));
    crest.material.opacity = enter * (1 - leave);
  });
  const ringPlay = after(t.clock, 100, () => t.clock.tween(760, k => {
    ring.scale.setScalar(radius * (0.1 + 1.15 * easeOut(k)));
    ring.material.opacity = 1 - k;
  }));
  const sparks = after(t.clock, 155, async () => {
    t.particles.burst(rise, { count: 14, color: 0xffcf61, speed: 3.2, up: 0.25, size: 0.15, life: 0.5, gravity: 3 });
  });
  const hops = shop.map((obj, i) => after(t.clock, 160 + i * 28, () => hop(t, obj, 0.22, 410)));
  try { await Promise.all([crestPlay, ringPlay, sparks, ...hops]); } finally {
    t.stage.scene.remove(ring, crest);
    ring.geometry.dispose();
    ring.material.dispose();
    crest.material.map?.dispose();
    crest.material.dispose();
  }
}

/** A faceted gold badge with the new tier. */
function crestTexture(tier: number) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 150;
  const g = canvas.getContext('2d')!;
  const shape = () => {
    g.beginPath();
    g.moveTo(18, 0); g.lineTo(238, 0); g.lineTo(256, 22); g.lineTo(230, 110); g.lineTo(128, 150);
    g.lineTo(26, 110); g.lineTo(0, 22); g.closePath();
  };
  const fill = g.createLinearGradient(0, 0, 256, 150);
  fill.addColorStop(0, '#ffed9c'); fill.addColorStop(0.22, '#ab6020'); fill.addColorStop(0.47, '#ffcb61'); fill.addColorStop(0.85, '#7e410e');
  shape();
  g.fillStyle = fill;
  g.fill();
  g.save();
  g.translate(128, 75); g.scale(0.88, 0.84); g.translate(-128, -75);
  shape();
  const inner = g.createLinearGradient(0, 0, 256, 150);
  inner.addColorStop(0, '#a06623'); inner.addColorStop(0.3, '#d99b36'); inner.addColorStop(0.64, '#bb7724'); inner.addColorStop(1, '#ffdc80');
  g.fillStyle = inner;
  g.fill();
  g.restore();
  g.font = '900 64px Georgia,serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 8;
  g.strokeStyle = '#542b12';
  g.strokeText('★ ' + tier, 128, 62);
  g.fillStyle = '#fff4bc';
  g.fillText('★ ' + tier, 128, 62);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
