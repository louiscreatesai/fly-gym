// The fly: body path, face-contact solver, a precomputed footstep plan (no foot sliding),
// duck / slide set pieces, and per-frame posing with IK. Pure function of loop time u.
import * as THREE from 'three';
import { HILL, groundPoint, groundAngle, groundAngleSmooth } from './world.js';
import { CUBE_A } from './cube.js';
import {
  PERIOD, U_FALL, U_WAKE, sigmaOf, SLIP, pushP, poseFromP, cubePose, P_REST, X_REST, T_TIP0, T_FLAT, T_BACK,
} from './cubeMotion.js';
import { track, clamp, lerp, sstep, smoother, wob, window4 } from './util.js';

const a = CUBE_A, H = HILL;
// noise on the wrapped loop time must repeat exactly every PERIOD (seamless loop): snap frequencies
const W = 2 * Math.PI / PERIOD;
const ps = (u, omega, ph) => Math.sin(Math.max(1, Math.round(omega / W)) * W * u + ph);
const wobP = (u, rate, seed) => 0.5 * ps(u, rate, seed * 12.9898) + 0.3 * ps(u, 2.31 * rate, seed * 78.233 + 1.3) + 0.2 * ps(u, 4.13 * rate, seed * 37.719 + 2.1);
const tremP = (u, f, seed) => 0.6 * ps(u, f * 6.2832, seed * 3.7) + 0.4 * ps(u, f * 1.618 * 6.2832, seed * 9.1);
const LEGS = ['LF', 'LM', 'LH', 'RF', 'RM', 'RH'];
const SIDE = { LF: -1, LM: -1, LH: -1, RF: 1, RM: 1, RH: 1 };
const ADJ = { LF: ['LM', 'RF'], LM: ['LF', 'LH', 'RM'], LH: ['LM', 'RH'], RF: ['RM', 'LF'], RM: ['RF', 'RH', 'LM'], RH: ['RM', 'LH'] };

// nominal foot offsets in the body's ground frame [forward, right] (mm)
const NOM_WALK = { LF: [1.45, -0.55], LM: [-0.25, -1.35], LH: [-1.55, -1.2], RF: [1.45, 0.55], RM: [-0.25, 1.35], RH: [-1.55, 1.2] };
const NOM_PUSH = { LM: [0.0, -1.4], LH: [-1.3, -1.05], RM: [0.0, 1.4], RH: [-1.3, 1.05] };
const SPLAY = { LF: [1.3, -1.2], LM: [0.05, -1.85], LH: [-1.3, -1.35], RF: [1.3, 1.2], RM: [0.05, 1.85], RH: [-1.3, 1.35] };

// ---- body tracks -----------------------------------------------------------------------
export const TUNE = { faceH: 1.22, faceLat: 0.55, gap: 0.38, dh: 0, dpitch: 0, headPitch: 0.12, faceOut: 0.035, wingPitch: 0, ankleUp: 0.22 };
const HEAD_PT = [1.0, 1.12];          // front of the head (fly local x forward, y up) that touches the cube
const H_PUSH = 0.28, PITCH_PUSH = -0.36;

// sigma-domain modifiers (ride height, pitch)
const H_DUCK = -0.36;
const hTrack = track([[U_WAKE, H_DUCK], [3.45, 0.3], [3.75, 0.32], [4.3, H_PUSH], [SLIP.t0, H_PUSH], [SLIP.t1, H_PUSH - 0.16], [SLIP.hold, H_PUSH - 0.05],
  [7.2, H_PUSH], [10.55, 0.36], [10.75, 0.5], [11.0, 0.45]]);
const pitchTrack = track([[U_WAKE, 0], [3.5, 0.02], [3.8, PITCH_PUSH], [SLIP.t0, PITCH_PUSH], [SLIP.t1, PITCH_PUSH - 0.14], [SLIP.hold, PITCH_PUSH - 0.06],
  [7.0, PITCH_PUSH], [10.45, PITCH_PUSH], [10.78, 0.12], [10.95, 0.18], [11.0, 0.12]]);
// headbutt: pull back, slam
// (negative = pulls back, positive = lunges so the head hits the cube)
const buttPull = s => 0.2 * window4(3.78, 3.83, 3.85, 3.88, s) - (TUNE.gap - 0.01) * window4(3.87, 3.91, 3.98, 4.15, s);

