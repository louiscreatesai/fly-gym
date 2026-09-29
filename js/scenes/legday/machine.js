// The 45° sled leg press, fly-sized, stylised (steel grey-blue, purple/pink hex accents).
//
// Frames: world is Y-up, units mm. The rails run along DV = (cos45, sin45, 0).
// "Rail frame" = a Group rotated 45° about Z: local x = up the rails (DV), local y = HV (the fly's head
// direction, perpendicular to the rails), local z = world z. Its origin is the footplate centre line.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const A = Math.SQRT1_2;
export const DV = new THREE.Vector3(A, A, 0);
export const HV = new THREE.Vector3(-A, A, 0);

// geometry constants (rail frame)
export const RAIL_Y = -2.5;        // rails run under the carriage
export const RAIL_Z = 1.2;
export const RAIL_X0 = -0.35, RAIL_X1 = 6.6;
export const PLATE_R = 0.92, PLATE_T = 0.13, PLATE_PITCH = PLATE_T + 0.014;
export const HORN_X = 1.3, HORN_Y = 1.1, HORN_Z0 = 1.75, HORN_Z1 = 1.75 + 11 * PLATE_PITCH + 0.1;
export const TPLATE_R = 1.0, TPLATE_T = 0.2;
export const TRAY = new THREE.Vector3(1.75, 1.6, 0);   // tower tray centre (rail frame), relative to the sled

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _q = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0);

function mesh(geo, mat, cast = true, recv = true) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast; m.receiveShadow = recv;
  return m;
}
/** a cylinder strut between two points */
function strut(p, q, r, mat, seg = 12) {
  const len = p.distanceTo(q);
  const m = mesh(new THREE.CylinderGeometry(r, r, len, seg), mat);
  m.position.copy(p).add(q).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(_up, _b.subVectors(q, p).normalize());
  return m;
}
/** a rounded box between two points (long axis p->q), with a roll so its "up" faces `up` */
function beam(p, q, w, h, mat, up = new THREE.Vector3(0, 1, 0)) {
  const len = p.distanceTo(q);
  const m = mesh(new RoundedBoxGeometry(len, h, w, 3, Math.min(w, h) * 0.3), mat);
  m.position.copy(p).add(q).multiplyScalar(0.5);
  const x = _b.subVectors(q, p).normalize().clone();
  const z = new THREE.Vector3().crossVectors(x, up).normalize();
  const y = new THREE.Vector3().crossVectors(z, x);
  m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  return m;
}

/** hex plate geometries: body (steel prism + hub, vertex coloured) and accent (hex rings on both faces). Axis = Y. */
export function plateGeometries(r = PLATE_R, t = PLATE_T, steel = 0x8e9ab3, hub = 0x3b4260) {
  const col = (g, c) => {
    const cc = new THREE.Color(c), n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = cc.r; a[i * 3 + 1] = cc.g; a[i * 3 + 2] = cc.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return g;
  };
  const prism = col(new THREE.CylinderGeometry(r, r, t, 6, 1).toNonIndexed(), steel);
  prism.computeVertexNormals();
  // chamfer ring (slightly smaller, a bit proud) gives the bevelled look
  const bevel = col(new THREE.CylinderGeometry(r * 0.9, r * 0.97, t * 1.12, 6, 1).toNonIndexed(), steel);
  bevel.computeVertexNormals();
  const hubG = col(new THREE.CylinderGeometry(r * 0.2, r * 0.2, t * 1.4, 16, 1).toNonIndexed(), hub);
  hubG.computeVertexNormals();
  const body = mergeGeometries([prism, bevel, hubG]);
  // accent: a hex ring on each face
  const ring = (y) => {
    const g = new THREE.RingGeometry(r * 0.36, r * 0.66, 6, 1);
    g.rotateX(y > 0 ? -Math.PI / 2 : Math.PI / 2);
    g.translate(0, y, 0);
    return g;
  };
  // a thin pink band around the rim so stacked plates read from the side
  const band = new THREE.CylinderGeometry(r * 1.012, r * 1.012, t * 0.28, 6, 1, true);
  band.deleteAttribute('uv');
  const r1 = ring(t * 0.565), r2 = ring(-t * 0.565);
  r1.deleteAttribute('uv'); r2.deleteAttribute('uv');
  const accent = mergeGeometries([r1, r2, band]);
  accent.rotateY(0);   // rings share the prism orientation (both have a vertex at +x... close enough)
  return { body, accent };
}

