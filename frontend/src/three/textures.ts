// Procedural textures for card objects and keyword layers. Each is drawn once per
// stage and shared; per-card layers clone the ones they scroll.
import * as THREE from 'three';

function canvasTexture(width: number, height: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d')!);
  const texture = new THREE.CanvasTexture(canvas);
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Draws `paint` at every wrapped offset so the tile repeats without seams. */
function wrapped(size: number, paint: (dx: number, dy: number) => void) {
  for (const [dx, dy] of [[0, 0], [size, 0], [-size, 0], [0, size], [0, -size]]) paint(dx, dy);
}

/** Dense dark smoke for Stealth, tiled across the face. */
export const smokeTexture = () => canvasTexture(256, 256, g => {
  g.fillStyle = 'rgba(10,6,18,.78)';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 70; i++) {
    const x = Math.random() * 256, y = Math.random() * 256, r = 16 + Math.random() * 44;
    const alpha = 0.1 + Math.random() * 0.14;
    wrapped(256, (dx, dy) => {
      const puff = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
      puff.addColorStop(0, `rgba(120,105,150,${alpha})`);
      puff.addColorStop(1, 'rgba(120,105,150,0)');
      g.fillStyle = puff;
      g.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
    });
  }
});

/**
 * One diagonal band of light on a wide transparent tile, for golden minions. Scrolled
 * sideways, it sweeps across the face and then leaves a pause before the next pass.
 */
export const sheenTexture = () => canvasTexture(512, 128, g => {
  const band = g.createLinearGradient(40, 0, 150, 0);
  band.addColorStop(0, 'rgba(255,248,220,0)');
  band.addColorStop(0.5, 'rgba(255,250,232,.85)');
  band.addColorStop(1, 'rgba(255,248,220,0)');
  g.fillStyle = band;
  g.beginPath();
  g.moveTo(60, 0); g.lineTo(130, 0); g.lineTo(100, 128); g.lineTo(30, 128);
  g.closePath();
  g.fill();
});

/** White wind streaks on transparency for Windfury; scrolls sideways across the face. */
export const windTexture = () => canvasTexture(256, 256, g => {
  g.lineCap = 'round';
  for (let i = 0; i < 9; i++) {
    const y = 20 + i * 27 + Math.random() * 10, len = 90 + Math.random() * 110, x = Math.random() * 256;
    const lift = (Math.random() - 0.5) * 30, width = 4 + Math.random() * 4;
    wrapped(256, dx => {
      const streak = g.createLinearGradient(x + dx, 0, x + dx + len, 0);
      streak.addColorStop(0, 'rgba(255,255,255,0)');
      streak.addColorStop(0.5, `rgba(255,255,255,${0.75 + Math.random() * 0.25})`);
      streak.addColorStop(1, 'rgba(255,255,255,0)');
      g.strokeStyle = streak;
      g.lineWidth = width;
      g.beginPath();
      g.moveTo(x + dx, y);
      g.bezierCurveTo(x + dx + len * 0.3, y - lift, x + dx + len * 0.6, y + lift, x + dx + len, y - lift * 0.4);
      // A curl at the head of some streaks reads as a gust.
      if (i % 3 === 0) g.arc(x + dx + len - 8, y - lift * 0.4 - 8, 8, Math.PI / 2, Math.PI * 1.9, true);
      g.stroke();
    });
  }
});

/** Translucent silver with branching cracks, for Reborn. Alpha carries the shell's opacity. */
export const crackTexture = () => canvasTexture(512, 512, g => {
  const sheen = g.createLinearGradient(0, 0, 512, 512);
  sheen.addColorStop(0, 'rgba(240,246,255,.34)');
  sheen.addColorStop(0.5, 'rgba(210,222,240,.16)');
  sheen.addColorStop(1, 'rgba(245,250,255,.3)');
  g.fillStyle = sheen;
  g.fillRect(0, 0, 512, 512);
  // Both passes (highlight, then dark core) replay the same seeded walk so they line up.
  for (const [color, width] of [['rgba(255,255,255,.95)', 4], ['rgba(70,85,110,.85)', 1.6]] as const) {
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const crack = (x: number, y: number, angle: number, length: number, depth: number) => {
      g.beginPath();
      g.moveTo(x, y);
      for (let step = 0; step < 6; step++) {
        angle += (rand() - 0.5) * 0.9;
        x += Math.cos(angle) * length / 6;
        y += Math.sin(angle) * length / 6;
        g.lineTo(x, y);
        if (depth > 0 && rand() < 0.3) {
          g.stroke();
          crack(x, y, angle + (rand() < 0.5 ? 0.8 : -0.8), length * 0.5, depth - 1);
          g.beginPath();
          g.moveTo(x, y);
        }
      }
      g.stroke();
    };
    g.strokeStyle = color;
    g.lineWidth = width;
    for (let i = 0; i < 7; i++) crack(rand() * 512, rand() * 512, rand() * 6.3, 160 + rand() * 140, 2);
  }
});