// crab walk from the slide end to behind the cube
const SLIDE_END = { s: -4.1, z: -2.7 };

/** ground frame at arclength s (smoothed over the body) */
function frameAngle(s) { return groundAngleSmooth(s, 1.15); }

const _gp = new THREE.Vector3(), _rxy = [0, 0, 0];
/** root position (x, y) for body at s and ride height h, plus the frame angle (scratch array) */
function rootXY(s, h) {
  groundPoint(s, _gp);
  const al = frameAngle(s);
  _rxy[0] = _gp.x - Math.sin(al) * h; _rxy[1] = _gp.y + Math.cos(al) * h; _rxy[2] = al;
  return _rxy;
}

/** find the body s where the head touches the cube's back face (plane through B, normal X) */
function solveContact(bx, by, psi, h, pitch, gap = TUNE.gap) {
  const Xx = Math.cos(psi), Xy = Math.sin(psi);
  // s-coordinate guess of B, then bisection on the signed distance head -> face plane
  const sB = bx <= H.x0 ? bx - H.x0 : Math.min((bx - H.x0) / H.cos, H.S + (bx - H.x1));
  let lo = sB - 4.5, hi = sB + 1.0;
  for (let i = 0; i < 28; i++) {
    const m = (lo + hi) / 2;
    const r = rootXY(m, h);
    const be = r[2] + pitch;
    const hx = r[0] + HEAD_PT[0] * Math.cos(be) - HEAD_PT[1] * Math.sin(be);
    const hy = r[1] + HEAD_PT[0] * Math.sin(be) + HEAD_PT[1] * Math.cos(be);
    if ((hx - bx) * Xx + (hy - by) * Xy + gap < 0) lo = m; else hi = m;
  }
  return (lo + hi) / 2;
}

export class FlyRig {
  constructor(ctx) {
    this.ctx = ctx;
    this.fly = ctx.fly;
    this.cp = {};          // scratch cube pose
    this.v = new THREE.Vector3();
    this.q = new THREE.Quaternion();
    this.q2 = new THREE.Quaternion();
    this.m = new THREE.Matrix4();
    this.e = new THREE.Euler();
    this.tgt = new THREE.Vector3();
    this.X = new THREE.Vector3(); this.Y = new THREE.Vector3(); this.Z = new THREE.Vector3();
  }

  // body ground pose in the sigma domain: {s, z, yaw, h, pitch}
  bodySigma(s, out) {
    const cp = s >= PERIOD + T_TIP0 ? cubePose(s - PERIOD, this.cp) : poseFromP(pushP(s), this.cp);
    const h = hTrack(s) + TUNE.dh, pitch = pitchTrack(s) + TUNE.dpitch;
    const sc = solveContact(cp.bx, cp.by, cp.psi, h, pitch) - buttPull(s);
    if (s < this.CRAB_T1) {
      const k = smoother(U_WAKE, this.CRAB_T1, s);
      out.s = lerp(SLIDE_END.s, this.sRest, smoother(U_WAKE + 0.12, this.CRAB_T1, s));
      out.z = lerp(SLIDE_END.z, 0, smoother(U_WAKE + 0.05, this.CRAB_T1 - 0.04, s));
      out.yaw = 0.38 * Math.sin(Math.PI * k) * (1 - k * 0.3);
    } else {
      out.s = sc; out.z = 0; out.yaw = 0;
    }
    out.h = h; out.pitch = pitch;
    return out;
  }

  /** world position of fly.root at loop time u (body path only, no IK; for the follow camera) */
  bodyWorld(u, out) {
    const b = this._bw || (this._bw = {});
    if (u >= U_FALL && u < U_WAKE) this.bodyFall(u, b); else this.bodySigma(sigmaOf(u), b);
    const al = frameAngle(b.s);
    groundPoint(b.s, out);
    out.x += -Math.sin(al) * b.h; out.y += Math.cos(al) * b.h; out.z = b.z;
    return out;
  }

