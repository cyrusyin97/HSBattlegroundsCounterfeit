// Card objects. Each card springs toward a goal pose every frame, so a new snapshot,
// hover or drag only retargets it and interrupted motion needs no cleanup.
// Faces are procedural placeholders drawn from engine data.
import * as THREE from 'three';
import type { Zone } from '../core/intents';
import type { Key, Placement } from './reconciler';
import { roundedRect, type Stage } from './stage';
import { reducedMotion, type Pose as Timed } from './motion';

const FACE_PX = 512;
export const ICE_OPACITY = 0.42;

/** Shared sizes and geometry for every card on one stage. */
export class CardKit {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  /** Rotation back from upright, so faces lean toward the camera. */
  readonly lean: number;
  readonly centerY: number;
  /** Face normal in world space. */
  readonly normal: THREE.Vector3;
  readonly face: THREE.ShapeGeometry;
  readonly body: THREE.ExtrudeGeometry;
  readonly outline: THREE.ShapeGeometry;
  readonly shadow: THREE.PlaneGeometry;
  /** A clear block a little larger than the card, worn while its shop slot is frozen. */
  readonly ice: THREE.ExtrudeGeometry;
  readonly shadowTexture: THREE.CanvasTexture;
  readonly bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x7a5530, metalness: 0.45, roughness: 0.45 });

  constructor(readonly stage: Stage) {
    // Size cards so a warband card covers the same 116 × 148 board pixels as the DOM token.
    const a = stage.boardToWorld(720, 491), b = stage.boardToWorld(820, 491);
    const perPixel = a.distanceTo(b) / 100;
    this.width = 116 * perPixel;
    this.height = 148 * perPixel;
    this.depth = 0.05;
    const view = stage.camera.position.clone().sub(a);
    this.lean = Math.atan2(view.y, Math.hypot(view.x, view.z)) + 0.22;
    this.centerY = this.height / 2 * Math.cos(this.lean) + 0.02;
    this.normal = new THREE.Vector3(0, Math.sin(this.lean), Math.cos(this.lean));

    const radius = this.width * 0.1;
    this.face = new THREE.ShapeGeometry(roundedRect(this.width, this.height, radius), 6);
    const pos = this.face.getAttribute('position'), uv = this.face.getAttribute('uv');
    for (let i = 0; i < pos.count; i++) {
      uv.setXY(i, pos.getX(i) / this.width + 0.5, pos.getY(i) / this.height + 0.5);
    }
    this.body = new THREE.ExtrudeGeometry(roundedRect(this.width, this.height, radius), {
      depth: this.depth, bevelEnabled: false, curveSegments: 6,
    });
    this.body.translate(0, 0, -this.depth);
    const pad = this.width * 0.06;
    this.outline = new THREE.ShapeGeometry(roundedRect(this.width + pad, this.height + pad, radius + pad / 2), 6);
    const icePad = this.width * 0.08;
    this.ice = new THREE.ExtrudeGeometry(roundedRect(this.width + icePad, this.height + icePad, radius + icePad / 2), {
      depth: 0.12, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 1, curveSegments: 4,
    });
    this.ice.translate(0, 0, -0.085);
    this.shadow = new THREE.PlaneGeometry(this.width * 1.3, this.height * 0.95);
    this.shadow.rotateX(-Math.PI / 2);
    this.shadowTexture = radialTexture();
  }
}

interface Pose { pos: THREE.Vector3; roll: number; scale: number }
export interface Face {
  name: string; seed: string; spell: boolean;
  atk?: number; hp?: number; tier?: number; price?: number | null; costsHealth?: boolean; frozen?: boolean;
}

export function faceOf(p: Placement): Face {
  const c = p.card, spell = c.type === 'spell';
  return {
    name: c.name_zh, seed: c.id, spell,
    atk: spell ? undefined : c.atk, hp: spell ? undefined : c.hp,
    tier: p.zone === 'shop' ? c.tier : undefined,
    price: p.zone === 'shop' ? p.price : undefined,
    costsHealth: p.zone === 'shop' ? c.costs_health : undefined,
    frozen: p.frozen,
  };
}

