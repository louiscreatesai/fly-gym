// Playing cards: thin rounded slabs with a canvas-texture face (big clean rank + suit, readable at
// phone size) and a purple/pink back. Local frame: x = width, y = height (text up), z = face normal.
// On the table the text points +x (away from the dealer-side camera) so it reads upright on screen.
import * as THREE from 'three';
import { CARD } from './table.js';

const RED = '#e3164f', INK = '#171a33';
export const SUIT = { S: '♠', H: '♥', D: '♦', C: '♣' };
const TEX_W = 512, TEX_H = Math.round(512 * CARD.h / CARD.w);

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

export function faceTexture(rank, suit) {
  const c = document.createElement('canvas');
  c.width = TEX_W; c.height = TEX_H;
  const g = c.getContext('2d');
  const W = TEX_W, H = TEX_H;
  const col = suit === 'H' || suit === 'D' ? RED : INK;
  const sym = SUIT[suit];
  g.fillStyle = '#fbfaff'; g.fillRect(0, 0, W, H);
  // soft paper shading
  const sh = g.createLinearGradient(0, 0, 0, H);
  sh.addColorStop(0, 'rgba(255,255,255,0)'); sh.addColorStop(1, 'rgba(120,110,170,0.08)');
  g.fillStyle = sh; g.fillRect(0, 0, W, H);
  g.lineWidth = 6; g.strokeStyle = 'rgba(167,139,250,0.55)';
  roundRect(g, 16, 16, W - 32, H - 32, 30); g.stroke();
  const font = w => `900 ${w}px "Segoe UI", "Arial Black", system-ui, sans-serif`;
  const sfont = w => `${w}px "Segoe UI Symbol", "Segoe UI", system-ui, sans-serif`;
  g.fillStyle = col; g.textAlign = 'center'; g.textBaseline = 'middle';
  // corner index (top-left): this is what stays visible in a fanned hand, so it is big
  const ix = 104;
  g.font = font(rank === '10' ? 150 : 176);
  if (rank === '10') { g.save(); g.translate(ix, 124); g.scale(0.82, 1); g.fillText(rank, 0, 0); g.restore(); }
  else g.fillText(rank, ix, 124);
  g.font = sfont(128); g.fillText(sym, ix, 262);
  // mirrored small index bottom-right
  g.save(); g.translate(W - 64, H - 96); g.rotate(Math.PI);
  g.font = font(rank === '10' ? 70 : 84); g.fillText(rank, 0, 0);
  g.font = sfont(64); g.fillText(sym, 0, 64);
  g.restore();
  // centre
  if ('JQK'.includes(rank)) {
    g.save();
    g.fillStyle = 'rgba(199,155,255,0.22)';
    roundRect(g, W * 0.36, H * 0.3, W * 0.5, H * 0.5, 26); g.fill();
    g.lineWidth = 5; g.strokeStyle = 'rgba(139,92,246,0.6)'; g.stroke();
    g.fillStyle = col;
    g.font = font(210); g.fillText(rank, W * 0.61, H * 0.49);
    g.font = sfont(96); g.fillText(sym, W * 0.61, H * 0.7);
    g.restore();
  } else if (rank === 'A') {
    g.font = sfont(330); g.fillText(sym, W * 0.58, H * 0.56);
  } else {
    g.font = sfont(250); g.fillText(sym, W * 0.6, H * 0.58);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function backTexture() {
  const c = document.createElement('canvas');
  c.width = TEX_W; c.height = TEX_H;
  const g = c.getContext('2d');
  const W = TEX_W, H = TEX_H;
  g.fillStyle = '#f4efff'; g.fillRect(0, 0, W, H);
  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#4c1d95'); bg.addColorStop(0.5, '#6d28d9'); bg.addColorStop(1, '#86198f');
  g.fillStyle = bg; roundRect(g, 26, 26, W - 52, H - 52, 26); g.fill();
  g.save();
  roundRect(g, 26, 26, W - 52, H - 52, 26); g.clip();
  // diamond lattice
  g.strokeStyle = 'rgba(240,171,252,0.5)'; g.lineWidth = 4;
  for (let k = -H; k < W + H; k += 48) {
    g.beginPath(); g.moveTo(k, 0); g.lineTo(k + H, H); g.stroke();
    g.beginPath(); g.moveTo(k, H); g.lineTo(k + H, 0); g.stroke();
  }
  g.restore();
  // centre hex emblem
  g.save(); g.translate(W / 2, H / 2);
  const hex = r => { g.beginPath(); for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + i * Math.PI / 3; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.closePath(); };
  hex(118); g.fillStyle = '#2e1065'; g.fill(); g.lineWidth = 10; g.strokeStyle = '#f0abfc'; g.stroke();
  hex(70); g.fillStyle = '#f0abfc'; g.fill();
  hex(34); g.fillStyle = '#2e1065'; g.fill();
  g.restore();
  g.lineWidth = 8; g.strokeStyle = '#f0abfc';
  roundRect(g, 44, 44, W - 88, H - 88, 18); g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function cardShape() {
  const w = CARD.w, h = CARD.h, r = CARD.r;
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + r, -h / 2);
  s.lineTo(w / 2 - r, -h / 2); s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  s.lineTo(w / 2, h / 2 - r); s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  s.lineTo(-w / 2 + r, h / 2); s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  s.lineTo(-w / 2, -h / 2 + r); s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  return s;
}

/** one geometry, 3 groups: 0 face (+z), 1 back (-z), 2 edge */
export function cardGeometry() {
  const sh = cardShape();
  const ex = new THREE.ExtrudeGeometry(sh, { depth: CARD.t, bevelEnabled: false, curveSegments: 6 });
  ex.translate(0, 0, -CARD.t / 2);
  // ExtrudeGeometry groups: 0 = caps (back cap first half, front cap second half), 1 = sides
  const pos = ex.attributes.position, uv = ex.attributes.uv, nrm = ex.attributes.normal;
  const g0 = ex.groups[0], g1 = ex.groups[1];
  const idx = [];
  const face = [], back = [], edge = [];
  const nonIndexed = !ex.index;
  const vid = i => nonIndexed ? i : ex.index.getX(i);
  for (let i = g0.start; i < g0.start + g0.count; i += 3) {
    const a = vid(i), b = vid(i + 1), c = vid(i + 2);
    (pos.getZ(a) > 0 ? face : back).push(a, b, c);
  }
  for (let i = g1.start; i < g1.start + g1.count; i++) edge.push(vid(i));
  // UVs for the caps from x/y
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    if (Math.abs(nrm.getZ(i)) > 0.5) {
      const u = x / CARD.w + 0.5, v = y / CARD.h + 0.5;
      uv.setXY(i, pos.getZ(i) > 0 ? u : 1 - u, v);   // the back is seen mirrored, flip it back
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', pos); g.setAttribute('normal', nrm); g.setAttribute('uv', uv);
  g.setIndex([...face, ...back, ...edge]);
  g.addGroup(0, face.length, 0);
  g.addGroup(face.length, back.length, 1);
  g.addGroup(face.length + back.length, edge.length, 2);
  return g;
}

export class CardSet {
  constructor(scene, specs) {
    // specs: [{rank, suit}] one mesh each
    this.geo = cardGeometry();
    this.backTex = backTexture();
    // albedo kept low: a white card under the key light would otherwise cross the bloom threshold
    this.backMat = new THREE.MeshStandardMaterial({ map: this.backTex, roughness: 0.55, metalness: 0.0, color: new THREE.Color(0.62, 0.62, 0.62) });
    this.edgeMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.36, 0.35, 0.4), roughness: 0.7 });
    this.meshes = specs.map(sp => {
      const faceMat = new THREE.MeshStandardMaterial({ map: faceTexture(sp.rank, sp.suit), roughness: 0.62, metalness: 0.0, color: new THREE.Color(0.4, 0.4, 0.41) });
      const m = new THREE.Mesh(this.geo, [faceMat, this.backMat, this.edgeMat]);
      m.castShadow = true; m.receiveShadow = true;
      m.matrixAutoUpdate = false;
      m.visible = false;
      scene.add(m);
      return m;
    });
  }
}