  build() {
    const f = this.fly;
    f.root.position.set(0, 0, 0); f.root.quaternion.identity(); f.setPose(f.tripod); f.apply();
    this.tarsLen = {}; this.chainNoTarsus = {}; this.chainTarsus = {}; this.tarsBody = {};
    for (const l of LEGS) {
      this.chainTarsus[l] = [`joint_${l}Tarsus1`]; this.tarsBody[l] = l + 'Tarsus1';
      this.tarsLen[l] = f.tip(l).distanceTo(f.worldPos(l + 'Tarsus1'));
      this.chainNoTarsus[l] = [`joint_${l}Tibia`, `joint_${l}Femur`, `joint_${l}Femur_roll`, `joint_${l}Coxa`, `joint_${l}Coxa_roll`, `joint_${l}Coxa_yaw`];
    }
    this.N = new THREE.Vector3(); this.D = new THREE.Vector3();
    // rest contact (cube at P_REST): end of the crab walk
    const cp = poseFromP(P_REST, {});
    this.CRAB_T1 = 3.75;
    this.sRest = solveContact(cp.bx, cp.by, cp.psi, hTrack(this.CRAB_T1), pitchTrack(this.CRAB_T1));
    // duck start: body pose at u = U_FALL (sigma = PERIOD + U_FALL)
    const b = this.bodySigma(PERIOD + U_FALL, {});
    this.sDuck = b.s;
    this.planSteps();
    this.bD = this.bodyFall(2.12, {});
    this.pA = this.bodyFall(2.555, {});
    // where every foot is when the duck starts (world)
    this.duckFrom = {};
    const cpF = cubePose(U_FALL - 1e-6, {});
    this.duckFaceN = new THREE.Vector3(-Math.cos(cpF.psi), -Math.sin(cpF.psi), 0);
    this.duckFaceD = new THREE.Vector3(-Math.sin(cpF.psi), Math.cos(cpF.psi), 0);
    const tmp = [0, 0, 0];
    for (const l of LEGS) {
      const w = new THREE.Vector3();
      if (l === 'LF' || l === 'RF') this.faceTarget(l, cpF, PERIOD + U_FALL - 1e-6, U_FALL - 1e-6, 1.25, w);
      else { this.footAt(l, PERIOD + U_FALL, tmp); this.ground(tmp[0], tmp[1], 0, w); }
      this.duckFrom[l] = w;
    }
    this._fw = new THREE.Vector3(); this._up0 = new THREE.Vector3(0, 0, 1);
    // base poses: tripod, and a push pose with the front legs solved onto the face once
    f.setWings({});
    this.tripod = { ...f.tripod };
    // lift the front legs forward/up a little as the IK start for pushing
    this.pushBase = { ...f.tripod };
    for (const l of ['LF', 'RF']) {
      this.pushBase[`joint_${l}Coxa`] = (f.tripod[`joint_${l}Coxa`] || 0) + 0.5;
      this.pushBase[`joint_${l}Femur`] = (f.tripod[`joint_${l}Femur`] || 0) - 0.35;
      this.pushBase[`joint_${l}Tibia`] = (f.tripod[`joint_${l}Tibia`] || 0) + 0.3;
    }
  }