export function buildMachine(ctx, T0) {
  const P = ctx.PALETTE;
  const M = {};
  const mats = M.mats = {
    steel: new THREE.MeshStandardMaterial({ color: P.steel, roughness: 0.42, metalness: 0.38 }),
    steelDark: new THREE.MeshStandardMaterial({ color: P.steelDark, roughness: 0.5, metalness: 0.4 }),
    rail: new THREE.MeshStandardMaterial({ color: 0xaab4cc, roughness: 0.28, metalness: 0.6 }),
    pad: new THREE.MeshStandardMaterial({ color: 0x2c3150, roughness: 0.78, metalness: 0.02 }),
    accent: new THREE.MeshStandardMaterial({ color: P.accent, roughness: 0.4, metalness: 0.1, emissive: 0x7a3fd0, emissiveIntensity: 0.55 }),
    glow: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xc79bff).multiplyScalar(1.6), toneMapped: false }),
    grip: new THREE.MeshStandardMaterial({ color: 0x1b1e30, roughness: 0.9 }),
  };
  const root = M.root = new THREE.Group();
  root.name = 'legpress';
  ctx.scene.add(root);

  // rail frame: origin = T0 + XC*HV (footplate centre line), rotated 45° about z
  const rf = M.railFrame = new THREE.Group();
  rf.rotation.z = Math.PI / 4;
  root.add(rf);
  M.toWorld = (x, y, z, out = new THREE.Vector3()) => out.set(x, y, z).applyMatrix4(rf.matrixWorld);

  // ---------- base frame on the platform ----------
  const baseY = 0.13;
  const bx0 = -3.55, bx1 = 5.6;
  for (const s of [-1, 1]) {
    root.add(beam(new THREE.Vector3(bx0, baseY, s * 1.35), new THREE.Vector3(bx1, baseY, s * 1.35), 0.34, 0.26, mats.steelDark));
    // rubber feet
    for (const x of [bx0 + 0.25, bx1 - 0.25]) {
      const f = mesh(new RoundedBoxGeometry(0.5, 0.08, 0.5, 2, 0.03), mats.grip);
      f.position.set(x, 0.02, s * 1.35);
      root.add(f);
    }
  }
  for (const x of [bx0 + 0.2, 0.9, bx1 - 0.2]) root.add(beam(new THREE.Vector3(x, baseY, -1.35), new THREE.Vector3(x, baseY, 1.35), 0.3, 0.22, mats.steelDark));

  rf.updateMatrixWorld(true);
  return M;
}

