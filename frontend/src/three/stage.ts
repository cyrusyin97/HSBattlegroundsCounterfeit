// Renderer, camera, lights and table. Board coordinates (1440 × 810) map to the
// canvas, so layout and HUD share one coordinate system.
import * as THREE from 'three';
import type { Rect } from './layout';

export const BOARD_W = 1440, BOARD_H = 810;
const BACKDROP = 0x1a0f0b;

export class Stage {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, BOARD_W / BOARD_H, 0.1, 100);
  readonly renderer: THREE.WebGLRenderer;
  private readonly raycaster = new THREE.Raycaster();
  private readonly callbacks: ((dt: number) => void)[] = [];
  /** CPU time of the last frame's updates and draw, in milliseconds. */
  frameMs = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.scene.background = new THREE.Color(BACKDROP);
    this.scene.fog = new THREE.Fog(BACKDROP, 17, 30);
    this.camera.position.set(0, 10, 10.5);
    this.camera.lookAt(0, 0, 0.9);
    this.camera.updateMatrixWorld();
    const sun = new THREE.DirectionalLight(0xffe3b8, 2.4);
    sun.position.set(-4, 9, 14);
    this.scene.add(new THREE.HemisphereLight(0xfff0dc, 0x3b2414, 1.5), sun);
    this.addTable();
    let last = performance.now();
    this.renderer.setAnimationLoop(now => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const start = performance.now();
      for (const callback of this.callbacks) callback(dt);
      this.renderer.render(this.scene, this.camera);
      this.frameMs = performance.now() - start;
    });
  }

  /** The canvas keeps its 1440 × 810 CSS size inside the scaled board. */
  resize(scale: number) {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2) * scale);
    this.renderer.setSize(BOARD_W, BOARD_H, false);
  }

  onFrame(callback: (dt: number) => void) { this.callbacks.push(callback); }

  get maxAnisotropy() { return this.renderer.capabilities.getMaxAnisotropy(); }

  ray(x: number, y: number) {
    this.raycaster.setFromCamera(new THREE.Vector2(x / BOARD_W * 2 - 1, 1 - y / BOARD_H * 2), this.camera);
    return this.raycaster;
  }

  /** The point at `height` above the table that appears at board coordinate (x, y). */
  boardToWorld(x: number, y: number, height = 0) {
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -height);
    return this.ray(x, y).ray.intersectPlane(plane, new THREE.Vector3()) ?? new THREE.Vector3();
  }

  worldToBoard(point: THREE.Vector3) {
    const p = point.clone().project(this.camera);
    return { x: (p.x + 1) / 2 * BOARD_W, y: (1 - p.y) / 2 * BOARD_H };
  }

  /** A flat table overlay that appears exactly over a board rectangle. */
  zoneQuad(r: Rect, color: THREE.ColorRepresentation, opacity: number) {
    const corners = [[r.left, r.bottom], [r.right, r.bottom], [r.right, r.top], [r.left, r.top]]
      .map(([x, y]) => this.boardToWorld(x, y, 0.006));
    const geometry = new THREE.BufferGeometry().setFromPoints(corners);
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
      color, opacity, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    }));
    this.scene.add(mesh);
    return mesh;
  }

  private addTable() {
    const wood = woodTexture();
    wood.anisotropy = this.maxAnisotropy;
    wood.repeat.set(6, 4);
    const table = new THREE.Mesh(new THREE.PlaneGeometry(60, 40),
      new THREE.MeshStandardMaterial({ map: wood, roughness: 0.85 }));
    table.rotation.x = -Math.PI / 2;
    // A leather mat under the shop and warband, sized to the rows at their nearest edge.
    const top = this.boardToWorld(720, 140).z, bottom = this.boardToWorld(720, 616).z;
    const half = Math.abs(this.boardToWorld(120, 616).x);
    const mat = (pad: number, y: number, material: THREE.Material) => {
      const shape = roundedRect(2 * (half + pad), bottom - top + 2 * pad, 0.5 + pad);
      const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape, 8), material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(0, y, (top + bottom) / 2);
      return mesh;
    };
    this.scene.add(table,
      mat(0.12, 0.002, new THREE.MeshStandardMaterial({ color: 0xa27a44, metalness: 0.5, roughness: 0.4 })),
      mat(0, 0.004, new THREE.MeshStandardMaterial({ color: 0x3a2a22, roughness: 0.95 })));
  }
}

export function roundedRect(w: number, h: number, r: number) {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

function woodTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const g = canvas.getContext('2d')!;
  const plank = 64;
  for (let y = 0; y < 512; y += plank) {
    g.fillStyle = `hsl(26 42% ${20 + Math.random() * 6}%)`;
    g.fillRect(0, y, 512, plank);
    for (let i = 0; i < 14; i++) {
      g.strokeStyle = `rgba(30,14,6,${0.08 + Math.random() * 0.14})`;
      g.lineWidth = 1 + Math.random() * 1.5;
      const base = y + Math.random() * plank, wave = Math.random() * 2.5;
      g.beginPath();
      g.moveTo(0, base);
      for (let x = 32; x <= 512; x += 32) g.lineTo(x, base + Math.sin(x / 64 + i) * wave);
      g.stroke();
    }
    g.fillStyle = 'rgba(12,6,3,.65)';
    g.fillRect(0, y, 512, 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}