  // ---- footstep planner (sigma domain, precomputed) -------------------------------------
  planSteps() {
    const dt = 1 / 240;
    const t0 = U_WAKE, t1 = PERIOD + U_FALL;
    const bp = {}, bq = {};
    const desired = (t, leg, out) => {
      this.bodySigma(Math.min(t, t1 - 1e-4), bp);      // never look past the duck (the cube is falling then)
      const nom = this.nominal(t, leg);
      const c = Math.cos(bp.yaw), s = Math.sin(bp.yaw);
      out[0] = bp.s + c * nom[0] - s * nom[1];
      out[1] = bp.z + s * nom[0] + c * nom[1];
      return out;
    };
    // initial: where the slide left the feet
    const init = {};
    for (const l of LEGS) init[l] = this.slideFoot(U_WAKE, l);
    const st = {};
    for (const l of LEGS) st[l] = { pos: init[l].slice(), swingUntil: -1, landed: t0, ev: [] };
    const d = [0, 0], dNext = [0, 0];
    let prevB = this.bodySigma(t0, {});
    const frontOn = this.FRONT_ON = 3.66;     // front legs go onto the cube face
    let slipDone = false, stompDone = false;
    for (let t = t0; t < t1; t += dt) {
      const B = this.bodySigma(t, bq);
      const speed = (Math.hypot(B.s - prevB.s, B.z - prevB.z) + Math.abs(B.yaw - prevB.yaw) * 1.2) / dt;
      const push = t > frontOn;
      // the slip: planted mid/hind feet slide with the body
      if (t >= SLIP.t0 && t < SLIP.t1) {
        const ds = B.s - prevB.s;
        for (const l of ['LM', 'LH', 'RM', 'RH']) {
          const L = st[l];
          if (L.swingUntil < t) {
            const e = L.ev.length && L.ev[L.ev.length - 1];
            if (!e || e.type !== 'slide' || e.t1 < t - dt * 1.5) L.ev.push({ type: 'slide', t0: t, t1: t, from: L.pos.slice(), to: L.pos.slice() });
            const ee = L.ev[L.ev.length - 1];
            L.pos[0] += ds * (l[1] === 'H' ? 1.15 : 0.8);
            ee.t1 = t + dt; ee.to = L.pos.slice();
          }
        }
        prevB = { ...B };
        continue;
      }
      if (!stompDone && t >= SLIP.catch) {
        // the catch: right hind leg shoots back and stomps
        stompDone = true;
        const L = st.RH;
        const c = Math.cos(B.yaw), s = Math.sin(B.yaw);
        const nom = [-1.75, 1.15];
        const to = [B.s + c * nom[0] - s * nom[1], B.z + s * nom[0] + c * nom[1]];
        L.ev.push({ type: 'swing', t0: t, t1: t + 0.075, from: L.pos.slice(), to, lift: 0.22 });
        L.pos = to; L.swingUntil = t + 0.075; L.landed = t + 0.075;
      }
      // pick the leg that most needs a step
      let best = null, bestE = 0;
      for (const l of LEGS) {
        if (push && (l === 'LF' || l === 'RF')) continue;
        const L = st[l];
        if (L.swingUntil > t || t - L.landed < 0.04) continue;
        desired(t, l, d);
        const e = Math.hypot(L.pos[0] - d[0], L.pos[1] - d[1]);
        const thr = push ? 0.27 : 0.32;
        const blocked = ADJ[l].some(n => st[n].swingUntil > t && !(push && (n === 'LF' || n === 'RF')));
        if (blocked && e < 2.2 * thr) continue;          // wait for the neighbour unless it is urgent
        if (e > thr && e - thr > bestE) { bestE = e - thr; best = l; }
      }
      if (best) {
        const L = st[best];
        const Tsw = clamp(0.22 - speed * 0.02, 0.1, 0.2) * (push ? 1.05 : 0.9);
        const thr = push ? 0.27 : 0.32;
        const lead = clamp(0.8 * thr / Math.max(speed, 0.2), 0, 0.35);
        desired(t + Tsw, best, d);
        desired(t + Tsw + lead, best, dNext);
        // land ahead of the body, but never more than ~0.8 of a stride ahead of where it will be
        const ox = dNext[0] - d[0], oz = dNext[1] - d[1], ol = Math.hypot(ox, oz), lim = 0.8 * thr;
        if (ol > lim) { dNext[0] = d[0] + ox * lim / ol; dNext[1] = d[1] + oz * lim / ol; }
        L.ev.push({ type: 'swing', t0: t, t1: t + Tsw, from: L.pos.slice(), to: dNext.slice(), lift: push ? 0.3 : 0.24 });
        L.pos = dNext.slice(); L.swingUntil = t + Tsw; L.landed = t + Tsw;
      }
      prevB = { ...B };
    }
    this.plan = {};
    for (const l of LEGS) this.plan[l] = { init: init[l], ev: st[l].ev };
  }

  nominal(t, leg) {
    const w = sstep(3.3, 3.7, t);
    if (leg === 'LF' || leg === 'RF') return NOM_WALK[leg];
    const A = NOM_WALK[leg], B = NOM_PUSH[leg];
    return [lerp(A[0], B[0], w), lerp(A[1], B[1], w)];
  }