/** Everything that is placed relative to T0 (called after rf is positioned). */
export function buildMachineParts(ctx, M, { XC }) {
  const { mats } = M;
  const rf = M.railFrame, root = M.root;
  rf.updateMatrixWorld(true);
  const W = (x, y, z) => M.toWorld(x, y, z);
  const baseY = 0.13;

  // ---------- rails (bendable) ----------
  const L = RAIL_X1 - RAIL_X0;
  M.rails = [];
  for (const s of [-1, 1]) {
    const g = new THREE.BoxGeometry(L, 0.2, 0.3, 40, 1, 1);
    g.translate(L / 2, 0, 0);
    const m = mesh(g, mats.rail);
    m.position.set(RAIL_X0, RAIL_Y, s * RAIL_Z);
    rf.add(m);
    m.userData.rest = g.attributes.position.array.slice();
    M.rails.push(m);
    // glowing inset strip along the outer face
    const sg = new THREE.BoxGeometry(L - 0.3, 0.035, 0.01, 40, 1, 1);
    sg.translate(L / 2, 0, 0);
    const strip = new THREE.Mesh(sg, mats.glow);
    strip.position.set(RAIL_X0, RAIL_Y, s * (RAIL_Z + 0.151));
    strip.userData.rest = sg.attributes.position.array.slice();
    rf.add(strip);
    M.rails.push(strip);
    // safety stops (low)
    const stop = mesh(new RoundedBoxGeometry(0.18, 0.34, 0.42, 2, 0.05), mats.accent);
    stop.position.set(0.55, RAIL_Y + 0.05, s * RAIL_Z);
    rf.add(stop);
  }
  M.railLen = L;

  // lower rail mount: a crossbar + two legs down to the base
  const lo = W(RAIL_X0 + 0.1, RAIL_Y - 0.1, 0);
  root.add(beam(W(RAIL_X0 + 0.1, RAIL_Y - 0.16, -RAIL_Z - 0.2), W(RAIL_X0 + 0.1, RAIL_Y - 0.16, RAIL_Z + 0.2), 0.3, 0.26, mats.steelDark));
  for (const s of [-1, 1]) {
    const p = W(RAIL_X0 + 0.1, RAIL_Y - 0.2, s * RAIL_Z);
    root.add(strut(p, new THREE.Vector3(p.x, baseY, s * RAIL_Z), 0.11, mats.steelDark));
  }
  // upper end: tall upright + gusset struts
  const hi = W(RAIL_X1 - 0.15, RAIL_Y - 0.12, 0);
  M.upperX = hi.x;
  for (const s of [-1, 1]) {
    const top = W(RAIL_X1 - 0.15, RAIL_Y - 0.12, s * RAIL_Z);
    root.add(beam(new THREE.Vector3(top.x, baseY, s * 1.35), new THREE.Vector3(top.x, top.y + 0.2, s * 1.35), 0.3, 0.3, mats.steel, new THREE.Vector3(1, 0, 0)));
    // diagonal brace from mid-rail to the base
    const mid = W(RAIL_X0 + L * 0.52, RAIL_Y - 0.1, s * RAIL_Z);
    root.add(strut(mid, new THREE.Vector3(mid.x + 0.3, baseY, s * 1.35), 0.09, mats.steelDark));
  }
  root.add(beam(W(RAIL_X1 - 0.15, RAIL_Y - 0.2, -1.5), W(RAIL_X1 - 0.15, RAIL_Y - 0.2, 1.5), 0.28, 0.28, mats.steel));
  // end caps on the rails
  for (const s of [-1, 1]) {
    const cap = mesh(new RoundedBoxGeometry(0.26, 0.36, 0.42, 2, 0.06), mats.accent);
    cap.position.set(RAIL_X1 - 0.05, RAIL_Y, s * RAIL_Z);
    rf.add(cap);
  }

  // ---------- seat: backrest pad (fly lies on its back on it) + butt cushion ----------
  const seat = M.seat = new THREE.Group();
  rf.add(seat);
  const padLen = 4.1, padW = 1.9;
  const back = mesh(new RoundedBoxGeometry(0.34, padLen, padW, 4, 0.14), mats.pad);
  // backrest top surface sits at rail-frame x = -(0.43) (the fly's dorsal side)
  back.position.set(-0.43 - 0.17, -0.2, 0);
  seat.add(back);
  // purple piping around the pad
  const pipeG = new THREE.TorusGeometry(1, 0.025, 6, 48);
  for (const s of [-1, 1]) {
    const pipe = new THREE.Mesh(new THREE.BoxGeometry(0.03, padLen - 0.2, 0.03), mats.glow);
    pipe.position.set(-0.43 + 0.005, -0.2, s * (padW / 2 - 0.05));
    seat.add(pipe);
  }
  // steel shell behind the pad
  const shell = mesh(new RoundedBoxGeometry(0.14, padLen + 0.1, padW + 0.1, 3, 0.05), mats.steel);
  shell.position.set(-0.43 - 0.34 - 0.07, -0.2, 0);
  seat.add(shell);
  // butt cushion at the bottom end (below the abdomen tip)
  const cush = mesh(new RoundedBoxGeometry(0.9, 0.34, padW * 0.9, 4, 0.14), mats.pad);
  cush.position.set(-0.43 + 0.25, -0.2 - padLen / 2 - 0.05, 0);
  seat.add(cush);
  // handles beside the seat (unused: all six legs press)
  for (const s of [-1, 1]) {
    const hb = W(-0.7, -1.9, s * 1.2);
    const he = W(-0.7, -1.9, s * 1.75);
    root.add(strut(hb, he, 0.06, mats.steelDark));
    const grip = strut(W(-0.7, -1.9, s * 1.75), W(0.05, -1.9, s * 1.75), 0.085, mats.grip);
    root.add(grip);
  }
  // seat supports: from the shell down to the base
  const s1 = W(-0.95, 1.0, 0), s2 = W(-0.95, -1.7, 0);
  for (const z of [-0.6, 0.6]) {
    root.add(strut(new THREE.Vector3(s1.x, s1.y, z), new THREE.Vector3(s1.x + 0.2, baseY, z * 1.9), 0.1, mats.steelDark));
    root.add(strut(new THREE.Vector3(s2.x, s2.y, z), new THREE.Vector3(s2.x - 0.1, baseY, z * 1.9), 0.1, mats.steelDark));
  }

  // ---------- sled carriage (moves along rail-frame x) ----------
  const sled = M.sled = new THREE.Group();
  rf.add(sled);
  const plate = mesh(new RoundedBoxGeometry(0.18, 4.3, 3.7, 3, 0.07), mats.steel);
  plate.position.set(0.09, 0, 0);
  sled.add(plate);
  // grip texture: purple hex dots on the plate face (instanced, cheap)
  {
    const dot = new THREE.CircleGeometry(0.075, 6);
    dot.rotateY(-Math.PI / 2);
    const pts = [];
    for (let iy = -9; iy <= 9; iy++) for (let iz = -7; iz <= 7; iz++) {
      const y = iy * 0.21, z = iz * 0.23 + (iy & 1 ? 0.115 : 0);
      if (Math.abs(z) < 1.72 && Math.abs(y) < 2.0) pts.push([y, z]);
    }
    const dm = new THREE.InstancedMesh(dot, new THREE.MeshStandardMaterial({ color: 0x6e5aa8, roughness: 0.6, emissive: 0x2a1650, emissiveIntensity: 0.5 }), pts.length);
    const mm = new THREE.Matrix4();
    pts.forEach(([y, z], i) => dm.setMatrixAt(i, mm.makeTranslation(-0.002, y, z)));
    dm.receiveShadow = true;
    sled.add(dm);
  }
  // glowing trim around the plate edge (front face)
  for (const [len, y, z, rz] of [[4.2, 0, 1.8, 0], [4.2, 0, -1.8, 0], [3.5, 2.1, 0, 1], [3.5, -2.1, 0, 1]]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.02, rz ? 0.035 : len, rz ? len : 0.035), mats.glow);
    b.position.set(-0.005, y, z);
    sled.add(b);
  }
  // side frames: open strut trusses from the footplate back to the horn axle and the sliders
  const SF = [[0.2, 1.75, HORN_X, HORN_Y], [HORN_X, HORN_Y, 2.15, -0.35], [2.15, -0.35, 2.15, -2.1], [2.15, -2.1, 0.2, -2.1],
    [0.2, -0.9, HORN_X, HORN_Y], [0.2, -0.9, 2.15, -2.1]];
  for (const s of [-1, 1]) {
    const z = s * 1.62;
    for (const [x0, y0, x1, y1] of SF) sled.add(strut(new THREE.Vector3(x0, y0, z), new THREE.Vector3(x1, y1, z), 0.075, mats.steelDark));
    for (const [x, y] of [[HORN_X, HORN_Y], [2.15, -0.35], [2.15, -2.1], [0.2, -0.9]]) {
      const k = mesh(new THREE.SphereGeometry(0.105, 12, 8), mats.steelDark);
      k.position.set(x, y, z);
      sled.add(k);
    }
    // hex accent badge on the frame
    const hx = new THREE.Mesh(new THREE.RingGeometry(0.13, 0.24, 6), mats.accent);
    hx.position.set(1.45, -1.2, s * 1.7);
    if (s < 0) hx.rotation.y = Math.PI;
    sled.add(hx);
    // sliders on the rails
    for (const x of [0.3, 1.9]) {
      const sl = mesh(new RoundedBoxGeometry(0.5, 0.3, 0.46, 2, 0.06), mats.steelDark);
      sl.position.set(x, RAIL_Y + 0.28, s * RAIL_Z);
      sled.add(sl);
    }
    // horn (weight peg)
    const horn = mesh(new THREE.CylinderGeometry(0.13, 0.13, HORN_Z1 - HORN_Z0 + 0.25, 16), mats.rail);
    horn.rotation.x = Math.PI / 2;
    horn.position.set(HORN_X, HORN_Y, s * ((HORN_Z0 + HORN_Z1) / 2 - 0.1));
    sled.add(horn);
    const collar = mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.12, 16), mats.accent);
    collar.rotation.x = Math.PI / 2;
    collar.position.set(HORN_X, HORN_Y, s * (HORN_Z0 - 0.08));
    sled.add(collar);
    const endc = mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.1, 16), mats.steelDark);
    endc.rotation.x = Math.PI / 2;
    endc.position.set(HORN_X, HORN_Y, s * (HORN_Z1 + 0.05));
    sled.add(endc);
  }
  // back frame of the carriage: two cross tubes + the horn axle
  for (const [x, y] of [[2.15, -2.1], [HORN_X, HORN_Y], [2.15, -0.35]]) {
    const tube = mesh(new THREE.CylinderGeometry(0.11, 0.11, 3.24, 12), mats.steel);
    tube.rotation.x = Math.PI / 2;
    tube.position.set(x, y, 0);
    sled.add(tube);
  }
  // bottom crossbar at the slider line
  const cb = mesh(new RoundedBoxGeometry(0.3, 0.26, 3.3, 2, 0.06), mats.steelDark);
  cb.position.set(1.1, RAIL_Y + 0.35, 0);
  sled.add(cb);
  // tower tray: a horizontal hex deck on a post behind the horn axle, between the two horns. It lives in
  // `trayRig` (pivot on the axle) so the scene can pop it out when the horns are full.
  const PIV = new THREE.Vector3(HORN_X, HORN_Y, 0);
  const rig = M.trayRig = new THREE.Group();
  rig.position.copy(PIV);
  sled.add(rig);
  const tray = M.tray = new THREE.Group();
  tray.position.copy(TRAY).sub(PIV);
  tray.rotation.z = -Math.PI / 4;   // world-horizontal
  rig.add(tray);
  const deck = mesh(new THREE.CylinderGeometry(1.08, 1.08, 0.14, 6), mats.steel);
  deck.rotation.y = Math.PI / 6;
  deck.position.y = -0.07;
  tray.add(deck);
  const deckRim = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.03, 6, 1, true), mats.glow);
  deckRim.rotation.y = Math.PI / 6;
  deckRim.position.y = -0.03;
  tray.add(deckRim);
  {
    // a world-vertical post from the deck down to the axle, plus two braces to the back cross tube
    const tb = new THREE.Vector3(0, -0.14, 0).applyEuler(tray.rotation).add(tray.position);   // deck bottom centre (rig frame)
    const hub = mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.5, 16), mats.accent);
    hub.rotation.x = Math.PI / 2;
    rig.add(hub);
    rig.add(strut(new THREE.Vector3(0, 0, 0), tb, 0.1, mats.steelDark));
    for (const z of [-0.55, 0.55]) {
      rig.add(strut(new THREE.Vector3(2.15 - PIV.x, -0.35 - PIV.y, z), new THREE.Vector3(tb.x, tb.y, z * 0.5), 0.065, mats.steelDark));
    }
  }

  return M;
}

