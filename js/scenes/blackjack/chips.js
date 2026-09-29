// Casino chips: one InstancedMesh (cylinder with edge stripes and an inlaid top, coloured per
// instance). Static chips (the fly's bankroll towers, the dealer's rack) are written once; the
// moving bet stacks are rewritten every frame from pure functions of time.
import * as THREE from 'three';
import { TABLE, rackLayout } from './table.js';

export const CHIP = { r: 0.25, h: 0.046 };
export const CHIP_COLORS = {
  purple: 0x7c3aed, pink: 0xdb2777, teal: 0x0f9f8f, black: 0x23263a, gold: 0xd9a21b, white: 0xe9e6f5,
};

function chipMaskTexture() {
  // top half: the edge band (u around, v up), bottom half: the cap (a circle squeezed into the half)
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const g = c.getContext('2d');
  // r = stripe mask (white inlay), g = shade (1 = full colour)
  g.fillStyle = 'rgb(0,255,0)'; g.fillRect(0, 0, 512, 512);
  // edge band: 8 white stripes around
  for (let i = 0; i < 8; i++) {
    g.fillStyle = 'rgb(255,255,0)';
    g.fillRect(i * 64 + 20, 0, 24, 256);
  }
  // cap: outer ring of dashes, inner inlay disc
  g.save();
  g.translate(256, 384); g.scale(1, 0.5);
  for (let i = 0; i < 16; i++) {
    const a0 = (i / 16) * Math.PI * 2, a1 = a0 + Math.PI / 16;
    g.beginPath(); g.arc(0, 0, 232, a0, a1); g.arc(0, 0, 196, a1, a0, true); g.closePath();
    g.fillStyle = i % 2 ? 'rgb(255,255,0)' : 'rgb(0,255,0)'; g.fill();
  }
  g.beginPath(); g.arc(0, 0, 150, 0, Math.PI * 2); g.fillStyle = 'rgb(0,200,0)'; g.fill();   // slightly darker inlay
  g.beginPath(); g.arc(0, 0, 150, 0, Math.PI * 2); g.lineWidth = 12; g.strokeStyle = 'rgb(200,255,0)'; g.stroke();
  g.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 4;
  return t;
}

function chipGeometry() {
  const g = new THREE.CylinderGeometry(CHIP.r, CHIP.r, CHIP.h, 28, 1, false);
  // remap UVs: torso -> top half (v 0.5..1), caps -> bottom half
  const uv = g.attributes.uv;
  const [torso, top, bottom] = g.groups;
  const idx = g.index;
  const seen = new Set();
  const remap = (grp, fn) => {
    for (let i = grp.start; i < grp.start + grp.count; i++) {
      const v = idx.getX(i);
      if (seen.has(v)) continue;
      seen.add(v);
      fn(v);
    }
  };
  remap(torso, v => uv.setXY(v, uv.getX(v), 0.5 + 0.5 * uv.getY(v)));
  remap(top, v => uv.setXY(v, uv.getX(v), 0.5 * uv.getY(v)));
  remap(bottom, v => uv.setXY(v, uv.getX(v), 0.5 * uv.getY(v)));
  g.clearGroups();
  g.translate(0, CHIP.h / 2, 0);        // origin at the bottom face
  return g;
}

