// "I gave the fly pre-workout for eternity": the fly dry-scoops pre-workout on a treadmill,
// the speed steps 4 -> 25 -> 60 -> 120 -> 200 -> 312 mph, the belt goes red-hot, snaps and
// whips off the back, the fly keeps running in mid-air, a white flash resets the loop.
// Gait: flygym's recorded step cycle in a tripod, corrected with IK so stance feet ride the belt.
import * as THREE from 'three';
import { Gait, GhostLegs, LEGS6, PHASE_OFF } from './preworkout/gait.js';
import { buildTreadmill, makeBeltMaterial, TM, TUB } from './preworkout/treadmill.js';
import { SpriteCloud, StreakCloud, BeltRibbon, FlashOverlay, hash } from './preworkout/fx.js';

// ------------------------------------------------------------------ timeline (seconds, loop time u)
const P = 9.0;            // loop period
const SCOOP_T = 0.24;     // powder hits the mouth
const SNAP = 6.6;         // belt snaps
const LOOK = 7.32;        // fly notices it is running on air
const FALL = 7.82;        // ... and drops
const RESET = 8.3;        // hidden by the white flash
const HEAT0 = 4.9, HEAT1 = 5.9, ERR_T = 5.9;
const STEPS = [
  { t: -9, mph: 4, hz: 6, lean: 0.0 },
  { t: 0.45, mph: 25, hz: 9.5, lean: 0.05 },
  { t: 1.6, mph: 60, hz: 13, lean: 0.1 },
  { t: 2.6, mph: 120, hz: 17, lean: 0.15 },
  { t: 3.6, mph: 200, hz: 21, lean: 0.2 },
  { t: 4.6, mph: 312, hz: 25, lean: 0.25 },
];
const RAMP = 0.26;
const V0 = 1.1;           // belt mm per gait cycle (stance feet move exactly this far)

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = x => { x = clamp(x); return x * x * (3 - 2 * x); };
const lerp = (a, b, k) => a + (b - a) * k;
const win = (u, a, b, fa = 0.1, fb = 0.1) => smooth((u - a) / fa) * (1 - smooth((u - b) / fb));
const fmt = n => n.toLocaleString('en-US');

function level(u, key) {
  if (u >= RESET) return STEPS[0][key];
  let v = STEPS[0][key];
  for (let i = 1; i < STEPS.length; i++) {
    const s = STEPS[i];
    if (u > s.t) v += (s[key] - STEPS[i - 1][key]) * smooth((u - s.t) / RAMP);
  }
  return v;
}
function stepIndex(u) {
  if (u >= RESET) return 0;
  let k = 0;
  for (let i = 1; i < STEPS.length; i++) if (u >= STEPS[i].t) k = i;
  return k;
}
/** gait frequency (Hz) */
function gaitHz(u) {
  if (u >= RESET) return STEPS[0].hz;
  let f = level(u, 'hz');
  f += 5 * smooth((u - SNAP) / 0.2);                 // legs spin even faster on air
  f *= 1 - smooth((u - LOOK) / 0.24);                // ... then stop dead
  return f;
}

// scoop choreography, in "scoop time" s = u (u < 3) or u - P (u >= RESET), so it runs across the wrap
// frame 1 (s = 0) shows the loaded scoop held up beside the fly's face (camera side), about to go in
const SC_REACH = -0.7, SC_GRAB = -0.44, SC_LIFT = -0.3, SC_PRES = -0.05, SC_MOUTH = 0.15, SC_TIP1 = 0.3, SC_BACK = 0.52, SC_FREE = 0.76;
const SCOOP_L = 0.6;      // grip to cup centre

