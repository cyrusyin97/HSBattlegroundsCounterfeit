// Procedural textures for card objects and keyword layers. Each is drawn once per
// stage and shared; per-card layers clone the ones they scroll.
import * as THREE from 'three';
// Seamless greyscale tiles made by scripts/make_textures.py.
import mapleUrl from './materials/maple.png';
import smokeUrl from './materials/smoke.png';

/** Starts loading `url`; `get` returns the image once loaded, null before or on failure. */
function preload(url: string) {
  let image: HTMLImageElement | null = null;
  const ready = new Promise<void>(resolve => {
    const img = new Image();
    img.onload = () => { image = img; resolve(); };
    img.onerror = () => resolve();
    img.src = url;
  });
  return { ready, get: () => image };
}

const maple = preload(mapleUrl);
const smoke = preload(smokeUrl);
/** Resolves once the maple grain has loaded, or failed to. */
export const mapleReady = maple.ready;
/** Maple grain for card bodies, or null until it has loaded. */
export const mapleGrain = maple.get;

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

/**
 * Smoke tinted `tint` with a dark wash on top, at `alpha`. Until the smoke tile loads it
 * shows soft procedural puffs; then the canvas is redrawn and every clone updates.
 */
function tintedSmoke(tint: string, wash: string, alpha: number) {
  const texture = canvasTexture(256, 256, g => {
    g.fillStyle = 'rgba(10,6,18,.78)';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 70; i++) {
      const x = Math.random() * 256, y = Math.random() * 256, r = 16 + Math.random() * 44;
      const a = 0.1 + Math.random() * 0.14;
      wrapped(256, (dx, dy) => {
        const puff = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
        puff.addColorStop(0, `rgba(120,105,150,${a})`);
        puff.addColorStop(1, 'rgba(120,105,150,0)');
        g.fillStyle = puff;
        g.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
      });
    }
  });
  void smoke.ready.then(() => {
    const image = smoke.get();
    if (!image) return;
    const g = (texture.image as HTMLCanvasElement).getContext('2d')!;
    g.clearRect(0, 0, 256, 256);
    g.drawImage(image, 0, 0, 256, 256);
    // Lighter smoke (denser) keeps more of the tint; the wash darkens it all evenly.
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = tint;
    g.fillRect(0, 0, 256, 256);
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = wash;
    g.fillRect(0, 0, 256, 256);
    g.globalCompositeOperation = 'destination-in';
    g.fillStyle = `rgba(0,0,0,${alpha})`;
    g.fillRect(0, 0, 256, 256);
    g.globalCompositeOperation = 'source-over';
    texture.needsUpdate = true;
  });
  return texture;
}

/** Dark lavender smoke for Stealth, tiled across the face. */
export const smokeTexture = () => tintedSmoke('#8a78b4', 'rgba(8,5,16,.45)', 0.82);

/** Paler smoke for the ring that spills past a Stealth card's edges. */
export const smokeRingTexture = () => tintedSmoke('#6f5d96', 'rgba(8,5,16,.1)', 1);

/**
 * Alpha for that ring: clear over the middle of the card, densest just past its edges and
 * fading out beyond. Stretched over a plane larger than the card, the circle becomes an oval.
 */
export const ringMaskTexture = () => canvasTexture(256, 256, g => {
  const ring = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  ring.addColorStop(0, '#000');
  ring.addColorStop(0.52, '#000');
  ring.addColorStop(0.66, '#fff');
  ring.addColorStop(0.94, '#000');
  g.fillStyle = ring;
  g.fillRect(0, 0, 256, 256);
}, false);

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

/**
 * Wind for Windfury on transparency: a few tapered gusts, pointed at both ends and of uneven
 * thickness, in a band across the top of the face and one across the bottom; the middle
 * stays clear. Scrolls sideways across the face.
 */
export const windTexture = () => canvasTexture(256, 256, g => {
  // Empty pixels are white at the lowest alpha, not transparent black, so filtering the
  // thin gusts blends toward white instead of leaving a dark fringe.
  g.fillStyle = 'rgba(255,255,255,.005)';
  g.fillRect(0, 0, 256, 256);
  // [y from the top, length, thickness, bow]
  const gusts = [[18, 200, 10, -6], [38, 130, 4, -3], [8, 56, 2.5, -1], [222, 210, 11, -7], [244, 120, 3.5, -2]];
  for (const [y, len, thick, bow] of gusts) {
    const x = Math.random() * 256;
    for (const dx of [-256, 0, 256]) {
      const x0 = x + dx, x1 = x0 + len;
      // The head (left, where the wind is going) is brightest; the tail fades out.
      const fade = g.createLinearGradient(x0, 0, x1, 0);
      fade.addColorStop(0, 'rgba(255,255,255,0)');
      fade.addColorStop(0.22, 'rgba(255,255,255,.95)');
      fade.addColorStop(0.65, 'rgba(255,255,255,.55)');
      fade.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = fade;
      g.beginPath();
      g.moveTo(x0, y);
      g.bezierCurveTo(x0 + len * 0.3, y + bow - thick, x0 + len * 0.7, y + bow - thick, x1, y);
      g.bezierCurveTo(x0 + len * 0.7, y + bow + thick * 0.2, x0 + len * 0.3, y + bow + thick * 0.2, x0, y);
      g.fill();
    }
  }
});

/** Branching cracks on transparency, laid over Reborn's glass shell: a bright edge around a dark core. */
export const crackTexture = () => canvasTexture(512, 512, g => {
  // Both passes (highlight, then dark core) replay the same seeded walk so they line up.
  for (const [color, width] of [['rgba(255,255,255,.95)', 7], ['rgba(30,40,60,.95)', 3]] as const) {
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