  /** planned foot at sigma time t: [s, z, lift] */
  footAt(leg, t, out) {
    const P = this.plan[leg];
    const ev = P.ev;
    let lo = -1, hi = ev.length;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ev[m].t0 <= t) lo = m; else hi = m; }
    if (lo < 0) { out[0] = P.init[0]; out[1] = P.init[1]; out[2] = 0; return out; }
    const e = ev[lo];
    if (t >= e.t1) { out[0] = e.to[0]; out[1] = e.to[1]; out[2] = 0; return out; }
    const k = (t - e.t0) / (e.t1 - e.t0);
    if (e.type === 'slide') {
      out[0] = lerp(e.from[0], e.to[0], k); out[1] = lerp(e.from[1], e.to[1], k); out[2] = 0; return out;
    }
    const kk = smoother(0, 1, k);
    out[0] = lerp(e.from[0], e.to[0], kk);
    out[1] = lerp(e.from[1], e.to[1], kk);
    out[2] = Math.sin(Math.PI * Math.min(1, k * 1.1)) * e.lift;
    return out;
  }

  // ---- fall domain (u in [U_FALL, U_WAKE)) ---------------------------------------------
  /** body during duck / slide */
  bodyFall(u, out) {
    const sD = this.sDuck;
    const s0 = sD - 0.42;                    // scoots back when ducking
    if (u < 2.56) {
      out.s = lerp(sD, s0, smoother(U_FALL, 2.12, u));
      out.z = 0; out.yaw = 0;
    } else {
      // lets go: slides down tail first, veering to the camera side, stops on the floor
      const k = clamp((u - 2.56) / (U_WAKE - 2.56), 0, 1);
      const acc = k < 0.62 ? (k / 0.62) ** 2 * 0.62 : 0.62 + (1 - (1 - (k - 0.62) / 0.38) ** 2) * 0.38;
      out.s = lerp(s0, SLIDE_END.s, acc);
      out.z = lerp(0, SLIDE_END.z, smoother(0.1, 0.72, k));
      out.yaw = 0.22 * Math.sin(k * 7.5) * Math.sin(Math.PI * k);
    }
    out.h = u < 2.56 ? lerp(hTrack(PERIOD + U_FALL), H_DUCK, smoother(U_FALL, 2.1, u)) : H_DUCK + 0.06 * Math.sin(Math.PI * clamp((u - 2.56) / 0.6, 0, 1));
    out.pitch = u < 2.56 ? lerp(pitchTrack(PERIOD + U_FALL), 0, smoother(U_FALL, 2.1, u)) : 0;
    return out;
  }

  /** where each foot is during the slide (ground coords, relative to the body) */
  slideFoot(u, leg, out = [0, 0]) {
    const b = this.bodyFall(Math.min(u, U_WAKE - 1e-6), this._sfb || (this._sfb = {}));
    const sp = SPLAY[leg];
    const k = clamp((u - 2.56) / (U_WAKE - 2.56), 0, 1);
    // paddling while sliding
    const pad = Math.sin(u * 22 + (SIDE[leg] > 0 ? 0 : 1.7) + (leg[1] === 'F' ? 0 : leg[1] === 'M' ? 2.1 : 4.2)) * 0.18 * Math.sin(Math.PI * k);
    let fw = sp[0] + pad, rt = sp[1];
    // tuck the right legs in while passing the cube
    if (SIDE[leg] > 0) rt *= lerp(1, 0.75, sstep(0.45, 0.7, k));
    const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
    out[0] = b.s + c * fw - s * rt; out[1] = b.z + s * fw + c * rt;
    return out;
  }

  // ---- per-frame posing -----------------------------------------------------------------
  /**
   * Pose the fly for loop time u. cube = the cube pose at u. Returns info for the scene.
   */
  pose(u, cube, info) {
    const f = this.fly;
    const inFall = u >= U_FALL && u < U_WAKE;
    const sg = sigmaOf(u);
    const B = inFall ? this.bodyFall(u, this.bp || (this.bp = {})) : this.bodySigma(sg, this.bp || (this.bp = {}));

    // how hard it strains (0..1+) -> tremble
    let strain = 0;
    if (!inFall) {
      const p = cube.mode === 'push' ? pushP(sg) : H.S;
      strain = sg < 4.4 ? 0.15 * sstep(U_WAKE, 3.45, sg) : clamp(0.25 + 0.75 * (p - 2.5) / (H.S - 2.5), 0.25, 1);
      if (u >= T_TIP0 && u < U_FALL) strain = 1.25;
      strain += 1.0 * window4(SLIP.t0, SLIP.t1, SLIP.hold, SLIP.hold + 0.25, sg);
    } else strain = 1.25 * (1 - sstep(U_FALL, 2.12, u));      // lets go of the effort as it ducks
    const tr = strain;

    // ---- base joint pose ----
    const pushW = inFall ? 1 - sstep(U_FALL, 2.15, u) : sstep(3.52, 3.7, sg);
    f.setPose(this.tripod);
    if (pushW > 0) f.setPose(this.pushBase, pushW);

    // head / proboscis / antennae / abdomen
    let headPitch = 0, headTurn = 0, headTilt = 0, prob = 0;
    const t = u;
    if (!inFall) {
      headPitch = TUNE.headPitch * pushW;                                  // pressed down into the cube
      prob = pushW * (0.2 + 0.45 * Math.max(0, Math.sin(sg * 5.3)) ** 3);  // keeps tasting
      // tasting at the bottom
      prob = Math.max(prob, window4(3.66, 3.7, 3.78, 3.82, sg) * 0.95);
      headPitch -= 0.3 * window4(3.78, 3.83, 3.85, 3.88, sg);   // headbutt wind-up
      headPitch += 0.25 * window4(3.88, 3.91, 3.96, 4.1, sg);
      // teeter: look up at the summit, proboscis out, hopeful
      const hope = window4(T_TIP0 + 0.05, T_FLAT, 1.93, 2.0, u) * (u < 3 ? 1 : 0);
      prob = Math.max(prob, hope * 1.0);
      headPitch = lerp(headPitch, -0.35, hope);
      // slip: head snaps down
      headPitch += 0.25 * window4(SLIP.t0, SLIP.t1, SLIP.t1 + 0.05, SLIP.hold, sg);
      headTurn = 0.06 * wobP(t, 1.3, 2) * (sg < 4 ? sstep(U_WAKE, 3.35, sg) : 1);
      if (u < 3) prob *= 1 - sstep(1.94, U_FALL, u);           // flinches: proboscis in as the cube comes back
    } else {
      // duck: head down, then peek toward the camera, then slide
      const peek = window4(2.3, 2.42, 2.56, 2.66, u);
      const wake = 1 - sstep(2.95, U_WAKE, u);          // hand over smoothly to the pushing branch
      headPitch = (lerp(TUNE.headPitch, 0.45, smoother(U_FALL, 2.1, u)) * (1 - peek) - 0.25 * peek) * wake;
      headTurn = -0.35 * peek;
      // grabs at the cube as it slides past
      prob = window4(2.97, 3.0, 3.08, 3.13, u) * 0.8;
      headTilt = 0.12 * Math.sin(u * 9) * sstep(2.56, 2.7, u) * wake;
    }
    f.set('joint_Head', headPitch + 0.02 * tremP(t, 9, 1) * tr);
    f.set('joint_Head_roll', headTurn);
    f.set('joint_Head_yaw', headTilt);
    f.set('joint_Rostrum', -1.25 * prob);
    f.set('joint_Haustellum', -0.95 * prob);
    // antennae twitch (flick more when it tastes)
    f.set('joint_LPedicel', 0.1 * wobP(t, 2.7, 1) + 0.1 * Math.max(0, ps(t, 3.1, 2)) ** 12 - 0.12 * prob);
    f.set('joint_RPedicel', 0.1 * wobP(t, 2.7, 2) + 0.1 * Math.max(0, ps(t, 3.1, 4)) ** 12 - 0.12 * prob);
    f.set('joint_LPedicel_roll', 0.08 * wobP(t, 1.9, 3));
    f.set('joint_RPedicel_roll', -0.08 * wobP(t, 1.9, 4));
    // abdomen: breathing, pumping harder with strain, pressed flat in the duck
    const br = ps(t, 2 * Math.PI * 1.55, 0) * (0.025 + 0.03 * tr);
    const curl = -0.03 * tr;
    for (const seg of ['A1A2', 'A3', 'A4', 'A5', 'A6']) f.set(`joint_${seg}`, br + curl);
    // wings: folded, twitching on effort; up like arms on the slide
    const slideW = inFall ? sstep(2.56, 2.7, u) * (1 - sstep(3.02, U_WAKE, u)) : 0;
    const twitch = Math.max(0, ps(t, 7.3, 0)) ** 20 * 0.12 * tr + Math.max(0, ps(t, 4.1, 1)) ** 30 * 0.08;
    const hopeW = !inFall ? window4(T_FLAT - 0.05, T_FLAT, 1.9, 1.98, u) : 0;
    f.setWings({
      spread: twitch + slideW * 0.55 + hopeW * (0.16 + 0.06 * Math.sin(t * 2 * Math.PI * 23)),
      pitch: slideW * 0.35 + hopeW * 0.1 + TUNE.wingPitch * (1 - slideW),
      flap: hopeW * 0.12 * Math.sin(t * 2 * Math.PI * 23),
    });

    // ---- root transform ----
    const jit = 0.022 * tr;
    this.placeRoot(B.s, B.z, B.yaw, B.h + jit * tremP(t, 13, 1), B.pitch + 0.012 * tr * tremP(t, 11, 2), 0.012 * tr * tremP(t, 12, 3));

    // ---- legs ----
    const tip = this.tgt, N = this.N, D = this.D;
    const tmp = this._tmp || (this._tmp = [0, 0, 0]);
    if (inFall) {
      // duck: feet go to the splay and cling; slide: feet slide with the body
      for (const l of LEGS) {
        let sN;
        if (u < 2.56) {
          const k = smoother(U_FALL, 2.11, u);
          const sp = SPLAY[l];
          sN = this.bD.s + sp[0];
          this.ground(sN, this.bD.z + sp[1], 0, tip);
          tip.lerp(this.duckFrom[l], 1 - k);
          tip.y += Math.sin(Math.PI * k) * 0.2;
        } else {
          const pA = this.pA;
          const k = sstep(2.56, 2.64, u);
          const sl = this.slideFoot(u, l, this._sl || (this._sl = [0, 0]));
          sN = lerp(pA.s + SPLAY[l][0], sl[0], k);
          const fz = lerp(pA.z + SPLAY[l][1], sl[1], k);
          const lift = (0.03 + 0.12 * Math.max(0, Math.sin(u * 22 + LEGS.indexOf(l) * 1.3)) * sstep(2.6, 2.7, u)) * (1 - sstep(3.0, 3.12, u));
          this.ground(sN, fz, lift, tip);
        }
        this.groundNormal(sN, N);
        this.groundDir(l, tip, N, D);
        if ((l === 'LF' || l === 'RF') && u < 2.06) { N.copy(this.duckFaceN); D.copy(this.duckFaceD); }   // still on the face
        if (l === 'RF' && u >= 2.95 && u < 3.12) {
          // grabs at the cube's side as it slides past
          const g = window4(2.95, 3.0, 3.07, 3.12, u);
          const side = this.v.set(X_REST - a / 2 + 0.5, 0.95, -a / 2 - 0.02);
          tip.lerp(side, g);
          if (g > 0.5) { N.set(0, 0, -1); D.set(0, 1, 0); }
        }
        this.placeFoot(l, tip, N, D, { iters: 10 });
      }
      info.frontOnCube = u >= 3.0 && u < 3.08;
    } else {
      // stepping legs from the plan; front legs on the cube's back face while pushing
      const cpsi = Math.cos(cube.psi), spsi = Math.sin(cube.psi);
      for (const l of LEGS) {
        const front = l === 'LF' || l === 'RF';
        this.footAt(l, sg, tmp);
        this.ground(tmp[0], tmp[1], tmp[2], tip);
        this.groundNormal(tmp[0], N);
        this.groundDir(l, tip, N, D);
        if (front) {
          const w = sstep(this.FRONT_ON - 0.1, this.FRONT_ON + 0.05, sg);
          if (w > 0) {
            this.faceTarget(l, cube, sg, u, tr, this.v);
            tip.lerp(this.v, w);
            tip.y += Math.sin(Math.PI * w) * 0.35;
            if (w > 0.5) { N.set(-cpsi, -spsi, 0); D.set(-spsi, cpsi, 0); }   // face normal (toward the fly), up the face
          }
        }
        this.placeFoot(l, tip, N, D, { iters: front ? 12 : 9, ankleUp: front && sg >= this.FRONT_ON - 0.05 ? 0.1 : TUNE.ankleUp });
      }
      info.frontOnCube = sg >= this.FRONT_ON || sg < 3.0;
    }
    // leg tremble on top of the IK (knees shake)
    if (tr > 0.05) {
      for (const l of LEGS) {
        const sd = LEGS.indexOf(l);
        f.set(`joint_${l}Tibia`, f.get(`joint_${l}Tibia`) + 0.035 * tr * tremP(t, 14 + sd * 0.7, sd));
        f.set(`joint_${l}Femur`, f.get(`joint_${l}Femur`) + 0.02 * tr * tremP(t, 12 + sd * 0.5, sd + 7));
      }
    }
    info.strain = tr;
    info.body = B;
    return info;
  }

  /**
   * Put a leg's tip on target T with the tarsus lying along the surface (normal N) in direction dir:
   * first the ankle (Tarsus1 origin) above the surface, then the tarsus aimed at T.
   */
  placeFoot(leg, T, N, dir, { iters = 9, ankleUp = TUNE.ankleUp } = {}) {
    const f = this.fly;
    const A = this._ank || (this._ank = new THREE.Vector3());
    const L = this.tarsLen[leg] * 0.86;
    A.copy(T).addScaledVector(dir, -L).addScaledVector(N, ankleUp);
    f.reach(leg, A, { iters, tipBody: this.tarsBody[leg], joints: this.chainNoTarsus[leg] });
    f.reach(leg, T, { iters: 3, joints: this.chainTarsus[leg] });
    f.reach(leg, T, { iters: 6, joints: this.chainNoTarsus[leg] });   // close the gap, keep the tarsus aim
  }

  groundNormal(s, out) { const al = groundAngle(s); return out.set(-Math.sin(al), Math.cos(al), 0); }

  /** tarsus direction on the ground: away from the coxa, in the tangent plane */
  groundDir(leg, T, N, out) {
    this.fly.worldPos(leg + 'Coxa', out);
    out.subVectors(T, out);
    out.addScaledVector(N, -out.dot(N));
    const l = out.length();
    if (l < 1e-6) out.set(1, 0, 0); else out.multiplyScalar(1 / l);
    return out;
  }

  /** world point of ground coords (s, z) lifted by n along the local normal */
  ground(s, z, n, out) {
    groundPoint(s, out);
    const al = groundAngle(s);
    out.x += -Math.sin(al) * n;
    out.y += Math.cos(al) * n + 0.005;
    out.z = z;
    return out;
  }

  /** front foot target on the cube's back face */
  faceTarget(leg, cube, sg, u, tr, out) {
    const side = SIDE[leg];
    const c = Math.cos(cube.psi), s = Math.sin(cube.psi);
    // height along the face and lateral offset; reach higher in the teeter
    const hope = u >= T_TIP0 && u < U_FALL ? sstep(T_TIP0, T_FLAT, u) : 0;
    let hh = TUNE.faceH + 0.35 * hope + 0.05 * wob(sg * 1.7, side);
    // re-grip now and then: one leg slides up, the other holds
    const rg = Math.max(0, Math.sin(sg * 2.4 + (side > 0 ? 0 : Math.PI))) ** 16;
    hh += 0.18 * rg;
    const lat = side * (TUNE.faceLat + 0.04 * wob(sg, side + 5));
    // hang on through the slip
    out.set(cube.bx, cube.by, 0);
    out.x += -s * hh - c * TUNE.faceOut;
    out.y += c * hh - s * TUNE.faceOut;
    out.z = lat;
    // shaking hands
    out.x += 0.02 * tr * tremP(u, 15, side + 3);
    out.y += 0.02 * tr * tremP(u, 16, side + 4);
    return out;
  }

  /** place fly.root at ground coords with ride height h and extra pitch / roll */
  placeRoot(s, z, yaw, h, pitch, roll) {
    const f = this.fly;
    const al = frameAngle(s);
    groundPoint(s, this.v);
    const T = this.X.set(Math.cos(al), Math.sin(al), 0);
    const N = this.Y.set(-Math.sin(al), Math.cos(al), 0);
    f.root.position.set(this.v.x + N.x * h, this.v.y + N.y * h, z);
    // forward in the tangent plane
    const fw = this._fw.copy(T).multiplyScalar(Math.cos(yaw)).addScaledVector(this._up0, Math.sin(yaw));
    const rt = this.Z.crossVectors(fw, N).normalize();
    this.m.makeBasis(fw, N, rt);
    this.q.setFromRotationMatrix(this.m);
    this.e.set(roll, 0, pitch, 'ZYX');
    this.q2.setFromEuler(this.e);
    f.root.quaternion.copy(this.q).multiply(this.q2);
  }
}
