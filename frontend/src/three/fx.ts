// Shared effect layers: instanced shard particles in the scene, and DOM labels that
// follow a point on the table so numbers stay crisp at any scale.
import * as THREE from 'three';
import { reducedMotion } from './motion';
import type { Stage } from './stage';

interface Shard {
  pos: THREE.Vector3; vel: THREE.Vector3; spin: THREE.Vector3; rot: THREE.Euler;
  color: THREE.Color; size: number; life: number; age: number; gravity: number;
}
export interface BurstOptions {
  count: number; color: THREE.ColorRepresentation;
  /** Initial speed in world units per second, and how much of it points up. */
  speed: number; up?: number;
  size?: number; life?: number; gravity?: number;
  /** Spread in the table plane only, for rings and waves. */
  flat?: boolean;
}

export class Particles {
  private readonly mesh: THREE.InstancedMesh;
  private readonly shards: Shard[] = [];
  private readonly matrix = new THREE.Matrix4();
  private readonly quat = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();

  constructor(stage: Stage, private readonly capacity = 384) {
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0.5, 0), new THREE.Vector3(0.32, -0.2, 0), new THREE.Vector3(-0.22, -0.5, 0),
    ]);
    this.mesh = new THREE.InstancedMesh(geometry,
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false }), capacity);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.setColorAt(0, new THREE.Color());
    stage.scene.add(this.mesh);
    stage.onFrame((dt, _now, jumped) => {
      // Shards are short-lived; after a long gap they are already over.
      if (jumped) this.shards.length = 0;
      this.step(dt);
    });
  }

  burst(at: THREE.Vector3, o: BurstOptions) {
    if (reducedMotion.matches) return;
    const color = new THREE.Color(o.color);
    for (let i = 0; i < o.count && this.shards.length < this.capacity; i++) {
      const angle = (i / o.count) * Math.PI * 2 + Math.random() * 0.4;
      const up = o.flat ? 0 : (o.up ?? 0.5) * (0.6 + Math.random() * 0.8);
      const dir = new THREE.Vector3(Math.cos(angle), up, Math.sin(angle)).normalize();
      this.shards.push({
        pos: at.clone(), vel: dir.multiplyScalar(o.speed * (0.7 + Math.random() * 0.6)),
        spin: new THREE.Vector3(Math.random() * 12 - 6, Math.random() * 12 - 6, Math.random() * 12 - 6),
        rot: new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6),
        color: color.clone().offsetHSL(0, 0, (Math.random() - 0.5) * 0.15),
        size: (o.size ?? 0.12) * (0.7 + Math.random() * 0.6),
        life: (o.life ?? 0.5) * (0.8 + Math.random() * 0.4), age: 0, gravity: o.gravity ?? 6,
      });
    }
  }

  private step(dt: number) {
    if (!this.shards.length && !this.mesh.count) return;
    let n = 0;
    for (const s of this.shards) {
      s.age += dt;
      if (s.age >= s.life) continue;
      s.vel.y -= s.gravity * dt;
      s.pos.addScaledVector(s.vel, dt);
      s.rot.x += s.spin.x * dt; s.rot.y += s.spin.y * dt; s.rot.z += s.spin.z * dt;
      // Shards shrink away instead of fading, so one opaque material serves all.
      this.scale.setScalar(s.size * (1 - (s.age / s.life) ** 2));
      this.matrix.compose(s.pos, this.quat.setFromEuler(s.rot), this.scale);
      this.mesh.setMatrixAt(n, this.matrix);
      this.mesh.setColorAt(n, s.color);
      this.shards[n++] = s;
    }
    this.shards.length = n;
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
  }
}

/** DOM labels pinned to a moving board point. */
export class Labels {
  readonly layer = document.createElement('div');
  private readonly live = new Set<{ el: HTMLElement; at: () => { x: number; y: number } }>();

  constructor(stage: Stage, parent: HTMLElement) {
    this.layer.className = 'fx-layer';
    parent.append(this.layer);
    stage.onFrame(() => {
      for (const { el, at } of this.live) {
        const p = at();
        el.style.left = p.x + 'px';
        el.style.top = p.y + 'px';
      }
    });
  }

  /**
   * Shows `el` at `at()` for the duration of its animation, then removes it. `late` starts
   * the animation part-way, for a label whose moment has already begun.
   */
  async show(el: HTMLElement, at: () => { x: number; y: number }, frames: Keyframe[], ms: number, late = 0) {
    const item = { el, at };
    const p = at();
    el.style.left = p.x + 'px';
    el.style.top = p.y + 'px';
    el.ariaHidden = 'true';
    this.layer.append(el);
    this.live.add(item);
    const still = reducedMotion.matches ? frames.map(({ transform: _, ...rest }) => rest) : frames;
    const animation = el.animate(still, { duration: ms, easing: 'ease-out', fill: 'both' });
    if (late > 0) animation.currentTime = late;
    try { await animation.finished; } catch { /* cancelled */ } finally {
      this.live.delete(item);
      el.remove();
    }
  }
}

/** The outlined starburst used for combat and hero damage. */
export function burstLabel(text: string, absorbed: boolean) {
  const burst = document.createElement('span');
  burst.className = 'combat-burst' + (absorbed ? ' absorbed' : '');
  const label = document.createElement('b');
  label.textContent = text;
  burst.append(label);
  return burst;
}
