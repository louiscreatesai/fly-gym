// Sisyphus: "I made the fly push a sugar cube uphill for eternity".
// The fly shoves a sugar cube up a ramp, tasting it through its feet the whole way (flies have
// sugar taste neurons on their legs). At the lip the cube teeters ... and tumbles back down.
// Brain panel: the 'sugar' clip (sugar taste neurons -> MN9, the feeding motor neuron) plays
// whenever the front feet are on the cube.
//
// Loop (9 s, seamless):
//  0.0   cube ~90% up the ramp, fly leaning in, legs trembling, proboscis dabbing, taste ripples
//  1.6   cube's front goes over the lip, 1.79 it tips flat onto the plateau (plate flares): ALMOST
//  1.95  it rocks back; 2.0 brain stops, the fly flinches and ducks flat
//  2.08  cube rolls back over its edge, bounces high over the ducked fly, 2.5 / 2.69 bounces
//  2.86  crash on the floor (dust, crumbs, shake), 2.87 ATTEMPT FAILED, counter +1
//  2.56  fly lets go and slides down tail first; 2.99 grabs the cube's side (brain plays 'sugar')
//  3.15  gets up, crab-walks behind the cube, 3.66 front feet on the sugar, tastes, 3.9 headbutt
//  4.3   cube hits the foot of the ramp, 4.95 levered onto it, pushing up
//  6.1   SLIPS back a millimetre, 6.34 a hind leg stomps back, NOT TODAY, holds, keeps pushing
//
// Cameras: gym = follow camera (sisyphus/followCam.js, pure function of t, runs only while
// stage.current === 'gym'); front / close = static shots at the summit; wide = the whole hill (key 4).
import * as THREE from 'three';
import { HILL, groundY, buildWorld } from './sisyphus/world.js';
import { buildCube, CUBE_A } from './sisyphus/cube.js';
import { cubePose, support, PERIOD, IMPACTS, SLIP, T_TIP0, T_FLAT, U_WAKE } from './sisyphus/cubeMotion.js';
import { FlyRig } from './sisyphus/flyMotion.js';
import { FollowCam } from './sisyphus/followCam.js';

const ATTEMPT0 = 48211;
const EV = {
  tipBack: 2.0,        // cube rolls away: brain stop, phase 3
  failed: 2.87,        // crash at the bottom: ATTEMPT FAILED flash + counter
  grab: 2.99,          // front foot touches the cube again: brain play
};
const fmt = n => n.toLocaleString('en-US');

