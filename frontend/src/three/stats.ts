// `?stats` panel: frame rate, CPU frame time and draw counts, for profiling.
import type { Stage } from './stage';

export function showStats(stage: Stage, parent: HTMLElement) {
  const panel = document.createElement('pre');
  panel.className = 'stats';
  parent.append(panel);
  const times: number[] = [];
  let frames = 0, elapsed = 0;
  stage.onFrame(dt => {
    frames++;
    elapsed += dt;
    times.push(stage.frameMs);
    if (elapsed < 0.5) return;
    times.sort((a, b) => a - b);
    const mean = times.reduce((a, b) => a + b, 0) / times.length;
    const { calls, triangles } = stage.renderer.info.render;
    panel.textContent = [
      `${Math.round(frames / elapsed)} fps`,
      `cpu ${mean.toFixed(2)} ms · p95 ${times[Math.floor(times.length * 0.95)].toFixed(2)} ms`,
      `${calls} draws · ${triangles} tris`,
    ].join('\n');
    frames = 0;
    elapsed = 0;
    times.length = 0;
  });
}
