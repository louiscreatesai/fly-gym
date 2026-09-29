// "I made the fly do leg day for eternity (it has 6 legs)"
// The fly lies back in a 45° sled leg press and presses with ALL SIX legs, forever. Every rep loads another
// hex plate on each horn; when the horns are full the plates stack on the sled as a wobbling tower,
// the rails flex, the platform cracks, NEW PR, and it still does one more rep.
//
// Timeline (PERIOD 9.6 s, u = t % PERIOD; each rep = push / hold / lower, legs glued to the plate by fly.reach):
//   0.00  mid-push, 8 plates a side already (hook)      0.17 lockout, +1 plate per horn (+90 LB)
//   1.37  lockout +90 LB                                  2.57 lockout +90 LB, horns full (11 a side)
//   2.60  flash HORNS FULL, tray pops out of the plate    2.82 tower starts (+135 LB), 3.77 +270 LB, 4.97 +450 LB
//   6.20  heavy lockout, 24 plates rain (+1,080 LB)       6.40 NEW PR: platform cracks, shake, rails bow, tower leans
//   7.40-8.20  one more rep (stall + grind, trembling)    8.22 cracks spread, second shake
//   9.35  next push starts (motion is continuous)         9.44-9.60 violet-white flash hides the reset to 8 a side
import * as THREE from 'three';
import {
  DV, HV, buildMachine, buildMachineParts, mergeStatic, plateGeometries, bendRails, railSag,
  HORN_X, HORN_Y, HORN_Z0, PLATE_PITCH, TPLATE_R, TPLATE_T, TRAY, RAIL_X0,
} from './legday/machine.js';
import { buildCracks, LabelPool, ResetFlash, rng } from './legday/fx.js';

const T0 = new THREE.Vector3(-1.7, 2.95, 0);   // thorax origin (world)
const XC = -0.55;                              // footplate centre along the fly's body axis (fly frame x)
const D_MIN = 0.88, D_MAX = 1.92;               // footplate distance from the thorax (ventral), folded / locked out
// feet on the plate, fly frame: x forward (head), z side (the fly's left is -z)
const FEET = {
  LF: [0.82, -0.66], RF: [0.82, 0.66],
  LM: [-0.72, -1.36], RM: [-0.72, 1.36],
  LH: [-2.0, -1.04], RH: [-2.0, 1.04],
};
const LEGS = ['LF', 'LM', 'LH', 'RF', 'RM', 'RH'];
const CHAIN = ['Coxa_yaw', 'Coxa', 'Coxa_roll', 'Femur', 'Femur_roll', 'Tibia', 'Tarsus1', 'Tarsus2', 'Tarsus3', 'Tarsus4', 'Tarsus5'];
const COXA_X = { LF: -0.16, RF: -0.16, LM: -0.56, RM: -0.56, LH: -0.78, RH: -0.78 };   // fly frame
const TARSUS_LEN = 0.34;   // tarsus 2..5 laid flat on the plate
const TARSAL = {};         // per leg: joint lists for the flat-foot step
for (const L of ['LF', 'LM', 'LH', 'RF', 'RM', 'RH']) TARSAL[L] = [2, 3, 4, 5].map(i => `joint_${L}Tarsus${i}`);

const PERIOD = 9.6;
const REPS = [
  { p0: -0.25, lk: 0.17, h1: 0.33, l1: 0.95 },
  { p0: 0.95, lk: 1.37, h1: 1.53, l1: 2.15 },
  { p0: 2.15, lk: 2.57, h1: 2.73, l1: 3.35 },
  { p0: 3.35, lk: 3.77, h1: 3.93, l1: 4.55 },
  { p0: 4.55, lk: 4.97, h1: 5.13, l1: 5.75 },
  { p0: 5.75, lk: 6.20, h1: 6.60, l1: 7.40, heavy: true },
  { p0: 7.40, lk: 8.20, h1: 8.45, l1: 9.35, grind: true },
];
const T_CRACK = 6.40, T_CRACK2 = 8.22;
const T_FULL = 2.60;
const N_HORN0 = 8, N_HORN = 11;
const HORN_ADDS = [REPS[0].lk + 0.02, REPS[1].lk + 0.02, REPS[2].lk + 0.02];   // one plate per horn per rep
const T_TRAY = T_FULL + 0.02;   // the tray pops out of the footplate's top edge
const BURSTS = [   // tower plates: [first landing, count, spacing]
  [T_TRAY + 0.2, 3, 0.07],
  [REPS[3].lk + 0.02, 6, 0.025],
  [REPS[4].lk + 0.02, 10, 0.015],
  [REPS[5].lk + 0.02, 24, 0.014],
];
const LB = 45;
const TOWER_SLOT = [0.7, 0.47];   // load labels (horns + tower): right side of the phone strip, below the flash line
const G = 320;          // plate fall "gravity" (mm/s²)
const TP_STEP = 0.205;  // tower plate pitch