export class Chips {
  constructor(scene, capacity) {
    const mat = new THREE.MeshStandardMaterial({ map: chipMaskTexture(), roughness: 0.38, metalness: 0.08 });
    mat.onBeforeCompile = sh => {
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <map_fragment>', 'vec4 chipM = texture2D( map, vMapUv );')
        .replace('#include <color_fragment>', `#include <color_fragment>
          diffuseColor.rgb = mix(diffuseColor.rgb * (0.55 + 0.45 * chipM.g), vec3(0.34, 0.33, 0.37), chipM.r);`);
    };
    mat.customProgramCacheKey = () => 'bj-chip';
    this.mesh = new THREE.InstancedMesh(chipGeometry(), mat, capacity);
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.n = 0;
    this.cap = capacity;
    this._c = new THREE.Color();
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1); this._e = new THREE.Euler();
    scene.add(this.mesh);
  }

  /** reserve one instance and colour it; returns the index */
  add(color) {
    const i = this.n++;
    this.mesh.setColorAt(i, this._c.set(color));
    return i;
  }

  set(i, x, y, z, rx = 0, ry = 0, rz = 0, sy = 1) {
    this._e.set(rx, ry, rz);
    this._q.setFromEuler(this._e);
    this._s.set(1, sy, 1);
    this._m.compose(this._p.set(x, y, z), this._q, this._s);
    this.mesh.setMatrixAt(i, this._m);
  }

  commit() {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

// deterministic hash in [0,1)
export function hash(a, b = 0) {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** a stack whose chips carry fixed per-level jitter (identical for stacks built with the same seed) */
export class Stack {
  constructor(chips, colors, seed) {
    this.chips = chips;
    this.idx = colors.map(c => chips.add(c));
    this.jit = colors.map((_, k) => [(hash(seed, k) - 0.5) * 0.028, (hash(seed, k + 50) - 0.5) * 0.028, hash(seed, k + 99) * 6.28]);
    this.n = colors.length;
  }
  get height() { return this.n * CHIP.h; }
  /**
   * base (x, y, z) of the bottom chip. lean: tilt of the whole stack toward (dx, dz) (radians);
   * grow 0..1 rises out of the felt (the rack), hidden when 0.
   */
  write(x, y, z, { lean = 0, dx = 0, dz = 0, grow = 1, hidden = false } = {}) {
    const C = this.chips;
    for (let k = 0; k < this.n; k++) {
      const i = this.idx[k];
      if (hidden || grow <= 0) { C.set(i, 0, -50, 0, 0, 0, 0, 0.001); continue; }
      const [jx, jz, yaw] = this.jit[k];
      const h = k * CHIP.h * grow;
      // lean as a shear about the base
      C.set(i, x + jx + dx * lean * h, y + h, z + jz + dz * lean * h, dz * lean, yaw, -dx * lean, grow);
    }
  }
}

/** static layout: the fly's bankroll towers + the dealer's rack */
export function buildStatic(chips) {
  const towers = [];
  const pal = [CHIP_COLORS.purple, CHIP_COLORS.pink, CHIP_COLORS.teal, CHIP_COLORS.black, CHIP_COLORS.gold];
  // [x, z, count, colour]: behind the rail line on both sides of the fly (its "bankroll")
  const T = [
    [2.62, 1.3, 30, 0], [2.3, 1.72, 40, 4], [2.2, 2.28, 22, 1], [1.95, 1.3, 16, 2],
    [2.62, -1.3, 34, 3], [2.3, -1.72, 24, 0], [2.2, -2.28, 38, 4], [1.95, -1.32, 12, 1],
  ];
  for (const [x, z, n, ci] of T) {
    for (let k = 0; k < n; k++) {
      // bands of colour: mostly the tower colour with a few other chips mixed in
      const cc = hash(x * 13 + z, k) < 0.14 ? pal[(ci + 1 + (k % 3)) % pal.length] : pal[ci];
      const i = chips.add(cc);
      const jx = (hash(x, k + 7) - 0.5) * 0.03, jz = (hash(z, k + 3) - 0.5) * 0.03;
      chips.set(i, x + jx, TABLE.y + k * CHIP.h, z + jz, 0, hash(k, x) * 6.28, 0);
    }
    towers.push({ x, z, n });
  }
  // dealer rack: chips on edge in slots (axis along x)
  const RK = rackLayout();
  const rackCols = [CHIP_COLORS.black, CHIP_COLORS.gold, CHIP_COLORS.purple, CHIP_COLORS.pink];
  for (let s = 0; s < RK.slots; s++) {
    const z = RK.z - RK.width / 2 + (s + 0.5) * RK.pitch;
    const n = 10 + Math.floor(hash(s, 5) * 3);
    for (let k = 0; k < n; k++) {
      const i = chips.add(rackCols[s]);
      const x = RK.x - RK.depth / 2 + 0.04 + k * (CHIP.h + 0.004);
      chips.set(i, x, TABLE.y + 0.1 + CHIP.r, z, 0, 0, Math.PI / 2);
    }
  }
  return towers;
}
