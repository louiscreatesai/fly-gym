// Fly-sized treadmill, pre-workout tub and scoop, in the gym's steel grey-blue + purple look.
// World units are millimetres. The fly runs toward +x, the console is at the +x end.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const TM = {
  Yb: 0.85,          // belt top
  XB: -3.35,         // back roller x
  XF: 2.5,           // front roller x (under the motor hood)
  W: 1.85,           // belt half width
  R: 0.2,            // roller radius
};
TM.len = TM.XF - TM.XB;
TM.cx = (TM.XF + TM.XB) / 2;

// console head (it leans back over the front of the belt, toward the runner)
export const CON = { x: 2.72, y: 3.3, tilt: -0.42, footX: 3.3 };
// tub + scoop placement (on a cup holder hanging off the right upright, the camera side)
export const TUB = { x: 2.25, z: 0.78, y0: 1.72, h: 0.72, r: 0.33 };
TUB.top = TUB.y0 + TUB.h;

function rbox(w, h, d, r, mat, seg = 3) {
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, seg, r), mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

// ---------------------------------------------------------------- belt material
export function makeBeltMaterial({ fromUV = false } = {}) {
  const U = {
    uOff: { value: 0 }, uBlur: { value: 0.002 }, uHeat: { value: 0 }, uHalfL: { value: TM.len / 2 },
    uHalfW: { value: TM.W }, uFlick: { value: 0 },
  };
  const m = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.78, metalness: 0.0, envMapIntensity: 0.6, side: fromUV ? THREE.DoubleSide : THREE.FrontSide,
  });
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    // fromUV: a deformed strip (the snapped belt) whose uv.x runs along the belt
    const beltP = fromUV ? 'vBeltP = vec3((uv.x - 0.5) * 2.0 * uHalfL, 0.0, (uv.y - 0.5) * 2.0 * uHalfW);' : 'vBeltP = position;';
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBeltP; uniform float uHalfL, uHalfW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + beltP);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vBeltP;
        uniform float uOff, uBlur, uHeat, uHalfL, uHalfW, uFlick;
        // integral of a unit-period square wave with duty d, and its box filter over a length L (motion blur)
        float sqI(float x, float d) { return floor(x) * d + min(fract(x), d); }
        float boxSq(float x, float L, float d) { return (sqI(x + L, d) - sqI(x, d)) / L; }
        float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
          return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
      `)
      .replace('#include <map_fragment>', `#include <map_fragment>
        float bx = vBeltP.x + uOff;                      // pattern coordinate (the belt moves toward -x)
        float L = max(uBlur, 0.003);
        float slat = boxSq(bx / 0.26, L / 0.26, 0.22);   // grooves between slats
        float mark = boxSq(bx / 1.6, L / 1.6, 0.07);     // purple accent chevrons every 1.6 mm
        float az = abs(vBeltP.z);
        float edge = smoothstep(uHalfW - 0.2, uHalfW - 0.16, az);
        vec3 col = mix(vec3(0.022, 0.025, 0.038), vec3(0.085, 0.09, 0.125), slat);
        col = mix(col, vec3(0.45, 0.28, 0.85), mark * 0.9 * (1. - edge) * step(az, uHalfW - 0.45));
        col = mix(col, vec3(0.16, 0.17, 0.24), edge * 0.8);
        col *= 0.85 + 0.3 * vn(vec2(bx * 2.0 / (1. + L * 6.), vBeltP.z * 5.));
        diffuseColor.rgb *= col;
      `)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          float back = smoothstep(uHalfL, -uHalfL, vBeltP.x);
          float n1 = vn(vec2(bx * 1.3 / (1. + L * 1.5), vBeltP.z * 2.2));
          float n2 = vn(vec2(bx * 4.0 / (1. + L * 3.0) + 17., vBeltP.z * 6.));
          float n = 0.65 * n1 + 0.35 * n2;
          float heat = uHeat * (0.35 + 0.9 * back) * (0.55 + 0.9 * n);
          heat *= 1. - 0.5 * smoothstep(uHalfW - 0.3, uHalfW, az);
          vec3 hot = mix(vec3(0.75, 0.05, 0.01), vec3(1.6, 0.55, 0.1), clamp(heat * 0.9 - 0.2, 0., 1.));
          totalEmissiveRadiance += hot * heat * (0.95 + 0.5 * uFlick);
        }
      `);
  };
  m.customProgramCacheKey = () => 'pw-belt-' + (fromUV ? 'uv' : 'pos');   // the two variants share onBeforeCompile's source
  m.userData.U = U;
  return m;
}