const smooth = k => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));
const smoother = k => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * k * (k * (k * 6 - 15) + 10));
const clamp01 = k => Math.min(1, Math.max(0, k));
const fmt = n => Math.round(n).toLocaleString('en-US');

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
const _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const _ga = new THREE.Vector3(), _gb = new THREE.Vector3(), _gh = new THREE.Vector3(), _gu = new THREE.Vector3(), _gp = new THREE.Vector3(), _gk = new THREE.Vector3();
const _feet = {};
for (const L of LEGS) _feet[L] = new THREE.Vector3();

function flyToWorld(x, y, z, out) {
  return out.copy(T0).addScaledVector(HV, x).addScaledVector(DV, -y).setZ(T0.z + z);
}

/** crossing test for a looped event at looped time ue */
function hit(prevT, t, ue) {
  if (!(t > prevT) || t - prevT > 1.5) return false;
  const c0 = Math.floor(prevT / PERIOD), c1 = Math.floor(t / PERIOD);
  for (let c = c0; c <= c1; c++) { const te = c * PERIOD + ue; if (te > prevT && te <= t) return true; }
  return false;
}

export default {
  pageTitle: 'Fly Gym · leg day ×3',
  cameras: {
    gym: { pos: [-6.47, 7.27, 16.99], target: [-0.5, 3.4, 1.0], fov: 30 },
    front: { pos: [-6.23, 8.61, 0.42], target: [-1.75, 3.25, 0], fov: 30 },
    close: { pos: [-6.01, 6.21, 2.81], target: [-1.8, 2.9, 0.1], fov: 30 },
  },
  defaultCam: 'gym',
  hud: {
    title: 'LEG PRESS · 6 LEGS', sub: 'LEG DAY × 3 · NO REST DAYS',
    cams: [['gym', 'Gym view'], ['front', 'Front view'], ['close', 'Close-up']],
    stats: [{ key: 'reps', label: 'REPS', of: '∞' }, { key: 'set', label: 'SET' }, { key: 'time', label: 'WORKOUT', small: true }],
    phases: ['↑ PUSH', 'HOLD', '↓ LOWER'],
    footer: 'NeuroMechFly body · articulated exercise animation · Methods',
  },

  async build(ctx) {
    const { scene, fly } = ctx;
    const plat = ctx.stage.platform({ w: 13.5, d: 10 });
    plat.position.x = 0.6;
    scene.add(plat);

    // ---- machine ----
    const M = this.M = buildMachine(ctx, T0);
    M.railFrame.position.copy(T0).addScaledVector(HV, XC);
    buildMachineParts(ctx, M, { XC });
    // merge static parts per material (world frame, rail frame, sled, tray) to keep draw calls low
    M.merged = mergeStatic(M.root, new Set([M.railFrame])) + mergeStatic(M.railFrame, new Set([M.sled]))
      + mergeStatic(M.sled, new Set([M.trayRig])) + mergeStatic(M.trayRig);

    // ---- plates (instanced: body + accent rings) ----
    const pg = plateGeometries();
    const tg = plateGeometries(TPLATE_R, TPLATE_T);
    const plateBody = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.35 });
    const plateAcc = new THREE.MeshStandardMaterial({ color: ctx.PALETTE.accent, roughness: 0.35, emissive: 0xb06cff, emissiveIntensity: 0.6, side: THREE.DoubleSide });
    const mkInst = (g, mat, n) => {
      const m = new THREE.InstancedMesh(g, mat, n);
      m.castShadow = true; m.receiveShadow = true;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      scene.add(m);
      return m;
    };
    this.nHorn = 2 * N_HORN;
    this.hornBody = mkInst(pg.body, plateBody, this.nHorn);
    this.hornAcc = mkInst(pg.accent, plateAcc, this.nHorn);
    this.nTower = BURSTS.reduce((a, b) => a + b[1], 0);
    this.towerBody = mkInst(tg.body, plateBody, this.nTower);
    this.towerAcc = mkInst(tg.accent, plateAcc, this.nTower);

    // horn plate schedule: [side, k, landTime]
    this.hornSched = [];
    for (const s of [-1, 1]) for (let k = 0; k < N_HORN; k++) {
      const land = k < N_HORN0 ? -1e9 : HORN_ADDS[k - N_HORN0] + (s > 0 ? 0 : 0.035);
      this.hornSched.push({ s, k, land, yaw: (k * 0.37 + (s > 0 ? 0.2 : 0)) % 0.5 - 0.25 });
    }
    // tower schedule
    const R = rng(11);
    this.towerSched = [];
    let j = 0;
    for (const [t0, n, dt] of BURSTS) for (let i = 0; i < n; i++, j++) {
      this.towerSched.push({ land: t0 + i * dt, ox: (R() - 0.5) * 0.12, oz: (R() - 0.5) * 0.12, yaw: (R() - 0.5) * 0.7, spin: (R() - 0.5) * 3 });
    }
    // load labels
    const lbl = (tt, text, where, size = 1) => ({ t: tt, text, where, size });
    this.labels = [
      lbl(HORN_ADDS[0], '+90 LB', 'horn'), lbl(HORN_ADDS[1], '+90 LB', 'horn'),   // the 3rd add is announced by HORNS FULL
      lbl(BURSTS[0][0] + 0.16, '+135 LB', 'tower'), lbl(BURSTS[1][0] + 0.1, '+270 LB', 'tower', 1.1),
      lbl(BURSTS[2][0] + 0.1, '+450 LB', 'tower', 1.2), lbl(BURSTS[3][0] + 0.18, '+1,080 LB', 'tower', 1.45),
      lbl(REPS[6].lk + 0.02, '+1 REP', 'plate', 1.1),
    ];
    this.labelPool = new LabelPool(4);
    this.flashEl = new ResetFlash();

    // ---- cracks ----
    this.cracks = buildCracks(scene, {
      roots: [
        { x: 1.7, z: 0.2, n: 7, len: 6.0, w: 0.11 },
        { x: -1.6, z: 0, n: 4, len: 4.0, w: 0.09, d0: 0.5 },
        { x: 4.9, z: 0, n: 3, len: 3.5, w: 0.09, d0: 0.8 },
      ],
      bounds: [0.6 - 6.6, 0.6 + 6.6, -4.9, 4.9],
    });
    // heat glow disc under the machine
    this.heat = new THREE.Mesh(new THREE.PlaneGeometry(12, 9), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uA: { value: 0 } },
      vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: 'uniform float uA; varying vec2 vP; void main(){ float r = length(vP / vec2(5.5, 3.6)); float a = exp(-r*r*2.5) * uA; gl_FragColor = vec4(vec3(0.5,0.2,1.0)*a, 1.0); }',
    }));
    this.heat.rotation.x = -Math.PI / 2;
    this.heat.position.set(1.5, 0.006, 0);
    this.heat.renderOrder = 2;
    scene.add(this.heat);

    // under-glow that flares when the platform cracks (always in the scene so shaders never recompile)
    this.under = new THREE.PointLight(0xa855f7, 0, 16, 1.6);
    this.under.position.set(2.6, 0.35, 0.4);
    scene.add(this.under);
    // sparks (one Points draw call); ballistic, pure function of t
    {
      const R2 = rng(23), N = 180;
      this.sparkN = N;
      this.sparkData = [];
      const roots = [[0.9, 0.3, 1.25], [0.9, 0.3, -1.25], [4.6, 0.2, 1.35], [4.6, 0.2, -1.35], [-1.6, 0.2, 0.9], [-1.6, 0.2, -0.9], [1.7, 0.1, 0.2]];
      for (let i = 0; i < N; i++) {
        const r = roots[i % roots.length];
        const a = R2() * Math.PI * 2, sp = 3 + R2() * 7;
        this.sparkData.push({
          t0: (i < N * 0.7 ? T_CRACK : T_CRACK2) + R2() * 0.12,
          x: r[0] + (R2() - 0.5) * 0.4, y: r[1], z: r[2] + (R2() - 0.5) * 0.4,
          vx: Math.cos(a) * sp * 0.55, vy: 4 + R2() * 8, vz: Math.sin(a) * sp * 0.55,
          life: 0.45 + R2() * 0.55,
        });
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('aA', new THREE.BufferAttribute(new Float32Array(N), 1).setUsage(THREE.DynamicDrawUsage));
      this.sparks = new THREE.Points(g, new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { uScale: { value: 1 } },
        vertexShader: `attribute float aA; varying float vA; uniform float uScale;
          void main(){ vA = aA; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
            gl_PointSize = aA > 0.0 ? uScale * (6.0 + 10.0 * aA) / -mv.z * 10.0 : 0.0; }`,
        fragmentShader: `varying float vA; void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c);
          float a = smoothstep(0.5, 0.0, d); vec3 col = mix(vec3(1.2, 0.6, 3.0), vec3(3.0, 2.4, 3.2), smoothstep(0.25, 0.0, d));
          gl_FragColor = vec4(col * a * vA, 1.0); }`,
      }));
      this.sparks.frustumCulled = false;
      scene.add(this.sparks);
    }

    // ---- fly: lying back in the seat, ventral side facing the footplate ----
    fly.root.rotation.set(0, 0, Math.PI * 0.75);
    const off = new THREE.Vector3(0.496, 1.297, 0).applyEuler(fly.root.rotation);
    fly.root.position.copy(T0).sub(off);
    fly.setPose(fly.tripod);
    this.bodyBase = fly.getPose();
    // per-leg segment lengths + joint lists for the 3-step foot placement
    this.legGeo = {}; this.jHip = {}; this.jKnee = {}; this.jTars = {};
    {
      const save = fly.getPose();
      for (const L of LEGS) {
        for (let i = 1; i <= 5; i++) fly.set(`joint_${L}Tarsus${i}`, 0);
        fly.apply();
        const P = b => fly.worldPos(L + b);
        const front = L[1] === 'F', hind = L[1] === 'H';
        this.legGeo[L] = {
          fem: P('Femur').distanceTo(P('Tibia')), tib: P('Tibia').distanceTo(P('Tarsus1')),
          tars: P('Tarsus1').distanceTo(fly.tip(L)) * 0.99,
          pole: front ? 0.9 : 0.6, fwd: front ? 0.3 : hind ? -0.4 : 0,
        };
        const J = k => `joint_${L}${k}`;
        this.jHip[L] = [J('Femur'), J('Coxa'), J('Coxa_roll'), J('Coxa_yaw')];
        this.jKnee[L] = [J('Tibia'), J('Femur_roll')];
        this.jTars[L] = [1, 2, 3, 4, 5].map(i => J(`Tarsus${i}`));
      }
      fly.setPose(save); fly.apply();
    }
    // leg LUT over the plate distance (solved once, then glued every frame by fly.reach)
    this.lut = [];
    const N = 28, d0 = D_MAX + 0.12, d1 = D_MIN - 0.2;
    this.lutD0 = d0; this.lutStep = (d1 - d0) / N;
    for (let i = 0; i <= N; i++) {
      const D = d0 + i * this.lutStep;
      if (i === 0) this._legSeed(fly);
      for (let k = 0; k < 3; k++) for (const L of LEGS) this._glue(fly, L, D, 0, 30);
      const row = {};
      for (const L of LEGS) for (const c of CHAIN) row[`joint_${L}${c}`] = fly.get(`joint_${L}${c}`);
      this.lut.push(row);
    }
    this.lutKeys = Object.keys(this.lut[0]);
    this._pose = {};
  },

  /** a starting pose for the extended legs: tripod with femurs opened up and straight tarsi */
  _legSeed(fly) {
    fly.setPose(fly.tripod);
    for (const L of LEGS) {
      fly.set(`joint_${L}Tibia`, fly.get(`joint_${L}Tibia`) * 0.6);
      for (const j of TARSAL[L]) fly.set(j, -0.05);
    }
    fly.apply();
  },

  /**
   * Plant one foot on the plate without anything passing through it (all steps use fly.reach):
   * (0) knee placed by 2-bone IK with a pole that points out and back toward the pad (like a fly on a ceiling),
   * (1) ankle placed with tibia + femur roll (the knee stays put), (2) tarsus laid down to the claw.
   */
  _glue(fly, L, D, sag, iters) {
    const [x, z] = FEET[L];
    let dx = x - COXA_X[L], dz = z;
    const n = Math.hypot(dx, dz) || 1; dx /= n; dz /= n;
    const g = this.legGeo[L];
    // claw (B) and ankle (A) targets
    const B = this._foot(L, D, sag, _gb).addScaledVector(DV, -0.015);
    const A = _ga.copy(B).addScaledVector(HV, -dx * g.tars).addScaledVector(DV, -0.11);
    A.z -= dz * g.tars;
    // knee target from the hip (femur origin), pole = sideways out + dorsal (toward the pad)
    const H = fly.worldPos(`${L}Femur`, _gh);
    const u = _gu.subVectors(A, H); let d = u.length(); u.divideScalar(d || 1);
    d = Math.min(d, g.fem + g.tib - 1e-3);
    const xk = (g.fem * g.fem - g.tib * g.tib + d * d) / (2 * d);
    const rk = Math.sqrt(Math.max(0, g.fem * g.fem - xk * xk));
    const p = _gp.set(0, 0, Math.sign(z) || 1).addScaledVector(DV, -g.pole).addScaledVector(HV, g.fwd);
    p.addScaledVector(u, -p.dot(u)).normalize();
    const K = _gk.copy(H).addScaledVector(u, xk).addScaledVector(p, rk);
    fly.reach(L, K, { iters, tipBody: `${L}Tibia`, joints: this.jHip[L] });
    fly.reach(L, A, { iters, tipBody: `${L}Tarsus1`, joints: this.jKnee[L] });
    fly.reach(L, B, { iters: iters + 2, joints: this.jTars[L] });
  },

  /** world position of a foot on the plate at plate distance D, with sled sag (rail-frame -y) */
  _foot(L, D, sag, out) {
    const [x, z] = FEET[L];
    flyToWorld(x, -D, z, out);
    return out.addScaledVector(HV, -sag);
  },

  /** sled extension state from looped time */
  _ext(u) {
    if (u >= REPS[6].l1) u -= PERIOD;
    let r = REPS[0], i = 0;
    for (; i < REPS.length; i++) if (u < REPS[i].l1) { r = REPS[i]; break; }
    let ext, phase, prog = clamp01((u - r.p0) / (r.l1 - r.p0));
    if (u < r.lk) {
      const k = (u - r.p0) / (r.lk - r.p0);
      if (r.grind) {
        // drive, stall at the sticking point, grind through
        ext = k < 0.3 ? 0.42 * smooth(k / 0.3) : k < 0.72 ? 0.42 + 0.14 * smooth((k - 0.3) / 0.42) : 0.56 + 0.44 * smoother((k - 0.72) / 0.28);
      } else ext = smoother(k);
      phase = 0;
    } else if (u < r.h1) { ext = 1; phase = 1; } else {
      const k = (u - r.h1) / (r.l1 - r.h1);
      ext = 1 - (r.heavy ? smooth(k) : smoother(k));
      phase = 2;
    }
    return { ext, phase, prog, rep: i, r, u };
  },

  update(ctx, t, dt, prevT) {
    const { fly, hud } = ctx;
    const u = ((t % PERIOD) + PERIOD) % PERIOD;
    const cycle = Math.floor(t / PERIOD);
    const st = this._ext(u);

    // ---- load state ----
    let hornN = 0, towerN = 0, dip = 0;
    for (const h of this.hornSched) {
      if (u >= h.land) {
        hornN++;
        const a = u - h.land;
        if (a < 0.8) dip += 0.045 * Math.sin(a * 24) * Math.exp(-a * 7);
      }
    }
    for (const p of this.towerSched) {
      if (u >= p.land) {
        towerN++;
        const a = u - p.land;
        if (a < 0.8) dip += 0.022 * Math.sin(a * 22) * Math.exp(-a * 6.5);
      }
    }
    const load = LB * (hornN + towerN);
    const afterPR = u >= T_CRACK;

    // trembling near failure
    let trem = 0;
    if (u > REPS[4].p0 && u < REPS[5].p0) trem = 0.006;
    if (u >= REPS[5].lk) trem = 0.02 + 0.012 * smooth((u - REPS[5].lk) / 0.6);
    if (u >= REPS[6].p0 && u < REPS[6].lk + 0.1) trem = 0.045;
    if (u >= REPS[6].h1) trem = 0.02 * (1 - smooth((u - REPS[6].h1) / 0.6));
    const noise = Math.sin(t * 2 * Math.PI * 21) * 0.6 + Math.sin(t * 2 * Math.PI * 33.7 + 1.3) * 0.4;
    const D = D_MIN + (D_MAX - D_MIN) * st.ext - dip + trem * noise;

    // ---- rails flex with the load ----
    let flex = 0.01 + 0.004 * towerN;
    if (u >= REPS[5].lk) {
      const a = u - REPS[5].lk;
      flex += 0.09 * Math.sin(a * 26) * Math.exp(-a * 4);
    }
    if (afterPR) flex += 0.2 * smooth((u - T_CRACK) / 0.3) + 0.06 * Math.sin((u - T_CRACK) * 30) * Math.exp(-(u - T_CRACK) * 5);
    flex += trem * noise * 0.5;
    const M = this.M;
    const sledX = D;
    const center = clamp01((sledX + 0.8 - RAIL_X0) / M.railLen);
    bendRails(M, flex, center);
    const sag = railSag(M, flex, center, sledX + 0.8);
    M.sled.position.set(sledX, -sag, 0);
    M.railFrame.updateMatrixWorld(true);

    // ---- plates on the horns ----
    const sw = M.sled.matrixWorld;
    let hi = 0;
    for (const h of this.hornSched) {
      const age = u - h.land;
      _p.set(HORN_X, HORN_Y, h.s * (HORN_Z0 + 0.02 + (h.k + 0.5) * PLATE_PITCH)).applyMatrix4(sw);
      let sc = 1, tilt = 0;
      if (age < 0) {
        const fall = 0.5 * G * age * age;
        if (fall > 14) sc = 0;
        _p.y += fall;
        tilt = age * 3;
      } else if (age < 0.5) {
        _p.y += 0.16 * Math.abs(Math.sin(age * 19)) * Math.exp(-age * 9);
        tilt = 0.25 * Math.sin(age * 30) * Math.exp(-age * 10);
      }
      // horn axis is world z; plate geometry axis is y
      _e.set(Math.PI / 2 + tilt, 0, h.yaw + Math.PI / 4 + tilt * 0.5);
      _q.setFromEuler(_e);
      _m.compose(_p, _q, _s.setScalar(sc));
      this.hornBody.setMatrixAt(hi, _m);
      this.hornAcc.setMatrixAt(hi, _m);
      hi++;
    }
    this.hornBody.instanceMatrix.needsUpdate = true;
    this.hornAcc.instanceMatrix.needsUpdate = true;

    // ---- the tower ----
    const tw = M.tray.matrixWorld;
    const trayP = _w.setFromMatrixPosition(tw);
    const H = Math.max(1, towerN) * TP_STEP;
    // sway: natural slow sway + kicks from the sled motion and landings
    const prA = afterPR ? smooth((u - T_CRACK) / 0.4) : 0;
    const swayA = 0.005 * towerN + 0.28 * prA;
    const swX = swayA * (Math.sin(t * 2 * Math.PI * 0.73) + 0.35 * Math.sin(t * 2 * Math.PI * 1.9 + 0.7)) + 0.35 * dip + trem * noise * 1.5 - 0.35 * prA;
    const swZ = swayA * 0.6 * Math.sin(t * 2 * Math.PI * 0.53 + 1.1) + 0.12 * prA;
    let ti = 0;
    for (const p of this.towerSched) {
      const age = u - p.land;
      const idx = ti;
      const h = 0.1 + idx * TP_STEP;
      const f = (h / 8) ** 1.6, df = 1.6 * (h / 8) ** 0.6 / 8;
      _p.set(trayP.x + p.ox + swX * f, trayP.y + h, trayP.z + p.oz + swZ * f);
      let sc = 1, tx = -swZ * df, tz = -swX * df, yaw = p.yaw;
      if (age < 0) {
        const fall = 0.5 * G * age * age;
        if (fall > 16) sc = 0;
        _p.y += fall;
        yaw += p.spin * age;
        tx += age * 1.2; tz += age * 0.8;
      } else if (age < 0.4) {
        _p.y += 0.12 * Math.abs(Math.sin(age * 22)) * Math.exp(-age * 10);
      }
      _e.set(tx, yaw, tz);
      _q.setFromEuler(_e);
      _m.compose(_p, _q, _s.setScalar(sc));
      this.towerBody.setMatrixAt(ti, _m);
      this.towerAcc.setMatrixAt(ti, _m);
      ti++;
    }
    this.towerBody.instanceMatrix.needsUpdate = true;
    this.towerAcc.instanceMatrix.needsUpdate = true;

    // ---- cracks + heat ----
    const cu = this.cracks.uniforms;
    let rev = 0, heatA = 0;
    if (u >= T_CRACK) {
      rev = this.cracks.maxD * 0.62 * (1 - Math.pow(1 - clamp01((u - T_CRACK) / 0.45), 3));
      heatA = 0.9 * Math.exp(-(u - T_CRACK) * 1.5) + 0.35;
    }
    if (u >= T_CRACK2) {
      rev += this.cracks.maxD * 0.4 * (1 - Math.pow(1 - clamp01((u - T_CRACK2) / 0.5), 3));
      heatA += 0.6 * Math.exp(-(u - T_CRACK2) * 2);
    }
    cu.uReveal.value = rev;
    cu.uHeat.value = Math.min(1, heatA);
    cu.uTime.value = t;
    this.cracks.group.visible = rev > 0;
    this.heat.material.uniforms.uA.value = heatA * 0.12;
    this.heat.visible = heatA > 0;

    // ---- tray pops out when the horns are full ----
    {
      const k = (u - T_TRAY) / 0.2;
      const sc = k <= 0 ? 0 : k >= 1 ? 1 : 1 + 0.25 * Math.sin(k * Math.PI) - (1 - k) ** 3;
      M.trayRig.visible = sc > 0.01;
      M.trayRig.scale.setScalar(Math.max(0.01, sc));
    }
    // ---- under-glow + sparks ----
    this.under.intensity = heatA * 12;
    {
      const pos = this.sparks.geometry.attributes.position.array, aa = this.sparks.geometry.attributes.aA.array;
      let any = false;
      for (let i = 0; i < this.sparkN; i++) {
        const d = this.sparkData[i], a = u - d.t0;
        if (a < 0 || a > d.life) { aa[i] = 0; continue; }
        any = true;
        pos[i * 3] = d.x + d.vx * a;
        pos[i * 3 + 1] = Math.max(0.02, d.y + d.vy * a - 0.5 * 30 * a * a);
        pos[i * 3 + 2] = d.z + d.vz * a;
        aa[i] = 1 - a / d.life;
      }
      this.sparks.visible = any;
      this.sparks.geometry.attributes.position.needsUpdate = true;
      this.sparks.geometry.attributes.aA.needsUpdate = true;
      this.sparks.material.uniforms.uScale.value = window.innerHeight / 1080;
    }

    // ---- fly ----
    this._poseFly(ctx, t, u, st, D, sag, trem, noise, afterPR);

    // ---- events ----
    if (hit(prevT, t, 0)) ctx.brain.play('push', { loop: true });
    for (let i = 1; i < REPS.length; i++) if (hit(prevT, t, REPS[i].p0)) ctx.brain.play('push', { loop: true });
    if (hit(prevT, t, T_FULL)) hud.flash('HORNS FULL', { color: '#f0abfc', ms: 1100, size: 0.9 });
    for (const [t0] of BURSTS) if (hit(prevT, t, t0)) ctx.stage.shake = Math.max(ctx.stage.shake, 0.04);
    if (hit(prevT, t, REPS[5].lk + 0.05)) ctx.stage.shake = 0.1;
    if (hit(prevT, t, T_CRACK)) { ctx.stage.shake = 0.26; hud.flash('NEW PR', { color: '#f0abfc', ms: 1300, size: 1.25 }); }
    if (hit(prevT, t, T_CRACK2)) ctx.stage.shake = 0.14;

    // ---- labels ----
    const items = this._items || (this._items = []);
    items.length = 0;
    for (const L of this.labels) {
      const age = u - L.t;
      if (age < 0 || age > 1.05) continue;
      const wv = L._w || (L._w = new THREE.Vector3());
      let slot = null;
      if (L.where === 'horn' || L.where === 'tower') slot = TOWER_SLOT;
      else wv.set(0, 2.4, 1.6).applyMatrix4(sw);
      items.push({ text: L.text, world: wv, slot, age, size: L.size });
    }
    this.labelPool.render(items, ctx.camera);

    // ---- reset flash ----
    let fo = 0;
    if (u > 9.44) fo = smooth((u - 9.44) / 0.16);
    else if (cycle >= 1 && u < 0.22) fo = 1 - smooth(u / 0.22);
    this.flashEl.set(fo);

    // ---- HUD ----
    let locks = 0;
    for (const r of REPS) if (u >= r.lk) locks++;
    const reps = 11 + cycle * REPS.length + locks;
    const desc = st.rep === 6 && st.phase === 0 ? 'One more rep…' : st.phase === 0 ? 'Pressing with all six legs' : st.phase === 1 ? 'Locked out · all six legs' : 'Lowering · all six legs';
    hud.update({
      stats: { reps: fmt(reps), set: fmt(4812 + cycle), time: 'DAY 1,284' },
      phase: st.phase, progress: st.prog, desc,
      note: `${fmt(load)} lb · front · middle · hind`,
      danger: afterPR && u < 9.4,
    });
  },

  _poseFly(ctx, t, u, st, D, sag, trem, noise, afterPR) {
    const f = ctx.fly;
    // legs from the LUT
    const fi = (D - this.lutD0) / this.lutStep;
    const i0 = Math.max(0, Math.min(this.lut.length - 2, Math.floor(fi)));
    const k = Math.min(1, Math.max(0, fi - i0));
    const a = this.lut[i0], b = this.lut[i0 + 1];
    const pose = this._pose;
    for (const key of this.lutKeys) pose[key] = a[key] + (b[key] - a[key]) * k;
    f.setPose(this.bodyBase);
    f.setPose(pose);

    const push = st.phase === 0 ? 1 : st.phase === 1 ? 0.7 : 0.25;
    const strain = afterPR ? 1 : 0.35 + 0.1 * st.rep;
    // head: thrown back into the pad on the push, shakes when grinding
    f.set('joint_Head', -0.12 - 0.22 * st.ext * push + 0.05 * Math.sin(t * 1.7) + trem * noise * 2.5);
    f.set('joint_Head_yaw', 0.08 * Math.sin(t * 0.9) + trem * Math.sin(t * 2 * Math.PI * 17) * 3);
    f.set('joint_Head_roll', 0.05 * Math.sin(t * 1.3 + 1));
    // antennae twitch
    for (const [s, ph] of [['L', 0], ['R', 1.7]]) {
      const tw = Math.sin(t * 7.3 + ph) * 0.12 + (Math.sin(t * 23 + ph * 3) > 0.93 ? 0.25 : 0);
      f.set(`joint_${s}Pedicel`, tw);
      f.set(`joint_${s}Pedicel_yaw`, 0.1 * Math.sin(t * 3.1 + ph));
      f.set(`joint_${s}Funiculus`, 0.15 * Math.sin(t * 5.3 + ph));
    }
    // abdomen: breathes, clenches on the push (curls toward the ventral side)
    const clench = st.phase === 0 ? smooth(st.ext * 1.4) : st.phase === 1 ? 1 : 1 - smooth((st.prog - 0.5) * 2);
    const breath = 0.035 * Math.sin(t * 2 * Math.PI * 0.8);
    const curl = -(0.05 + 0.07 * strain) * clench + breath;
    for (const s of ['A1A2', 'A3', 'A4', 'A5', 'A6']) f.set(`joint_${s}`, curl * (s === 'A1A2' ? 0.6 : 1));
    // proboscis out when it is really grinding
    const tongue = (u > REPS[5].lk && u < REPS[6].h1 + 0.4) ? 0.6 : 0.15 * clench;
    f.set('joint_Rostrum', tongue * 0.8);
    f.set('joint_Haustellum', -tongue);
    // wings splayed on the pad; twitch at lockout; buzz on the grind
    let spread = 0.95, pitch = -0.2, flap = 0;
    const lockAge = u - st.r.lk;
    if (lockAge > 0 && lockAge < 0.5) flap += 0.22 * Math.sin(lockAge * 2 * Math.PI * 26) * Math.exp(-lockAge * 7);
    if (st.rep === 6 && st.phase === 0) flap += 0.35 * Math.sin(t * 2 * Math.PI * 30) * smooth((u - REPS[6].p0) / 0.3);
    if (st.rep === 5 && u > REPS[5].lk && u < REPS[5].h1) flap += 0.25 * Math.sin(t * 2 * Math.PI * 28);
    f.setWings({ spread, pitch: pitch + Math.abs(flap) * 0.6, flap: flap * 0.4 });

    // glue all six feet to the plate
    for (const L of LEGS) this._glue(f, L, D, sag, 3);
  },

  reset() {},
};