export default {
  pageTitle: 'Fly Gym · Sisyphus',
  cameras: {
    gym: { pos: [-10, 7, 6], target: [0.5, 2.8, 0], fov: 30 },      // follow camera; set to its t=0 framing in build()
    front: { pos: [5.40, 10.92, -11.31], target: [0.95, 3.5, -0.3], fov: 30 },
    close: { pos: [-1.35, 6.85, -10.26], target: [1.4, 4.0, 0], fov: 30 },
    wide: { pos: [-28.66, 17.66, -22.65], target: [-2.4, 1.05, -0.8], fov: 28 },   // whole hill (key 4)
  },
  defaultCam: 'gym',
  hud: {
    title: 'SUGAR CUBE · UPHILL', sub: 'SISYPHUS PROTOCOL',
    cams: [['gym', 'Gym view'], ['front', 'Front view'], ['close', 'Close-up']],
    stats: [{ key: 'att', label: 'ATTEMPT' }, { key: 'eat', label: 'SUGAR EATEN' }, { key: 'time', label: 'TIME', small: true }],
    phases: ['↑ PUSH', 'ALMOST', '↓ ROLLS BACK'],
    footer: 'NeuroMechFly body · articulated exercise animation · Methods',
  },

  async build(ctx) {
    this.world = buildWorld(ctx);
    this.cube = buildCube(ctx);
    this.rig = new FlyRig(ctx);
    this.rig.build();
    this.follow = new FollowCam(this.rig);
    this.follow.build();
    const c0 = this.follow.at(0);
    this.cameras.gym = { pos: c0.pos.toArray(), target: c0.tgt.toArray(), fov: this.cameras.gym.fov };
    this.cp = {};
    this.info = {};
    this._zAxis = new THREE.Vector3(0, 0, 1); this._n = new THREE.Vector3();
    const rippleGeo = new THREE.RingGeometry(0.62, 0.8, 40);
    this.ripples = [0, 1].map(() => {
      const m = new THREE.Mesh(rippleGeo, new THREE.MeshBasicMaterial({
        color: new THREE.Color(0xf0abfc).multiplyScalar(1.8), transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide }));
      m.renderOrder = 4; m.visible = false;
      ctx.scene.add(m);
      return m;
    });
    this.brainOn = false;
    // impact points for the dust (contact point under the cube at each impact)
    const tmp = {};
    this.impacts = IMPACTS.filter(im => im.dust > 0).map(im => {
      const c = cubePose(im.t + 1e-4, tmp);
      const al = im.surf === 'slope' ? HILL.theta : 0;
      const d = support(c.psi - al);
      return { t: im.t, x: c.cx + Math.sin(al) * d, y: c.cy - Math.cos(al) * d, z: 0, dust: im.dust, crumbs: !!im.crumbs };
    });
  },

  reset() { this.brainOn = false; },

  /** faint pink ripples on the sugar where the front tarsi press (they taste it) */
  tasteFx(u, t) {
    const f = this.rig.fly;
    for (let i = 0; i < 2; i++) {
      const r = this.ripples[i];
      const on = this.info.frontOnCube && this.cp.mode !== 'tumble';
      if (!on) { r.visible = false; continue; }
      const leg = i ? 'RF' : 'LF';
      f.tip(leg, r.position);
      const c = Math.cos(this.cp.psi), s = Math.sin(this.cp.psi);
      // on the cube's back face, facing the fly
      r.quaternion.setFromUnitVectors(this._zAxis, this._n.set(-c, -s, 0));
      r.position.addScaledVector(this._n, 0.02);
      const ph = ((t * 1.7 + i * 0.5) % 1);
      r.scale.setScalar(0.12 + 0.5 * ph);
      r.material.opacity = 0.75 * (1 - ph) * (1 - ph);
      r.visible = true;
    }
  },

  update(ctx, t, dt, prevT) {
    const u = ((t % PERIOD) + PERIOD) % PERIOD;
    const pu = ((prevT % PERIOD) + PERIOD) % PERIOD;
    const loops = Math.floor(t / PERIOD);
    const crossed = ev => (prevT < t) && (pu <= u ? (pu < ev && u >= ev) : (pu < ev || u >= ev));

    // ---- cube ----
    const c = cubePose(u, this.cp);
    const cb = this.cube;
    const al = c.alpha;
    const d = support(c.psi - al);
    cb.grp.position.set(c.cx + Math.sin(al) * d, c.cy - Math.cos(al) * d, 0);
    cb.grp.rotation.set(0, 0, al);
    cb.grp.scale.set(1 + c.sq * 0.55, 1 - c.sq, 1 + c.sq * 0.55);
    cb.spin.position.set(0, d, 0);
    cb.spin.rotation.set(0, 0, c.psi - al);
    cb.setTime(t, window.innerHeight);
    cb.impacts(u, this.impacts, groundY);

    // ---- fly + follow camera ----
    this.rig.pose(u, c, this.info);
    this.follow.apply(ctx.stage, u);
    // the goal lights up while the cube sits on the plateau ... and dies when it tips back
    const hope = u >= T_TIP0 + 0.1 && u < 2.3 ? Math.min(1, (u - T_TIP0 - 0.1) / 0.09) * (u < 1.97 ? 1 : Math.max(0, 1 - (u - 1.97) / 0.06) * (Math.sin(u * 90) > 0 ? 1 : 0.2)) : 0;
    this.world.update(t, hope);
    this.tasteFx(u, t);

    // ---- events ----
    const fails = loops + (u >= EV.failed ? 1 : 0);
    const brainWanted = u >= EV.grab || u < EV.tipBack;
    if (brainWanted !== this.brainOn) {
      if (brainWanted) ctx.brain.play('sugar', { loop: true, speed: 0.35 });
      else ctx.brain.stop();
      this.brainOn = brainWanted;
    }
    if (crossed(EV.failed)) ctx.hud.flash('ATTEMPT FAILED', { color: '#ff6b9a', ms: 1200, size: 0.92 });
    if (crossed(2.86)) ctx.stage.shake = 0.16;
    if (crossed(2.5)) ctx.stage.shake = 0.06;
    if (crossed(SLIP.catch + 0.02)) { ctx.stage.shake = 0.05; ctx.hud.flash('NOT TODAY', { color: '#5eead4', ms: 900, size: 0.7 }); }

    // ---- HUD ----
    let phase = 0, desc = 'Pushing the sugar uphill';
    if (u >= T_TIP0 - 0.1 && u < EV.tipBack) { phase = 1; desc = 'Almost there'; }
    else if (u >= EV.tipBack && u < U_WAKE + 0.6) { phase = 2; desc = 'It rolled back'; }
    ctx.hud.update({
      stats: { att: fmt(ATTEMPT0 + fails), eat: '0', time: 'DAY 9,999' },
      phase, progress: c.progress, desc,
      note: "tastes it through its feet · can't eat it",
      danger: phase === 2 && u < 2.9,
    });
  },
};