// ---------------------------------------------------------------- 7-segment console screen
const SEG = {
  '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd', '6': 'afgedc', '7': 'abc',
  '8': 'abcdefg', '9': 'abcdfg', 'E': 'afged', 'r': 'eg', '-': 'g', ' ': '',
};
function drawDigit(g, ch, x, y, w, h, t, on, off) {
  const segs = SEG[ch] ?? '';
  const sk = 0.12;                                  // italic slant
  const P = (px, py) => [x + px + (h - py) * sk, y + py];
  const hseg = (py) => [P(t * 0.6, py), P(t * 1.1, py - t / 2), P(w - t * 1.1, py - t / 2), P(w - t * 0.6, py), P(w - t * 1.1, py + t / 2), P(t * 1.1, py + t / 2)];
  const vseg = (px, y0, y1) => [P(px, y0 + t * 0.6), P(px + t / 2, y0 + t * 1.1), P(px + t / 2, y1 - t * 1.1), P(px, y1 - t * 0.6), P(px - t / 2, y1 - t * 1.1), P(px - t / 2, y0 + t * 1.1)];
  const m = h / 2;
  const S = {
    a: hseg(t / 2), g: hseg(m), d: hseg(h - t / 2),
    f: vseg(t / 2, 0, m), b: vseg(w - t / 2, 0, m), e: vseg(t / 2, m, h), c: vseg(w - t / 2, m, h),
  };
  for (const k of 'abcdefg') {
    g.beginPath();
    S[k].forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py)));
    g.closePath();
    const lit = segs.includes(k);
    g.fillStyle = lit ? on : off;
    g.shadowColor = lit ? on : 'transparent';
    g.shadowBlur = lit ? 14 : 0;
    g.fill();
  }
  g.shadowBlur = 0;
}