// base orientation: face up on the felt, text toward +x: local x -> +z, local y -> +x, local z -> +y
const Q0 = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(
  new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0)));
const _q = new THREE.Quaternion(), _qf = new THREE.Quaternion(), _qy = new THREE.Quaternion();
const _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
const AX_Y = new THREE.Vector3(0, 1, 0), AX_LY = new THREE.Vector3(0, 1, 0);

/**
 * Write a card's matrix. flip: 0 face up, 1 face down (rotation about the card's long axis).
 * yaw: twist on the felt (radians). tilt: extra rotation about the long axis for a lifted edge.
 */
export function placeCard(mesh, x, y, z, flip, yaw, scale = 1) {
  const a = Math.PI * flip;
  _qf.setFromAxisAngle(AX_LY, a);
  _qy.setFromAxisAngle(AX_Y, yaw);
  _q.copy(_qy).multiply(Q0).multiply(_qf);
  // keep the lifted edge above the felt during a flip
  const lift = Math.abs(Math.sin(a)) * CARD.w * 0.5;
  _p.set(x, y + lift, z);
  mesh.matrix.compose(_p, _q, _s.setScalar(scale));
  mesh.matrixWorldNeedsUpdate = true;
}

/** blackjack value helpers */
export function cardValue(rank) { return rank === 'A' ? 11 : 'JQK'.includes(rank) ? 10 : +rank; }
export function handTotal(ranks) {
  let t = 0, aces = 0;
  for (const r of ranks) { t += cardValue(r); if (r === 'A') aces++; }
  while (t > 21 && aces > 0) { t -= 10; aces--; }
  return t;
}
