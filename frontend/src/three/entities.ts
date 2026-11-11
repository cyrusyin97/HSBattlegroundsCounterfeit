// Card objects. Each card springs toward a goal pose every frame, so a new snapshot,
// hover or drag only retargets it and interrupted motion needs no cleanup.
// Faces are drawn from engine data around the card's cropped illustration.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Zone } from '../core/intents';
import type { Key, Placement } from './reconciler';
import { roundedRect, type Stage } from './stage';
import { CARD_FOOTPRINT } from './layout';
import { reducedMotion, type Pose as Timed } from './motion';
import { traits } from '../core/traits';
import { artFor, drawArt, requestArt } from './art';
import * as tex from './textures';
import { CATALOGS, cardName, fontStack, locale, type Locale } from '../i18n';

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
  readonly shadow: THREE.PlaneGeometry;
  /** A clear block a little larger than the card, worn while its shop slot is frozen. */
  readonly ice: THREE.ExtrudeGeometry;
  /** Taunt: a round-bottomed steel shield behind the card, inside a polished brass rim, with rivets. */
  readonly bulwark: THREE.ExtrudeGeometry;
  readonly bulwarkRim: THREE.ExtrudeGeometry;
  readonly rivets: THREE.BufferGeometry;
  readonly bulwarkMaterial: THREE.MeshStandardMaterial;
  readonly rimMaterial = new THREE.MeshStandardMaterial({ color: 0xe0b464, metalness: 1, roughness: 0.15, emissive: 0x4a300a });
  /** Divine Shield: a golden blister hugging the card, bright at its rim and clear over the face. */
  readonly shell: THREE.BufferGeometry;
  readonly shellMaterial: THREE.ShaderMaterial;
  /** Reborn: a cracked block of frosted glass around the card. */
  readonly reborn: THREE.ExtrudeGeometry;
  readonly rebornMaterial: THREE.MeshPhysicalMaterial;
  readonly cracks: THREE.PlaneGeometry;
  readonly crackMaterial: THREE.MeshBasicMaterial;
  /** Stealth: smoke that spills past the card's edges, around the veil on its face. */
  readonly smokeRing: THREE.PlaneGeometry;
  readonly smokeRingTexture = tex.smokeRingTexture();
  readonly ringMask = tex.ringMaskTexture();
  /** Deathrattle and Venomous badges hung at the bottom edge of the card. */
  readonly badge: THREE.CircleGeometry;
  readonly skullMaterial: THREE.MeshBasicMaterial;
  readonly poisonMaterial: THREE.MeshBasicMaterial;
  readonly smokeTexture = tex.smokeTexture();
  readonly windTexture = tex.windTexture();
  readonly sheenTexture = tex.sheenTexture();
  readonly shadowTexture = tex.radialTexture();
  /** World units per board pixel on the warband row, where cards have their nominal size. */
  private readonly perPixel: number;
  /** How far a Taunt card rises so its shield's round bottom stays above the table. */
  readonly tauntLift: number;
  /** The card's edge, polished brass like the face's frame. */
  readonly bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xc8964a, metalness: 0.9, roughness: 0.2 });

  constructor(readonly stage: Stage) {
    // Size cards so a warband card covers the same 116 × 148 board pixels as the DOM token.
    const a = stage.boardToWorld(720, 491);
    const perPixel = this.perPixel = worldPerPixel(stage, 491);
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
    const icePad = this.width * 0.08;
    this.ice = new THREE.ExtrudeGeometry(roundedRect(this.width + icePad, this.height + icePad, radius + icePad / 2), {
      depth: 0.12, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 1, curveSegments: 4,
    });
    this.ice.translate(0, 0, -0.085);
    // A thick slab with a broad rounded bevel, so its sides read as solid from the camera.
    // The plate's front face sits just behind the card; the rim's a little further back.
    const plate = { depth: 0.14, bevelEnabled: true, bevelSize: 0.035, bevelThickness: 0.04, bevelSegments: 4, curveSegments: 12 };
    const front = 0.14 + 0.04;
    this.bulwark = new THREE.ExtrudeGeometry(bulwarkShape(this.width, this.height, 0), plate);
    this.bulwark.translate(0, 0, -this.depth - 0.005 - front);
    this.bulwarkRim = new THREE.ExtrudeGeometry(bulwarkShape(this.width, this.height, RIM_PAD), plate);
    this.bulwarkRim.translate(0, 0, -this.depth - 0.025 - front);
    const steel = tex.steelTexture();
    // Extruded faces take UVs from shape coordinates (world units), so tile by size.
    steel.wrapS = steel.wrapT = THREE.RepeatWrapping;
    steel.repeat.set(0.9, 0.9);
    this.bulwarkMaterial = new THREE.MeshStandardMaterial({ map: steel, metalness: 0.85, roughness: 0.38 });
    this.rivets = rivetGeometry(this.width, this.height);
    // The rim's lowest front point, once the card leans back and stands forward: it must sit
    // just above the table (y = 0) or the table hides it.
    const rimBottom = bulwarkSize(this.width, this.height, RIM_PAD).bottom, rimFront = TAUNT_RAISE - this.depth - 0.025;
    const lowest = this.centerY + rimBottom * Math.cos(this.lean) + rimFront * Math.sin(this.lean);
    this.tauntLift = Math.max(0, 0.015 - lowest);
    // Deep enough that its sides show from the camera, like a bubble the card sits inside;
    // just narrower than the slot pitch (136 px against 116 px cards) so neighbours stay clear.
    this.shell = shellGeometry(this.width * 0.58, this.height * 0.565, 0.7);
    this.shellMaterial = new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color(1, 0.78, 0.32) }, time: { value: 0 } },
      vertexShader: `varying vec3 vNormal; varying vec3 vView;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vNormal = normalize(normalMatrix * normal);
          vView = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `uniform vec3 color; uniform float time; varying vec3 vNormal; varying vec3 vView;
        void main() {
          float rim = pow(1.0 - abs(dot(vNormal, vView)), 1.8);
          float pulse = 0.85 + 0.15 * sin(time * 3.0);
          // A faint gold haze over the face, solid gold toward the silhouette, so it reads on
          // light and dark and the card looks held inside the bubble.
          vec3 gold = color * (0.95 + 0.5 * rim);
          // Thin-film colours in a band just inside the gold edge, drifting around the bubble.
          float phase = rim * 1.6 + atan(vNormal.y, vNormal.x) * 0.16 + time * 0.12;
          vec3 film = 0.5 + 0.5 * cos(6.2832 * (phase + vec3(0.0, 0.33, 0.67)));
          float band = smoothstep(0.3, 0.6, rim) * (1.0 - smoothstep(0.8, 1.0, rim));
          vec3 tint = mix(gold, film * 1.15, band * 0.5);
          // Reflections that show the curve: a sharp glint and a broad soft sheen toward the key
          // light at the upper left, and a faint bounce on the opposite lower side.
          vec3 key = normalize(vec3(-0.45, 0.55, 0.7));
          float facing = max(dot(vNormal, key), 0.0);
          float glint = 0.9 * pow(facing, 80.0) + 0.16 * pow(facing, 6.0);
          float bounce = 0.22 * pow(max(dot(vNormal, normalize(vec3(0.5, -0.55, 0.65))), 0.0), 12.0);
          float shine = glint + bounce;
          gl_FragColor = vec4(tint + shine, min(1.0, (0.2 + 0.8 * rim) * pulse + shine));
        }`,
      transparent: true, depthWrite: false,
    });
    const rebornPad = this.width * 0.11;
    this.reborn = new THREE.ExtrudeGeometry(roundedRect(this.width + rebornPad, this.height + rebornPad, radius + rebornPad / 2), {
      depth: 0.14, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 2, curveSegments: 6,
    });
    this.reborn.translate(0, 0, -0.1);
    // Lightly frosted glass: transmission shows the card through the shell, slightly softened.
    this.rebornMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xf4f8ff, emissive: 0x0e131a, metalness: 0, roughness: 0.08,
      transmission: 0.95, thickness: 0.05, ior: 1.2, side: THREE.DoubleSide,
    });
    // Transmission would wash out anything drawn into the glass, so the cracks ride on a
    // plane just over its front face. The shell's front sits at z ≈ 0.07.
    this.cracks = new THREE.PlaneGeometry(this.width + rebornPad, this.height + rebornPad);
    this.cracks.translate(0, 0, 0.072);
    this.crackMaterial = new THREE.MeshBasicMaterial({ map: tex.crackTexture(), transparent: true, depthWrite: false });
    this.smokeRing = new THREE.PlaneGeometry(this.width * 1.69, this.height * 1.53);
    this.badge = new THREE.CircleGeometry(this.width * 0.12, 40);
    this.skullMaterial = new THREE.MeshBasicMaterial({ map: tex.skullTexture(), transparent: true });
    this.poisonMaterial = new THREE.MeshBasicMaterial({ map: tex.poisonTexture(), transparent: true });
    this.shadow = new THREE.PlaneGeometry(this.width * 1.3, this.height * 0.95);
    this.shadow.rotateX(-Math.PI / 2);
  }

  /** Scale that makes a card on board row `y` look as large as one on the warband row. */
  scaleAt(y: number) { return worldPerPixel(this.stage, y) / this.perPixel; }
}

/**
 * A closed blister whose outline is a rounded rectangle (a superellipse) of half-size
 * hx × hy, bulging `depth` in front of the card and behind it. Built from a sphere whose
 * cross-sections are pushed out to that outline, so the rim follows the card's edge.
 */
function shellGeometry(hx: number, hy: number, depth: number) {
  const sphere = new THREE.SphereGeometry(1, 64, 32);
  // Sphere poles lie on y; turn them to z so cross-sections are parallel to the card.
  sphere.rotateX(Math.PI / 2);
  const pos = sphere.getAttribute('position'), n = 6;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), r = Math.hypot(x, y);
    if (r < 1e-6) { pos.setXYZ(i, 0, 0, pos.getZ(i) * depth); continue; }
    const cx = x / r, cy = y / r;
    const edge = (Math.abs(cx) ** n + Math.abs(cy) ** n) ** (-1 / n);
    pos.setXYZ(i, cx * edge * r * hx, cy * edge * r * hy, pos.getZ(i) * depth);
  }
  // Weld the seam so normals (and the rim glow they drive) run smooth all round.
  sphere.deleteAttribute('uv');
  sphere.deleteAttribute('normal');
  const shell = mergeVertices(sphere);
  shell.computeVertexNormals();
  return shell;
}

/** How far a Taunt card stands forward of its row, in world units along the card's normal. */
const TAUNT_RAISE = 0.1;

/**
 * Board pixels a card needs across its row: its own width, or the width of a layer drawn
 * wider than it (a Taunt shield, standing forward so it looks a little larger, a Divine
 * Shield bubble, a Reborn shell). Stealth's smoke is meant to spill and is not counted.
 */
export function footprint(card: Placement['card']) {
  const { auras, marks } = traits(card);
  if (auras.has('taunt')) return CARD_FOOTPRINT * (1 + 2 * (BULWARK_PAD + RIM_PAD)) + 6;
  if (auras.has('shield')) return CARD_FOOTPRINT * 1.16;
  if (marks.includes('reborn')) return CARD_FOOTPRINT * 1.11;
  return CARD_FOOTPRINT;
}

/** How far the taunt plate reaches past the card's sides, in card widths. */
const BULWARK_PAD = 0.056;
/** How much further the gilded rim reaches past the plate, in card widths. */
const RIM_PAD = 0.028;

/** Half-width, top, bottom and the height where the round bottom starts, grown by `margin`. */
function bulwarkSize(width: number, height: number, margin: number) {
  const w = width / 2 + width * (BULWARK_PAD + margin);
  const bottom = -height / 2 - width * (BULWARK_PAD * 3.4 + margin);
  return { w, top: height / 2 + width * (BULWARK_PAD * 0.75 + margin), bottom, side: bottom + w };
}

/** A round-bottomed shield: small corners above the card, a half-circle bottom below it. */
function bulwarkShape(width: number, height: number, margin: number) {
  const { w, top, bottom, side } = bulwarkSize(width, height, margin);
  const r = width * 0.08, k = 0.552 * w;
  const s = new THREE.Shape();
  s.moveTo(-w + r, top);
  s.lineTo(w - r, top); s.quadraticCurveTo(w, top, w, top - r);
  s.lineTo(w, side); s.bezierCurveTo(w, side - k, k, bottom, 0, bottom);
  s.bezierCurveTo(-k, bottom, -w, side - k, -w, side);
  s.lineTo(-w, top - r); s.quadraticCurveTo(-w, top, -w + r, top);
  return s;
}

/** Rivets around the steel plate, just inside its edge. */
function rivetGeometry(width: number, height: number) {
  const { w, top, side } = bulwarkSize(width, height, 0), inset = width * 0.035, round = w - inset;
  const spots = [
    [-w + inset * 1.4, top - width * 0.025], [0, top - width * 0.025], [w - inset * 1.4, top - width * 0.025],
    [-w + inset * 0.7, -height * 0.05], [w - inset * 0.7, -height * 0.05],
    [-round * 0.6, side - round * 0.8], [round * 0.6, side - round * 0.8],
  ];
  return mergeGeometries(spots.map(([x, y]) =>
    new THREE.SphereGeometry(width * 0.03, 10, 8).scale(1, 1, 0.6).translate(x, y, -0.055)));
}

function worldPerPixel(stage: Stage, y: number) {
  return stage.boardToWorld(720, y).distanceTo(stage.boardToWorld(820, y)) / 100;
}

interface Pose { pos: THREE.Vector3; roll: number; scale: number }
export interface Face {
  /** The UI language the face is drawn in; part of the texture cache key. */
  lang: Locale;
  name: string; seed: string; spell: boolean;
  atk?: number; hp?: number; tier?: number; price?: number | null; costsHealth?: boolean; frozen?: boolean;
  golden?: boolean;
}

export function faceOf(p: Placement): Face {
  const c = p.card, spell = c.type === 'spell';
  return {
    lang: locale(), name: cardName(c), seed: c.id, spell,
    atk: spell ? undefined : c.atk, hp: spell ? undefined : c.hp,
    tier: p.zone === 'shop' ? c.tier : undefined,
    // Minions always cost the same, so only shop spells carry a price.
    price: p.zone === 'shop' && spell ? p.price : undefined,
    costsHealth: p.zone === 'shop' && spell ? c.costs_health : undefined,
    frozen: p.frozen,
    golden: !spell && !!c.golden,
  };
}

export class CardObject {
  key: Key = 'shop:-1';
  zone: Zone = 'shop';
  readonly root = new THREE.Group();
  readonly shadow: THREE.Mesh;
  hovered = false;
  /**
   * A valid target for the spell or magnet in hand. Nothing draws it at the moment: the
   * coloured outlines were removed until a marker that suits the card materials is designed.
   */
  targetable = false;
  shield = false;
  taunt = false;
  stealth = false;
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
  /** Shown while the face is frozen. Effects animate its scale and opacity. */
  readonly ice: THREE.Mesh<THREE.ExtrudeGeometry, THREE.MeshStandardMaterial>;
  private readonly bulwark: THREE.Mesh;
  private readonly shell: THREE.Mesh;
  private readonly veil: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;
  private readonly smokeRing: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private smokeOut = false;
  private readonly wind: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;
  /** Golden: a band of light sweeping across the face, a cue that does not rely on hue. */
  private readonly sheen: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;
  private golden = false;
  private readonly rebornShell: THREE.Mesh;
  private readonly skull: THREE.Mesh;
  private readonly poison: THREE.Mesh;
  private windy = false;
  private disposed = false;
  private age = Math.random() * 10;
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
    this.ice = new THREE.Mesh(kit.ice, new THREE.MeshStandardMaterial({
      color: 0xc8f3ff, emissive: 0x2a6f8f, roughness: 0.15, metalness: 0.1,
      transparent: true, opacity: ICE_OPACITY, depthWrite: false,
    }));
    this.ice.raycast = () => {};
    this.ice.visible = false;
    this.bulwark = new THREE.Mesh(kit.bulwark, kit.bulwarkMaterial);
    const rim = new THREE.Mesh(kit.bulwarkRim, kit.rimMaterial);
    const rivets = new THREE.Mesh(kit.rivets, kit.rimMaterial);
    // Frames sit outside the card and must not widen its pick area.
    rim.raycast = rivets.raycast = () => {};
    this.bulwark.add(rim, rivets);
    this.shell = new THREE.Mesh(kit.shell, kit.shellMaterial);
    this.shell.renderOrder = 2;
    this.veil = new THREE.Mesh(kit.face, new THREE.MeshBasicMaterial({
      map: scrolling(kit.smokeTexture), transparent: true, opacity: 0.9, depthWrite: false,
    }));
    this.veil.position.z = 0.004;
    // The ring's smoke scrolls on its own while the mask stays put (each map has its own transform).
    this.smokeRing = new THREE.Mesh(kit.smokeRing, new THREE.MeshBasicMaterial({
      map: scrolling(kit.smokeRingTexture), alphaMap: kit.ringMask, transparent: true, opacity: 0.8, depthWrite: false,
    }));
    this.smokeRing.position.z = 0.01;
    this.smokeRing.renderOrder = 1;
    this.wind = new THREE.Mesh(kit.face, new THREE.MeshBasicMaterial({
      map: scrolling(kit.windTexture), transparent: true, depthWrite: false,
    }));
    this.wind.position.z = 0.006;
    const sheen = scrolling(this.kit.sheenTexture);
    sheen.repeat.set(0.5, 1);
    this.sheen = new THREE.Mesh(kit.face, new THREE.MeshBasicMaterial({ map: sheen, transparent: true, depthWrite: false }));
    this.sheen.position.z = 0.005;
    this.rebornShell = new THREE.Mesh(kit.reborn, kit.rebornMaterial);
    this.rebornShell.renderOrder = 1;
    const cracks = new THREE.Mesh(kit.cracks, kit.crackMaterial);
    cracks.renderOrder = 2;
    cracks.raycast = () => {};
    this.rebornShell.add(cracks);
    this.skull = new THREE.Mesh(kit.badge, kit.skullMaterial);
    this.poison = new THREE.Mesh(kit.badge, kit.poisonMaterial);
    for (const mesh of [this.bulwark, this.shell, this.veil, this.smokeRing, this.wind, this.sheen, this.rebornShell, this.skull, this.poison]) {
      mesh.raycast = () => {};
      mesh.visible = false;
    }
    this.spin.add(this.bulwark, new THREE.Mesh(kit.body, kit.bodyMaterial), this.faceMesh,
      this.veil, this.smokeRing, this.sheen, this.wind, this.skull, this.poison, this.ice, this.rebornShell, this.shell);
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
    const { auras, marks } = traits(p.card);
    // Overlapping hand cards would bury each other's frames and shells.
    const table = p.zone !== 'hand';
    this.shield = table && auras.has('shield');
    this.taunt = table && auras.has('taunt');
    this.stealth = auras.has('stealth');
    this.smokeOut = table && this.stealth;
    this.windy = marks.includes('windfury');
    this.golden = face.golden ?? false;
    this.rebornShell.visible = table && marks.includes('reborn');
    // Badges hang centred on the bottom edge, side by side when both apply.
    const badges = [marks.includes('deathrattle') && this.skull, marks.includes('venomous') && this.poison]
      .filter((mesh): mesh is THREE.Mesh => !!mesh);
    this.skull.visible = this.poison.visible = false;
    badges.forEach((mesh, i) => {
      mesh.visible = true;
      // The card's bottom edge rests on the table, so the badge rides just above it.
      mesh.position.set((i - (badges.length - 1) / 2) * this.kit.width * 0.25, -this.kit.height / 2 + this.kit.width * 0.1, 0.008);
    });
    this.placement = p;
    this.face = face;
    this.ice.visible = !!face.frozen;
    this.redraw();
    if (artFor(face.seed) === undefined) void requestArt(face.seed).then(() => this.redraw());
    if (!tex.mapleGrain()) void tex.mapleReady.then(() => this.redraw());
  }

  /** Redraws the face when its data or its artwork changed. */
  private redraw() {
    if (!this.face || this.disposed) return;
    const art = artFor(this.face.seed);
    const key = JSON.stringify(this.face) + (art ? '+art' : '') + (tex.mapleGrain() ? '+grain' : '');
    if (key === this.faceKey) return;
    this.faceKey = key;
    drawFace(this.canvas, this.face, art ?? undefined);
    this.texture.needsUpdate = true;
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
  /** The card this object shows, as of its last placement. */
  get card() { return this.placement?.card; }

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
    // A Taunt card stands on its shield: raised so the shield's bottom clears the table.
    if (this.taunt) this.root.position.y += this.kit.tauntLift * c.scale;
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

    this.age += dt;
    this.bulwark.visible = this.taunt;
    // A Taunt card and its slab stand forward of the row, raised off the board.
    this.spin.position.z = this.taunt ? TAUNT_RAISE : 0;
    this.shell.visible = this.shield;
    const still = reducedMotion.matches;
    if (this.shield) this.kit.shellMaterial.uniforms.time.value = still ? 0 : performance.now() / 1000;
    this.veil.visible = this.stealth;
    if (this.stealth && !still) this.veil.material.map!.offset.set(this.age * 0.05, this.age * -0.03);
    // The spill drifts the other way, so the two layers read as moving smoke.
    this.smokeRing.visible = this.smokeOut;
    if (this.smokeOut && !still) this.smokeRing.material.map!.offset.set(this.age * -0.03, this.age * 0.02);
    this.wind.visible = this.windy;
    if (this.windy) {
      // Gusts sweep across the face and swell and fade.
      if (!still) this.wind.material.map!.offset.set(-this.age * 0.55, Math.sin(this.age * 1.7) * 0.04);
      this.wind.material.opacity = still ? 0.85 : 0.6 + 0.4 * Math.max(0, Math.sin(this.age * 2.2));
    }
    this.sheen.visible = this.golden;
    // Under reduced motion the band rests across the face instead of sweeping.
    if (this.golden) this.sheen.material.map!.offset.x = still ? 0.62 : (-this.age * 0.4) % 1;
    if (this.removing && c.scale < 0.04) this.gone = true;
  }

  dispose() {
    this.texture.dispose();
    (this.faceMesh.material as THREE.Material).dispose();
    (this.shadow.material as THREE.Material).dispose();
    this.ice.material.dispose();
    this.disposed = true;
    for (const layer of [this.veil, this.smokeRing, this.wind, this.sheen]) {
      layer.material.map!.dispose();
      layer.material.dispose();
    }
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

/** A per-card copy of a shared texture that can scroll on its own. */
function scrolling(texture: THREE.Texture) {
  const copy = texture.clone();
  copy.wrapS = copy.wrapT = THREE.RepeatWrapping;
  copy.needsUpdate = true;
  return copy;
}

function hue(seed: string) {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

function drawFace(canvas: HTMLCanvasElement, f: Face, art?: HTMLImageElement) {
  const g = canvas.getContext('2d')!;
  const w = canvas.width, h = canvas.height, u = w / 256, base = hue(f.seed);
  const font = (size: number, weight = 'bold') => `${weight} ${size * u}px ${fontStack(f.lang)}`;
  g.clearRect(0, 0, w, h);
  g.save();
  roundPath(g, 0, 0, w, h, 26 * u);
  g.clip();
  // Normal bodies are maple lacquered in the card's hue: the grain sits under the tint
  // with an overlay blend, so the hue keeps its value and the grain shows as light and dark.
  const grain = tex.mapleGrain();
  if (grain && !f.golden) {
    const pattern = g.createPattern(grain, 'repeat')!;
    // One tile spans about 120/116 of the card width, as in the design.
    pattern.setTransform(new DOMMatrix().scale(w * 120 / 116 / grain.width));
    g.fillStyle = pattern;
    g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'overlay';
  }
  const fill = g.createLinearGradient(0, 0, 0, h);
  // Golden bodies are bright metal, far lighter than any normal body, so they stand out
  // by brightness and not by hue alone.
  if (f.golden) {
    fill.addColorStop(0, '#fff0b3');
    fill.addColorStop(0.45, '#e2b041');
    fill.addColorStop(1, '#8a5a12');
  } else {
    fill.addColorStop(0, `hsl(${base} 30% 34%)`);
    fill.addColorStop(1, `hsl(${base} 36% 13%)`);
  }
  g.fillStyle = fill;
  g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'source-over';
  // The body sits a step below the frame: a dark line and a soft shadow along its edge.
  g.save();
  // The fill outside this inset is hidden under the frame except for a 1-unit dark seam.
  roundPath(g, 9 * u, 9 * u, w - 18 * u, h - 18 * u, 20 * u);
  g.rect(-w, -h, w * 3, h * 3);
  g.shadowColor = 'rgba(0,0,0,.65)';
  g.shadowBlur = 6 * u;
  g.shadowOffsetX = 3 * u;
  g.shadowOffsetY = 4 * u;
  g.fillStyle = '#000';
  g.fill('evenodd');
  g.restore();

  // Sizes are in 256ths of the card width; a face is about 326 tall. At a 960 × 540
  // window a warband card is about 80 px wide, so one unit is about 0.31 px.
  // The face carries no name: names and text live in the hover tooltip.
  // Illustration window: an oval for minions, a rounded panel for spells. Without
  // artwork it falls back to a tinted emblem holding the name's first glyph.
  const cx = w / 2, cy = 124 * u, rx = 104 * u, ry = 115 * u;
  const frame = () => {
    g.beginPath();
    if (f.spell) g.roundRect(cx - rx, cy - ry, rx * 2, ry * 2, 22 * u);
    else g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  };
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.save();
  frame();
  g.clip();
  if (art) drawArt(g, art, f.spell, cx - rx, cy - ry, rx * 2, ry * 2);
  else {
    const glow = g.createRadialGradient(cx, cy - 20 * u, 8 * u, cx, cy, rx);
    glow.addColorStop(0, `hsl(${base} 55% 58%)`);
    glow.addColorStop(1, `hsl(${base} 45% 22%)`);
    g.fillStyle = glow;
    g.fillRect(cx - rx, cy - ry, rx * 2, ry * 2);
    g.fillStyle = 'rgba(255,241,214,.92)';
    g.font = font(72);
    g.fillText([...f.name][0] ?? '?', cx, cy + 3 * u);
  }
  drawGlass(g, frame, cx, cy, rx, ry, u);
  g.restore();
  frame();
  if (f.golden) {
    // A dark band outside a thick pale ring keeps the window edge clear on the bright body.
    g.lineWidth = 14 * u;
    g.strokeStyle = '#4a2a06';
    g.stroke();
    g.lineWidth = 8 * u;
    g.strokeStyle = '#fff4c8';
  } else {
    // A brass bezel: a dark seat under it, then a ring whose sheen turns around the window.
    g.lineWidth = 11 * u;
    g.strokeStyle = 'rgba(50,28,8,.9)';
    g.stroke();
    const ring = g.createConicGradient(110 * Math.PI / 180, cx, cy);
    for (const [at, color] of RING) ring.addColorStop(at, color);
    g.lineWidth = 8 * u;
    g.strokeStyle = ring;
  }
  g.stroke();

  // A dark fade along the bottom keeps the numbers readable over any artwork.
  const scrim = g.createLinearGradient(0, h - 80 * u, 0, h);
  scrim.addColorStop(0, 'rgba(8,4,2,0)');
  scrim.addColorStop(1, 'rgba(8,4,2,.8)');
  g.fillStyle = scrim;
  g.fillRect(0, h - 80 * u, w, 80 * u);
  if (f.spell) {
    g.font = font(24, '600');
    g.fillStyle = '#e3d3ff';
    g.fillText(CATALOGS[f.lang].card.spell, cx, h - 26 * u);
  }

  if (f.frozen) {
    g.fillStyle = 'rgba(160,220,255,.38)';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(240,252,255,.8)';
    g.lineWidth = 3 * u;
    g.beginPath();
    g.moveTo(30 * u, 80 * u); g.lineTo(80 * u, 130 * u); g.lineTo(64 * u, 170 * u);
    g.moveTo(w - 40 * u, h - 110 * u); g.lineTo(w - 90 * u, h - 150 * u); g.lineTo(w - 76 * u, h - 190 * u);
    g.stroke();
  }
  g.restore();

  if (f.golden) goldenFrame(g, w, h, u);
  else {
    // Polished brass: bands of reflected light along the frame and a glint at the top left,
    // with a bright outer edge and a dark inner one for the bevel.
    roundPath(g, 4 * u, 4 * u, w - 8 * u, h - 8 * u, 23 * u);
    g.lineWidth = 8 * u;
    g.strokeStyle = f.frozen ? '#b8f9ff' : angled(g, w, h, 155, BRASS);
    g.stroke();
    if (!f.frozen) {
      g.strokeStyle = glint(g, w * 0.25, h * 0.04, w * 0.45);
      g.stroke();
    }
    g.lineWidth = 1.5 * u;
    g.strokeStyle = 'rgba(255,241,205,.75)';
    roundPath(g, 0.75 * u, 0.75 * u, w - 1.5 * u, h - 1.5 * u, 26 * u);
    g.stroke();
  }

  // Numbers stand on their own: a bright fill inside a heavy dark outline and shadow.
  const number = (text: string, x: number, y: number, align: CanvasTextAlign, size: number, color: string) => {
    g.save();
    g.font = `bold ${size * u}px Georgia,serif`;
    g.textAlign = align;
    g.lineJoin = 'round';
    g.shadowColor = 'rgba(0,0,0,.7)';
    g.shadowBlur = 6 * u;
    g.shadowOffsetY = 4 * u;
    g.lineWidth = 11 * u;
    g.strokeStyle = '#1a0d06';
    g.strokeText(text, x, y);
    g.shadowColor = 'transparent';
    g.fillStyle = color;
    g.fillText(text, x, y);
    g.restore();
  };
  const low = h - 30 * u;
  if (f.atk !== undefined) number(String(f.atk), 18 * u, low, 'left', 60, '#ffd66b');
  if (f.hp !== undefined) number(String(f.hp), w - 18 * u, low, 'right', 60, '#ff7a6b');
  if (f.price !== undefined) number((f.costsHealth ? '♥' : '') + (f.price ?? '–'), w - 16 * u, 30 * u, 'right', 48, '#ffe9a8');
  if (f.tier) drawStars(g, f.tier, 9 * u, 9 * u, 26 * u);
}

/**
 * Golden minions: a double frame (a broad band of polished gold inside a dark line) and
 * diamond studs at the corners. Shape and contrast mark them, not color alone.
 */
function goldenFrame(g: CanvasRenderingContext2D, w: number, h: number, u: number) {
  g.lineWidth = 16 * u;
  g.strokeStyle = '#3d2205';
  roundPath(g, 8 * u, 8 * u, w - 16 * u, h - 16 * u, 22 * u);
  g.stroke();
  g.lineWidth = 10 * u;
  g.strokeStyle = angled(g, w, h, 155, GOLD);
  roundPath(g, 8 * u, 8 * u, w - 16 * u, h - 16 * u, 22 * u);
  g.stroke();
  g.strokeStyle = glint(g, w * 0.25, h * 0.04, w * 0.45);
  g.stroke();
  g.lineWidth = 3 * u;
  g.strokeStyle = '#3d2205';
  roundPath(g, 17 * u, 17 * u, w - 34 * u, h - 34 * u, 16 * u);
  g.stroke();
  const stud = (x: number, y: number) => {
    const r = 11 * u;
    g.beginPath();
    g.moveTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x, y + r); g.lineTo(x - r, y);
    g.closePath();
    g.fillStyle = '#fffbe8';
    g.fill();
    g.lineWidth = 3 * u;
    g.strokeStyle = '#3d2205';
    g.stroke();
  };
  for (const [x, y] of [[14, 14], [w / u - 14, 14], [14, h / u - 14], [w / u - 14, h / u - 14]]) stud(x * u, y * u);
}

/** Tier as a row of gilded stars on a matte brushed-silver plate, one star per tier. */
function drawStars(g: CanvasRenderingContext2D, count: number, x: number, y: number, size: number) {
  const pad = size * 0.22, pw = count * size + pad * 2, ph = size + pad * 2;
  g.save();
  g.beginPath();
  g.roundRect(x, y, pw, ph, ph * 0.32);
  g.lineWidth = size * 0.14;
  g.strokeStyle = '#24272b';
  g.stroke();
  g.fillStyle = angled(g, pw, ph, 170, SILVER, x, y);
  g.fill();
  // Matte, not mirror: fine horizontal brush marks in faint light and dark, clipped to the plate.
  g.save();
  g.clip();
  g.lineWidth = Math.max(1, size * 0.03);
  for (let i = 0; i < pw * ph / (size * 2); i++) {
    const sx = x + Math.random() * pw, sy = y + Math.random() * ph, len = size * (0.3 + Math.random() * 0.9);
    g.strokeStyle = Math.random() < 0.5 ? 'rgba(255,255,255,.14)' : 'rgba(40,44,50,.12)';
    g.beginPath();
    g.moveTo(sx, sy);
    g.lineTo(sx + len, sy);
    g.stroke();
  }
  g.restore();
  // A soft lit top edge and a shaded bottom one give the plate its thickness without a gloss.
  g.lineWidth = size * 0.07;
  g.strokeStyle = '#5d636b';
  g.stroke();
  g.beginPath();
  g.moveTo(x + ph * 0.35, y + size * 0.06);
  g.lineTo(x + pw - ph * 0.35, y + size * 0.06);
  g.lineWidth = size * 0.05;
  g.strokeStyle = 'rgba(255,255,255,.45)';
  g.stroke();
  const star = g.createLinearGradient(0, y + pad, 0, y + pad + size);
  star.addColorStop(0, '#fff6c4');
  star.addColorStop(0.5, '#f2c14e');
  star.addColorStop(1, '#a8730f');
  g.fillStyle = star;
  g.strokeStyle = '#5a3a0a';
  g.lineWidth = size * 0.06;
  for (let i = 0; i < count; i++) {
    const sx = x + pad + i * size + size / 2, sy = y + pad + size / 2 + size * 0.04;
    g.beginPath();
    for (let k = 0; k < 10; k++) {
      const r = k % 2 ? size * 0.21 : size * 0.48, a = -Math.PI / 2 + k * Math.PI / 5;
      g.lineTo(sx + Math.cos(a) * r, sy + Math.sin(a) * r);
    }
    g.closePath();
    g.fill();
    g.stroke();
  }
  g.restore();
}

type Stops = readonly (readonly [number, string])[];
/** Polished brass and gold: alternating bands of reflected light, darkest a third of the way. */
const BRASS: Stops = [[0, '#fff6d8'], [0.07, '#f1cf86'], [0.18, '#b98433'], [0.27, '#7a4f1c'], [0.38, '#d9ad5e'],
  [0.46, '#fff0c2'], [0.53, '#e2b768'], [0.66, '#9c6a28'], [0.76, '#6e4517'], [0.87, '#c99a4e'], [0.95, '#f6d995'], [1, '#fff3cc']];
const GOLD: Stops = [[0, '#fffbe8'], [0.08, '#ffe38a'], [0.2, '#e0a930'], [0.3, '#9c6a14'], [0.42, '#f4cb5c'],
  [0.5, '#fff6cf'], [0.58, '#f2c14e'], [0.7, '#b07a1c'], [0.78, '#8a5a12'], [0.88, '#e7b84a'], [1, '#fff2c2']];
/** The bezel's sheen around the window, as a conic sweep. */
const RING: Stops = [[0, '#fff0c0'], [0.18, '#c4924a'], [0.34, '#6f4a1d'], [0.52, '#e8c27a'], [0.7, '#8c6230'], [0.86, '#f3d491'], [1, '#fff0c0']];
/** Matte silver: a narrow range of greys, no white highlight band, so it reads satin rather than chrome. */
const SILVER: Stops = [[0, '#dde1e5'], [0.45, '#c2c7cd'], [1, '#9ea4ab']];

/** A linear gradient at `deg` (CSS convention: 0 points up, clockwise) across the box at (x, y). */
function angled(g: CanvasRenderingContext2D, w: number, h: number, deg: number, stops: Stops, x = 0, y = 0) {
  const a = deg * Math.PI / 180, dx = Math.sin(a), dy = -Math.cos(a);
  const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2, mx = x + w / 2, my = y + h / 2;
  const grad = g.createLinearGradient(mx - dx * half, my - dy * half, mx + dx * half, my + dy * half);
  for (const [at, color] of stops) grad.addColorStop(at, color);
  return grad;
}

/** A white glint at (x, y) fading out by radius r, for stroking over polished metal. */
function glint(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  const grad = g.createRadialGradient(x, y, 0, x, y, r);
  grad.addColorStop(0, 'rgba(255,255,255,.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  return grad;
}

/** Fills around (x, y) with an elliptical radial gradient of radii rx, ry; clip it first. */
function oval(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, stops: Stops) {
  g.save();
  g.translate(x, y);
  g.scale(1, ry / rx);
  const grad = g.createRadialGradient(0, 0, 0, 0, 0, rx);
  for (const [at, color] of stops) grad.addColorStop(at, color);
  g.fillStyle = grad;
  g.fillRect(-rx * 3, -rx * 3, rx * 6, rx * 6);
  g.restore();
}

/**
 * Glass over the illustration, drawn inside the window's clip: the pane sits below the
 * bezel (shadowed at the top left, catching light at the bottom right), darkens slightly
 * toward its rim like a dome, and carries an arc of reflected light.
 */
function drawGlass(g: CanvasRenderingContext2D, frame: () => void, cx: number, cy: number, rx: number, ry: number, u: number) {
  // Fill everything outside the window: the fill is clipped away and only its shadow falls inside.
  const inner = (color: string, blur: number, dx: number, dy: number) => {
    g.save();
    frame();
    g.rect(cx - rx * 2, cy - ry * 2, rx * 4, ry * 4);
    g.shadowColor = color;
    g.shadowBlur = blur * u;
    g.shadowOffsetX = dx * u;
    g.shadowOffsetY = dy * u;
    g.fillStyle = '#000';
    g.fill('evenodd');
    g.restore();
  };
  oval(g, cx, cy - ry * 0.12, rx, ry, [[0.55, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,.38)']]);
  inner('rgba(0,0,0,.75)', 12, 4, 6);
  inner('rgba(255,232,190,.45)', 3, -2, -2.4);
  frame();
  g.lineWidth = 3 * u;
  g.strokeStyle = 'rgba(20,10,4,.95)';
  g.stroke();
  oval(g, cx - rx * 0.34, cy - ry * 0.66, rx * 1.16, ry * 0.6, [[0, 'rgba(255,252,240,.42)'], [0.72, 'rgba(255,252,240,0)']]);
  oval(g, cx + rx * 0.4, cy + ry * 0.74, rx * 0.56, ry * 0.24, [[0, 'rgba(255,250,235,.2)'], [0.72, 'rgba(255,250,235,0)']]);
  g.fillStyle = angled(g, rx * 2, ry * 2, 158, [[0, 'rgba(255,250,235,.16)'], [0.4, 'rgba(255,250,235,0)']], cx - rx, cy - ry);
  g.fillRect(cx - rx, cy - ry, rx * 2, ry * 2);
}

function roundPath(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}
