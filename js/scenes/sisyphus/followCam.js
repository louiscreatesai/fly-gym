// Follow camera for the gym view. A fixed low 3/4 direction from behind-right (downhill), so
// the hill rises to the right with the SUMMIT flag top-right. Distance and aim come from the
// fly's real projected extents: the fly fills ~60% of the phone strip with its feet above the HUD
// card. While the cube tumbles the shot pulls back to hold fly + cube, then whips after the
// slide. Built once from posed samples, smoothed circularly: a pure, seamless function of t.
import * as THREE from 'three';
import { cubePose, PERIOD } from './cubeMotion.js';
import { window4 } from './util.js';

const N = 1080;                      // playback table over the loop (120 Hz)
const S = 120;                       // posed samples used to build it

export const FOLLOW = {
  az: 146 * Math.PI / 180,           // camera direction from the target, azimuth (x toward +z)
  el: 17 * Math.PI / 180,            // elevation: low enough that the 27 deg slope reads
  fov: 30,
  flyFrac: 0.6,                      // fly width / strip width
  feetAt: 0.67,                      // lowest fly point, fraction of screen height from the top
  bothFrac: 0.8,                     // fly + cube span during the tumble pull-back
  topAt: 0.14,                       // keep the highest point below this (header)
  cubeBias: 0.2,                     // horizontal aim nudged toward the cube
  margin: 0.25,                      // mm around body origins (abdomen tip, wing tips)
};

export class FollowCam {
  constructor(rig) {
    this.rig = rig;
    this.tx = new Float32Array(N); this.ty = new Float32Array(N); this.tz = new Float32Array(N);
    this.dd = new Float32Array(N);
    this.pos = new THREE.Vector3(); this.tgt = new THREE.Vector3();
    this.fw = new THREE.Vector3(); this.rt = new THREE.Vector3(); this.up = new THREE.Vector3();
  }

  basis() {
    const F = FOLLOW, ce = Math.cos(F.el);
    this.fw.set(-ce * Math.cos(F.az), -Math.sin(F.el), -ce * Math.sin(F.az));          // camera looks along fw
    this.rt.crossVectors(this.fw, new THREE.Vector3(0, 1, 0)).normalize();
    this.up.crossVectors(this.rt, this.fw).normalize();
  }

  build() {
    const F = FOLLOW, fly = this.rig.fly;
    this.basis();
    const k = 0.5 / Math.tan(F.fov * Math.PI / 360);        // focal length in screen heights
    const stripW = 9 / 16;                                  // phone strip width in screen heights
    const cp = {}, info = {}, p = new THREE.Vector3();
    const bodies = Object.values(fly.bodies);
    const legs = ['LF', 'LM', 'LH', 'RF', 'RM', 'RH'];
    const sr = new Float32Array(S), sv = new Float32Array(S), sf = new Float32Array(S), sd = new Float32Array(S);
    for (let i = 0; i < S; i++) {
      const u = i * PERIOD / S;
      const c = cubePose(u, cp);
      this.rig.pose(u, c, info);
      fly.apply();
      let r0 = 1e9, r1 = -1e9, v0 = 1e9, v1 = -1e9, fsum = 0, n = 0;
      const add = q => {
        const r = q.dot(this.rt), v = q.dot(this.up);
        if (r < r0) r0 = r; if (r > r1) r1 = r; if (v < v0) v0 = v; if (v > v1) v1 = v;
        fsum += q.dot(this.fw); n++;
      };
      for (const b of bodies) add(b.getWorldPosition(p));
      for (const l of legs) add(fly.tip(l, p));
      r0 -= F.margin; r1 += F.margin; v0 -= F.margin * 0.5; v1 += F.margin;
      // hero rule: fly width -> distance, feet above the card, aim nudged toward the cube
      const cc = p.set(c.cx, c.cy, 0), cr = cc.dot(this.rt), cv = cc.dot(this.up);
      let d = (r1 - r0) * k / (F.flyFrac * stripW);
      let tr = (r0 + r1) / 2 * (1 - F.cubeBias) + cr * F.cubeBias;
      // tumble: pull back to hold both (a support radius of ~1.35 mm around the cube centre)
      const w = window4(1.98, 2.12, 2.95, 3.35, u);
      if (w > 0) {
        const R0 = Math.min(r0, cr - 1.35), R1 = Math.max(r1, cr + 1.35);
        const V0 = Math.min(v0, cv - 1.35), V1 = Math.max(v1, cv + 1.35);
        const dB = Math.max((R1 - R0) * k / (F.bothFrac * stripW), (V1 - V0) * k / (F.feetAt - F.topAt));
        d += (Math.max(d, dB) - d) * w;
        tr += ((R0 + R1) / 2 - tr) * w;
        v0 += (V0 - v0) * w;
      }
      sr[i] = tr;
      sv[i] = v0 + (F.feetAt - 0.5) * d / k;               // lowest point lands at feetAt
      sf[i] = fsum / n;
      sd[i] = d;
    }
    // to world targets, upsample to N, then smooth circularly (quick through the fall = whip)
    const rx = new Float32Array(N), ry = new Float32Array(N), rz = new Float32Array(N), rd = new Float32Array(N), sig = new Float32Array(N);
    for (let j = 0; j < N; j++) {
      const f = j * S / N, i0 = Math.floor(f), i1 = (i0 + 1) % S, a = f - i0;
      const L = A => A[i0] + (A[i1] - A[i0]) * a;
      p.set(0, 0, 0).addScaledVector(this.rt, L(sr)).addScaledVector(this.up, L(sv)).addScaledVector(this.fw, L(sf));
      rx[j] = p.x; ry[j] = p.y; rz[j] = p.z; rd[j] = L(sd);
      const u = j * PERIOD / N;
      sig[j] = u > 1.95 && u < 3.45 ? 0.07 : 0.2;
    }
    const smooth = (src, dst, scale) => {
      for (let i = 0; i < N; i++) {
        const s = sig[i] * scale * N / PERIOD, R = Math.ceil(3 * s);
        let acc = 0, ws = 0;
        for (let q = -R; q <= R; q++) { const w = Math.exp(-0.5 * (q / s) ** 2); acc += w * src[(i + q + N) % N]; ws += w; }
        dst[i] = acc / ws;
      }
    };
    smooth(rx, this.tx, 1); smooth(ry, this.ty, 1); smooth(rz, this.tz, 1); smooth(rd, this.dd, 1.3);
  }

  /** camera position + target at loop time u (writes this.pos / this.tgt) */
  at(u) {
    const f = ((u % PERIOD) + PERIOD) % PERIOD / PERIOD * N;
    const i0 = Math.floor(f) % N, i1 = (i0 + 1) % N, a = f - Math.floor(f);
    const L = A => A[i0] + (A[i1] - A[i0]) * a;
    this.tgt.set(L(this.tx), L(this.ty), L(this.tz));
    this.pos.copy(this.tgt).addScaledVector(this.fw, -L(this.dd));
    return this;
  }

  /** drive the stage camera when the gym preset is active (also steers a running tween) */
  apply(stage, u) {
    if (stage.current !== 'gym') return;
    this.at(u);
    if (stage.tween) { stage.tween.to.pos.copy(this.pos); stage.tween.to.target.copy(this.tgt); }
    else { stage.camera.position.copy(this.pos); stage.controls.target.copy(this.tgt); }
  }
}