export class CardObject {
  key: Key = 'shop:-1';
  zone: Zone = 'shop';
  readonly root = new THREE.Group();
  readonly shadow: THREE.Mesh;
  hovered = false;
  targetable = false;
  shield = false;
  removing = false;
  gone = false;
  /** A timed pose that replaces the spring while set, for lunges and recoils. */
  override?: Timed;
  private held?: THREE.Vector3;
  private placement?: Placement;
  private face?: Face;
  private flashLeft = 0;
  private readonly tilt = new THREE.Group();
  private readonly spin = new THREE.Group();
  private readonly faceMesh: THREE.Mesh;
  private readonly outlineMesh: THREE.Mesh;
  /** Shown while the face is frozen. Effects animate its scale and opacity. */
  readonly ice: THREE.Mesh<THREE.ExtrudeGeometry, THREE.MeshStandardMaterial>;
  private readonly canvas = document.createElement('canvas');
  private readonly texture: THREE.CanvasTexture;
  private faceKey = '';
  private readonly current: Pose = { pos: new THREE.Vector3(), roll: 0, scale: 0 };
  private readonly rest: Pose = { pos: new THREE.Vector3(), roll: 0, scale: 1 };
  private placed = false;

  constructor(private readonly kit: CardKit) {
    this.canvas.width = FACE_PX;
    this.canvas.height = Math.round(FACE_PX * kit.height / kit.width);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = kit.stage.maxAnisotropy;
    this.faceMesh = new THREE.Mesh(kit.face, new THREE.MeshStandardMaterial({ map: this.texture, roughness: 0.6 }));
    this.faceMesh.position.z = 0.001;
    this.outlineMesh = new THREE.Mesh(kit.outline, new THREE.MeshBasicMaterial({ toneMapped: false }));
    this.outlineMesh.position.z = -0.002;
    this.outlineMesh.raycast = () => {};
    this.ice = new THREE.Mesh(kit.ice, new THREE.MeshStandardMaterial({
      color: 0xc8f3ff, emissive: 0x2a6f8f, roughness: 0.15, metalness: 0.1,
      transparent: true, opacity: ICE_OPACITY, depthWrite: false,
    }));
    this.ice.raycast = () => {};
    this.ice.visible = false;
    this.spin.add(new THREE.Mesh(kit.body, kit.bodyMaterial), this.faceMesh, this.outlineMesh, this.ice);
    this.tilt.add(this.spin);
    this.tilt.rotation.x = -kit.lean;
    this.root.add(this.tilt);
    this.root.userData.card = this;
    this.shadow = new THREE.Mesh(kit.shadow, new THREE.MeshBasicMaterial({
      map: kit.shadowTexture, color: 0x000000, transparent: true, depthWrite: false,
    }));
    this.shadow.raycast = () => {};
  }

  show(p: Placement, face: Face) {
    this.key = p.key;
    this.zone = p.zone;
    this.removing = this.gone = false;
    this.shield = !!p.card.shield_hits;
    this.placement = p;
    this.face = face;
    this.ice.visible = !!face.frozen;
    const key = JSON.stringify(face);
    if (key !== this.faceKey) {
      this.faceKey = key;
      drawFace(this.canvas, face);
      this.texture.needsUpdate = true;
    }
  }

  /** Layout target. A new card starts above its slot and grows into place. */
  setRest(pos: THREE.Vector3, roll: number, scale = 1) {
    this.rest.pos.copy(pos);
    this.rest.roll = roll;
    this.rest.scale = scale;
    if (!this.placed) {
      this.placed = true;
      this.current.pos.copy(pos).add(new THREE.Vector3(0, 0.9, -0.4));
      this.current.roll = roll;
      this.current.scale = 0.2;
    }
  }

  /** Redraw with changed numbers, such as health at the moment of contact. */
  restat(patch: Partial<Face>) {
    if (this.placement && this.face) this.show(this.placement, { ...this.face, ...patch });
  }

  /** Brighten the face briefly, as on being hit. */
  flash(seconds = 0.2) { this.flashLeft = seconds; }

  get restPosition() { return this.rest.pos; }
  /** Hidden cards still move; effects reveal them on cue. */
  set visible(value: boolean) { this.root.visible = this.shadow.visible = value; }
  get position() { return this.current.pos; }