/** Deflection of a simply supported beam (length 1) under a point load at c, normalised to a peak of 1. */
function beamShape(u, c) {
  const a = Math.min(0.95, Math.max(0.05, c)), b = 1 - a;
  const y = x => x <= a ? b * x * (1 - b * b - x * x) : a * (1 - x) * (1 - a * a - (1 - x) * (1 - x));
  // the peak sits at x = sqrt((1 - b²) / 3) when a >= b, else mirrored
  const xm = a >= b ? Math.sqrt((1 - b * b) / 3) : 1 - Math.sqrt((1 - a * a) / 3);
  return y(Math.min(1, Math.max(0, u))) / y(xm);
}

/** Bend the rails: offset along rail-frame -y by amp * beamShape(x). */
export function bendRails(M, amp, center) {
  const L = M.railLen;
  for (const m of M.rails) {
    const pos = m.geometry.attributes.position, rest = m.userData.rest, a = pos.array;
    for (let i = 0; i < a.length; i += 3) a[i + 1] = rest[i + 1] - amp * beamShape(rest[i] / L, center);
    pos.needsUpdate = true;
  }
}
export function railSag(M, amp, center, xRail) {
  return amp * beamShape((xRail - RAIL_X0) / M.railLen, center);
}

/**
 * Merge the plain meshes under `parent` into one mesh per material (baked relative to `parent`),
 * skipping any subtree in `skip`, instanced meshes and bendable rails. Cuts draw calls a lot.
 */
export function mergeStatic(parent, skip = new Set()) {
  parent.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(parent.matrixWorld).invert();
  const buckets = new Map();
  const victims = [];
  const rel = new THREE.Matrix4();
  parent.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh || o === parent || o.userData.rest) return;
    for (let a = o.parent; a && a !== parent; a = a.parent) if (skip.has(a)) return;
    if (skip.has(o)) return;
    const key = o.material.uuid + (o.castShadow ? 'c' : '') + (o.receiveShadow ? 'r' : '') + (o.renderOrder || 0);
    let b = buckets.get(key);
    if (!b) buckets.set(key, b = { mat: o.material, cast: o.castShadow, recv: o.receiveShadow, ro: o.renderOrder, geos: [] });
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    g.applyMatrix4(rel.multiplyMatrices(inv, o.matrixWorld));
    b.geos.push(g);
    victims.push(o);
  });
  for (const o of victims) o.parent.remove(o);
  for (const b of buckets.values()) {
    const m = new THREE.Mesh(b.geos.length > 1 ? mergeGeometries(b.geos) : b.geos[0], b.mat);
    m.castShadow = b.cast; m.receiveShadow = b.recv; m.renderOrder = b.ro;
    parent.add(m);
  }
  return victims.length;
}