export default {
  pageTitle: 'Fly Gym · pre-workout treadmill',
  cameras: {
    // framed for the phone strip: whole fly centred and as big as fits, feet just above the HUD card
    gym: { pos: [-12.18, 6.93, 6.2], target: [0.04, 1.93, -0.42], fov: 30 },
    front: { pos: [12.79, 3.0, -2.22], target: [0.23, 1.85, -0.3], fov: 30 },
    close: { pos: [-2.99, 5.23, 15.91], target: [0.35, 1.89, -0.12], fov: 26 },
  },
  defaultCam: 'gym',
  hud: {
    title: 'TREADMILL · PRE-WORKOUT', sub: 'DRY SCOOP PROTOCOL',
    cams: [['gym', 'Gym view'], ['front', 'Front view'], ['close', 'Close-up']],
    stats: [{ key: 'speed', label: 'SPEED', of: 'mph' }, { key: 'scoops', label: 'SCOOPS' }, { key: 'time', label: 'TIME', small: true }],
    phases: ['SCOOP', 'RUN', '???'],
    footer: 'NeuroMechFly body · flygym step cycle · articulated exercise animation · Methods',
  },

  async build(ctx) {
    const { scene, fly } = ctx;
    this.clip = null;
    const plat = ctx.stage.platform({ w: 12.5, d: 7.4 });
    plat.position.set(-0.4, 0, 0);
    scene.add(plat);

    // a few rig vertices have zero normals (femurs); lit translucent copies turn them into NaN
    // pixels that bloom smears over the whole screen. Give them the normal of a triangle neighbour.
    for (const name in fly.meshes) {
      const g = fly.meshes[name].geometry, n = g.attributes.normal.array, idx = g.index.array;
      let fixed = 0;
      for (let v = 0; v < n.length / 3; v++) {
        if (n[v * 3] || n[v * 3 + 1] || n[v * 3 + 2]) continue;
        for (let k = 0; k < idx.length; k++) if (idx[k] === v) {
          const t0 = k - (k % 3);
          for (let j = t0; j < t0 + 3; j++) { const w = idx[j]; if (n[w * 3] || n[w * 3 + 1] || n[w * 3 + 2]) { n[v * 3] = n[w * 3]; n[v * 3 + 1] = n[w * 3 + 1]; n[v * 3 + 2] = n[w * 3 + 2]; break; } }
          if (n[v * 3] || n[v * 3 + 1] || n[v * 3 + 2]) break;
        }
        if (!(n[v * 3] || n[v * 3 + 1] || n[v * 3 + 2])) n[v * 3 + 2] = 127;
        fixed++;
      }
      if (fixed) g.attributes.normal.needsUpdate = true;
    }

    const T = this.tm = buildTreadmill(ctx);
    scene.add(T.group);

    // gait tables (IK onto the belt), built once
    this.base = new THREE.Vector3(0.6, TM.Yb - 0.12, 0);
    this.gait = new Gait(fly, { beltY: TM.Yb + 0.012, base: this.base, pivot: new THREE.Vector3(0.5, 1.3, 0), V0, leans: [0, 0.13, 0.26] });
    this.ghosts = new GhostLegs(fly, this.gait, 5);

    // separate material for the real legs so they can fade into the blur
    this.legMat = fly.materials.body.clone();
    this.legMat.transparent = true;
    for (const L of LEGS6) for (const s of ['Coxa', 'Femur', 'Tibia', 'Tarsus1', 'Tarsus2', 'Tarsus3', 'Tarsus4', 'Tarsus5']) {
      for (const c of fly.bodies[L + s].children) if (c.isMesh) c.material = this.legMat;
    }
    this.eyeBase = { color: fly.materials.eye.emissive.clone(), k: fly.materials.eye.emissiveIntensity };

    // gait phase integral over the loop (1 ms table), so phase and belt travel are pure functions of t
    const n = Math.ceil(RESET * 1000) + 2;
    this.phi = new Float64Array(n);
    let acc = 0;
    for (let i = 1; i < n; i++) { acc += gaitHz((i - 0.5) / 1000) / 1000; this.phi[i] = acc; }

    // fx
    this.powder = new SpriteCloud(120, { soft: 1.3 });
    this.sparkle = new SpriteCloud(60, { additive: true, soft: 2.0 });
    this.smoke = new SpriteCloud(120, { soft: 1.2 });
    this.sparks = new StreakCloud(420);
    this.lines = new StreakCloud(140);
    this.glow = new SpriteCloud(4, { additive: true, soft: 1.6 });
    for (const s of [this.powder, this.sparkle, this.smoke, this.sparks, this.lines, this.glow]) scene.add(s.mesh);
    this.smoke.mesh.renderOrder = 5; this.powder.mesh.renderOrder = 6;
    this.ribbonMat = makeBeltMaterial({ fromUV: true });
    this.ribbon = new BeltRibbon(90, 2 * TM.W - 0.1, this.ribbonMat);
    scene.add(this.ribbon.mesh);
    this.flash = new FlashOverlay();

    // compile every program now (the snapped belt, ghost legs and particles would otherwise stall the first frame they appear)
    this.ribbon.mesh.visible = true;
    for (const c of this.ghosts.copies) for (const L in c) c[L].root.visible = true;
    ctx.stage.renderer.compile(scene, ctx.camera);
    // ANGLE/D3D11 still finalises shaders on the first real draw, so draw one frame with everything shown
    this.ribbon.write((s, c, side) => { c.set(TM.XB + s * TM.len, TM.Yb + 0.3, 0); side.set(0, 0, 1); });
    ctx.stage.renderer.render(scene, ctx.camera);
    if (ctx.stage.composer) ctx.stage.composer.render(0);
    this.ribbon.mesh.visible = false;
    for (const c of this.ghosts.copies) for (const L in c) c[L].root.visible = false;

    // scoop resting pose in the tub
    this.cupRest = new THREE.Vector3(TUB.x - 0.02, TUB.top - 0.1, TUB.z - 0.02);
    this.dRest = new THREE.Vector3(0.6, -0.5, 0.62).normalize();          // grip -> cup
    this.gripRest = this.cupRest.clone().addScaledVector(this.dRest, -SCOOP_L);
    this.dPres = new THREE.Vector3(0.15, 0.25, 0.95).normalize();
    this.v = { a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), d: new THREE.Vector3(), m: new THREE.Vector3(),
      up: new THREE.Vector3(), g: new THREE.Vector3(), x: new THREE.Vector3(), y: new THREE.Vector3(), z: new THREE.Vector3(),
      mat: new THREE.Matrix4(), q: new THREE.Quaternion() };
    this.skipRF = new Set(['RF']);

    // let the browser catch up after the long build, so the shell's first frame gets a fresh timestamp
    // (a stale rAF time right after a long task gives a negative first dt and the scene would start at t < 0)
    for (let i = 0; i < 3; i++) await new Promise(r => requestAnimationFrame(r));
  },

  reset(ctx) { this.clip = null; },

  /** gait phase (cycles) */
  phase(u) {
    if (u >= RESET) return -STEPS[0].hz * (P - u);
    const x = u * 1000, i = Math.floor(x), f = x - i;
    return this.phi[i] * (1 - f) + this.phi[Math.min(i + 1, this.phi.length - 1)] * f;
  },

  update(ctx, t, dt, prevT) {
    const { fly, hud } = ctx;
    const u = ((t % P) + P) % P;
    const loop = Math.floor(t / P);
    const T = this.tm, V = this.v;
    const live = dt > 0 && t - prevT < 0.25;
    const fired = ev => live && Math.floor((t - ev) / P) > Math.floor((prevT - ev) / P);

    // ---------------------------------------------------------------- speed state
    const k = stepIndex(u);
    const hz = gaitHz(u);
    const Phi = this.phase(u);
    const mph = level(u, 'mph');
    const snapped = u >= SNAP && u < RESET;
    let lean = level(u, 'lean');
    if (u >= LOOK && u < RESET) lean = lerp(lean, 0.05, smooth((u - LOOK) / 0.3));
    const blur = smooth((hz - 11) / 9);
    const beltV = V0 * hz;                               // mm/s
    const heat = u < RESET ? smooth((u - HEAT0) / (HEAT1 - HEAT0)) : 0;
    const flick = heat * (0.5 + 0.5 * Math.sin(u * 53) * Math.sin(u * 31.7));

    // ---------------------------------------------------------------- fly body
    const sT = u >= RESET ? u - P : u;                   // scoop time
    const holdW = u >= RESET || u < 2 ? smooth((sT - SC_REACH) / 0.24) * (1 - smooth((sT - SC_BACK) / (SC_FREE - SC_BACK))) : 0;
    let fallY = 0;
    if (u >= FALL && u < RESET) { const a = u - FALL; fallY = -Math.min(0.9, 0.5 * 9 * a * a); }
    // at full speed the whole body buzzes a little (feet are a blur by then, so contact still reads)
    const jit = 0.018 * blur * (u < LOOK ? 1 : 0);
    V.a.set(jit * Math.sin(u * 97), fallY + jit * Math.sin(u * 131 + 2), jit * 0.6 * Math.sin(u * 89 + 1));
    fly.setPose(fly.tripod);
    this.gait.placeRoot(lean, Phi, V.a);
    for (const L of LEGS6) this.gait.poseLeg(L, Phi, lean);

    // head: gait bob, tuck at speed, snap back on the dry scoop, look down into the pit, look at camera
    const snapBack = Math.exp(-Math.max(0, sT - SCOOP_T) / 0.35) * smooth((sT - SCOOP_T + 0.05) / 0.07);
    const lookDown = u < RESET ? smooth((u - LOOK) / 0.18) : 0;
    const lookCam = u < RESET ? smooth((u - (LOOK + 0.24)) / 0.14) : 0;
    const shiver = 0.03 * blur * Math.sin(u * 91);
    fly.set('joint_Head', 0.06 * blur + 0.03 * Math.sin(Phi * 4 * Math.PI) - 0.62 * snapBack + 0.5 * lookDown * (1 - 0.5 * lookCam) + shiver);
    fly.set('joint_Head_roll', 0.45 * lookCam);
    fly.set('joint_Head_yaw', 0.08 * Math.sin(u * 7.3) * (1 - blur) - 0.12 * lookCam);
    // antennae: shoot up on the scoop, blown back by the wind, droop when it looks down
    const wind = clamp((mph - 20) / 250) * (1 - lookDown);
    const flutter = Math.sin(u * 83) * 0.12 * wind + Math.sin(u * 131) * 0.06 * wind;
    const up = snapBack;
    for (const [s, sg] of [['L', 1], ['R', -1]]) {
      fly.set(`joint_${s}Pedicel`, -0.95 * up - 0.6 * wind + 0.5 * lookDown);
      fly.set(`joint_${s}Pedicel_roll`, sg * (0.25 * up + 0.1 * wind));
      fly.set(`joint_${s}Funiculus`, -0.3 * up - 0.45 * wind + flutter);
      fly.set(`joint_${s}Arista`, -0.3 * up - 0.4 * wind + flutter * 1.5);
    }
    // abdomen breathes, streams back at speed
    const breath = Math.sin(u * 2 * Math.PI * (1.2 + 1.8 * blur));
    fly.set('joint_A1A2', 0.03 * breath - 0.05 * blur);
    fly.set('joint_A3', 0.03 * breath - 0.04 * blur);
    fly.set('joint_A4', 0.02 * breath);
    // mouthparts open for the scoop
    const gulp = win(sT, SC_MOUTH - 0.06, SC_TIP1 + 0.05, 0.06, 0.12);
    fly.set('joint_Rostrum', 0.35 * gulp);
    fly.set('joint_Haustellum', -0.5 * gulp);
    // wings: twitch at 60, buzz from 120, fold when it realises
    const buzz = u < RESET ? smooth((mph - 90) / 60) * (1 - smooth((u - (LOOK + 0.05)) / 0.15)) : 0;
    const twitch = u < RESET ? smooth((mph - 40) / 30) * (1 - buzz) : 0;
    fly.setWings({
      spread: 0.05 + 0.18 * twitch * (0.5 + 0.5 * Math.sin(u * 23)) + 0.95 * buzz,
      pitch: 0.06 + 0.2 * buzz,
      flap: buzz * 0.5 * Math.sin(u * 2 * Math.PI * 27.3),
    });
    // eyes glow after the scoop, brighter with speed
    const eyeK = u >= RESET ? 0 : (sT < SCOOP_T ? 0 : 1);
    const eyeGlow = eyeK * (0.45 + 0.9 * clamp((mph - 25) / 287) + 1.3 * Math.exp(-(sT - SCOOP_T) / 0.25)) * (1 - 0.7 * lookDown);
    const em = fly.materials.eye;
    em.emissive.setRGB(0.9, 0.08, 0.02);
    em.emissiveIntensity = this.eyeBase.k + eyeGlow;
    if (eyeGlow <= 0) em.emissive.copy(this.eyeBase.color);
    fly.apply();

    // ---------------------------------------------------------------- scoop + right front leg
    const mouth = fly.worldPos('Haustellum', V.m);
    mouth.x += 0.16; mouth.y -= 0.02; mouth.z += 0.02;
    let held = holdW > 0.999 || (sT > SC_GRAB && sT < SC_BACK);
    // grip path
    const grip = V.g, d = V.d, upv = V.up.set(0, 1, 0);
    const dMouth = V.c.set(-0.42, -0.12, -0.9).normalize();
    let roll = 0;
    if (sT < SC_GRAB) { grip.copy(this.gripRest); d.copy(this.dRest); }
    else if (sT < SC_LIFT) {                                   // dig into the tub
      const k2 = (sT - SC_GRAB) / (SC_LIFT - SC_GRAB);
      grip.copy(this.gripRest); grip.y -= 0.07 * Math.sin(Math.PI * k2); d.copy(this.dRest);
    } else if (sT < SC_MOUTH) {
      // present it beside the face on the camera side (cup up, heap showing), then swing it in
      const pc = V.x.copy(mouth).add(V.y.set(0.12, 0.28, 0.72));
      const gp = pc.addScaledVector(this.dPres, -SCOOP_L);
      const gm = V.b.copy(mouth).addScaledVector(dMouth, -SCOOP_L);
      if (sT < SC_PRES) {
        const k2 = smooth((sT - SC_LIFT) / (SC_PRES - SC_LIFT));
        grip.lerpVectors(this.gripRest, gp, k2); grip.y += 0.25 * Math.sin(Math.PI * k2);
        d.copy(this.dRest).lerp(this.dPres, k2).normalize();
      } else {
        const k2 = smooth((sT - SC_PRES) / (SC_MOUTH - SC_PRES));
        grip.lerpVectors(gp, gm, k2);
        d.copy(this.dPres).lerp(dMouth, k2).normalize();
      }
    } else if (sT < SC_TIP1) {                                 // tip it in
      grip.copy(mouth).addScaledVector(dMouth, -SCOOP_L);
      d.copy(dMouth);
      roll = -1.9 * smooth((sT - SC_MOUTH) / 0.09);
    } else if (sT < SC_BACK) {                                 // toss it back into the tub
      const k2 = smooth((sT - SC_TIP1) / (SC_BACK - SC_TIP1));
      const gm = V.b.copy(mouth).addScaledVector(dMouth, -SCOOP_L);
      grip.lerpVectors(gm, this.gripRest, k2); grip.y += 0.22 * Math.sin(Math.PI * k2);
      d.copy(dMouth).lerp(this.dRest, k2).normalize();
      roll = -1.9 * (1 - k2);
    } else { grip.copy(this.gripRest); d.copy(this.dRest); }
    if (holdW > 0.001) {
      const gaitTip = fly.tip('RF', V.a);
      const tgt = V.b.copy(gaitTip).lerp(grip, holdW);
      fly.reach('RF', tgt, { iters: 10 });
      if (held) grip.copy(fly.tip('RF', V.a));
    }
    // scoop transform: x = d, y = cup opening, rolled about d
    const X = V.x.copy(d);
    const Y = V.y.copy(upv).addScaledVector(X, -upv.dot(X)).normalize();
    if (roll) Y.applyAxisAngle(X, roll);
    const Z = V.z.crossVectors(X, Y);
    V.mat.makeBasis(X, Y, Z).setPosition(grip);
    T.scoop.matrixAutoUpdate = false;
    T.scoop.matrix.copy(V.mat);
    T.scoop.matrixWorldNeedsUpdate = true;
    T.heap.visible = !(sT >= SCOOP_T && u < RESET);

    // ---------------------------------------------------------------- ghost legs + blur
    const spread = Math.min(0.92, 0.1 + hz / 60 * 1.5);
    const skip = holdW > 0.001 ? this.skipRF : null;
    this.ghosts.update(Phi, lean, blur, spread, skip);
    this.legMat.opacity = 1 - 0.5 * blur;
    this.legMat.depthWrite = blur < 0.3;

    // ---------------------------------------------------------------- treadmill
    const U = T.beltMat.userData.U;
    const D = V0 * Phi;
    U.uOff.value = D;
    U.uBlur.value = 0.55 * beltV / 60;
    U.uHeat.value = heat;
    U.uFlick.value = flick;
    T.beltTop.visible = T.beltUnder.visible = T.wrapBack.visible = !snapped;
    T.beltWrapMat.emissiveIntensity = heat * 1.6;
    for (const r of T.rollers) r.rotation.z = D / (TM.R * 0.9);
    // readout: counts up after each step, then 312 / Err flicker, then fault
    let shown = level(u, 'mph'), ts = STEPS[k].t;
    const since = u - ts;
    if (k > 0 && since < 0.24) shown = lerp(STEPS[k - 1].mph, STEPS[k].mph, since / 0.24);
    const show = Math.round(shown);
    let text = String(show).padStart(4, ' '), label = 'SPEED', alarm = false;
    if (u >= ERR_T && u < SNAP && Math.floor(u * 7) % 2) { text = ' Err'; alarm = true; label = 'BELT TEMP'; }
    if (snapped) { text = ' Err'; alarm = Math.floor(u * 5) % 2 === 0; label = 'BELT FAULT'; }
    const col = alarm || show >= 300 ? '#ff5040' : show >= 100 ? '#ff8af2' : '#5ef0ff';
    T.screen.draw(text, label, col, snapped ? 1 : clamp(shown / 312), alarm);
    const bump = k > 0 ? Math.exp(-Math.max(0, since) / 0.09) * (since >= 0 ? 1 : 0) : 0;
    const scrK = 1.4 + 1.8 * bump + (u >= ERR_T && u < RESET ? 0.5 * Math.sin(u * 40) : 0);
    T.screenMat.color.setRGB(scrK, scrK, scrK);
    T.console.scale.setScalar(1 + 0.05 * bump);
    // the machine starts to rattle at 200+ and shakes itself apart while the belt cooks
    const rattle = u < RESET ? clamp((mph - 150) / 160) * 0.5 + heat * 0.8 + (snapped ? 0.6 * Math.exp(-(u - SNAP) / 0.4) : 0) : 0;
    T.console.rotation.x = rattle * 0.035 * Math.sin(u * 71);
    T.console.rotation.y = rattle * 0.03 * Math.sin(u * 53 + 1);

    // ---------------------------------------------------------------- fx
    this.updatePowder(u, sT, mouth);
    this.updateLines(u, mph, D, snapped, lookDown);
    this.updateSparks(u, heat);
    this.updateRibbon(u);
    // white flash: glow burst at the fly, then the screen goes white, reset, fade back in
    const fl = u < RESET ? smooth((u - 7.98) / 0.22) : 1 - smooth((u - 8.4) / 0.36);
    this.flash.set(fl);
    this.glow.begin();
    const gb = smooth((u - 7.8) / 0.3) * (u < RESET ? 1 : 0);
    if (gb > 0) { const tp = fly.worldPos('Thorax', V.a); this.glow.push(tp.x, tp.y, tp.z, 2 + 14 * gb, 1.6, 1.3, 1.5, gb); }
    this.glow.end();

    // ---------------------------------------------------------------- camera shake
    if (dt > 0) {
      let sh = 0;
      if (k > 0 && since < 0.3) sh = Math.max(sh, 0.05 * (1 - since / 0.3) * (0.6 + k * 0.15));
      sh = Math.max(sh, 0.05 * heat * (u < SNAP ? 1 : 0));
      if (u >= SNAP && u < SNAP + 0.5) sh = Math.max(sh, 0.28 * (1 - (u - SNAP) / 0.5));
      if (snapped && u < LOOK) sh = Math.max(sh, 0.03);
      ctx.stage.shake = Math.max(ctx.stage.shake, sh);
    }

    // ---------------------------------------------------------------- HUD + brain
    let clip = 'run1';
    if (u < RESET) { if (u >= STEPS[4].t) clip = 'run4'; else if (u >= STEPS[3].t) clip = 'run3'; else if (u >= STEPS[2].t) clip = 'run2'; }
    if (clip !== this.clip) { ctx.brain.play(clip, { loop: true }); this.clip = clip; }
    if (fired(STEPS[3].t + 0.05)) hud.flash('120 MPH', { color: '#f0abfc', ms: 1100 });
    if (fired(SNAP)) hud.flash('BELT FAILURE', { color: '#ff5a5a', ms: 1300, size: 0.9 });

    const scoops = 4111 + loop + (u >= SCOOP_T ? 1 : 0);
    const phaseIx = (u >= RESET || u < 0.45) ? 0 : (u < ERR_T ? 1 : 2);
    let desc = 'Running on pure pre-workout';
    if (u >= 5.35 && u < SNAP) desc = 'Belt overheating';
    else if (snapped && u >= SNAP + 0.35 && u < LOOK) desc = 'Still running · on air';
    else if (snapped) desc = 'Belt failure';
    hud.update({
      stats: { speed: snapped ? 'ERR' : String(STEPS[k].mph), scoops: fmt(scoops), time: 'DAY 812' },
      phase: phaseIx,
      progress: snapped ? 1 : clamp(shown / 312),
      desc,
      note: 'no caffeine modeled · walking neurons driven harder each scoop',
      danger: u >= 5.35 && u < RESET,
    });
  },

  // ------------------------------------------------------------------ fx helpers
  updatePowder(u, sT, mouth) {
    const pw = this.powder, sp = this.sparkle;
    pw.begin(); sp.begin();
    const age0 = sT - SCOOP_T;
    if (age0 > -0.02 && age0 < 1.3) {
      // the burst origin is fixed at the scoop moment: mouth position is close enough and stable
      const ox = mouth.x + 0.05, oy = mouth.y + 0.02, oz = mouth.z;
      for (let i = 0; i < 118; i++) {
        const delay = hash(i, 1) * 0.1;
        const a = age0 - delay;
        const life = 0.55 + 0.45 * hash(i, 2);
        if (a < 0 || a > life) continue;
        const th = hash(i, 3) * Math.PI * 2, ph = Math.acos(2 * hash(i, 4) - 1);
        const sp0 = 2.0 + 4.0 * hash(i, 5);
        let vx = Math.sin(ph) * Math.cos(th) * sp0 + 1.8, vy = Math.cos(ph) * sp0 * 0.8 + 1.5, vz = Math.sin(ph) * Math.sin(th) * sp0 + 1.0;
        const drag = (1 - Math.exp(-a * 4.0)) / 4.0;             // integrated velocity with drag
        const windX = -3.4 * a * a;                              // running wind pushes it back
        const x = ox + vx * drag + windX, y = oy + vy * drag - 0.3 * a * a, z = oz + vz * drag;
        const k = a / life;
        const size = 0.12 + 0.75 * Math.sqrt(k) * (0.6 + 0.8 * hash(i, 6));
        const alpha = 0.8 * (1 - k) * (1 - k) * smooth(a / 0.04);
        const shade = 0.85 + 0.3 * hash(i, 7);
        pw.push(x, y, z, size, 1.0 * shade, 0.36 * shade, 0.82 * shade, alpha);
        if (i < 58) {
          const sa = (1 - k) * smooth(a / 0.03);
          sp.push(x + 0.05, y, z, 0.07 + 0.06 * hash(i, 8), 3.2, 1.0, 2.6, sa);
        }
      }
    }
    pw.end(); sp.end();
  },

  updateLines(u, mph, D, snapped, lookDown) {
    const L = this.lines;
    L.begin();
    const dens = u < RESET ? smooth((mph - 30) / 200) * (1 - smooth((u - LOOK) / 0.25)) : 0;
    const N = 130;
    const cnt = Math.floor(N * dens);
    const travel = D * 4.5;
    const len = 0.6 + 2.8 * clamp((mph - 30) / 280);
    for (let i = 0; i < cnt; i++) {
      const r1 = hash(i, 11), r2 = hash(i, 12), r3 = hash(i, 13);
      let y = 0.9 + 3.6 * r1, z = -3.6 + 7.2 * r2;
      if (Math.abs(z) < 1.4 && y < 2.8) z = Math.sign(z || 1) * (1.4 + Math.abs(z) * 0.8);
      const span = 17;
      const x = 7.5 - ((r3 * span + travel * (0.8 + 0.5 * hash(i, 14))) % span);
      const fade = smooth((7.5 - x) / 2) * smooth((x + 9.5) / 2) * dens;
      const b = 0.55 * fade * (0.5 + 0.5 * hash(i, 15));
      L.push(x, y, z, x + len, y, z, 0.012 + 0.012 * hash(i, 16), b * 0.75, b * 0.85, b * 1.3);
    }
    L.end();
  },

  updateSparks(u, heat) {
    const S = this.sparks, sm = this.smoke;
    S.begin(); sm.begin();
    const rate = u < RESET ? smooth((u - 5.15) / 0.7) * (1 - smooth((u - (SNAP + 0.5)) / 0.4)) : 0;
    const life = 0.5;
    const X0 = TM.XB - TM.R * 0.55, Y0 = TM.Yb - 0.02;
    for (let i = 0; i < 170; i++) {
      const off = (i / 170) * life;
      const gen = Math.floor((u - off) / life);
      const t0 = gen * life + off;
      const a = u - t0;
      const emit = u < RESET ? smooth((t0 - 5.15) / 0.7) * (1 - smooth((t0 - (SNAP + 0.5)) / 0.4)) : 0;
      if (hash(i, gen, 1) > emit) continue;
      const z = (hash(i, gen, 2) * 2 - 1) * (TM.W - 0.1);
      const vx = -(1.5 + 4 * hash(i, gen, 3)), vy = 2 + 5 * hash(i, gen, 4), vz = (hash(i, gen, 5) - 0.3) * 4;
      const g = -22;
      const x = X0 + vx * a, y = Y0 + vy * a + 0.5 * g * a * a, zz = z + vz * a;
      if (y < 0.02) continue;
      const dtS = 0.028;
      const px = X0 + vx * (a - dtS), py = Y0 + vy * (a - dtS) + 0.5 * g * (a - dtS) * (a - dtS), pz = z + vz * (a - dtS);
      const k = a / life;
      const br = (1 - k) * 1.0;
      S.push(x, y, zz, px, py, pz, 0.018, 4.0 * br, 1.7 * br, 0.45 * br);
    }
    // snap burst at the break line (front of the belt) and at the back roller
    const sa = u - SNAP;
    if (sa > 0 && sa < 0.7) {
      for (let i = 0; i < 80; i++) {
        const front = i < 40;
        const ox = front ? TM.XF - 0.1 : TM.XB - 0.1, oy = TM.Yb + 0.02;
        const z = (hash(i, 31) * 2 - 1) * TM.W;
        const vx = front ? -(1 + 5 * hash(i, 32)) : -(3 + 7 * hash(i, 32)), vy = 2 + 6 * hash(i, 33), vz = (hash(i, 34) - 0.5) * 6;
        const a = sa * (0.8 + 0.4 * hash(i, 35));
        const x = ox + vx * a, y = oy + vy * a - 11 * a * a, zz = z + vz * a;
        if (y < 0.02) continue;
        const br = 1 - sa / 0.7;
        S.push(x, y, zz, x - vx * 0.03, y - (vy - 22 * a) * 0.03, zz - vz * 0.03, 0.022, 4.5 * br, 2.2 * br, 0.6 * br);
      }
    }
    // friction sparks off every stance foot on the red-hot belt
    const fl = 0.3, G = this.gait, P0 = this.v.a;
    for (let i = 0; i < 150; i++) {
      const off = (i / 150) * fl;
      const gen = Math.floor((u - off) / fl);
      const t0 = gen * fl + off;
      const a = u - t0;
      if (!(t0 < SNAP && t0 >= 0)) continue;
      const emit = smooth((t0 - 5.0) / 0.7);
      if (hash(i, gen, 61) > emit) continue;
      const L = LEGS6[i % 6];
      const ph = this.phase(t0) + PHASE_OFF[L], p = ph - Math.floor(ph);
      if (p < G.swingEnd[L]) continue;                 // only feet that are down
      G.footTarget(L, p, P0);
      const vx = -(4 + 7 * hash(i, gen, 62)), vy = 1.2 + 3.5 * hash(i, gen, 63), vz = (hash(i, gen, 64) - 0.5) * 3 + Math.sign(P0.z) * 0.8;
      const x = P0.x + vx * a, y = P0.y + vy * a - 11 * a * a, z = P0.z + vz * a;
      if (y < TM.Yb) continue;
      const k = a / fl, br = (1 - k) * 1.1;
      const dtS = 0.022;
      S.push(x, y, z, x - vx * dtS, y - (vy - 22 * a) * dtS, z - vz * dtS, 0.014, 4.2 * br, 2.0 * br, 0.5 * br);
    }
    S.end();
    // smoke: pours off the back roller, rises off the hot belt, then out of the pit
    const sl = 1.7;
    for (let i = 0; i < 110; i++) {
      const off = (i / 110) * sl;
      const gen = Math.floor((u - off) / sl);
      const t0 = gen * sl + off;
      const a = u - t0;
      const emit = t0 < RESET ? smooth((t0 - 5.0) / 0.8) * (1 - smooth((t0 - 7.6) / 0.3)) : 0;
      if (hash(i, gen, 41) > emit * 0.95) continue;
      const src = hash(i, gen, 47);
      const fromBelt = src < 0.55;
      const z = (hash(i, gen, 42) * 2 - 1) * (TM.W - 0.2);
      const x0 = fromBelt ? TM.XB + 0.6 + hash(i, gen, 48) * (TM.len - 1.6) : TM.XB - 0.15;
      const rise = fromBelt ? 0.55 + 0.5 * hash(i, gen, 44) : 0.9 + 0.7 * hash(i, gen, 44);
      const drift = (fromBelt && t0 < SNAP ? 1.6 : 0.9) + 0.8 * hash(i, gen, 43);
      const x = x0 - drift * a - 0.25 * a * a, y = TM.Yb - 0.02 + rise * a, zz = z + (hash(i, gen, 45) - 0.5) * 0.6 * a;
      const k = a / sl;
      const size = (fromBelt ? 0.2 : 0.3) + 1.4 * Math.sqrt(k);
      const alpha = (fromBelt ? 0.32 : 0.5) * Math.sin(Math.PI * Math.min(1, k * 1.15)) * (0.6 + 0.4 * hash(i, gen, 46));
      const hot = Math.max(0, 1 - k * 2.5) * heat;
      const g0 = 0.3 + 0.1 * hash(i, gen, 49);
      sm.push(x, y, zz, size, g0 + 0.55 * hot, g0 * 0.95 + 0.12 * hot, g0 + 0.02 * hot, alpha);
    }
    sm.end();
  },

  updateRibbon(u) {
    const R = this.ribbon;
    const a = u - SNAP;
    if (!(a >= 0 && a < 0.95 && u < RESET)) { R.mesh.visible = false; return; }
    R.mesh.visible = true;
    const RU = this.ribbonMat.userData.U;
    RU.uOff.value = V0 * this.phase(SNAP);            // same slats as the belt had
    RU.uBlur.value = 0.2; RU.uHeat.value = 0.75 * (1 - smooth(a / 0.9)); RU.uFlick.value = 0.4;
    const Lb = TM.len, vb = 15;                       // the back roller keeps dragging it backward
    const X0 = TM.XB - 0.05, Yr = TM.Yb + 0.02;
    const gone = Math.max(0, a - Lb / vb);            // once it has all left the deck it flies away
    // throw direction off the roller: back at first, then up and out toward the camera side
    const kk = smooth(a / 0.4);
    const Dx = lerp(-1, -0.35, kk), Dy = lerp(0.35, 0.85, kk), Dz = lerp(0.15, 0.62, kk);
    const Dn = Math.hypot(Dx, Dy, Dz), dx = Dx / Dn, dy = Dy / Dn, dz = Dz / Dn;
    R.write((s, c, side) => {
      // s = 0 at the back roller end of the top run, 1 at the torn front end
      const p = s * Lb - vb * a;                      // distance ahead of the back roller along the old belt
      side.set(0, 0, 1);
      if (p >= 0) {                                   // still on the deck: rippling as it is dragged
        const amp = 0.32 * smooth(a / 0.1) * Math.min(1, p / 1.2);
        c.set(X0 + p, Yr + Math.abs(Math.sin(p * 2.1 - a * 34)) * amp, 0);
      } else {                                        // thrown off the back: a whip with a travelling wave
        const q = -p;
        const env = Math.min(1, q / 1.3);
        const w = Math.sin(q * 1.5 - a * 30) * 0.55 * env, w2 = Math.sin(q * 1.1 - a * 19 + 1) * 0.4 * env;
        c.set(X0 + dx * q * 0.95 + w * 0.45, Yr + dy * q * 0.95 + w, dz * q * 0.95 + w2);
        side.set(-dz * 0.6, Math.sin(q * 0.8 - a * 11) * 0.4, 1).normalize();
      }
      c.x -= 3 * gone; c.y += 6 * gone; c.z += 3 * gone;
    });
  },
};
