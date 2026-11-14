// Card numbers (attack, health, shop price) drawn as quads over the face from one glyph
// atlas, so a changed number rewrites a few vertices instead of redrawing and uploading
// the whole face. Glyphs are drawn with the same canvas styling the face once used for
// its numbers, and laid out with the canvas's own text metrics.
import * as THREE from 'three';
import type { Face } from './entities';

/** Face texture width in pixels; sizes below are in 256ths of it, as in the face drawing. */
export const FACE_PX = 512;
const U = FACE_PX / 256;
const GLYPHS = '0123456789♥–';
const FONT = (size: number) => `bold ${size * U}px Georgia,serif`;
const OUTLINE = '#1a0d06';
const LINE = 11 * U, BLUR = 6 * U, DROP = 4 * U;
/** Room around the ink for the outline and its shadow. */
const PAD = Math.ceil(LINE / 2 + BLUR * 1.5 + 2);
/** Empty texels between cells, so mipmaps do not bleed one glyph into the next. */
const GUTTER = 6;

type Style = 'stat' | 'price';
const SIZES: Record<Style, number> = { stat: 60, price: 48 };
const COLORS = { atk: '#ffd66b', hp: '#ff7a6b', price: '#ffe9a8' } as const;

/** A glyph cell: its rectangle in the atlas, and where that lies around the pen at the baseline. */
interface Cell { u0: number; v0: number; u1: number; v1: number; left: number; top: number; w: number; h: number }
interface Glyph { outline: Cell; fill: Cell }

/** A number to draw, at a baseline point on the face in face pixels. */
interface Run { text: string; x: number; y: number; align: 'left' | 'right'; style: Style; color: string }

/** The numbers a face shows, placed as the face drawing placed them. */
function runs(f: Face, faceHeight: number): Run[] {
  const low = faceHeight - 30 * U, out: Run[] = [];
  if (f.atk !== undefined) out.push({ text: String(f.atk), x: 18 * U, y: low, align: 'left', style: 'stat', color: COLORS.atk });
  if (f.hp !== undefined) out.push({ text: String(f.hp), x: FACE_PX - 18 * U, y: low, align: 'right', style: 'stat', color: COLORS.hp });
  if (f.price !== undefined) {
    out.push({ text: (f.costsHealth ? '♥' : '') + (f.price ?? '–'), x: FACE_PX - 16 * U, y: 30 * U, align: 'right', style: 'price', color: COLORS.price });
  }
  return out;
}

/** The part of a face its numbers come from, as a cache key. */
export function numbersKey(f: Face) {
  return `${f.atk}|${f.hp}|${f.price}|${f.costsHealth}`;
}

export class CardNumbers {
  readonly material: THREE.MeshStandardMaterial;
  private readonly glyphs = new Map<string, Glyph>();
  private readonly measure: CanvasRenderingContext2D;
  readonly texture: THREE.CanvasTexture;

  constructor(maxAnisotropy: number, private readonly cardWidth: number, private readonly cardHeight: number,
    private readonly faceHeight: number) {
    this.measure = document.createElement('canvas').getContext('2d')!;
    const canvas = this.drawAtlas();
    this.texture = new THREE.CanvasTexture(canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = maxAnisotropy;
    // Lit like the face, so the numbers keep the look they had when drawn on it.
    this.material = new THREE.MeshStandardMaterial({
      map: this.texture, roughness: 0.6, vertexColors: true, transparent: true, depthWrite: false,
    });
  }

  /** A mesh for one card's numbers; it shares the atlas and owns its geometry and material. */
  mesh() {
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material.clone());
    mesh.raycast = () => {};
    return mesh;
  }

