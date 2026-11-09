// Timed motion on the stage clock, for choreography that a spring cannot express:
// lunges, recoils and effect sequences. Everything resolves as a promise so a
// sequence reads top to bottom.
import * as THREE from 'three';
import type { Stage } from './stage';

export const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

/** A pose relative to nothing: world position plus pitch and roll in radians. */
export interface Pose { pos: THREE.Vector3; pitch: number; roll: number }
export interface Key<T> { at: number; value: T; ease?: (t: number) => number }

export const smooth = (t: number) => t * t * (3 - 2 * t);
export const easeIn = (t: number) => t * t;
export const easeOut = (t: number) => 1 - (1 - t) * (1 - t);

export class Clock {
  private readonly tasks = new Set<(dt: number) => boolean>();

  constructor(stage: Stage) {
    stage.onFrame(dt => {
      for (const task of [...this.tasks]) if (task(dt)) this.tasks.delete(task);
    });
  }

  /** Calls `update` with progress 0 → 1 over `ms`. Reduced motion jumps to the end. */
  tween(ms: number, update: (t: number) => void): Promise<void> {
    if (reducedMotion.matches || ms <= 0) {
      update(1);
      return Promise.resolve();
    }
    update(0);
    return this.run(ms, update);
  }

  /** A pause that holds under reduced motion too, so results stay readable. */
  wait(ms: number): Promise<void> { return ms > 0 ? this.run(ms, () => {}) : Promise.resolve(); }

  private run(ms: number, update: (t: number) => void) {
    return new Promise<void>(resolve => {
      let elapsed = 0;
      this.tasks.add(dt => {
        elapsed += dt * 1000;
        const t = Math.min(1, elapsed / ms);
        update(t);
        if (t < 1) return false;
        resolve();
        return true;
      });
    });
  }
}

/** Piecewise interpolation between keyed poses. Each key's ease shapes the segment ending at it. */
export function samplePose(keys: Key<Pose>[], t: number, out: Pose): Pose {
  let i = 1;
  while (i < keys.length - 1 && t > keys[i].at) i++;
  const a = keys[i - 1], b = keys[i];
  const span = b.at - a.at;
  const k = (b.ease ?? smooth)(span > 0 ? Math.min(1, Math.max(0, (t - a.at) / span)) : 1);
  out.pos.lerpVectors(a.value.pos, b.value.pos, k);
  out.pitch = a.value.pitch + (b.value.pitch - a.value.pitch) * k;
  out.roll = a.value.roll + (b.value.roll - a.value.roll) * k;
  return out;
}

export const pose = (pos: THREE.Vector3, pitch = 0, roll = 0): Pose => ({ pos, pitch, roll });