/** Hammered steel for the Taunt bulwark. */
export const steelTexture = () => canvasTexture(256, 256, g => {
  const base = g.createLinearGradient(0, 0, 256, 256);
  base.addColorStop(0, '#d9d6cf');
  base.addColorStop(0.45, '#8f8b84');
  base.addColorStop(1, '#c7c2b8');
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 260; i++) {
    const x = Math.random() * 256, y = Math.random() * 256, r = 3 + Math.random() * 9;
    const dent = g.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
    dent.addColorStop(0, `rgba(255,255,255,${0.06 + Math.random() * 0.1})`);
    dent.addColorStop(1, `rgba(40,36,32,${0.05 + Math.random() * 0.08})`);
    g.fillStyle = dent;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
});

/** A bone-white skull on a dark disc, hung at the bottom of Deathrattle cards. */
export const skullTexture = () => badge('#3a2a4a', '#c9a4ff', g => {
  g.fillStyle = '#f2ead8';
  g.beginPath();
  g.arc(64, 56, 30, Math.PI * 0.9, Math.PI * 2.1);
  g.lineTo(84, 82); g.lineTo(44, 82); g.closePath();
  g.fill();
  g.fillRect(48, 80, 32, 14);
  g.fillStyle = '#3a2a4a';
  g.beginPath(); g.ellipse(52, 60, 8, 10, -0.2, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.ellipse(76, 60, 8, 10, 0.2, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.moveTo(64, 70); g.lineTo(59, 79); g.lineTo(69, 79); g.closePath(); g.fill();
  g.fillRect(55, 86, 3, 8); g.fillRect(63, 86, 3, 8); g.fillRect(71, 86, 3, 8);
});

/** A green poison flask, hung at the bottom of Venomous cards. */
export const poisonTexture = () => badge('#1e3b1c', '#9fe36b', g => {
  g.fillStyle = '#8a6a43';
  g.fillRect(56, 24, 16, 12);
  g.fillStyle = '#d8efe0';
  g.fillRect(58, 34, 12, 16);
  const liquid = g.createRadialGradient(58, 70, 4, 64, 76, 30);
  liquid.addColorStop(0, '#d6ff8a');
  liquid.addColorStop(0.6, '#5fcf2f');
  liquid.addColorStop(1, '#2c7a17');
  g.fillStyle = liquid;
  g.beginPath(); g.arc(64, 76, 26, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#e8f6ea';
  g.lineWidth = 4;
  g.beginPath(); g.arc(64, 76, 26, -Math.PI * 0.35, Math.PI * 1.35); g.stroke();
  g.fillStyle = 'rgba(255,255,255,.7)';
  g.beginPath(); g.arc(55, 68, 5, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(70, 84, 3, 0, Math.PI * 2); g.fill();
});

function badge(fill: string, ring: string, icon: (g: CanvasRenderingContext2D) => void) {
  return canvasTexture(128, 128, g => {
    g.beginPath();
    g.arc(64, 64, 60, 0, Math.PI * 2);
    const disc = g.createRadialGradient(54, 44, 6, 64, 64, 60);
    disc.addColorStop(0, fill);
    disc.addColorStop(1, '#120a08');
    g.fillStyle = disc;
    g.fill();
    g.lineWidth = 6;
    g.strokeStyle = ring;
    g.stroke();
    g.lineWidth = 3;
    g.strokeStyle = '#e8cf95';
    g.beginPath();
    g.arc(64, 64, 63, 0, Math.PI * 2);
    g.stroke();
    icon(g);
  });
}

/** Soft round shadow under each card. */
export const radialTexture = () => canvasTexture(128, 128, g => {
  const fill = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  fill.addColorStop(0, 'rgba(0,0,0,1)');
  fill.addColorStop(0.5, 'rgba(0,0,0,.55)');
  fill.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = fill;
  g.fillRect(0, 0, 128, 128);
}, false);
