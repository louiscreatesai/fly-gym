// Treadmill gait for the NeuroMechFly rig.
// Joint angles come from flygym's recorded single step (stepcycle.js), phase-shifted into a
// tripod (LF, RM, LH together; RF, LM, RH half a cycle later, as in flygym's CPG example).
// The recorded step does not keep the feet on one plane, so at build time every leg is
// corrected with fly.reach(): stance feet sit on the belt and slide backward at exactly
// the belt speed (V0 mm per gait cycle), swing feet follow a lifted arc. The solved angles
// are stored in tables (a few lean levels x N phases), so runtime is lookups only.
import * as THREE from 'three';
import SC from './stepcycle.js';

export const LEGS6 = ['LF', 'LM', 'LH', 'RF', 'RM', 'RH'];
export const DOFS = SC.dofs.map(d => d);                       // Coxa_yaw, Coxa, Coxa_roll, Femur, Femur_roll, Tibia, Tarsus1
export const PHASE_OFF = { LF: 0, RM: 0, LH: 0, RF: 0.5, LM: 0.5, RH: 0.5 };
const SEGS = ['Coxa', 'Femur', 'Tibia', 'Tarsus1', 'Tarsus2', 'Tarsus3', 'Tarsus4', 'Tarsus5'];

const frac = x => x - Math.floor(x);

/** recorded joint angle (periodic linear interpolation of the resampled spline) */
function recorded(leg, dof, ph) {
  const a = SC.legs[leg].angles[dof], n = SC.samples;
  const x = frac(ph) * n, i = Math.floor(x), f = x - i;
  return a[i % n] * (1 - f) + a[(i + 1) % n] * f;
}

export class Gait {
  /**
   * opts: beltY (world y of the belt top), base (THREE.Vector3 root position at lean 0),
   * pivot (root-local pivot for the lean, the thorax), V0 mm of belt per cycle, leans [...]
   */
  constructor(fly, { beltY, base, pivot, V0 = 1.1, leans = [0, 0.26], N = 48, lift = { F: 0.42, M: 0.34, H: 0.3 }, bob = 0.035 }) {
    this.fly = fly; this.beltY = beltY; this.base = base.clone(); this.pivot = pivot.clone();
    this.V0 = V0; this.leans = leans; this.N = N; this.lift = lift; this.bob = bob;
    this._q = new THREE.Quaternion(); this._v = new THREE.Vector3(); this._e = new THREE.Euler();
    this.swingEnd = {}; this.cx = {}; this.cz = {};
    this._measure();
    this.tables = leans.map(l => this._solve(l));
  }

  /** root placement for lean + gait phase; writes into fly.root */
  placeRoot(lean, phase, extra = null) {
    const r = this.fly.root;
    r.rotation.set(0, 0, -lean);
    // keep the thorax pivot where it is: pos = base + pivot - R*pivot
    const v = this._v.copy(this.pivot).applyEuler(r.rotation);
    r.position.copy(this.base).add(this.pivot).sub(v);
    r.position.y += this.bob * Math.cos(phase * 4 * Math.PI);   // two tripod pushes per cycle
    if (extra) r.position.add(extra);
  }

  _measure() {
    const f = this.fly, r = f.root;
    r.position.set(0, 0, 0); r.rotation.set(0, 0, 0);
    f.setPose(f.tripod);
    for (const L of LEGS6) {
      const e = SC.legs[L].swingEnd; this.swingEnd[L] = e;
      const tipAt = ph => {
        for (const d of DOFS) f.set(`joint_${L}${d}`, recorded(L, d, ph));
        f.apply(); return f.tip(L).clone();
      };
      const aep = tipAt(e), pep = tipAt(0.999);
      let zs = 0, k = 0;
      for (let s = 0; s < 8; s++) { zs += tipAt(e + (1 - e) * s / 7).z; k++; }
      this.cx[L] = (aep.x + pep.x) / 2;
      this.cz[L] = zs / k;
    }
    f.setPose(f.tripod); f.apply();
  }

  /** world foot target for leg L at its own phase p (0 = lift-off), root base frame */
  footTarget(L, p, out) {
    const e = this.swingEnd[L], duty = 1 - e;
    const S = this.V0 * duty;                       // stance stride: foot moves at exactly V0 per cycle
    const cx = this.base.x + this.cx[L], cz = this.base.z + this.cz[L];
    const kind = L[1];
    if (p >= e) {                                   // stance: on the belt, sliding back
      const s = (p - e) / duty;
      return out.set(cx + S / 2 - S * s, this.beltY, cz);
    }
    const s = p / e;                                // swing: lift, carry forward, set down
    const ease = s * s * (3 - 2 * s);
    const h = this.lift[kind] * Math.pow(Math.sin(Math.PI * Math.min(1, s * 1.08)), 0.85);
    const out2 = kind === 'F' ? 0.06 : kind === 'M' ? 0.1 : 0.05;
    return out.set(cx - S / 2 + S * ease, this.beltY + Math.max(0, h), cz + Math.sign(cz) * out2 * Math.sin(Math.PI * s));
  }