  /** Rewrites `mesh` to show the numbers of `face`: outlines first, then fills over them. */
  update(mesh: THREE.Mesh, face: Face) {
    const outlines: [Cell, number, number][] = [], fills: [Cell, number, number, string][] = [];
    for (const run of runs(face, this.faceHeight)) {
      const g = this.measure;
      g.font = FONT(SIZES[run.style]);
      const chars = [...run.text];
      // Pen positions from the canvas's own measure of each prefix, so kerning matches a
      // single fillText of the whole number.
      const start = run.align === 'left' ? run.x : run.x - g.measureText(run.text).width;
      let prefix = '';
      for (const ch of chars) {
        const glyph = this.glyphs.get(run.style + ch);
        const x = start + g.measureText(prefix).width;
        prefix += ch;
        if (!glyph) continue;
        outlines.push([glyph.outline, x, run.y]);
        fills.push([glyph.fill, x, run.y, run.color]);
      }
    }
    const quads = outlines.length + fills.length;
    const position = new Float32Array(quads * 12), uv = new Float32Array(quads * 8);
    const color = new Float32Array(quads * 12), normal = new Float32Array(quads * 12);
    const index = new Uint16Array(quads * 6);
    const tint = new THREE.Color();
    let q = 0;
    const put = (cell: Cell, x: number, y: number, c: THREE.Color) => {
      // Face pixels (y down) to the face plane (y up), centred on the card.
      const x0 = (x + cell.left) / FACE_PX - 0.5, x1 = (x + cell.left + cell.w) / FACE_PX - 0.5;
      const y0 = 0.5 - (y + cell.top) / this.faceHeight, y1 = 0.5 - (y + cell.top + cell.h) / this.faceHeight;
      const corners = [[x0, y0, cell.u0, cell.v0], [x1, y0, cell.u1, cell.v0], [x1, y1, cell.u1, cell.v1], [x0, y1, cell.u0, cell.v1]];
      corners.forEach(([px, py, tu, tv], i) => {
        const v = q * 4 + i;
        position.set([px * this.cardWidth, py * this.cardHeight, 0], v * 3);
        uv.set([tu, tv], v * 2);
        color.set([c.r, c.g, c.b], v * 3);
        normal.set([0, 0, 1], v * 3);
      });
      index.set([q * 4, q * 4 + 2, q * 4 + 1, q * 4, q * 4 + 3, q * 4 + 2], q * 6);
      q++;
    };
    const white = new THREE.Color(1, 1, 1);
    for (const [cell, x, y] of outlines) put(cell, x, y, white);
    for (const [cell, x, y, c] of fills) put(cell, x, y, tint.set(c));
    const geometry = mesh.geometry;
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geometry.setAttribute('color', new THREE.BufferAttribute(color, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    geometry.computeBoundingSphere();
  }

  /** Draws every glyph of both sizes twice: its shadowed outline, and its fill in white for tinting. */
  private drawAtlas() {
    const g = this.measure;
    const WIDTH = 1024;
    const cells: { key: string; ch: string; style: Style; layer: 'outline' | 'fill'; left: number; top: number; w: number; h: number; x: number; y: number }[] = [];
    let x = GUTTER, y = GUTTER, row = 0;
    for (const style of ['stat', 'price'] as Style[]) {
      g.font = FONT(SIZES[style]);
      for (const ch of GLYPHS) {
        const m = g.measureText(ch);
        const left = -Math.ceil(m.actualBoundingBoxLeft) - PAD, top = -Math.ceil(m.actualBoundingBoxAscent) - PAD;
        const w = Math.ceil(m.actualBoundingBoxLeft + m.actualBoundingBoxRight) + PAD * 2;
        const h = Math.ceil(m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) + PAD * 2 + Math.ceil(DROP);
        for (const layer of ['outline', 'fill'] as const) {
          if (x + w + GUTTER > WIDTH) { x = GUTTER; y += row + GUTTER; row = 0; }
          cells.push({ key: style + ch, ch, style, layer, left, top, w, h, x, y });
          x += w + GUTTER;
          row = Math.max(row, h);
        }
      }
    }
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = THREE.MathUtils.ceilPowerOfTwo(y + row + GUTTER);
    const a = canvas.getContext('2d')!;
    for (const c of cells) {
      a.save();
      a.font = FONT(SIZES[c.style]);
      a.textAlign = 'left';
      a.textBaseline = 'alphabetic';
      a.lineJoin = 'round';
      const penX = c.x - c.left, penY = c.y - c.top;
      if (c.layer === 'outline') {
        a.shadowColor = 'rgba(0,0,0,.7)';
        a.shadowBlur = BLUR;
        a.shadowOffsetY = DROP;
        a.lineWidth = LINE;
        a.strokeStyle = OUTLINE;
        a.strokeText(c.ch, penX, penY);
      } else {
        a.fillStyle = '#fff';
        a.fillText(c.ch, penX, penY);
      }
      a.restore();
      // Texture v runs up from the bottom of the canvas (flipY).
      const cell: Cell = {
        u0: c.x / WIDTH, u1: (c.x + c.w) / WIDTH,
        v0: 1 - c.y / canvas.height, v1: 1 - (c.y + c.h) / canvas.height,
        left: c.left, top: c.top, w: c.w, h: c.h,
      };
      const glyph = this.glyphs.get(c.key) ?? ({} as Glyph);
      glyph[c.layer] = cell;
      this.glyphs.set(c.key, glyph);
    }
    return canvas;
  }
}
