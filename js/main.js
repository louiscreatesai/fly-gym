// Shell: loads the stage, the fly, the HUD, the brain panel and one scene module.
// URL: index.html?scene=legday|sisyphus|preworkout
//   &t=2.5      freeze the scene at 2.5 s (for screenshots)
//   &cam=front  start on a camera preset
//   &brain=0    no brain panel     &hud=0  no HUD     &guide=1  phone framing guide
//   &calm=0     loud mode: pop-up labels and camera shake (default is calm)
// Keys: 1/2/3 cameras, Space pause, R restart, H hide HUD+brain, G guide, F fullscreen, P fps, C calm/loud.
import * as THREE from 'three';
import { Stage, PALETTE } from './stage.js';
import { loadFly, LEGS } from './fly.js';
import { Hud } from './hud.js';

const params = new URLSearchParams(location.search);
const sceneName = params.get('scene') || 'legday';
const freezeAt = params.has('t') ? parseFloat(params.get('t')) : null;

async function main() {
  const stage = new Stage(document.getElementById('stage'), { bloom: params.get('bloom') !== '0' });
  const mod = await import(`./scenes/${sceneName}.js`);
  const S = mod.default;
  document.title = S.pageTitle || 'Fly Gym';

  const fly = await loadFly();
  const state = { t: freezeAt ?? 0, paused: freezeAt !== null };
  const hud = new Hud(document.getElementById('hud'), {
    onCam: k => stage.goto(k),
    onPause: () => { state.paused = !state.paused; hud.setPaused(state.paused); },
    onRestart: () => restart(),
  });

  // brain panel (built separately; the page still works without it)
  const brainEl = document.getElementById('brain');
  let brain = null;
  if (params.get('brain') !== '0') {
    try {
      const B = await import('./brain.js');
      brain = await B.createBrainPanel(brainEl, { scene: sceneName });
    } catch (e) {
      console.warn('brain panel not ready:', e);
      brainEl.className = 'placeholder';
      brainEl.textContent = 'brain panel loading…';
    }
  } else brainEl.style.display = 'none';
  const brainApi = brain || { play() {}, stop() {}, update() {}, resize() {} };
  // portrait screens: a button slides the brain panel in and out (CSS shows the button only there)
  const bb = document.createElement('button');
  bb.id = 'brainBtn';
  bb.textContent = 'Brain';
  bb.addEventListener('click', () => {
    const on = document.body.classList.toggle('show-brain');
    bb.textContent = on ? 'Fly' : 'Brain';
    requestAnimationFrame(() => brainApi.resize());
  });
  document.body.appendChild(bb);

  const extraFlies = [];
  const ctx = {
    THREE, stage, scene: stage.scene, camera: stage.camera, fly, hud, brain: brainApi, params, PALETTE, LEGS,
    flies: [fly],
    /** load another fly (e.g. a spotter); it is posed with fly.apply() by the shell each frame */
    async loadFly() { const f = await loadFly(); extraFlies.push(f); ctx.flies.push(f); return f; },
    /** true exactly once when scene time crosses tEvent (handles loops); use for brain.play / hud.flash */
    crossed(prevT, t, tEvent) { return prevT < tEvent && t >= tEvent; },
  };
  stage.scene.add(fly.root);
  await S.build(ctx);
  stage.setPresets(S.cameras);
  hud.configure(S.hud);
  const camKeys = Object.keys(S.cameras);
  const startCam = params.get('cam') || S.defaultCam || camKeys[0];
  stage.goto(startCam, 0);
  hud.setCam(startCam);
  if (params.get('hud') === '0') hud.show(false);
  if (params.get('guide') === '1') document.body.classList.add('show-guide');
  const setCalm = on => { stage.calm = on; document.body.classList.toggle('calm', on); };
  setCalm(params.get('calm') !== '0');
  document.getElementById('loading').remove();

  function restart() {
    state.t = 0; prevT = -1e-6;
    S.reset && S.reset(ctx);
    brainApi.stop();
  }

  window.addEventListener('keydown', e => {
    if (e.key >= '1' && e.key <= '9') {
      const k = camKeys[+e.key - 1];
      if (k) { stage.goto(k); hud.setCam(k); }
    } else if (e.key === ' ') { state.paused = !state.paused; hud.setPaused(state.paused); e.preventDefault(); }
    else if (e.key === 'r' || e.key === 'R') restart();
    else if (e.key === 'h' || e.key === 'H') document.body.classList.toggle('clean');
    else if (e.key === 'g' || e.key === 'G') document.body.classList.toggle('show-guide');
    else if (e.key === 'p' || e.key === 'P') document.body.classList.toggle('show-fps');
    else if (e.key === 'c' || e.key === 'C') setCalm(!stage.calm);
    else if (e.key === 'f' || e.key === 'F') {
      if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen();
    }
  });
  window.addEventListener('resize', () => brainApi.resize());

  // test hooks for screenshot scripts
  window.__setTime = t => { state.t = t; state.paused = true; step(0); };
  window.__ctx = ctx;

  let prevT = state.t - 1e-6;
  const fpsEl = document.getElementById('fps');
  let frames = 0, fpsT = performance.now(), worst = 0;

  function step(dt) {
    S.update(ctx, state.t, dt, prevT);
    prevT = state.t;
    for (const f of ctx.flies) f.apply();
  }

  // settle a frozen frame (scenes may smooth over a few frames)
  if (freezeAt !== null) for (let i = 0; i < 3; i++) step(1 / 60);

  let last = performance.now();
  function frame(now) {
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
    worst = Math.max(worst, now - last);
    last = now;
    if (!state.paused) { state.t += dt; step(dt); }
    brainApi.update(now / 1000);
    stage.render(dt);
    frames++;
    if (now - fpsT > 1000) {
      fpsEl.textContent = `${frames} fps · worst ${worst.toFixed(1)} ms · t ${state.t.toFixed(2)}`;
      frames = 0; fpsT = now; worst = 0;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  window.__ready = true;
}

main().catch(e => {
  console.error(e);
  const l = document.getElementById('loading');
  if (l) l.textContent = 'Error: ' + e.message;
});