  hold(pos: THREE.Vector3 | undefined) { this.held = pos?.clone(); }
  get isHeld() { return this.held !== undefined; }
  remove() { this.removing = true; this.hovered = false; }

  /** Board-space anchor at a face-relative point, (-1, -1) to (1, 1). */
  anchor(u: number, v: number) {
    this.root.updateMatrixWorld();
    return this.kit.stage.worldToBoard(
      this.faceMesh.localToWorld(new THREE.Vector3(u * this.kit.width / 2, v * this.kit.height / 2, 0)));
  }

  step(dt: number) {
    const goal = this.goal();
    const k = reducedMotion.matches ? 1 : 1 - Math.exp(-dt * (this.held ? 28 : 12));
    const c = this.current;
    let pitch = 0;
    if (this.override && !this.removing) {
      c.pos.copy(this.override.pos);
      c.roll = this.override.roll;
      pitch = this.override.pitch;
    } else {
      c.pos.lerp(goal.pos, k);
      c.roll += (goal.roll - c.roll) * k;
    }
    c.scale += (goal.scale - c.scale) * k;
    this.root.position.copy(c.pos);
    this.root.scale.setScalar(Math.max(c.scale, 0.001));
    // A positive roll turns clockwise on screen, which is negative about the face normal.
    this.spin.rotation.z = -c.roll;
    // A positive pitch tips the top of the card away from the camera.
    this.tilt.rotation.x = -this.kit.lean - pitch;
    this.flashLeft = Math.max(0, this.flashLeft - dt);
    (this.faceMesh.material as THREE.MeshStandardMaterial).emissive.setScalar(this.flashLeft > 0 ? 0.35 : 0);

    const lift = Math.max(0, c.pos.y - this.kit.centerY);
    // The key light sits behind the camera, so the shadow falls toward the viewer.
    this.shadow.position.set(c.pos.x + 0.1 + lift * 0.35, 0.008, c.pos.z + 0.18 + lift * 0.3);
    this.shadow.scale.setScalar(c.scale * (1 + lift * 0.45));
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.6 * Math.min(1, c.scale) / (1 + lift * 1.6);

    const outline = this.outlineMesh.material as THREE.MeshBasicMaterial;
    this.outlineMesh.visible = this.targetable || this.hovered || this.shield;
    outline.color.set(this.targetable ? (this.hovered ? 0xffcd57 : 0x88d568) : this.hovered ? 0xffe6a6 : 0xffd877);
    if (this.removing && c.scale < 0.04) this.gone = true;
  }

  dispose() {
    this.texture.dispose();
    (this.faceMesh.material as THREE.Material).dispose();
    (this.outlineMesh.material as THREE.Material).dispose();
    (this.shadow.material as THREE.Material).dispose();
    this.ice.material.dispose();
  }

  private goal(): Pose {
    if (this.removing) return { pos: this.current.pos.clone().setY(this.kit.centerY + 0.3), roll: this.current.roll, scale: 0 };
    if (this.held) return { pos: this.held, roll: 0, scale: 1.06 };
    const pos = this.rest.pos.clone();
    const scale = this.rest.scale;
    if (!this.hovered) return { pos, roll: this.rest.roll, scale };
    if (this.zone !== 'hand') return { pos: pos.setY(pos.y + 0.12), roll: 0, scale };
    // Hovered hand cards rise toward the camera, above their neighbours.
    pos.addScaledVector(this.kit.normal, 0.6).y += 0.45;
    return { pos, roll: 0, scale: scale * 1.3 };
  }
}

