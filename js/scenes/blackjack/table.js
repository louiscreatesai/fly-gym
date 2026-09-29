// The casino set, fly-sized (millimetres): a semicircular blackjack table (green felt with printed
// arcs, padded rail, dealer chip rack, card shoe, discard holder) and a tall bar stool.
// World layout: the dealer's straight edge runs along z at x = TABLE.x0; the curved edge bulges
// toward +x where the fly sits. The gym camera looks from the dealer's side (-x) toward +x,
// so +z is screen right and card text points +x to read upright on screen.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const TABLE = {
  x0: -1.8,           // straight (dealer) edge
  R: 5.0,             // felt radius, curved edge apex at x0 + R = 3.2
  y: 3.0,             // felt top
  thick: 0.26,        // table top thickness under the felt
  railR: 0.17,        // padded rail tube radius
};
TABLE.apex = TABLE.x0 + TABLE.R;

export const STOOL = { x: 3.85, z: 0, seat: 2.02, r: 0.66, foot: 1.28 };

// spots on the felt (world x, z)
export const SPOT = {
  circle: [2.54, 0],                // betting circle (the fly's bet)
  side: [2.62, 0.72],               // the fly's winnings, left of its body (screen right)
  cards: [1.64, -0.6],             // first card of the fly's hand; later cards step by CARD_STEP
  dealer: [0.5, -0.12],              // dealer's up card; hole card and draws step by CARD_STEP
  shoeMouth: [-0.6, 2.95],          // where cards leave the shoe
  discard: [1.15, -3.3], 
  tray: [-0.72, -1.7],               // the payout stack rises out of the rack here
};
export const CARD_STEP = [0.03, 0.5];
export const CARD = { w: 0.82, h: 1.16, t: 0.016, r: 0.075 };   // fanned hand: small step away + to the right

const FELT_TEX = 2048;

function feltTexture() {
  const W = FELT_TEX, H = FELT_TEX / 2;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  // canvas x <- world z (-R..R), canvas y <- world x (apex at the top, straight edge at the bottom)
  const s = W / (2 * TABLE.R);                            // px per mm
  const cx = W / 2, cy = H;                               // table centre (middle of the straight edge)
  const P = (x, z) => [cx + z * s, cy - (x - TABLE.x0) * s];
  // felt: deep casino green with a soft vignette and fibre noise
  const bg = g.createRadialGradient(cx, cy - H * 0.35, H * 0.1, cx, cy - H * 0.3, H * 1.05);
  bg.addColorStop(0, '#11845f'); bg.addColorStop(0.7, '#0b6a4c'); bg.addColorStop(1, '#07513a');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  const img = g.getImageData(0, 0, W, H), d = img.data;
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * 14;
    d[i] += n * 0.6; d[i + 1] += n; d[i + 2] += n * 0.8;
  }
  g.putImageData(img, 0, 0);

  const ink = 'rgba(236, 244, 255, 0.92)', gold = '#f5d98a', pink = '#f0abfc';
  // arc text helper: letters upright (pointing away from the table centre), reading left to right
  const arcText = (text, radiusMM, font, color, spacing = 1.0, a0 = 0) => {
    g.save();
    g.font = font; g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle';
    const r = radiusMM * s;
    const widths = [...text].map(ch => g.measureText(ch).width * spacing);
    const total = widths.reduce((a, b) => a + b, 0);
    let ang = Math.PI / 2 + total / r / 2 + a0;         // start on the left, run clockwise over the top
    for (let i = 0; i < text.length; i++) {
      const w = widths[i];
      const a = ang - w / r / 2;
      g.save();
      g.translate(cx + Math.cos(a) * r, cy - Math.sin(a) * r);
      g.rotate(Math.PI / 2 - a);
      g.fillText(text[i], 0, 0);
      g.restore();
      ang -= w / r;
    }
    g.restore();
  };
  const arcLine = (radiusMM, width, color, a0 = 0.12, a1 = Math.PI - 0.12) => {
    g.beginPath(); g.arc(cx, cy, radiusMM * s, Math.PI + a0, 2 * Math.PI - (Math.PI - a1)); g.lineWidth = width; g.strokeStyle = color; g.stroke();
  };
  // insurance band
  arcLine(2.62, 5, 'rgba(245, 217, 138, 0.8)', 0.36, Math.PI - 0.36);
  arcLine(2.28, 5, 'rgba(245, 217, 138, 0.8)', 0.36, Math.PI - 0.36);
  arcText('INSURANCE  PAYS  2  TO  1', 2.45, '700 30px "Segoe UI", system-ui, sans-serif', 'rgba(245, 217, 138, 0.9)', 1.12);
  arcText('BLACKJACK  PAYS  3  TO  2', 1.92, '800 54px "Segoe UI", system-ui, sans-serif', ink, 1.05);
  arcText('DEALER MUST STAND ON 17 AND DRAW TO 16', 1.5, '700 30px "Segoe UI", system-ui, sans-serif', 'rgba(220, 235, 255, 0.78)', 1.06);
  // betting circle: glowing pink ring (his accent) with a thin inner line
  {
    const [x, y] = P(SPOT.circle[0], SPOT.circle[1]);
    g.lineWidth = 9; g.strokeStyle = pink;
    g.shadowColor = pink; g.shadowBlur = 18;
    g.beginPath(); g.arc(x, y, 0.47 * s, 0, Math.PI * 2); g.stroke();
    g.shadowBlur = 0;
    g.lineWidth = 3; g.strokeStyle = 'rgba(240,171,252,0.55)';
    g.beginPath(); g.arc(x, y, 0.38 * s, 0, Math.PI * 2); g.stroke();
  }
  // faint card boxes around the player's and the dealer's fans
  g.setLineDash([16, 12]); g.lineWidth = 3.5; g.strokeStyle = 'rgba(236,244,255,0.26)';
  for (const [sx, sz] of [SPOT.cards, SPOT.dealer]) {
    const m = 0.1, n = 3;
    const x0 = sx - CARD.h / 2 - m, x1 = sx + (n - 1) * CARD_STEP[0] + CARD.h / 2 + m;
    const z0 = sz - CARD.w / 2 - m, z1 = sz + (n - 1) * CARD_STEP[1] + CARD.w / 2 + m;
    const [ax, ay] = P(x1, z0), [bx, by] = P(x0, z1);
    g.beginPath(); g.roundRect(ax, ay, bx - ax, by - ay, 0.1 * s); g.stroke();
  }
  g.setLineDash([]);
  // edge trim
  g.lineWidth = 6; g.strokeStyle = 'rgba(199,155,255,0.55)';
  g.beginPath(); g.arc(cx, cy, TABLE.R * s - 5, Math.PI, 2 * Math.PI); g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 16;
  return { tex: t, P, s };
}