  _solve(lean) {
    const f = this.fly, N = this.N;
    const tab = {};
    for (const L of LEGS6) tab[L] = new Float32Array(N * DOFS.length);
    const tgt = new THREE.Vector3();
    for (let j = 0; j < N; j++) {
      const ph = j / N;
      this.placeRoot(lean, ph);
      f.setPose(f.tripod);
      for (const L of LEGS6) for (const d of DOFS) f.set(`joint_${L}${d}`, recorded(L, d, ph + PHASE_OFF[L]));
      f.apply();
      for (const L of LEGS6) {
        const p = frac(ph + PHASE_OFF[L]);
        this.footTarget(L, p, tgt);
        f.reach(L, tgt, { iters: 24 });
        const T = tab[L];
        DOFS.forEach((d, k) => { T[j * DOFS.length + k] = f.get(`joint_${L}${d}`); });
      }
    }
    f.setPose(f.tripod);
    this.fly.root.position.copy(this.base); this.fly.root.rotation.set(0, 0, 0);
    f.apply();
    return tab;
  }

  /** angles for leg L at global gait phase ph (the tripod offset is baked into the tables) and lean -> out[7] */
  angles(L, ph, lean, out) {
    const n = this.N, D = DOFS.length;
    const x = frac(ph) * n, i0 = Math.floor(x) % n, i1 = (i0 + 1) % n, fr = x - Math.floor(x);
    const ls = this.leans;
    let a = 0, w = 0;
    if (lean <= ls[0]) { a = 0; w = 0; } else if (lean >= ls[ls.length - 1]) { a = ls.length - 2; w = 1; } else {
      for (let k = 0; k < ls.length - 1; k++) if (lean <= ls[k + 1]) { a = k; w = (lean - ls[k]) / (ls[k + 1] - ls[k]); break; }
    }
    const A = this.tables[a][L], B = this.tables[Math.min(a + 1, ls.length - 1)][L];
    for (let k = 0; k < D; k++) {
      const va = A[i0 * D + k] * (1 - fr) + A[i1 * D + k] * fr;
      const vb = B[i0 * D + k] * (1 - fr) + B[i1 * D + k] * fr;
      out[k] = va + (vb - va) * w;
    }
    return out;
  }

  /** pose leg L of the fly from the tables */
  poseLeg(L, ph, lean) {
    const o = this._tmp || (this._tmp = new Float32Array(DOFS.length));
    this.angles(L, ph, lean, o);                   // tables are indexed by the global gait phase
    DOFS.forEach((d, k) => this.fly.set(`joint_${L}${d}`, o[k]));
  }
}

/**
 * Translucent copies of the six legs, parented to the thorax, used as a cartoon motion blur:
 * each copy shows the legs at an earlier gait phase.
 */
export class GhostLegs {
  constructor(fly, gait, count = 5) {
    this.fly = fly; this.gait = gait; this.count = count;
    this.mat = new THREE.MeshStandardMaterial({
      color: 0xf0a030, roughness: 0.6, metalness: 0, transparent: true, opacity: 0.2, depthWrite: false,
      emissive: 0x3a1800, emissiveIntensity: 0.6,
    });
    this.copies = [];
    const thorax = fly.bodies.Thorax;
    for (let g = 0; g < count; g++) {
      const legs = {};
      for (const L of LEGS6) {
        const src = fly.bodies[L + 'Coxa'];
        const c = src.clone(true);
        const segs = {};
        c.traverse(o => {
          if (o.isMesh) { o.material = this.mat; o.castShadow = false; o.receiveShadow = false; o.renderOrder = 3; }
          else if (SEGS.some(s => o.name === L + s)) segs[o.name] = o;
        });
        segs[L + 'Coxa'] = c;
        c.visible = false;
        thorax.add(c);
        legs[L] = { root: c, segs };
      }
      this.copies.push(legs);
    }
    this._a = new Float32Array(DOFS.length);
    this._q = new THREE.Quaternion();
  }

  /** write one leg copy from joint angles {name: rad} semantics, using fly rest quats and axes */
  _writeLeg(copy, L, angles7) {
    const f = this.fly, q = this._q;
    // coxa (yaw, pitch, roll), femur (pitch, roll), tibia, tarsus1 from the table; tarsus 2-5 from the live fly
    const vals = {};
    DOFS.forEach((d, k) => { vals[`joint_${L}${d}`] = angles7[k]; });
    for (const s of SEGS) {
      const name = L + s, o = copy.segs[name];
      if (!o) continue;
      o.quaternion.copy(f.rest[name]);
      for (const jn of f.bodyJoints[name]) {
        const a = jn in vals ? vals[jn] : f.angles[jn];
        if (a) o.quaternion.multiply(q.setFromAxisAngle(f.joints[jn].axis, a));
      }
    }
  }

  /** amount 0..1 (0 hides), spread in cycles, skip = set of legs not shown (e.g. RF busy) */
  update(phase, lean, amount, spread, skip = null) {
    const show = amount > 0.01;
    this.mat.opacity = 0.34 * amount / Math.sqrt(this.count / 3);
    for (let g = 0; g < this.count; g++) {
      const copy = this.copies[g];
      const ph = phase - spread * (g + 1) / (this.count + 1);
      for (const L of LEGS6) {
        const vis = show && !(skip && skip.has(L));
        copy[L].root.visible = vis;
        if (!vis) continue;
        this.gait.angles(L, ph, lean, this._a);
        this._writeLeg(copy[L], L, this._a);
      }
    }
  }
}
