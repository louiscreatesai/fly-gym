// The fly sitting upright on the bar stool, leaning on the table like a gambler.
// Body: the abdomen tip rests on the seat, the body leans toward the table by `lean` (pivoting
// on the seat). Hind feet on the stool's foot ring, middle feet on the padded rail, front legs
// are the "hands": rub (grooming), tap (hit), wave (stand), push (a chip stack), rest.
// Every leg is placed by fly.reach from a fixed seed each frame, so a pose is a pure function of
// its inputs (freeze frames are exact).
import * as THREE from 'three';
import { TABLE, STOOL } from './table.js';

const LEGS = ['LF', 'LM', 'LH', 'RF', 'RM', 'RH'];
const SEGS = ['Coxa', 'Femur', 'Tibia', 'Tarsus1', 'Tarsus2', 'Tarsus3', 'Tarsus4', 'Tarsus5'];
const CHAIN = ['Coxa_yaw', 'Coxa', 'Coxa_roll', 'Femur', 'Femur_roll', 'Tibia', 'Tarsus1', 'Tarsus2', 'Tarsus3', 'Tarsus4', 'Tarsus5'];

// seat contact of the abdomen tip (world) and the rest lean
export const SEAT = { x: STOOL.x - 0.12, y: STOOL.seat - 0.03, lean0: 0.2 };

// fixed foot targets (world). The fly's left is +z (screen right from the dealer side).
const RAIL_Y = TABLE.y + 0.035 + TABLE.railR * 0.92;
function railX(z) { const Rr = TABLE.R + 0.06; return TABLE.x0 + Math.sqrt(Rr * Rr - z * z); }
export const FEET = {
  LH: new THREE.Vector3(STOOL.x - 0.36, STOOL.foot + 0.04, 0.5),
  RH: new THREE.Vector3(STOOL.x - 0.36, STOOL.foot + 0.04, -0.5),
  LM: new THREE.Vector3(railX(1.1) - 0.02, RAIL_Y, 1.1),
  RM: new THREE.Vector3(railX(-1.1) - 0.02, RAIL_Y, -1.1),
};

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _w = new THREE.Vector3();
const _fw = new THREE.Vector3(), _dw = new THREE.Vector3(), _rw = new THREE.Vector3(0, 0, -1);

export class SeatedFly {
  constructor(fly) {
    this.fly = fly;
    this.seeds = {};
    this.legJoints = {};
    for (const L of LEGS) this.legJoints[L] = CHAIN.map(c => `joint_${L}${c}`);
  }

  /** anatomical limits for the CCD (the rig has none): keeps knees bending the right way, so poses blend cleanly */
  _limits() {
    const J = this.fly.joints;
    for (const L of LEGS) {
      const side = L[0] === 'L' ? 1 : -1, pair = L[1];
      const roll0 = pair === 'F' ? 0 : pair === 'M' ? 1.8 * side : 2.42 * side;
      const R = {
        Coxa_yaw: [-0.8, 0.8], Coxa: [-1.3, 1.3], Coxa_roll: [roll0 - 1.0, roll0 + 1.0],
        Femur: [-2.6, 0.3], Femur_roll: [-0.8, 0.8], Tibia: [0.1, 2.7],
        Tarsus1: [-0.9, 0.7], Tarsus2: [-1, 1], Tarsus3: [-1, 1], Tarsus4: [-1, 1], Tarsus5: [-1, 1],
      };
      if (pair === 'F') {
        // front legs groom the head: the coxa swings far forward, femur and tarsus fold more
        Object.assign(R, { Coxa: [-1.3, 2.3], Coxa_roll: [-1.2, 1.2], Femur: [-2.9, 0.5], Femur_roll: [-1.2, 1.2], Tarsus1: [-1.2, 1.0] });
      }
      for (const k in R) { const j = J[`joint_${L}${k}`]; if (j) j.range = R[k]; }
    }
  }

