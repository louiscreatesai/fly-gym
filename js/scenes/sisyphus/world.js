// The hill: a ramp on the slab, in the platform material, with glowing purple rim lines,
// faint distance ticks, a summit plate and a little SUMMIT flag.
// Ground profile: arclength s along the centre line. s < 0 flat floor, 0..S slope, > S plateau.
// Ground coords (s, z) map isometrically to the 3D surface (the surface is developable).
import * as THREE from 'three';

export const HILL = {
  theta: 27 * Math.PI / 180,   // slope angle
  S: 9.2,                      // slope length (mm)
  x0: -4.3,                    // world x of the foot of the ramp
  W: 4.6,                      // hill width (z)
  P: 3.2,                      // plateau length
};
HILL.cos = Math.cos(HILL.theta);
HILL.sin = Math.sin(HILL.theta);
HILL.x1 = HILL.x0 + HILL.S * HILL.cos;   // lip x
HILL.H = HILL.S * HILL.sin;              // hill height
HILL.x2 = HILL.x1 + HILL.P;              // back of plateau

/** Ground point at arclength s (z = 0 line). Writes into out (Vector3). */
export function groundPoint(s, out) {
  const h = HILL;
  if (s <= 0) return out.set(h.x0 + s, 0, 0);
  if (s <= h.S) return out.set(h.x0 + s * h.cos, s * h.sin, 0);
  return out.set(h.x1 + (s - h.S), h.H, 0);
}
/** Surface angle (radians, about z) at arclength s. */
export function groundAngle(s) {
  return s < 0 || s > HILL.S ? 0 : HILL.theta;
}
/** Smoothed surface angle: mean over [s - r, s + r] (for a body standing across a corner). */
export function groundAngleSmooth(s, r) {
  const h = HILL;
  const a = s - r, b = s + r;
  const ov = Math.max(0, Math.min(b, h.S) - Math.max(a, 0));   // overlap with the slope
  return h.theta * ov / (b - a);
}
/** Height of the ground at world x (the solid's top). */
export function groundY(x) {
  const h = HILL;
  if (x <= h.x0) return 0;
  if (x <= h.x1) return (x - h.x0) * h.sin / h.cos;
  if (x <= h.x2) return h.H;
  return 0;
}
/** World position of ground coords (s, z) raised by n along the surface normal. */
export function surf(s, z, n, out) {
  groundPoint(s, out);
  const a = groundAngle(s);
  out.x += -Math.sin(a) * n;
  out.y += Math.cos(a) * n;
  out.z = z;
  return out;
}

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** SUMMIT flag placement (world x, z of the pole) and cloth facing */
export const FLAG = { x: HILL.x1 + 0.75, z: -1.95, rotY: -0.98 };