function hue(seed: string) {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

function drawFace(canvas: HTMLCanvasElement, f: Face) {
  const g = canvas.getContext('2d')!;
  const w = canvas.width, h = canvas.height, u = w / 256, base = hue(f.seed);
  const font = (size: number, weight = 'bold') => `${weight} ${size * u}px "PingFang SC","Microsoft YaHei",sans-serif`;
  g.clearRect(0, 0, w, h);
  g.save();
  roundPath(g, 0, 0, w, h, 26 * u);
  const fill = g.createLinearGradient(0, 0, 0, h);
  fill.addColorStop(0, `hsl(${base} 36% 36%)`);
  fill.addColorStop(1, `hsl(${base} 44% 15%)`);
  g.fillStyle = fill;
  g.fill();
  g.clip();

  // Emblem: an oval for minions, a diamond for spells, holding the name's first glyph.
  const cx = w / 2, cy = h * 0.4;
  g.beginPath();
  if (f.spell) {
    g.moveTo(cx, cy - 86 * u); g.lineTo(cx + 72 * u, cy); g.lineTo(cx, cy + 86 * u); g.lineTo(cx - 72 * u, cy); g.closePath();
  } else {
    g.ellipse(cx, cy, 78 * u, 94 * u, 0, 0, Math.PI * 2);
  }
  const glow = g.createRadialGradient(cx, cy - 30 * u, 10 * u, cx, cy, 100 * u);
  glow.addColorStop(0, `hsl(${base} 55% 58%)`);
  glow.addColorStop(1, `hsl(${base} 45% 22%)`);
  g.fillStyle = glow;
  g.fill();
  g.lineWidth = 5 * u;
  g.strokeStyle = '#e6c98a';
  g.stroke();
  g.fillStyle = 'rgba(255,241,214,.92)';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = font(92);
  g.fillText([...f.name][0] ?? '?', cx, cy + 4 * u);

  // Name band.
  const band = h * 0.73;
  g.fillStyle = 'rgba(18,9,5,.7)';
  g.fillRect(0, band - 22 * u, w, 44 * u);
  let size = 26;
  g.font = font(size);
  while (size > 14 && g.measureText(f.name).width > w - 30 * u) g.font = font(--size);
  g.fillStyle = '#ffe8b3';
  g.fillText(f.name, cx, band);
  if (f.spell) {
    g.font = font(16, '600');
    g.fillStyle = '#d9c3ff';
    g.fillText('法术', cx, band + 38 * u);
  }

  if (f.frozen) {
    g.fillStyle = 'rgba(160,220,255,.38)';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(240,252,255,.8)';
    g.lineWidth = 3 * u;
    g.beginPath();
    g.moveTo(30 * u, 40 * u); g.lineTo(90 * u, 110 * u); g.lineTo(70 * u, 170 * u);
    g.moveTo(w - 40 * u, h - 90 * u); g.lineTo(w - 100 * u, h - 150 * u); g.lineTo(w - 80 * u, h - 210 * u);
    g.stroke();
  }
  g.restore();

  g.lineWidth = 8 * u;
  g.strokeStyle = f.frozen ? '#b8f9ff' : '#c8a160';
  roundPath(g, 4 * u, 4 * u, w - 8 * u, h - 8 * u, 23 * u);
  g.stroke();

  const gem = (x: number, y: number, r: number, color: string, text: string, size: number) => {
    g.beginPath();
    g.arc(x, y, r * u, 0, Math.PI * 2);
    g.fillStyle = color;
    g.fill();
    g.lineWidth = 3 * u;
    g.strokeStyle = '#f1dcae';
    g.stroke();
    g.font = `bold ${size * u}px Georgia,serif`;
    g.lineWidth = 5 * u;
    g.strokeStyle = 'rgba(0,0,0,.75)';
    g.strokeText(text, x, y + 2 * u);
    g.fillStyle = '#fff';
    g.fillText(text, x, y + 2 * u);
  };
  if (f.atk !== undefined) gem(36 * u, h - 38 * u, 30, '#b88a2c', String(f.atk), 34);
  if (f.hp !== undefined) gem(w - 36 * u, h - 38 * u, 30, '#aa3732', String(f.hp), 34);
  if (f.tier) gem(32 * u, 32 * u, 22, '#703177', '★' + f.tier, 17);
  if (f.price !== undefined) gem(w - 32 * u, 32 * u, 22, '#967019', (f.costsHealth ? '♥' : '') + (f.price ?? '–'), 20);
}

function roundPath(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

function radialTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const g = canvas.getContext('2d')!;
  const fill = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  fill.addColorStop(0, 'rgba(0,0,0,1)');
  fill.addColorStop(0.5, 'rgba(0,0,0,.55)');
  fill.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = fill;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}