export class ConsoleScreen {
  constructor() {
    const c = this.canvas = document.createElement('canvas');
    c.width = 512; c.height = 256;
    this.g = c.getContext('2d');
    this.tex = new THREE.CanvasTexture(c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 8;
  }
  /** text: 4 chars for the 7-segment digits (' 312', ' Err'), label, color, bar 0..1, alarm (red screen) */
  draw(text, label, color, bar, alarm) {
    const barK = Math.round(bar * 20);
    if (text === this.k0 && label === this.k1 && color === this.k2 && barK === this.k3 && alarm === this.k4) return;
    this.k0 = text; this.k1 = label; this.k2 = color; this.k3 = barK; this.k4 = alarm;
    const s = { text, label, color, bar, alarm };
    const g = this.g, W = 512, H = 256;
    g.clearRect(0, 0, W, H);
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, s.alarm ? '#2a0508' : '#070b16'); bg.addColorStop(1, s.alarm ? '#140204' : '#03050b');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    // faint scanlines
    g.fillStyle = 'rgba(255,255,255,0.025)';
    for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 1);
    g.font = '700 26px "Segoe UI", system-ui, sans-serif';
    g.textBaseline = 'top';
    g.fillStyle = s.alarm ? '#ff5a5a' : '#8fa3d8';
    g.fillText(s.label, 22, 14);
    g.textAlign = 'right';
    g.fillStyle = s.color;
    g.font = '800 28px "Segoe UI", system-ui, sans-serif';
    g.textAlign = 'left';
    g.fillText('MPH', 22 + g.measureText(s.label).width * 1.1 + 18, 12);   // next to the label: the screen's right end can leave the phone frame
    g.font = '700 20px "Segoe UI", system-ui, sans-serif';
    g.fillStyle = '#c79bff';
    g.fillText('⚡ PRE MODE', W - 20, 14);
    g.textAlign = 'left';
    // digits
    const dw = 92, dh = 140, gap = 22, x0 = 34, y0 = 46, th = 17;   // three digits, left side (the right edge can leave the phone frame)
    const off = 'rgba(160,180,255,0.045)';
    for (let i = 0; i < 3; i++) {
      drawDigit(g, s.text[i + 1] ?? ' ', x0 + i * (dw + gap), y0, dw, dh, th, s.color, off);
    }
    // LED bar
    const n = 20, bx = 22, by = 214, bw = (W - 44) / n;
    for (let i = 0; i < n; i++) {
      const f = i / (n - 1);
      const lit = f <= s.bar + 1e-6 && s.bar > 0;
      const col = f < 0.45 ? '#5ef0ff' : f < 0.75 ? '#f0abfc' : '#ff4a3a';
      g.fillStyle = lit ? col : 'rgba(160,180,255,0.08)';
      g.fillRect(bx + i * bw + 2, by, bw - 4, 20);
    }
    this.tex.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- tub label
function tubLabelTexture() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#0b0b10'; g.fillRect(0, 0, 1024, 512);
  // two labels, half a turn apart, centred on u = 0.5 and on the seam (u = 0 / 1)
  for (const cx of [0, 512, 1024]) {
    // glowing bolt
    g.save();
    g.translate(cx + 5, 235);                       // a big neon bolt behind the word
    g.scale(1.35, 1.25);
    g.shadowColor = '#b6ff3b'; g.shadowBlur = 30;
    g.fillStyle = '#b8f53c';
    g.beginPath();
    g.moveTo(40, -170); g.lineTo(-40, 20); g.lineTo(10, 20); g.lineTo(-30, 170); g.lineTo(70, -40); g.lineTo(18, -40); g.lineTo(60, -170);
    g.closePath(); g.fill();
    g.restore();
    g.font = '900 170px "Segoe UI Black", "Arial Black", system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 16; g.strokeStyle = '#0b0b10'; g.lineJoin = 'round';
    g.strokeText('PRE', cx + 20, 225);
    g.shadowColor = '#f0abfc'; g.shadowBlur = 18;
    g.fillStyle = '#ffffff';
    g.fillText('PRE', cx + 20, 225);
    g.shadowBlur = 0;
    g.fillStyle = '#f0abfc';
    g.font = '800 44px "Segoe UI", system-ui, sans-serif';
    g.fillText('WORKOUT', cx + 20, 340);
    g.fillStyle = '#8d93b5';
    g.font = '700 26px "Segoe UI", system-ui, sans-serif';
    g.fillText('FRUIT PUNCH · 30 SERVINGS', cx + 10, 410);
  }
  // rim bands
  g.fillStyle = '#c79bff'; g.fillRect(0, 0, 1024, 18); g.fillRect(0, 494, 1024, 18);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// ---------------------------------------------------------------- build everything
export function buildTreadmill(ctx) {
  const { PALETTE } = ctx;
  const grp = new THREE.Group();
  grp.name = 'Treadmill';
  const steel = new THREE.MeshStandardMaterial({ color: PALETTE.steel, roughness: 0.42, metalness: 0.35 });
  const steelLight = new THREE.MeshStandardMaterial({ color: 0xb4bfd6, roughness: 0.35, metalness: 0.4 });
  const steelDark = new THREE.MeshStandardMaterial({ color: PALETTE.steelDark, roughness: 0.5, metalness: 0.3 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x151824, roughness: 0.8, metalness: 0.1 });
  const glowPurple = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.edge).multiplyScalar(2.2), toneMapped: false });
  const { Yb, XB, XF, W, R } = TM;

  // side walls with a light foot rail on top and a purple LED strip outside
  const wallX0 = XB - 0.4, wallX1 = XF + 0.8, wallL = wallX1 - wallX0, wallT = 0.34;
  for (const s of [-1, 1]) {
    const wall = rbox(wallL, Yb + 0.06, wallT, 0.09, steel);
    wall.position.set((wallX0 + wallX1) / 2, (Yb + 0.06) / 2, s * (W + wallT / 2 + 0.01));
    grp.add(wall);
    const cap = rbox(wallL - 0.1, 0.07, wallT + 0.04, 0.03, steelLight);
    cap.position.set(wall.position.x, Yb + 0.07, wall.position.z);
    grp.add(cap);
    const led = new THREE.Mesh(new THREE.BoxGeometry(wallL - 0.5, 0.035, 0.01), glowPurple);
    led.position.set(wall.position.x, 0.42, s * (W + wallT + 0.02));
    grp.add(led);
  }
  // dark pit floor under the belt (shows once the belt is gone)
  const pit = new THREE.Mesh(new THREE.BoxGeometry(TM.len + 0.2, 0.04, 2 * W + 0.04), dark);
  pit.position.set(TM.cx, 0.03, 0); pit.receiveShadow = true;
  grp.add(pit);
  // cross members in the pit
  for (const x of [XB + 1.2, TM.cx, XF - 1.2]) {
    const bar = rbox(0.18, 0.14, 2 * W, 0.04, steelDark);
    bar.position.set(x, 0.12, 0);
    grp.add(bar);
  }

  // rollers + the belt wrapped around them
  const rollerGeo = new THREE.CylinderGeometry(R * 0.9, R * 0.9, 2 * W + 0.1, 28);
  rollerGeo.rotateX(Math.PI / 2);
  const rollers = [];
  for (const x of [XB, XF]) {
    const ro = new THREE.Group();
    ro.position.set(x, Yb - R, 0);
    const cyl = new THREE.Mesh(rollerGeo, steelLight); cyl.castShadow = true; ro.add(cyl);
    // stripes on the roller so its spin reads
    for (let k = 0; k < 4; k++) {
      const st = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, 2 * W + 0.12), steelDark);
      const a = k * Math.PI / 2;
      st.position.set(Math.cos(a) * R * 0.9, Math.sin(a) * R * 0.9, 0);
      st.rotation.z = a;
      ro.add(st);
    }
    grp.add(ro);
    rollers.push(ro);
  }
  const beltMat = makeBeltMaterial();
  const beltTop = new THREE.Mesh(new THREE.PlaneGeometry(TM.len, 2 * W, 1, 1).rotateX(-Math.PI / 2), beltMat);
  beltTop.position.set(TM.cx, Yb, 0);
  beltTop.receiveShadow = true;
  grp.add(beltTop);
  const beltUnder = new THREE.Mesh(new THREE.PlaneGeometry(TM.len, 2 * W).rotateX(Math.PI / 2), dark);
  beltUnder.position.set(TM.cx, Yb - 2 * R - 0.01, 0);
  grp.add(beltUnder);
  const wrapGeo = new THREE.CylinderGeometry(R + 0.012, R + 0.012, 2 * W, 28, 1, true, 0, Math.PI);
  wrapGeo.rotateX(Math.PI / 2);
  const beltWrapMat = new THREE.MeshStandardMaterial({ color: 0x14161f, roughness: 0.8, emissive: 0xff3a10, emissiveIntensity: 0 });
  const wrapBack = new THREE.Mesh(wrapGeo, beltWrapMat);
  wrapBack.position.set(XB, Yb - R, 0); wrapBack.rotation.z = Math.PI / 2;   // the half facing -x
  wrapBack.castShadow = true;
  grp.add(wrapBack);

  // motor hood at the front
  const hoodL = 1.45, hoodX = XF + 0.55;
  const hood = rbox(hoodL, Yb + 0.3, 2 * W + 2 * wallT + 0.06, 0.14, steelDark, 4);
  hood.position.set(hoodX, (Yb + 0.3) / 2, 0);
  grp.add(hood);
  const hoodLed = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 2 * W + 0.3), glowPurple);
  hoodLed.position.set(hoodX - hoodL / 2 - 0.005, Yb + 0.2, 0);
  grp.add(hoodLed);

  // uprights and console
  const upZ = W + 0.14;
  const upB = new THREE.Vector2(CON.footX, Yb + 0.25), upT = new THREE.Vector2(CON.x + 0.12, CON.y - 0.2);
  const upLen = upB.distanceTo(upT), upAng = Math.atan2(upB.x - upT.x, upT.y - upB.y);
  const upAt = y => upB.x + (upT.x - upB.x) * (y - upB.y) / (upT.y - upB.y);   // upright x at height y
  for (const s of [-1, 1]) {
    const up = rbox(0.22, upLen, 0.22, 0.06, steel);
    up.position.set((upB.x + upT.x) / 2, (upB.y + upT.y) / 2, s * upZ);
    up.rotation.z = upAng;
    grp.add(up);
  }
  const con = new THREE.Group();
  con.position.set(CON.x, CON.y, 0);
  con.rotation.z = CON.tilt;                 // screen tilts up toward the runner
  grp.add(con);
  const head = rbox(0.34, 1.22, 2 * W + 0.7, 0.12, steelDark, 4);
  con.add(head);
  const bezel = rbox(0.06, 0.98, 2.62, 0.04, dark);
  bezel.position.set(-0.17, 0.02, 0);
  con.add(bezel);
  const screen = new ConsoleScreen();
  const screenMat = new THREE.MeshBasicMaterial({ map: screen.tex, color: new THREE.Color(1.5, 1.5, 1.5), toneMapped: false });
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(2.46, 1.23), screenMat);
  scr.rotation.y = -Math.PI / 2;
  scr.position.set(-0.205, 0.02, 0);
  con.add(scr);
  // hex accents either side of the screen
  const hexGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.05, 6);
  hexGeo.rotateZ(Math.PI / 2);
  const hexMat = new THREE.MeshStandardMaterial({ color: PALETTE.accent, roughness: 0.4, emissive: PALETTE.accent, emissiveIntensity: 0.6 });
  for (const s of [-1, 1]) {
    const hx = new THREE.Mesh(hexGeo, hexMat);
    hx.position.set(-0.18, 0.02, s * 1.62);
    con.add(hx);
    const hi = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.06, 6).rotateZ(Math.PI / 2), steelDark);
    hi.position.set(-0.2, 0.02, s * 1.62);
    con.add(hi);
  }

  // handrails
  const railMat = steelLight;
  // the far rail runs back past the fly; the near (camera-side) one is a short front handle so it never crosses the fly
  for (const s of [-1, 1]) {
    const pts = (s < 0 ? [
      [upAt(2.42), 2.42], [upAt(2.42) - 0.9, 2.36], [0.9, 2.24], [0.25, 1.95], [0.0, 1.4], [-0.05, Yb + 0.1],
    ] : [
      [upAt(2.42), 2.42], [upAt(2.42) - 0.55, 2.38], [2.05, 2.2], [1.9, 1.7], [1.86, Yb + 0.1],
    ]).map(([x, y]) => new THREE.Vector3(x, y, s * (W + 0.17)));
    const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.065, 10, false), railMat);
    tube.castShadow = true;
    grp.add(tube);
  }

  // cup holder on the right rail + the tub
  const holder = new THREE.Group();
  grp.add(holder);
  const tray = new THREE.Mesh(new THREE.CylinderGeometry(TUB.r + 0.07, TUB.r + 0.04, 0.07, 6), steelDark);
  tray.position.set(TUB.x, TUB.y0 - 0.035, TUB.z); tray.castShadow = true; tray.receiveShadow = true;
  holder.add(tray);
  const ringM = new THREE.Mesh(new THREE.TorusGeometry(TUB.r + 0.05, 0.03, 8, 6), hexMat);
  ringM.rotation.x = Math.PI / 2; ringM.position.set(TUB.x, TUB.y0 + 0.04, TUB.z);
  holder.add(ringM);
  // bracket out to the right upright, behind the tub (seen from the gym camera) so the label stays clear
  const armX = TUB.x + 0.3, armLen = upZ - TUB.z;
  const arm2 = rbox(0.1, 0.08, armLen, 0.03, steel);
  arm2.position.set(armX, TUB.y0 - 0.04, TUB.z + armLen / 2);
  holder.add(arm2);
  const armUp = rbox(0.12, 0.12, 0.3, 0.03, steel);            // clamp around the upright
  armUp.position.set(upAt(TUB.y0), TUB.y0 - 0.04, upZ);
  holder.add(armUp);
  const arm3 = rbox(Math.abs(upAt(TUB.y0) - armX) + 0.1, 0.08, 0.1, 0.03, steel);
  arm3.position.set((upAt(TUB.y0) + armX) / 2, TUB.y0 - 0.04, upZ - 0.05);
  holder.add(arm3);

  const tub = new THREE.Group();
  tub.position.set(TUB.x, TUB.y0, TUB.z);
  const labelMat = new THREE.MeshStandardMaterial({ map: tubLabelTexture(), roughness: 0.35, metalness: 0.1, emissive: 0xffffff, emissiveIntensity: 0.0 });
  labelMat.emissiveMap = labelMat.map; labelMat.emissiveIntensity = 0.55;
  const blackPlastic = new THREE.MeshStandardMaterial({ color: 0x0c0c12, roughness: 0.3, metalness: 0.1 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(TUB.r, TUB.r, TUB.h, 40, 1, true), labelMat);
  body.position.y = TUB.h / 2; body.castShadow = true; body.receiveShadow = true;
  // face the label toward the gym camera (behind-right of the fly)
  const face = new THREE.Vector3(-0.97, 0, 0.24).normalize();
  body.rotation.y = Math.atan2(-face.x, -face.z);
  tub.add(body);
  const bottom = new THREE.Mesh(new THREE.CircleGeometry(TUB.r, 40).rotateX(Math.PI / 2), blackPlastic);
  tub.add(bottom);
  const inner = new THREE.Mesh(new THREE.CylinderGeometry(TUB.r - 0.02, TUB.r - 0.02, TUB.h - 0.02, 40, 1, true), new THREE.MeshStandardMaterial({ color: 0x0c0c12, roughness: 0.5, side: THREE.BackSide }));
  inner.position.y = TUB.h / 2;
  tub.add(inner);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(TUB.r - 0.01, 0.018, 8, 40), blackPlastic);
  rim.rotation.x = Math.PI / 2; rim.position.y = TUB.h;
  tub.add(rim);
  const powderMat = new THREE.MeshStandardMaterial({ color: 0xff5fc8, roughness: 0.95, emissive: 0xff2aa0, emissiveIntensity: 0.55 });
  const powder = new THREE.Mesh(new THREE.CircleGeometry(TUB.r - 0.03, 32).rotateX(-Math.PI / 2), powderMat);
  powder.position.y = TUB.h - 0.1; powder.receiveShadow = true;
  tub.add(powder);
  grp.add(tub);
  // the lid, off, lying on the motor hood
  const lid = new THREE.Group();
  const lidTop = new THREE.Mesh(new THREE.CylinderGeometry(TUB.r + 0.02, TUB.r + 0.02, 0.09, 40), blackPlastic);
  lidTop.castShadow = true;
  lid.add(lidTop);
  const lidMark = new THREE.Mesh(new THREE.CircleGeometry(0.16, 6).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xc8ff4a).multiplyScalar(1.4), toneMapped: false }));
  lidMark.position.y = 0.047;
  lid.add(lidMark);
  lid.position.set(hoodX + 0.05, Yb + 0.3 + 0.06, 1.35);
  lid.rotation.set(0.12, 0.4, -0.08);
  grp.add(lid);

  // the scoop: grip at the local origin, handle along +x, cup at the far end (opening +y)
  const scoop = new THREE.Group();
  const scoopMat = new THREE.MeshStandardMaterial({ color: 0xd9c2ff, roughness: 0.35, metalness: 0.05, emissive: 0x6a3ab0, emissiveIntensity: 0.25 });
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.05, 0.09), scoopMat);
  handle.position.set(0.21, 0, 0); handle.castShadow = true;
  scoop.add(handle);
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.2, 0.24, 28, 1, true), new THREE.MeshStandardMaterial({ color: 0xd9c2ff, roughness: 0.35, side: THREE.DoubleSide, emissive: 0x6a3ab0, emissiveIntensity: 0.25 }));
  cup.position.set(0.6, 0.06, 0); cup.castShadow = true;
  scoop.add(cup);
  const cupBase = new THREE.Mesh(new THREE.CircleGeometry(0.2, 28).rotateX(Math.PI / 2), scoopMat);
  cupBase.position.set(0.6, -0.06, 0);
  scoop.add(cupBase);
  const heap = new THREE.Mesh(new THREE.SphereGeometry(0.25, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), powderMat);
  heap.scale.set(1, 0.7, 1);
  heap.position.set(0.6, 0.17, 0); heap.castShadow = true;
  scoop.add(heap);
  scoop.userData.cupLocal = new THREE.Vector3(0.6, 0.12, 0);
  grp.add(scoop);

  return {
    group: grp, beltMat, beltTop, beltUnder, wrapBack, beltWrapMat, rollers, screen, screenMat, console: con,
    tub, scoop, heap, powderMat, hood,
  };
}