/** a half-disc (straight edge along z at x = 0, bulging toward +x) as a Shape in the (z, x) plane */
function halfDisc(R, seg = 96) {
  const sh = new THREE.Shape();
  sh.moveTo(-R, 0);
  for (let i = 0; i <= seg; i++) {
    const a = Math.PI - (i / seg) * Math.PI;
    sh.lineTo(Math.cos(a) * R, Math.sin(a) * R);
  }
  sh.lineTo(-R, 0);
  return sh;
}

export function buildSet(ctx) {
  const { scene, PALETTE } = ctx;
  const grp = new THREE.Group();
  grp.name = 'CasinoSet';
  scene.add(grp);
  const T = TABLE;

  const steel = new THREE.MeshStandardMaterial({ color: PALETTE.steel, roughness: 0.35, metalness: 0.55 });
  const steelDark = new THREE.MeshStandardMaterial({ color: PALETTE.steelDark, roughness: 0.45, metalness: 0.4 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x2a2140, roughness: 0.55, metalness: 0.1 });
  const leather = new THREE.MeshStandardMaterial({ color: 0x3b1f5c, roughness: 0.42, metalness: 0.05, emissive: 0x12051f, emissiveIntensity: 0.4 });
  const accent = new THREE.MeshStandardMaterial({ color: PALETTE.accent, roughness: 0.3, emissive: 0xb06cff, emissiveIntensity: 0.55 });

  // ---- felt ----
  const F = feltTexture();
  const feltGeo = new THREE.ShapeGeometry(halfDisc(T.R), 96);
  // shape coords: (z, x-x0). UVs: u = (z + R) / 2R, v = (x - x0) / R  (canvas y is flipped by flipY)
  {
    const p = feltGeo.attributes.position, uv = feltGeo.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + T.R) / (2 * T.R), p.getY(i) / T.R);
  }
  const felt = new THREE.Mesh(feltGeo, new THREE.MeshStandardMaterial({ map: F.tex, roughness: 0.92, metalness: 0 }));
  // shape (a, b) -> world (x = x0 + b, z = a): rotate so shape x -> world z, shape y -> world x, normal -> +y
  felt.matrixAutoUpdate = false;
  felt.matrix.set(
    0, 1, 0, T.x0,
    0, 0, 1, T.y,
    1, 0, 0, 0,
    0, 0, 0, 1,
  );
  felt.receiveShadow = true;
  grp.add(felt);

  // ---- table body: extruded half disc under the felt ----
  const bodyGeo = new THREE.ExtrudeGeometry(halfDisc(T.R + 0.06), { depth: T.thick, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 2, curveSegments: 96 });
  const body = new THREE.Mesh(bodyGeo, wood);
  body.matrixAutoUpdate = false;
  body.matrix.set(
    0, 1, 0, T.x0,
    0, 0, 1, T.y - T.thick - 0.06,
    1, 0, 0, 0,
    0, 0, 0, 1,
  );
  body.castShadow = true; body.receiveShadow = true;
  grp.add(body);

  // ---- padded rail along the curved edge (dark purple leather) + a pink piping line ----
  {
    const arc = new THREE.Curve();
    const Rr = T.R + 0.06;
    arc.getPoint = (k, out = new THREE.Vector3()) => {
      const a = -Math.PI / 2 + k * Math.PI;
      return out.set(T.x0 + Math.cos(a) * Rr, T.y + 0.035, Math.sin(a) * Rr);
    };
    const tube = new THREE.TubeGeometry(arc, 160, T.railR, 20, false);
    const rail = new THREE.Mesh(tube, leather);
    rail.castShadow = true; rail.receiveShadow = true;
    grp.add(rail);
    const pipe = new THREE.TubeGeometry(arc, 160, 0.018, 8, false);
    const pm = new THREE.Mesh(pipe, accent);
    pm.position.set(0, T.railR * 0.2, 0);
    grp.add(pm);
    // rail end caps
    for (const sgn of [-1, 1]) {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(T.railR, 20, 12), leather);
      cap.position.set(T.x0, T.y + 0.035, sgn * Rr);
      grp.add(cap);
    }
  }
  // dealer edge trim
  {
    const trim = new THREE.Mesh(new RoundedBoxGeometry(0.16, T.thick + 0.08, 2 * T.R + 0.2, 3, 0.05), steelDark);
    trim.position.set(T.x0 - 0.05, T.y - T.thick / 2 + 0.01, 0);
    trim.castShadow = true;
    grp.add(trim);
  }

  // ---- pedestal: column + foot on the platform ----
  {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.52, T.y - T.thick, 32), steelDark);
    col.position.set(T.x0 + 1.6, (T.y - T.thick) / 2, 0);
    col.castShadow = true; col.receiveShadow = true;
    grp.add(col);
    const foot = new THREE.Mesh(new RoundedBoxGeometry(2.4, 0.16, 5.4, 3, 0.07), steelDark);
    foot.position.set(T.x0 + 1.6, 0.08, 0);
    foot.castShadow = true; foot.receiveShadow = true;
    grp.add(foot);
    for (const sgn of [-1, 1]) {
      const hx = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.05, 6), accent);
      hx.position.set(T.x0 + 1.6, 0.17, sgn * 2.2);
      grp.add(hx);
    }
  }

  // ---- dealer chip rack (the chips themselves are instanced in chips.js) ----
  const rack = new THREE.Group();
  {
    const RK = rackLayout();
    const base = new THREE.Mesh(new RoundedBoxGeometry(RK.depth + 0.12, 0.14, RK.width + 0.14, 3, 0.04), steelDark);
    base.position.set(RK.x, T.y + 0.02, RK.z);
    base.castShadow = true; base.receiveShadow = true;
    rack.add(base);
    // slot dividers
    for (let i = 0; i <= RK.slots; i++) {
      const z = RK.z - RK.width / 2 + i * RK.pitch;
      const dv = new THREE.Mesh(new THREE.BoxGeometry(RK.depth, 0.2, 0.03), steelDark);
      dv.position.set(RK.x, T.y + 0.14, z);
      rack.add(dv);
    }
    grp.add(rack);
  }

  // ---- card shoe (dealer's right, screen right) ----
  const shoe = new THREE.Group();
  {
    const g = new THREE.Group();
    const shoeMat = new THREE.MeshStandardMaterial({ color: 0x323a56, roughness: 0.5, metalness: 0.2 });
    const box = new THREE.Mesh(new RoundedBoxGeometry(1.25, 0.62, 1.9, 3, 0.08), shoeMat);
    box.position.set(0, 0.31, 0);
    box.castShadow = true; box.receiveShadow = true;
    g.add(box);
    const top = new THREE.Mesh(new RoundedBoxGeometry(1.29, 0.05, 1.94, 2, 0.02), shoeMat);
    top.position.set(0, 0.64, 0);
    g.add(top);
    const hex = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.04, 6), accent);
    hex.position.set(0, 0.67, 0.2);
    g.add(hex);
    // the card stack visible in the mouth (backs)
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.36, 0.02), new THREE.MeshStandardMaterial({ color: 0x5b21b6, roughness: 0.6, emissive: 0x2e1065, emissiveIntensity: 0.4 }));
    mouth.position.set(0, 0.26, -0.96);
    g.add(mouth);
    // purple shoe lip (cards slide out over it)
    const lip = new THREE.Mesh(new RoundedBoxGeometry(1.2, 0.06, 0.3, 2, 0.025), accent);
    lip.position.set(0, 0.04, -1.05);
    g.add(lip);
    shoe.add(g);
    shoe.position.set(-1.05, T.y, 3.85);
    shoe.rotation.y = -0.35;
    grp.add(shoe);
  }

  // ---- discard holder (dealer's left, screen left) ----
  {
    const dh = new THREE.Group();
    const box = new THREE.Mesh(new RoundedBoxGeometry(1.2, 0.5, 1.5, 3, 0.07), steelDark);
    box.position.set(0, 0.25, 0);
    box.castShadow = true; box.receiveShadow = true;
    dh.add(box);
    const well = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.02, 1.2), new THREE.MeshStandardMaterial({ color: 0x0b0d18, roughness: 0.8 }));
    well.position.set(0, 0.505, 0);
    dh.add(well);
    const strip = new THREE.Mesh(new RoundedBoxGeometry(1.24, 0.06, 0.12, 2, 0.02), accent);
    strip.position.set(0, 0.47, 0.72);
    dh.add(strip);
    dh.position.set(SPOT.discard[0], T.y, SPOT.discard[1]);
    dh.rotation.y = -0.55;
    grp.add(dh);
  }

  // ---- bar stool ----
  {
    const S = STOOL;
    const st = new THREE.Group();
    const cushion = new THREE.Mesh(new THREE.CylinderGeometry(S.r, S.r * 0.94, 0.2, 40), leather);
    cushion.position.set(0, S.seat - 0.1, 0);
    cushion.castShadow = true; cushion.receiveShadow = true;
    st.add(cushion);
    const puff = new THREE.Mesh(new THREE.SphereGeometry(S.r, 40, 12, 0, Math.PI * 2, 0, Math.PI / 2), leather);
    puff.scale.set(1, 0.09 / S.r, 1);
    puff.position.set(0, S.seat, 0);
    puff.castShadow = true; puff.receiveShadow = true;
    st.add(puff);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(S.r * 0.97, 0.03, 8, 48), accent);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(0, S.seat - 0.12, 0);
    st.add(ring);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, S.seat - 0.2, 20), steel);
    post.position.set(0, (S.seat - 0.2) / 2, 0);
    post.castShadow = true;
    st.add(post);
    const foot = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.045, 10, 48), steel);
    foot.rotation.x = Math.PI / 2;
    foot.position.set(0, S.foot, 0);
    foot.castShadow = true;
    st.add(foot);
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4;
      const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.62, 8), steel);
      sp.rotation.z = Math.PI / 2;
      sp.rotation.y = -a;
      sp.position.set(Math.cos(a) * 0.31, S.foot, Math.sin(a) * 0.31);
      st.add(sp);
    }
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.62, 0.08, 40), steelDark);
    base.position.set(0, 0.04, 0);
    base.castShadow = true; base.receiveShadow = true;
    st.add(base);
    st.position.set(S.x, 0, S.z);
    grp.add(st);
  }

  // shadows on everything
  grp.traverse(o => { if (o.isMesh && o !== felt) { o.castShadow = o.castShadow || false; } });
  return { group: grp, felt, feltTex: F, shoe, rack };
}

/** chip rack geometry (shared with chips.js) */
export function rackLayout() {
  return { x: TABLE.x0 + 0.42, z: -2.4, depth: 0.62, width: 2.2, slots: 4, pitch: 2.2 / 4 };
}
