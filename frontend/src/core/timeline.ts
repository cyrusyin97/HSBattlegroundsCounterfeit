// Playback on real time. Cues run once, in order, when playback reaches them; updaters
// draw the state at the current time on every frame. Seeking forward over any span runs
// every cue in it, so a frame that arrives late (a background tab, a slow frame) shows
// the right state instead of resuming where the last frame stopped.
import { JUMP_MS } from './combat-timing.ts';

interface Cue { at: number; run: (late: number) => void }
type Updater = (time: number, jumped: boolean) => void;

export class Timeline {
  /** The playback position of the last seek, in milliseconds. */
  time = 0;
  disposed = false;
  private readonly cues: Cue[] = [];
  private next = 0;
  private readonly updaters = new Set<Updater>();
  private readonly disposers: (() => void)[] = [];

  /** Runs `run` once when playback reaches `at`; `late` is how far past `at` it already is. */
  at(at: number, run: (late: number) => void) {
    // Cues added while seeking go after the ones already run, so they still run in this seek.
    let i = this.cues.length;
    while (i > this.next && this.cues[i - 1].at > at) i--;
    this.cues.splice(i, 0, { at, run });
  }

  /** Calls `update` after the cues of every seek. `jumped` marks a step longer than a frame or two. */
  every(update: Updater): () => void {
    this.updaters.add(update);
    return () => this.updaters.delete(update);
  }

  onDispose(dispose: () => void) { this.disposers.push(dispose); }

  seek(time: number) {
    if (this.disposed) return;
    const jumped = time - this.time > JUMP_MS;
    this.time = time;
    while (this.next < this.cues.length && this.cues[this.next].at <= time) {
      const cue = this.cues[this.next++];
      cue.run(time - cue.at);
    }
    for (const update of [...this.updaters]) update(time, jumped);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.updaters.clear();
    for (const dispose of this.disposers.splice(0)) dispose();
  }
}

/** A source of frames: calls `frame` with the frame time and returns a function that stops it. */
export type Frames = (frame: (now: number) => void) => () => void;

/**
 * Plays `timeline` from `start` (a `performance.now()` time, possibly in the past) until
 * `duration`, then disposes it. Time comes from each frame's clock, never from counting frames.
 */
export function play(timeline: Timeline, duration: number, start: number, frames: Frames): Promise<void> {
  return new Promise(resolve => {
    const stop = frames(now => {
      const time = Math.max(0, now - start);
      timeline.seek(Math.min(time, duration));
      if (time < duration) return;
      stop();
      timeline.dispose();
      resolve();
    });
  });
}