  build() {
    const f = this.fly;
    this._limits();
    f.root.position.set(0, 0, 0);
    f.root.rotation.set(0, 0, 0);
    f.root.quaternion.identity();
    f.setPose(f.tripod);
    this.base = f.getPose();
    f.apply();
    // abdomen tip in the root frame: the most posterior vertex of A6 (after the sitting curl)
    this._bodyPose(0, 0);
    f.apply();
    const mesh = f.meshes.A6 || Object.values(f.meshes).find(m => /A6/.test(m.name));
    const pos = mesh.geometry.attributes.position;
    let best = null, bx = 1e9;
    f.root.updateWorldMatrix(true, true);
    const inv = new THREE.Matrix4().copy(f.root.matrixWorld).invert();
    for (let i = 0; i < pos.count; i += 3) {
      _v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld).applyMatrix4(inv);
      // posterior and a little ventral: the part that sits on the cushion
      const score = _v.x + 0.35 * (_v.y - 1.1);
      if (score < bx) { bx = score; best = _v.clone(); }
    }
    this.tipLocal = best;
    // leg seeds: solve each leg once from the tripod toward a nominal target, keep the angles
    this.place(SEAT.lean0);
    for (const L of ['LH', 'RH', 'LM', 'RM']) {
      this._solve(L, FEET[L], 40);
      this.seeds[L] = this._grab(L);
    }
    const tp = new THREE.Vector3();
    for (const [L, sgn] of [['LF', 1], ['RF', -1]]) {
      this._resetLeg(L);
      this._solve(L, tp.set(2.85, TABLE.y + 0.01, 0.55 * sgn), 40);
      this.seeds[L] = this._grab(L);
      this.seeds[L + '_rest'] = this.seeds[L];
      this._resetLeg(L);
      this._solve(L, tp.set(2.95, TABLE.y + 0.5, 0.0), 40);
      this.seeds[L + '_up'] = this._grab(L);
    }
    f.setPose(this.base);
  }

  /** three-stage placement (knee, wrist, claw) like legday's foot glue; used once at build */
  solveChain(L, knee, wrist, tip, iters = 40) {
    const f = this.fly, J = k => `joint_${L}${k}`;
    for (let r = 0; r < 4; r++) {
      f.reach(L, knee, { iters, tipBody: `${L}Tibia`, joints: [J('Coxa'), J('Coxa_roll'), J('Coxa_yaw'), J('Femur')] });
      f.reach(L, wrist, { iters, tipBody: `${L}Tarsus1`, joints: [J('Femur_roll'), J('Tibia'), J('Femur')] });
      f.reach(L, tip, { iters, joints: [J('Tarsus1'), J('Tarsus2'), J('Tarsus3'), J('Tarsus4'), J('Tarsus5')] });
    }
    return this._grab(L);
  }

  /** pose one leg from a descriptor: {type:'ik', target, seed} | {type:'joints', joints} | {type:'chain', seed, wrist, tip} */
  solveDesc(L, d) {
    const f = this.fly, J = k => `joint_${L}${k}`;
    if (d.type === 'joints') {
      for (const j of this.legJoints[L]) f.set(j, d.joints[j]);
      for (const seg of SEGS) f.applyBody(L + seg);        // refresh world matrices so tip() is current
      return;
    }
    const S = this.seeds[d.seed];
    for (const j of this.legJoints[L]) f.set(j, S[j]);
    if (d.type === 'ik') { f.reach(L, d.target, { iters: d.iters || 10 }); return; }
    // wrist (tarsus base) then claw: keeps the tarsus flat for the stand wave
    const hip = this._hipJ || (this._hipJ = {});
    const hj = hip[L] || (hip[L] = [J('Coxa'), J('Coxa_roll'), J('Coxa_yaw'), J('Femur'), J('Femur_roll'), J('Tibia')]);
    const tj = (this._tarJ || (this._tarJ = {}))[L] || (this._tarJ[L] = [1, 2, 3, 4, 5].map(i => J(`Tarsus${i}`)));
    f.reach(L, d.wrist, { iters: 10, tipBody: `${L}Tarsus1`, joints: hj });
    f.reach(L, d.tip, { iters: 8, joints: tj });
  }

  _grabInto(L, o) { for (const j of this.legJoints[L]) o[j] = this.fly.get(j); return o; }

  _grab(L) { const o = {}; for (const j of this.legJoints[L]) o[j] = this.fly.get(j); return o; }
  _resetLeg(L) { for (const j of this.legJoints[L]) this.fly.set(j, this.base[j] || 0); }
  _solve(L, target, iters) {
    const f = this.fly;
    for (let k = 0; k < 3; k++) f.reach(L, target, { iters });
  }

  /** abdomen curl + breathing (fly frame) */
  _bodyPose(breath, slump) {
    const f = this.fly;
    f.set('joint_A1A2', 0.06 + 0.5 * breath);
    f.set('joint_A3', 0.08 + breath);
    f.set('joint_A4', 0.06 + breath * 0.8);
    f.set('joint_A5', 0.04);
    f.set('joint_A6', 0.02);
  }

  /** place the root: upright, leaning toward the table (-x) by `lean`, abdomen tip on the seat */
  place(lean, sway = 0) {
    const f = this.fly;
    const c = Math.cos(lean), s = Math.sin(lean);
    _fw.set(-s, c, 0);            // head up, tipped toward the table
    _dw.set(c, s, 0);             // back faces away from the table
    // small side sway: rotate about world x
    _m.makeBasis(_fw, _dw, _rw);
    f.root.quaternion.setFromRotationMatrix(_m);
    if (sway) f.root.quaternion.premultiply(_q.setFromAxisAngle(_v.set(1, 0, 0), sway));
    _w.copy(this.tipLocal).applyQuaternion(f.root.quaternion);
    f.root.position.set(SEAT.x - _w.x, SEAT.y - _w.y, -_w.z);
    f.root.updateMatrixWorld(true);
  }

  /** seed a leg with a blend of stored poses, then glue its tip to the target */
  legTo(L, target, seedA, seedB = null, k = 0, iters = 8) {
    const f = this.fly;
    const A = this.seeds[seedA];
    if (seedB && k > 0) {
      const B = this.seeds[seedB];
      for (const j of this.legJoints[L]) f.set(j, A[j] + (B[j] - A[j]) * k);
    } else for (const j of this.legJoints[L]) f.set(j, A[j]);
    if (target) f.reach(L, target, { iters });
  }

  /**
   * s = { lean, sway, breath, head:[pitch, turn, tilt], antL, antR, prob (0..1), wings:{spread,pitch,flap},
   *       LF: {A: descriptor, B: descriptor | null, k: 0..1, stag}, RF: {...} }   (see solveDesc)
   */
  pose(s) {
    const f = this.fly;
    f.setPose(this.base);
    this._bodyPose(s.breath || 0, 0);
    // head
    f.set('joint_Head', s.head[0]);
    f.set('joint_Head_roll', s.head[1]);
    f.set('joint_Head_yaw', s.head[2]);
    // antennae
    for (const [side, a] of [['L', s.antL], ['R', s.antR]]) {
      f.set(`joint_${side}Pedicel`, a[0]);
      f.set(`joint_${side}Pedicel_yaw`, a[1]);
      f.set(`joint_${side}Funiculus`, a[2]);
    }
    // proboscis (MN9 is the proboscis motor neuron: a small twitch on HIT)
    const p = s.prob || 0;
    f.set('joint_Rostrum', 0.55 * p);
    f.set('joint_Haustellum', -0.75 * p);
    f.setWings(s.wings);
    this.place(s.lean, s.sway || 0);
    f.apply();
    // legs
    for (const L of ['LH', 'RH', 'LM', 'RM']) this.legTo(L, FEET[L], L, null, 0, 3);
    for (const L of ['LF', 'RF']) {
      const g = s[L];
      if (g.B && g.k > 0) {
        this.solveDesc(L, g.A);
        const a = this._grabInto(L, this._tmpA || (this._tmpA = {}));
        const ta = f.tip(L, this._tipA || (this._tipA = new THREE.Vector3()));
        this.solveDesc(L, g.B);
        if (g.stag) {
          // into / out of the raised grooming pose: staggered joint blend so the leg never sweeps past the face
          // (leaving it: the coxa lowers the folded leg first, then it unfolds; entering: fold first, then raise)
          const k = g.k, early = Math.min(1, k * 1.7), late = Math.max(0, k * 1.7 - 0.7);
          const ks = x => x * x * (3 - 2 * x);
          for (const j of this.legJoints[L]) {
            const coxa = j.includes('Coxa');
            const kj = ks(g.stag > 0 ? (coxa ? early : late) : (coxa ? late : early));
            f.set(j, a[j] + (f.get(j) - a[j]) * kj);
          }
        } else {
          // transition between two placed poses: blended joints, claw glued to the blended tip
          const tb = f.tip(L, this._tipB || (this._tipB = new THREE.Vector3()));
          for (const j of this.legJoints[L]) f.set(j, a[j] + (f.get(j) - a[j]) * g.k);
          f.reach(L, ta.lerp(tb, g.k), { iters: 8 });
        }
      } else this.solveDesc(L, g.A);
    }
  }
}