export function buildWorld(ctx) {
  const { scene, stage, PALETTE } = ctx;
  const h = HILL;
  const grp = new THREE.Group();
  grp.name = 'sisyphusWorld';

  // the slab under everything
  const plat = stage.platform({ w: 20, d: 10.5 });
  plat.position.set(-0.6, 0, 0);
  grp.add(plat);

  // ramp prism (cross-section in x-y, extruded along z)
  const shape = new THREE.Shape();
  shape.moveTo(h.x0, 0);
  shape.lineTo(h.x1, h.H);
  shape.lineTo(h.x2, h.H);
  shape.lineTo(h.x2, 0);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: h.W, bevelEnabled: false, steps: 1 });
  geo.translate(0, 0, -h.W / 2);
  // top faces lighter than the sides: split materials by normal
  const topMat = new THREE.MeshStandardMaterial({ color: PALETTE.platform, roughness: 0.6, metalness: 0.06 });
  const sideMat = new THREE.MeshStandardMaterial({ color: 0x8590b2, roughness: 0.6, metalness: 0.08 });
  geo.clearGroups();
  // ExtrudeGeometry: first the caps (front/back), then the side walls. Assign by face normal.
  const nrm = geo.getAttribute('normal');
  const idx = geo.index;
  const count = idx ? idx.count : nrm.count;
  // non-indexed in practice; group triangles: side walls with |nz| > 0.5 use sideMat
  let cur = -1, start = 0;
  for (let i = 0; i < count; i += 3) {
    const vi = idx ? idx.getX(i) : i;
    const m = Math.abs(nrm.getZ(vi)) > 0.5 || nrm.getX(vi) > 0.5 ? 1 : 0;
    if (m !== cur) {
      if (cur >= 0) geo.addGroup(start, i - start, cur);
      cur = m; start = i;
    }
  }
  geo.addGroup(start, count - start, cur);
  const ramp = new THREE.Mesh(geo, [topMat, sideMat]);
  ramp.castShadow = true;
  ramp.receiveShadow = true;
  grp.add(ramp);

  // glowing rim lines along the top edges
  const rimMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.edge).multiplyScalar(1.6), toneMapped: false });
  const lipMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xf0abfc).multiplyScalar(2.2), toneMapped: false });
  const inset = 0.07;
  const bar = (ax, ay, bx, by, z, mat, th = 0.03) => {
    const len = Math.hypot(bx - ax, by - ay);
    const m = new THREE.Mesh(new THREE.BoxGeometry(len, th, th * 1.2), mat);
    m.position.set((ax + bx) / 2, (ay + by) / 2 + th * 0.2, z);
    m.rotation.z = Math.atan2(by - ay, bx - ax);
    grp.add(m);
    return m;
  };
  for (const side of [-1, 1]) {
    const z = side * (h.W / 2 - inset);
    bar(h.x0 + 0.05, 0.0, h.x1, h.H, z, rimMat);
    bar(h.x1, h.H, h.x2 - inset, h.H, z, rimMat);
    // vertical back edge
    const v = new THREE.Mesh(new THREE.BoxGeometry(0.03, h.H, 0.036), rimMat);
    v.position.set(h.x2 - 0.02, h.H / 2, side * (h.W / 2 - 0.02));
    grp.add(v);
  }
  // the summit line across the lip (pink, brighter)
  const lip = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, h.W - 2 * inset), lipMat);
  lip.position.set(h.x1 + 0.01, h.H + 0.012, 0);
  grp.add(lip);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, h.W - 2 * inset), rimMat);
  back.position.set(h.x2 - inset, h.H + 0.01, 0);
  grp.add(back);

  // faint distance ticks + labels painted on the slope (one transparent decal)
  const decalTex = canvasTex(2048, 1024, (g, W, H) => {
    g.clearRect(0, 0, W, H);
    const pxPerMm = W / h.S;
    const zToPx = z => (z / h.W + 0.5) * H;
    g.lineCap = 'round'; g.lineJoin = 'round';
    // edge ticks every 0.5 mm, longer every 1 mm
    for (let mm = 0.5; mm < h.S - 0.2; mm += 0.5) {
      const x = mm * pxPerMm;
      const major = Math.abs(mm - Math.round(mm)) < 1e-6;
      g.strokeStyle = major ? 'rgba(215,190,255,0.95)' : 'rgba(200,170,255,0.6)';
      g.lineWidth = major ? 9 : 6;
      const L = major ? 0.45 : 0.24;
      for (const side of [-1, 1]) {
        const z0 = side * (h.W / 2 - 0.18), z1 = side * (h.W / 2 - 0.18 - L);
        g.beginPath(); g.moveTo(x, zToPx(z0)); g.lineTo(x, zToPx(z1)); g.stroke();
      }
    }
    // faint chevrons up the middle lane (the way to push)
    g.strokeStyle = 'rgba(210,180,255,0.6)';
    g.lineWidth = 16;
    for (let mm = 1.0; mm < h.S - 0.6; mm += 1.5) {
      const x = mm * pxPerMm;
      g.beginPath();
      g.moveTo(x - 0.28 * pxPerMm, zToPx(-0.5)); g.lineTo(x, zToPx(0)); g.lineTo(x - 0.28 * pxPerMm, zToPx(0.5));
      g.stroke();
    }
    // percent labels near both edges (reads as a progress gauge)
    g.fillStyle = 'rgba(225,205,255,0.95)';
    g.font = '800 64px Inter, Segoe UI, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const p of [25, 50, 75]) {
      const x = (p / 100) * h.S * pxPerMm;
      g.save();                              // on the camera side only (reads upright from the gym view)
      g.translate(x, zToPx(-(h.W / 2 - 0.95)));
      g.rotate(Math.PI / 2);
      g.fillText(p + '%', 0, 0);
      g.restore();
    }
  });
  const decal = new THREE.Mesh(
    new THREE.PlaneGeometry(h.S, h.W),
    new THREE.MeshBasicMaterial({ map: decalTex, transparent: true, depthWrite: false, toneMapped: false, opacity: 0.62 }),
  );
  // plane lies in x-y; rotate to lie on the slope: first flat (x along s, y -> -z), then pitch
  decal.rotation.order = 'ZXY';
  decal.rotation.set(-Math.PI / 2, 0, h.theta);
  decal.position.set((h.x0 + h.x1) / 2, h.H / 2 + 0.004, 0);
  decal.renderOrder = 1;
  grp.add(decal);

  // side walls: faint altitude contours every 1 mm with labels, like a mountain gauge
  const sideTex = canvasTex(2048, 1024, (g, W, H) => {
    g.clearRect(0, 0, W, H);
    const sx = W / (h.x2 - h.x0), sy = H / (h.H + 0.4);
    const X = x => (x - h.x0) * sx, Y = y => H - y * sy;
    g.save();
    g.beginPath();
    g.moveTo(X(h.x0), Y(0)); g.lineTo(X(h.x1), Y(h.H)); g.lineTo(X(h.x2), Y(h.H)); g.lineTo(X(h.x2), Y(0)); g.closePath();
    g.clip();
    for (let mm = 1; mm < h.H - 0.2; mm += 1) {
      g.strokeStyle = 'rgba(190,160,255,0.55)';
      g.lineWidth = 5;
      g.setLineDash([26, 18]);
      g.beginPath(); g.moveTo(X(h.x0), Y(mm)); g.lineTo(X(h.x2), Y(mm)); g.stroke();
    }
    g.restore();
    g.setLineDash([]);
    g.fillStyle = 'rgba(215,195,255,0.85)';
    g.font = '800 58px Inter, Segoe UI, sans-serif';
    g.textAlign = 'right'; g.textBaseline = 'bottom';
    for (let mm = 1; mm < h.H - 0.2; mm += 1) g.fillText(mm + ' mm', X(h.x2) - 30, Y(mm) - 8);
  });
  for (const sgn of [-1, 1]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(h.x2 - h.x0, h.H + 0.4),
      new THREE.MeshBasicMaterial({ map: sideTex, transparent: true, depthWrite: false, toneMapped: false, opacity: 0.7 }));
    m.position.set((h.x0 + h.x2) / 2, (h.H + 0.4) / 2, sgn * (h.W / 2 + 0.004));
    if (sgn > 0) { m.rotation.y = 0; } else { m.rotation.y = Math.PI; m.scale.x = -1; }
    m.renderOrder = 1;
    grp.add(m);
    // glowing line along the base of the wall
    const base = new THREE.Mesh(new THREE.BoxGeometry(h.x2 - h.x0 - 0.1, 0.025, 0.03), rimMat);
    base.position.set((h.x0 + h.x2) / 2 + 0.05, 0.02, sgn * (h.W / 2 + 0.005));
    grp.add(base);
  }

  // summit plate: a little white dish with a pink glowing ring (the goal)
  const plateX = h.x1 + 1.75, plateZ = 0;
  const dish = new THREE.Mesh(
    new THREE.CylinderGeometry(1.25, 1.05, 0.12, 48),
    new THREE.MeshStandardMaterial({ color: 0xe9ecf6, roughness: 0.35, metalness: 0.05 }),
  );
  dish.position.set(plateX, h.H + 0.06, plateZ);
  dish.castShadow = true; dish.receiveShadow = true;
  grp.add(dish);
  const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xf0abfc).multiplyScalar(2.0), toneMapped: false });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.028, 8, 64), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(plateX, h.H + 0.125, plateZ);
  grp.add(ring);
  // soft glow disk on the plate
  const glowTex = canvasTex(128, 128, (g, W, H) => {
    const gr = g.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W / 2);
    gr.addColorStop(0, 'rgba(240,171,252,0.0)');
    gr.addColorStop(0.72, 'rgba(240,171,252,0.10)');
    gr.addColorStop(0.9, 'rgba(240,171,252,0.35)');
    gr.addColorStop(1, 'rgba(240,171,252,0.0)');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
  });
  const glowMat = new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3.2), glowMat);
  glow.rotation.x = -Math.PI / 2;
  glow.position.set(plateX, h.H + 0.13, plateZ);
  grp.add(glow);

  // SUMMIT flag on a steel pole at the back corner of the plateau
  const poleMat = new THREE.MeshStandardMaterial({ color: PALETTE.steel, roughness: 0.4, metalness: 0.5 });
  const flagGrp = new THREE.Group();          // pole + knob + base + cloth, placed as one
  const poleX = 0, poleZ = 0;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.45, 12), poleMat);
  pole.position.set(poleX, h.H + 1.225, poleZ);
  pole.castShadow = true;
  flagGrp.add(pole);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0xf0abfc).multiplyScalar(2.2), toneMapped: false }));
  knob.position.set(poleX, h.H + 2.5, poleZ);
  flagGrp.add(knob);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.12, 6), new THREE.MeshStandardMaterial({ color: PALETTE.steelDark, roughness: 0.5, metalness: 0.4 }));
  base.position.set(poleX, h.H + 0.06, poleZ);
  base.castShadow = true;
  flagGrp.add(base);
  const flagTex = canvasTex(512, 256, (g, W, H) => {
    const gr = g.createLinearGradient(0, 0, W, H);
    gr.addColorStop(0, '#7c5cff'); gr.addColorStop(1, '#d58cf5');
    g.fillStyle = gr;
    g.beginPath();
    // swallowtail at the free end (left of the texture); the pole side is on the right
    g.moveTo(W, 0); g.lineTo(0, 0); g.lineTo(60, H / 2); g.lineTo(0, H); g.lineTo(W, H); g.closePath();
    g.fill();
    g.fillStyle = '#ffffff';
    g.font = '900 96px Inter, Segoe UI, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('SUMMIT', W / 2 + 30, H / 2 + 4);
  });
  flagTex.colorSpace = THREE.SRGBColorSpace;
  const flagGeo = new THREE.PlaneGeometry(1.7, 0.85, 16, 1);
  flagGeo.translate(-0.85, 0, 0);          // cloth flies toward local -x, away from the plateau
  const flag = new THREE.Mesh(flagGeo, new THREE.MeshBasicMaterial({ map: flagTex, side: THREE.DoubleSide, toneMapped: false, transparent: true }));
  flag.position.set(poleX, h.H + 2.03, poleZ);
  flag.rotation.y = FLAG.rotY;   // text faces the follow camera (and still reads from the wide one)
  flagGrp.add(flag);
  flagGrp.position.set(FLAG.x, 0, FLAG.z);
  grp.add(flagGrp);
  const flagBase = flagGeo.attributes.position.array.slice();

  scene.add(grp);

  return {
    grp, flag, flagGeo, flagBase, flagGrp,
    /** wave the flag; hope = 0..1 makes the summit plate flare (pure function of its inputs) */
    update(t, hope = 0) {
      const k = 2.0 + 2.6 * hope * (0.85 + 0.15 * Math.sin(t * 40));
      ringMat.color.setHex(0xf0abfc).multiplyScalar(k);
      glowMat.opacity = 1 + 1.5 * hope;
      glow.scale.setScalar(1 + 0.12 * hope);
      const p = flagGeo.attributes.position;
      const a = p.array;
      for (let i = 0; i < p.count; i++) {
        const x = flagBase[i * 3];
        const k = -x / 1.7;
        a[i * 3 + 2] = flagBase[i * 3 + 2] + Math.sin(t * 5.2 - x * 3.4) * 0.09 * k;
        a[i * 3 + 1] = flagBase[i * 3 + 1] + Math.sin(t * 3.1 - x * 2.1) * 0.03 * k;
      }
      p.needsUpdate = true;
    },
  };
}
