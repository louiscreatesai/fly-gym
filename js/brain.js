// Brain panel: "Inside the fly brain".
// Janelia MaleCNS v1.0 skeletons (CC BY 4.0) as a glowing point cloud, replaying REAL spikes from engine runs
// (Shiu et al. 2024 LIF model on MaleCNS). Nothing here invents a spike: every flash, raster dot, count and bar
// comes from assets/brain/<scene>_<clip>.bin written by tools/export_brain.py.
//
//   const brain = await createBrainPanel(asideEl, { scene: 'legday' });
//   brain.play('push');  brain.stop();  brain.update(nowSeconds);  brain.resize();
//
// The aside must have a size (the shell sets it). Everything is drawn inside it.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const FONT_URL = new URL('../assets/fonts/inter-latin.woff2', import.meta.url).href;
const ACT_W = 128;                 // activity texture width (slots per row)
const TAU_LEVEL = 0.16;            // s (screen time): flash fade
const TAU_HEAT = 0.04;             // s: white-hot core of a fresh spike
const AUTO_SPIN = 0.11;            // rad/s about the vertical axis (~57 s per turn)
const FOV = 22;
const ELEV = 0.10;                 // rad, camera a little above
const BIN = 15;                    // ms per raster bin / count window
const FONT = "'InterBP', 'Inter', 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif";

const fmt = n => Math.round(n).toLocaleString('en-US');
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const SUPER = {
  descending_neuron: 'descending', ascending_neuron: 'ascending', vnc_motor: 'motor', cb_motor: 'motor',
  vnc_sensory: 'sensory', cb_sensory: 'sensory', ol_sensory: 'sensory', sensory_ascending: 'sensory',
  cb_intrinsic: 'central brain', ol_intrinsic: 'optic lobe', vnc_intrinsic: 'nerve cord',
  visual_projection: 'visual projection', visual_centrifugal: 'visual centrifugal',
};

// ---------------------------------------------------------------------------------------------- CSS
const CSS = `
@font-face { font-family: 'InterBP'; src: url(${FONT_URL}) format('woff2'); font-weight: 100 900; font-display: block; }
.bp { --s: 1; --teal: #2dd4bf; --teal2: #5eead4; --gold: #fbbf24; --pink: #f472b6;
  --ink: #eaf2ff; --ink2: rgba(206, 222, 250, .78); --ink3: rgba(176, 196, 236, .58); --line: rgba(150, 190, 255, .16);
  position: absolute; inset: 0; box-sizing: border-box; display: flex; flex-direction: column;
  padding: calc(20px * var(--s)) calc(20px * var(--s)) calc(15px * var(--s));
  font-family: ${FONT}; color: var(--ink); line-height: 1.25; -webkit-font-smoothing: antialiased;
  background: linear-gradient(180deg, rgba(16, 24, 42, .84) 0%, rgba(9, 14, 27, .88) 100%);
  -webkit-backdrop-filter: blur(20px) saturate(1.25); backdrop-filter: blur(20px) saturate(1.25);
  border: 1px solid var(--line); border-radius: calc(18px * var(--s));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .06), 0 24px 60px rgba(0, 0, 0, .45);
  overflow: hidden; user-select: none; }
.bp * { box-sizing: border-box; }
.bp::before { content: ''; position: absolute; inset: 0; pointer-events: none; border-radius: inherit;
  background: radial-gradient(120% 40% at 50% 0%, rgba(45, 212, 191, .07), transparent 60%); }
.bp-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.bp-over { font-size: calc(12.5px * var(--s)); letter-spacing: .17em; font-weight: 650; color: var(--ink3); text-transform: uppercase; white-space: nowrap; }
.bp-btn { font-family: inherit; font-size: calc(13px * var(--s)); font-weight: 600; color: var(--ink2); cursor: pointer;
  background: rgba(255, 255, 255, .035); border: 1px solid rgba(160, 200, 255, .22); border-radius: calc(9px * var(--s));
  padding: calc(5px * var(--s)) calc(11px * var(--s)); line-height: 1.2; transition: background .2s, color .2s, border-color .2s; }
.bp-btn:hover { background: rgba(255, 255, 255, .08); color: var(--ink); }
.bp-btn.on { color: var(--teal2); border-color: rgba(45, 212, 191, .55); background: rgba(45, 212, 191, .10); }
.bp-title { margin: calc(10px * var(--s)) 0 0; font-size: calc(30px * var(--s)); font-weight: 720; letter-spacing: -.022em; line-height: 1.08; color: #f4f8ff; }
.bp-sub { margin-top: calc(5px * var(--s)); font-size: calc(15px * var(--s)); color: var(--ink2); font-weight: 450; }
.bp-sub b { font-weight: 650; color: var(--ink); font-variant-numeric: tabular-nums; }
.bp-row { display: flex; align-items: center; gap: calc(8px * var(--s)); margin-top: calc(13px * var(--s)); }
.bp-pill { border-radius: 999px; padding: calc(6px * var(--s)) calc(15px * var(--s)); font-size: calc(14px * var(--s)); }
.bp-pill.on { color: #032521; background: linear-gradient(180deg, #6ff0dc, #2dd4bf); border-color: rgba(94, 234, 212, .9);
  box-shadow: 0 0 calc(18px * var(--s)) rgba(45, 212, 191, .35), inset 0 1px 0 rgba(255, 255, 255, .45); }
.bp-grow { flex: 1; }
.bp-view { position: relative; flex: 1 1 auto; min-height: calc(160px * var(--s)); margin-top: calc(13px * var(--s));
  border-radius: calc(13px * var(--s)); overflow: hidden; border: 1px solid var(--line); background: #040811; cursor: grab; touch-action: none; }
.bp-view.drag { cursor: grabbing; }
.bp-view canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.bp-ov { position: absolute; inset: 0; pointer-events: none; }
.bp-lab { position: absolute; left: 0; top: 0; font-size: calc(12px * var(--s)); letter-spacing: .15em; font-weight: 650;
  color: rgba(214, 230, 255, .82); text-transform: uppercase; white-space: nowrap; text-shadow: 0 1px 8px rgba(0, 0, 0, .9), 0 0 2px rgba(0, 0, 0, .9); will-change: transform, opacity; }
.bp-tag { position: absolute; left: calc(11px * var(--s)); top: calc(10px * var(--s)); font-size: calc(12px * var(--s)); letter-spacing: .12em;
  font-weight: 650; color: var(--ink3); text-transform: uppercase; display: flex; align-items: center; gap: calc(7px * var(--s)); }
.bp-dot { width: calc(8px * var(--s)); height: calc(8px * var(--s)); border-radius: 50%; background: #475569; }
.bp-tag.live { color: var(--teal2); }
.bp-tag.live .bp-dot { background: var(--teal); box-shadow: 0 0 10px var(--teal); animation: bpPulse 1.4s ease-in-out infinite; }
@keyframes bpPulse { 50% { opacity: .35; } }
.bp-scale { position: absolute; left: calc(14px * var(--s)); bottom: calc(12px * var(--s)); font-size: calc(12px * var(--s)); color: var(--ink2); font-weight: 600; }
.bp-scale i { display: block; height: calc(6px * var(--s)); border: 1.5px solid rgba(220, 235, 255, .85); border-top: 0; margin-bottom: calc(4px * var(--s)); }
.bp-tip { position: absolute; left: 0; top: 0; padding: calc(7px * var(--s)) calc(10px * var(--s)); border-radius: calc(8px * var(--s));
  background: rgba(6, 12, 24, .92); border: 1px solid rgba(150, 200, 255, .3); font-size: calc(12.5px * var(--s)); color: var(--ink);
  white-space: nowrap; display: none; line-height: 1.35; }
.bp-tip small { color: var(--ink3); font-size: calc(12px * var(--s)); }
.bp-legend { display: flex; align-items: center; flex-wrap: wrap; gap: calc(5px * var(--s)) calc(12px * var(--s)); margin-top: calc(10px * var(--s));
  font-size: calc(12.5px * var(--s)); color: var(--ink2); font-weight: 500; }
.bp-legend span { display: inline-flex; align-items: center; gap: calc(6px * var(--s)); white-space: nowrap; }
.bp-sw { width: calc(15px * var(--s)); height: calc(4px * var(--s)); border-radius: 2px; display: inline-block; }
.bp-sw.sm { width: calc(9px * var(--s)); height: calc(9px * var(--s)); border-radius: 50%; }
.bp-legend.cells { gap: calc(5px * var(--s)) calc(10px * var(--s)); }
.bp-grad { width: calc(46px * var(--s)); height: calc(5px * var(--s)); border-radius: 3px; display: inline-block;
  background: linear-gradient(90deg, #0891b2, #22d3ee 45%, #f0fdff); }
.bp-firing { margin-top: calc(9px * var(--s)); font-size: calc(15.5px * var(--s)); color: var(--ink2); font-weight: 500; font-variant-numeric: tabular-nums; }
.bp-firing b { color: var(--ink); font-weight: 700; }
.bp-hint { margin-top: calc(4px * var(--s)); font-size: calc(12.5px * var(--s)); color: var(--ink3); line-height: 1.35; }
.bp-raster { position: relative; margin-top: calc(10px * var(--s)); height: calc(92px * var(--s)); flex: none; border-radius: calc(9px * var(--s));
  overflow: hidden; border: 1px solid var(--line); background: linear-gradient(180deg, #0a1426, #07101f); }
.bp-raster canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.bp-cap { margin-top: calc(6px * var(--s)); font-size: calc(12px * var(--s)); letter-spacing: .13em; font-weight: 650; color: var(--ink3); text-transform: uppercase; white-space: nowrap; }
.bp-stats { display: flex; gap: calc(26px * var(--s)); margin-top: calc(11px * var(--s)); padding-bottom: calc(11px * var(--s)); border-bottom: 1px solid var(--line); }
.bp-num { font-size: calc(36px * var(--s)); font-weight: 720; letter-spacing: -.02em; line-height: 1; font-variant-numeric: tabular-nums; color: #f4f8ff; }
.bp-unit { margin-top: calc(4px * var(--s)); font-size: calc(13.5px * var(--s)); color: var(--ink2); font-weight: 500; }
.bp-ro { margin-top: calc(11px * var(--s)); }
.bp-ro-t { font-size: calc(15px * var(--s)); color: var(--ink2); font-weight: 500; margin-bottom: calc(7px * var(--s)); }
.bp-ro-t b { color: var(--ink); font-weight: 700; }
.bp-bar { display: grid; grid-template-columns: calc(150px * var(--s)) 1fr calc(40px * var(--s)); align-items: center; gap: calc(10px * var(--s)); height: calc(24px * var(--s)); }
.bp-bl { font-size: calc(13.5px * var(--s)); color: var(--ink2); font-weight: 550; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bp-track { position: relative; height: calc(7px * var(--s)); border-radius: 99px; background: rgba(148, 180, 230, .12); overflow: hidden; }
.bp-fill { position: absolute; left: 0; top: 0; bottom: 0; width: 100%; border-radius: 99px; transform-origin: 0 50%; transform: scaleX(0);
  background: linear-gradient(90deg, #b7791f, #fbbf24 60%, #fde68a); box-shadow: 0 0 12px rgba(251, 191, 36, .55); }
.bp-fill.stim { background: linear-gradient(90deg, #be185d, #f472b6 60%, #fbcfe8); box-shadow: 0 0 12px rgba(244, 114, 182, .5); }
.bp-bv { font-size: calc(13.5px * var(--s)); color: var(--ink); font-weight: 650; text-align: right; font-variant-numeric: tabular-nums; }
.bp-note { font-size: calc(12px * var(--s)); color: var(--ink3); margin-top: calc(2px * var(--s)); }
.bp-foot { margin-top: auto; padding-top: calc(10px * var(--s)); font-size: calc(12px * var(--s)); color: var(--ink3); line-height: 1.5; font-variant-numeric: tabular-nums; }
.bp-foot b { color: var(--ink2); font-weight: 600; }
.bp-foot .cr { color: rgba(176, 196, 236, .5); }
.bp.enl .bp-hide-enl { display: none; }
`;

function injectCSS() {
  if (document.getElementById('bp-css')) return;
  const st = document.createElement('style');
  st.id = 'bp-css';
  st.textContent = CSS;
  document.head.appendChild(st);
}

const h = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};

async function getJSON(u) { const r = await fetch(u); if (!r.ok) throw new Error(`${u}: ${r.status}`); return r.json(); }
async function getBin(u) { const r = await fetch(u); if (!r.ok) throw new Error(`${u}: ${r.status}`); return r.arrayBuffer(); }

// ---------------------------------------------------------------------------------------------- shaders
const PTS_VS = /* glsl */`
uniform sampler2D uAct;
uniform float uInvQ, uSize, uBase, uGain, uColorMix, uRadius, uPivotZ, uFlashOn, uGrow;
uniform vec3 uGroupCol[7];
uniform float uGroupW[7];
attribute float aSlot;
attribute vec2 aInfo;
varying vec3 vCol;
vec3 flashColor(float cat, float heat) {
  float hh = clamp(heat, 0.0, 1.0);
  if (cat > 1.5) return mix(vec3(1.0, 0.66, 0.16), vec3(1.0, 0.95, 0.78), hh);   // readout: gold
  if (cat > 0.5) return mix(vec3(1.0, 0.30, 0.66), vec3(1.0, 0.86, 0.95), hh);   // stimulated: pink
  return mix(vec3(0.06, 0.62, 1.0), vec3(0.80, 1.0, 1.0), hh);                    // cyan -> white
}
void main() {
  vec4 mv = modelViewMatrix * vec4(position * uInvQ, 1.0);
  gl_Position = projectionMatrix * mv;
  float depth = clamp(0.5 + 0.5 * (mv.z - uPivotZ) / uRadius, 0.0, 1.0);          // 1 = near side
  int g = int(aInfo.x + 0.5);
  float rnd = aInfo.y / 255.0;
  vec3 live = mix(vec3(0.13, 0.27, 1.0), vec3(0.40, 0.24, 1.0), rnd);
  vec3 base = mix(live * uGroupW[g], uGroupCol[g] * 1.1, uColorMix);
  base *= uBase * mix(0.28, 1.0, depth * depth) * (0.65 + 0.7 * rnd);
  float f = 0.0; float heat = 0.0; float cat = 0.0;
  if (aSlot > 0.5) {
    int s = int(aSlot + 0.5);
    vec4 a = texelFetch(uAct, ivec2(s % ${ACT_W}, s / ${ACT_W}), 0);
    f = (1.0 - exp(-a.r)) * uFlashOn; heat = a.g; cat = a.b;
  }
  vCol = base + flashColor(cat, heat) * f * uGain * mix(0.5, 1.0, depth);
  gl_PointSize = uSize * (1.0 + uGrow * f);
}`;
const PTS_FS = /* glsl */`
varying vec3 vCol;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d) * 4.0;
  if (r2 > 1.0) discard;
  gl_FragColor = vec4(vCol * exp(-r2 * 3.2), 1.0);
}`;
const SHELL_VS = /* glsl */`
uniform float uInvQ, uSize, uShell, uRadius, uPivotZ;
attribute vec3 aNormal;
varying vec3 vCol;
void main() {
  vec4 mv = modelViewMatrix * vec4(position * uInvQ, 1.0);
  gl_Position = projectionMatrix * mv;
  vec3 n = normalize(normalMatrix * aNormal);
  vec3 v = normalize(-mv.xyz);
  float fr = pow(1.0 - abs(dot(n, v)), 3.0);
  float depth = clamp(0.5 + 0.5 * (mv.z - uPivotZ) / uRadius, 0.0, 1.0);
  vCol = vec3(0.40, 0.62, 1.0) * fr * uShell * mix(0.45, 1.0, depth);
  gl_PointSize = uSize;
}`;
const WIRE_VS = /* glsl */`
uniform sampler2D uAct;
uniform float uInvQ, uRest, uRestStim, uGain, uRadius, uPivotZ, uFlashOn, uWireFlash;
attribute float aSlot;
varying vec3 vCol;
void main() {
  vec4 mv = modelViewMatrix * vec4(position * uInvQ, 1.0);
  gl_Position = projectionMatrix * mv;
  float depth = clamp(0.5 + 0.5 * (mv.z - uPivotZ) / uRadius, 0.0, 1.0);
  int s = int(aSlot + 0.5);
  vec4 a = texelFetch(uAct, ivec2(s % ${ACT_W}, s / ${ACT_W}), 0);
  float f = (1.0 - exp(-a.r)) * uFlashOn;
  float hh = clamp(a.g, 0.0, 1.0);
  vec3 rest = a.b > 1.5 ? vec3(1.0, 0.62, 0.18) : vec3(1.0, 0.30, 0.62);
  vec3 hot = a.b > 1.5 ? mix(vec3(1.0, 0.72, 0.25), vec3(1.0, 0.96, 0.82), hh) : mix(vec3(1.0, 0.40, 0.72), vec3(1.0, 0.88, 0.96), hh);
  bool ro = a.b > 1.5;
  vCol = rest * (ro ? uRest : uRestStim) * mix(0.35, 1.0, depth)
       + hot * f * uGain * uWireFlash * (ro ? 1.0 : 2.5) * mix(0.5, 1.0, depth);
}`;
const WIRE_FS = /* glsl */`
varying vec3 vCol;
void main() { gl_FragColor = vec4(vCol, 1.0); }`;

// ---------------------------------------------------------------------------------------------- panel
export async function createBrainPanel(el, { scene, assetsBase = './assets/brain/' } = {}) {
  if (!scene) throw new Error('createBrainPanel: scene required');
  injectCSS();
  const base = assetsBase.endsWith('/') ? assetsBase : assetsBase + '/';
  const [cns, man] = await Promise.all([getJSON(base + 'cns.json'), getJSON(base + scene + '.json')]);
  const clipNames = Object.keys(man.clips);
  // look (tuned on the RX 5700 XT at 1080p; see tools/shot_brain.py)
  const T = { base: 0.04, size: 1.3, bloom: 0.25, bloomR: 0.4, thr: 1.0, gain: 1.2, gainRef: 45, grow: 0.8,
              shell: 0.2, rest: 0.0018, restStim: 0.035, exposure: 1.0, wireFlash: 0.12, gainPow: 0.75 };
  const bufs = await Promise.all([
    getBin(base + cns.points.file), getBin(base + cns.shell.file), getBin(base + cns.wires.file),
    getBin(base + cns.neurons.file), ...clipNames.map(c => getBin(base + man.clips[c].file)),
  ]);
  try { await document.fonts.load(`600 16px InterBP`); } catch (e) { /* system font fallback */ }
  const [ptsBuf, shellBuf, wireBuf, neurBuf] = bufs;

  // ---------------------------------------------------------------- slots (neurons that matter in this scene)
  const M = man.slots.count;
  const nNeur = cns.neurons.count;
  const slotOfNeuron = new Uint16Array(nNeur);
  const slotCat = new Uint8Array(M + 1);
  for (let i = 0; i < M; i++) {
    const n = man.slots.neuron[i];
    if (n >= 0) slotOfNeuron[n] = i + 1;
    slotCat[i + 1] = man.slots.cat[i];
  }
  const nStim = man.slots.cat.filter(c => c === 1).length;
  const cen = cns.centre_um;
  const Q = cns.quant_per_um;

  // clips
  const clips = {};
  clipNames.forEach((c, i) => {
    const b = bufs[4 + i];
    const info = man.clips[c];
    const n = info.n_spikes;
    clips[c] = { name: c, info, slots: new Uint16Array(b, 0, n), t10: new Uint16Array(b, n * 2, n), n, ms: info.ms };
  });

  // ---------------------------------------------------------------- DOM
  if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
  el.innerHTML = '';
  const root = h('div', 'bp');
  el.appendChild(root);
  const traced = fmt(cns.traced_neurons);
  root.innerHTML = `
    <div class="bp-top"><div class="bp-over">Movement · Neural activity</div><button class="bp-btn bp-enl">Enlarge</button></div>
    <h2 class="bp-title">Inside the fly brain</h2>
    <div class="bp-sub"><b>${traced}</b> traced neurons · MaleCNS v1.0</div>
    <div class="bp-row">
      <button class="bp-btn bp-pill on" data-mode="live">Live spikes</button>
      <button class="bp-btn bp-pill" data-mode="cells">Cell colors</button>
      <span class="bp-grow"></span>
      <button class="bp-btn bp-front">Front view</button>
    </div>
    <div class="bp-view">
      <canvas class="bp-gl"></canvas>
      <div class="bp-ov">
        <div class="bp-lab" data-a="optic_lobe_R">Optic lobe</div>
        <div class="bp-lab" data-a="optic_lobe_L">Optic lobe</div>
        <div class="bp-lab" data-a="central_brain">Central brain</div>
        <div class="bp-lab" data-a="nerve_cord">Nerve cord</div>
        <div class="bp-tag"><span class="bp-dot"></span><span class="bp-tagt">Idle</span></div>
        <div class="bp-scale"><i></i>100 µm</div>
        <div class="bp-tip"></div>
      </div>
    </div>
    <div class="bp-legend"></div>
    <div class="bp-firing"><b class="v-now">0</b> firing now / <b class="v-sec">0</b> active this second</div>
    <div class="bp-hint bp-hide-enl">Traced neuron branches · drag to rotate · hover to identify<br>
      <span class="v-incl"></span></div>
    <div class="bp-raster"><canvas></canvas></div>
    <div class="bp-cap"></div>
    <div class="bp-stats">
      <div><div class="bp-num v-spk">0</div><div class="bp-unit">spikes / 15 ms</div></div>
      <div><div class="bp-num v-act">0</div><div class="bp-unit">active neurons</div></div>
    </div>
    <div class="bp-ro">
      <div class="bp-ro-t">Neural readout: <b>${man.readout_title}</b></div>
      <div class="bp-bars"></div>
    </div>
    <div class="bp-foot">
      <div><b>${fmt(cns.model.neurons)}</b> neurons · <b>${fmt(cns.model.connections)}</b> connections</div>
      <div><span class="v-time">0.00</span> s neural time · <span class="v-speed">replay 0.35×</span></div>
      <div class="v-stim">stimulated: nothing (no input, no spikes)</div>
      ${man.notes.map(n => `<div>${n}</div>`).join('')}
      <div class="cr">${cns.credit}</div>
    </div>`;
  const $ = s => root.querySelector(s);
  const view = $('.bp-view'), canvas = $('.bp-gl'), tip = $('.bp-tip'), tag = $('.bp-tag'), tagT = $('.bp-tagt');
  const scaleEl = $('.bp-scale'), scaleBar = scaleEl.querySelector('i');
  const labs = [...root.querySelectorAll('.bp-lab')].map(e => ({ el: e, key: e.dataset.a }));
  const V = { now: $('.v-now'), sec: $('.v-sec'), spk: $('.v-spk'), act: $('.v-act'), time: $('.v-time'),
              stim: $('.v-stim'), speed: $('.v-speed'), incl: $('.v-incl') };
  const cap = $('.bp-cap');

  // bars
  const barsEl = $('.bp-bars');
  const stimGroups = new Set(man.stim_groups);
  const bars = man.bars.map(b => {
    const row = h('div', 'bp-bar');
    const isStim = b.groups.some(g => stimGroups.has(g));
    row.innerHTML = `<div class="bp-bl">${b.label}</div><div class="bp-track"><div class="bp-fill${isStim ? ' stim' : ''}"></div></div><div class="bp-bv">0.00</div>`;
    barsEl.appendChild(row);
    return { fill: row.querySelector('.bp-fill'), val: row.querySelector('.bp-bv'), v: 0, shown: '' , note: b.note };
  });
  const notes = man.bars.filter(b => b.note).map(b => b.note);
  if (notes.length) barsEl.insertAdjacentHTML('afterend', notes.map(n => `<div class="bp-note">${n}</div>`).join(''));

  // legend
  const legend = $('.bp-legend');
  function setLegend(mode) {
    legend.classList.toggle('cells', mode === 'cells');
    if (mode === 'cells') {
      legend.innerHTML = [0, 2, 6, 3, 4, 5].map(i => cns.groups[i]).map(g =>
        `<span><i class="bp-sw sm" style="background:${g.color}"></i>${g.name}</span>`).join('');
    } else {
      const hasRO = man.slots.cat.some(c => c === 2);
      legend.innerHTML = `<span><i class="bp-sw" style="background:#4a6cff"></i>anatomy</span>` +
        `<span><i class="bp-sw" style="background:var(--pink)"></i>stimulated</span>` +
        (hasRO ? `<span><i class="bp-sw" style="background:var(--gold)"></i>readout</span>` : '') +
        `<span><i class="bp-grad"></i>1 → 3+ spikes / 15 ms</span>`;
    }
  }
  setLegend('live');

  // ---------------------------------------------------------------- three.js
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
  renderer.setClearColor(0x040811, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  const scene3 = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 20, 20000);
  const pivot = new THREE.Group();
  scene3.add(pivot);

  // background: soft radial glow
  {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(128, 110, 10, 128, 128, 190);
    gr.addColorStop(0, '#0c1830'); gr.addColorStop(0.55, '#070e1d'); gr.addColorStop(1, '#03060d');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    scene3.background = tex;
  }

  // activity texture: R = flash level, G = heat (white core), B = category (0 other, 1 stimulated, 2 readout)
  const actH = Math.ceil((M + 1) / ACT_W);
  const actData = new Float32Array(ACT_W * actH * 4);
  for (let s = 1; s <= M; s++) actData[s * 4 + 2] = slotCat[s];
  const actTex = new THREE.DataTexture(actData, ACT_W, actH, THREE.RGBAFormat, THREE.FloatType);
  actTex.minFilter = actTex.magFilter = THREE.NearestFilter;
  actTex.needsUpdate = true;

  const dpr = () => Math.min(window.devicePixelRatio || 1, 2);
  const groupCols = cns.groups.map(g => new THREE.Color(g.color).convertSRGBToLinear());
  const common = {
    uAct: { value: actTex }, uInvQ: { value: 1 / Q }, uRadius: { value: 360 }, uPivotZ: { value: -3000 },
    uGain: { value: 1.2 }, uFlashOn: { value: 1 },
  };

  // points
  const NP = cns.points.count;
  const i16 = new Int16Array(ptsBuf), u16 = new Uint16Array(ptsBuf);
  const ppos = new Int16Array(NP * 3), pslot = new Uint16Array(NP), pinfo = new Uint8Array(NP * 2);
  const ngroup = new Uint8Array(neurBuf, nNeur * 4, nNeur);
  for (let i = 0, k = 0; i < NP; i++, k += 5) {
    ppos[i * 3] = i16[k]; ppos[i * 3 + 1] = i16[k + 1]; ppos[i * 3 + 2] = i16[k + 2];
    const n = u16[k + 3] | (u16[k + 4] << 16);
    pslot[i] = slotOfNeuron[n];
    pinfo[i * 2] = ngroup[n];
    pinfo[i * 2 + 1] = (Math.imul(i, 2654435761) >>> 24) & 255;
  }
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.BufferAttribute(ppos, 3));
  pg.setAttribute('aSlot', new THREE.BufferAttribute(pslot, 1));
  pg.setAttribute('aInfo', new THREE.BufferAttribute(pinfo, 2));
  pg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 800);
  const pmat = new THREE.ShaderMaterial({
    vertexShader: PTS_VS, fragmentShader: PTS_FS, transparent: true, depthTest: false, depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      ...common, uSize: { value: 2 }, uBase: { value: 0.05 }, uColorMix: { value: 0 }, uGrow: { value: 1 },
      uGroupCol: { value: groupCols }, uGroupW: { value: [0.62, 0.9, 1.0, 1.1, 1.3, 1.3, 1.0] },
    },
  });
  const points = new THREE.Points(pg, pmat);
  points.frustumCulled = false;
  pivot.add(points);

  // shell (glass outline of the CNS)
  const NS = cns.shell.count;
  const si16 = new Int16Array(shellBuf), si8 = new Int8Array(shellBuf);
  const spos = new Int16Array(NS * 3), snrm = new Int8Array(NS * 3);
  for (let i = 0; i < NS; i++) {
    spos[i * 3] = si16[i * 5]; spos[i * 3 + 1] = si16[i * 5 + 1]; spos[i * 3 + 2] = si16[i * 5 + 2];
    snrm[i * 3] = si8[i * 10 + 6]; snrm[i * 3 + 1] = si8[i * 10 + 7]; snrm[i * 3 + 2] = si8[i * 10 + 8];
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(spos, 3));
  sg.setAttribute('aNormal', new THREE.BufferAttribute(snrm, 3, true));
  const smat = new THREE.ShaderMaterial({
    vertexShader: SHELL_VS, fragmentShader: PTS_FS, transparent: true, depthTest: false, depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uInvQ: common.uInvQ, uRadius: common.uRadius, uPivotZ: common.uPivotZ, uSize: { value: 2 }, uShell: { value: 0.16 } },
  });
  const shell = new THREE.Points(sg, smat);
  shell.frustumCulled = false;
  pivot.add(shell);

  // wires: full skeletons of this scene's stimulated + readout neurons
  {
    const NW = cns.wires.count;
    const w16 = new Int16Array(wireBuf), wu16 = new Uint16Array(wireBuf);
    let cnt = 0;
    const keep = new Uint32Array(NW);
    for (let i = 0; i < NW; i++) {
      const n = wu16[i * 8 + 6] | (wu16[i * 8 + 7] << 16);
      const s = slotOfNeuron[n];
      if (s && slotCat[s]) keep[cnt++] = i;
    }
    const wpos = new Int16Array(cnt * 6), wslot = new Uint16Array(cnt * 2);
    for (let j = 0; j < cnt; j++) {
      const i = keep[j];
      for (let k = 0; k < 6; k++) wpos[j * 6 + k] = w16[i * 8 + k];
      const n = wu16[i * 8 + 6] | (wu16[i * 8 + 7] << 16);
      wslot[j * 2] = wslot[j * 2 + 1] = slotOfNeuron[n];
    }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.BufferAttribute(wpos, 3));
    wg.setAttribute('aSlot', new THREE.BufferAttribute(wslot, 1));
    var wmat = new THREE.ShaderMaterial({
      vertexShader: WIRE_VS, fragmentShader: WIRE_FS, transparent: true, depthTest: false, depthWrite: false,
      blending: THREE.AdditiveBlending, uniforms: { ...common, uRest: { value: 0.1 }, uRestStim: { value: 0.03 }, uWireFlash: { value: 0.3 } },
    });
    const wires = new THREE.LineSegments(wg, wmat);
    wires.frustumCulled = false;
    pivot.add(wires);
  }

  // post: bloom + filmic tone map
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene3, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), T.bloom, T.bloomR, T.thr);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // ---------------------------------------------------------------- camera framing
  const bmin = cns.bounds_um.min, bmax = cns.bounds_um.max;
  const A = {};
  for (const [k, v] of Object.entries(cns.anchors)) A[k] = new THREE.Vector3(...v);
  A.central_brain.y = bmax[1] + 38;           // label sits just above the brain
  const cam = { az: 0, azVel: 0, target: new THREE.Vector3(0, (bmin[1] + bmax[1]) / 2, 0), dist: 3000, zoom: 0 };
  let W = 1, H = 1, pxPerUm = 1;
  function frame() {
    const t = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const aspect = W / H;
    const top = bmax[1] + 62;                  // room for the CENTRAL BRAIN label
    const full = { y: (bmin[1] + top) / 2, hgt: (top - bmin[1]) * 1.03, wid: (bmax[0] - bmin[0]) * 1.1 };
    const enl = { y: (A.optic_lobe_L.y + bmax[1]) / 2 - 20, hgt: (bmax[1] - A.optic_lobe_L.y) * 2.1, wid: (bmax[0] - bmin[0]) * 1.08 };
    const z = cam.zoom;
    const y = full.y + (enl.y - full.y) * z, hgt = full.hgt + (enl.hgt - full.hgt) * z, wid = full.wid + (enl.wid - full.wid) * z;
    cam.target.set(0, y, 0);
    cam.dist = Math.max(hgt / (2 * t), wid / (2 * t * aspect));
    camera.position.set(0, y + Math.sin(ELEV) * cam.dist, Math.cos(ELEV) * cam.dist);
    camera.lookAt(cam.target);
    camera.updateMatrixWorld();
    common.uPivotZ.value = -cam.dist;
    pxPerUm = (H / 2) / (cam.dist * t);
  }

  function resize() {
    const r = el.getBoundingClientRect();
    const s = clamp(Math.min(r.height / 1030, r.width / 470), 0.5, 2.6);
    root.style.setProperty('--s', s.toFixed(4));
    const vr = view.getBoundingClientRect();
    W = Math.max(2, Math.round(vr.width)); H = Math.max(2, Math.round(vr.height));
    const pr = dpr();
    renderer.setPixelRatio(pr);
    renderer.setSize(W, H, false);
    composer.setPixelRatio(pr);
    composer.setSize(W, H);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    pmat.uniforms.uSize.value = T.size * pr * clamp(Math.sqrt(W * H) / 420, 0.8, 1.6);
    smat.uniforms.uSize.value = 1.8 * pr;
    frame();
    raster.resize();
    for (const L of labs) L.w = L.h = 0;
  }

  // ---------------------------------------------------------------- raster
  const rows = man.raster_rows, rowCat = man.raster_cat, nRows = rows.length;
  const rowOfSlot = new Int16Array(M + 1).fill(-1);
  rows.forEach((s, r) => { rowOfSlot[s] = r; });
  cap.textContent = `${nRows} readout cells · 15 ms bins · newest →`;
  const stimShown = rowCat.filter(c => c === 1).length;
  V.incl.textContent = man.n_active_scene > nRows
    ? `${nRows} of ${fmt(man.n_active_scene)} active cells in the raster · ${stimShown}/${nStim} stimulated cells included`
    : `${nRows}/${nRows} active cells in the raster · ${stimShown}/${nStim} stimulated cells included`;
  const raster = (() => {
    const cv = root.querySelector('.bp-raster canvas');
    const ctx = cv.getContext('2d');
    const hist = document.createElement('canvas');
    const hctx = hist.getContext('2d');
    let RW = 1, RH = 1, colW = 3, capN = 1, head = 0, filled = 0, rowPx = new Int32Array(nRows), pxCells, pxCat, img, fade;
    const marks = new Uint8Array(nRows);
    const COL = [[34, 211, 238], [244, 114, 182], [251, 191, 36]];
    function resizeR() {
      const r = cv.getBoundingClientRect(), pr = dpr();
      RW = Math.max(2, Math.round(r.width * pr)); RH = Math.max(2, Math.round(r.height * pr));
      cv.width = RW; cv.height = RH;
      colW = Math.max(2, Math.round(3 * pr * clamp(r.width / 400, 0.8, 1.5)));
      const oldCap = capN;
      capN = Math.ceil(RW / colW) + 2;
      const pad = Math.round(4 * pr), usable = RH - 2 * pad;
      pxCells = new Uint16Array(RH); pxCat = new Uint8Array(RH);
      for (let r2 = 0; r2 < nRows; r2++) {
        const y = pad + Math.min(usable - 1, Math.floor((r2 + 0.5) * usable / nRows));
        rowPx[r2] = y; pxCells[y]++;
        const c = rowCat[r2];
        if (c > pxCat[y]) pxCat[y] = c;
      }
      hist.width = capN; hist.height = RH;
      fade = ctx.createLinearGradient(0, 0, RW * 0.18, 0);
      fade.addColorStop(0, 'rgba(7,16,31,.95)'); fade.addColorStop(1, 'rgba(7,16,31,0)');
      img = hctx.createImageData(1, RH);
      if (oldCap !== capN) { head = 0; filled = 0; }
    }
    function mark(slot) { const r = rowOfSlot[slot]; if (r >= 0) marks[r] = 1; }
    const cnt = new Uint16Array(4096);
    function push(empty) {
      if (!img) return;
      const d = img.data;
      d.fill(0);
      if (!empty) {
        const c = cnt.subarray(0, RH); c.fill(0);
        for (let r2 = 0; r2 < nRows; r2++) if (marks[r2]) c[rowPx[r2]]++;
        for (let y = 0; y < RH; y++) {
          if (!c[y]) continue;
          const v = c[y] / pxCells[y];                     // fraction of this pixel's cells that spiked
          const col = COL[pxCat[y]];
          const w = pxCat[y] ? 0.3 * v * v : 0.8 * v * v;   // only (nearly) all cells spiking -> white
          d[y * 4] = col[0] + (255 - col[0]) * w; d[y * 4 + 1] = col[1] + (255 - col[1]) * w; d[y * 4 + 2] = col[2] + (255 - col[2]) * w;
          d[y * 4 + 3] = 255 * clamp(0.28 + 0.72 * Math.sqrt(v), 0, 1);
        }
      }
      marks.fill(0);
      hctx.putImageData(img, head, 0);
      head = (head + 1) % capN;
      filled = Math.min(filled + 1, capN);
    }
    function clear() { hctx.clearRect(0, 0, capN, RH); head = 0; filled = 0; marks.fill(0); }
    function draw(frac, alpha) {
      ctx.clearRect(0, 0, RW, RH);
      // faint guides: category bands
      ctx.globalAlpha = 1;
      for (let y = 0; y < RH; y++) {
        if (!pxCells[y] || !pxCat[y]) continue;
        ctx.fillStyle = pxCat[y] === 1 ? 'rgba(244,114,182,.10)' : 'rgba(251,191,36,.10)';
        ctx.fillRect(0, y, RW, 1);
      }
      ctx.imageSmoothingEnabled = false;
      ctx.globalAlpha = alpha;
      const right = RW - frac * colW;
      // newest column = head-1, drawn ending at `right`
      const n = filled;
      const startIdx = (head - n + capN) % capN;
      const x0 = right - n * colW;
      const firstLen = Math.min(n, capN - startIdx);
      if (firstLen > 0) ctx.drawImage(hist, startIdx, 0, firstLen, RH, x0, 0, firstLen * colW, RH);
      if (n - firstLen > 0) ctx.drawImage(hist, 0, 0, n - firstLen, RH, x0 + firstLen * colW, 0, (n - firstLen) * colW, RH);
      ctx.globalAlpha = 1;
      ctx.fillStyle = fade; ctx.fillRect(0, 0, RW * 0.18, RH);
    }
    return { resize: resizeR, mark, push, draw, clear };
  })();

  // ---------------------------------------------------------------- replay state
  const level = new Float32Array(M + 1), heat = new Float32Array(M + 1);
  const lastSpike = new Float64Array(M + 1).fill(-1e9);
  const binStamp = new Int32Array(M + 1).fill(-1);
  const st = {
    clip: null, speed: 0.35, loop: true, t: 0, idx: 0, offset: 0, C: 0,   // C = cumulative neural ms
    bin: 0, binSpk: 0, binAct: 0, lastSpk: 0, lastAct: 0, playing: false, lastNow: null,
    mode: 'live', colorMix: 0, front: false, drag: null, gain: 1.2, uiT: 0, activeGlow: 0, stopT: -1,
  };

  function lowerBound(arr, v) { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < v) lo = m + 1; else hi = m; } return lo; }

  function closeBinsUpTo(b) {
    while (st.bin < b) {
      st.lastSpk = st.binSpk; st.lastAct = st.binAct;
      raster.push(false);
      st.binSpk = 0; st.binAct = 0; st.bin++;
      if (b - st.bin > 400) { st.bin = b; break; }   // long jump: do not replay hundreds of empty bins
    }
  }

  function spike(s, Cms) {
    const b = Math.floor(Cms / BIN);
    if (b > st.bin) closeBinsUpTo(b);
    st.binSpk++;
    if (binStamp[s] !== b) { binStamp[s] = b; st.binAct++; }
    lastSpike[s] = Cms;
    level[s] = Math.min(level[s] + 1.0, 4.0);
    heat[s] = Math.min(heat[s] + 0.75, 1.3);
    raster.mark(s);
  }

  function advance(dtModel) {
    const c = st.clip;
    let remaining = dtModel;
    let guard = 0;
    while (remaining > 0 && guard++ < 8) {
      const step = Math.min(remaining, c.ms - st.t);
      const tEnd = st.t + step;
      const lim = tEnd * 10;
      const { slots, t10, n } = c;
      let i = st.idx;
      while (i < n && t10[i] <= lim) { spike(slots[i], st.offset + t10[i] / 10); i++; }
      st.idx = i;
      st.t = tEnd;
      st.C = st.offset + st.t;
      remaining -= step;
      if (st.t >= c.ms - 1e-9) {
        if (!st.loop) { stop(); return; }
        const lf = c.info.loop_from_ms;
        st.offset += c.ms - lf;
        st.t = lf;
        st.idx = lowerBound(c.t10, lf * 10 + 1);
      }
    }
    closeBinsUpTo(Math.floor(st.C / BIN));
  }

  // ---------------------------------------------------------------- API
  function play(name, { loop = true, speed = 0.35, from = null, restart = false } = {}) {
    const c = clips[name];
    if (!c) { console.warn(`brain: no clip "${name}" in scene "${scene}" (have ${clipNames.join(', ')})`); return; }
    st.loop = loop; st.speed = speed;
    V.speed.textContent = `replay ${speed.toFixed(2).replace(/0$/, '')}×`;
    if (st.playing && st.clip === c && !restart) return;
    const wasPlaying = st.playing;
    const f = from != null ? from : (wasPlaying ? c.info.loop_from_ms : 0);
    st.clip = c; st.playing = true; st.t = f;
    st.idx = lowerBound(c.t10, f * 10 + (f > 0 ? 1 : 0));
    st.offset = st.C - f;
    if (!wasPlaying) st.bin = Math.floor(st.C / BIN);
    V.stim.innerHTML = `stimulated: <b>${c.info.stim_text}</b>`;
    tag.classList.add('live');
    tagT.textContent = `Replay ${speed.toFixed(2).replace(/0$/, '')}×`;
  }

  function stop() {
    if (!st.playing) return;
    st.playing = false;
    closeBinsUpTo(Math.floor(st.C / BIN) + 1);
    V.stim.innerHTML = `stimulated: nothing (no input, no spikes)`;
    tag.classList.remove('live');
    tagT.textContent = 'Idle';
  }

  // ---------------------------------------------------------------- controls
  const pills = [...root.querySelectorAll('.bp-pill')];
  pills.forEach(p => p.addEventListener('click', () => {
    st.mode = p.dataset.mode;
    pills.forEach(q => q.classList.toggle('on', q === p));
    setLegend(st.mode);
  }));
  const frontBtn = $('.bp-front');
  frontBtn.addEventListener('click', () => { st.front = !st.front; frontBtn.classList.toggle('on', st.front); });
  const enlBtn = $('.bp-enl');
  let enlarged = false;
  enlBtn.addEventListener('click', () => {
    enlarged = !enlarged;
    enlBtn.classList.toggle('on', enlarged);
    enlBtn.textContent = enlarged ? 'Full CNS' : 'Enlarge';
    el.dispatchEvent(new CustomEvent('brainpanel:enlarge', { detail: { enlarged }, bubbles: true }));
  });

  // drag to rotate, hover to identify
  view.addEventListener('pointerdown', e => {
    st.drag = { x: e.clientX, az: cam.az, t: performance.now() };
    view.classList.add('drag'); view.setPointerCapture(e.pointerId);
  });
  view.addEventListener('pointermove', e => {
    if (st.drag) {
      const dx = e.clientX - st.drag.x;
      cam.az = st.drag.az + dx * 0.01;
      cam.azVel = 0;
    } else { st.mouse = { clientX: e.clientX, clientY: e.clientY }; hover(st.mouse); }
  });
  const endDrag = () => { if (st.drag) { st.drag = null; view.classList.remove('drag'); } };
  view.addEventListener('pointerup', endDrag);
  view.addEventListener('pointercancel', endDrag);
  view.addEventListener('pointerleave', () => { tip.style.display = 'none'; st.mouse = null; });

  const somas = new Float32Array(M * 3);
  const somaOk = new Uint8Array(M);
  for (let i = 0; i < M; i++) {
    if (man.slots.neuron[i] < 0) continue;
    somaOk[i] = 1;
    somas[i * 3] = man.slots.soma[i * 3] - cen[0];
    somas[i * 3 + 1] = man.slots.soma[i * 3 + 1] - cen[1];
    somas[i * 3 + 2] = man.slots.soma[i * 3 + 2] - cen[2];
  }
  const tmpV = new THREE.Vector3();
  function hover(e) {
    const r = view.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    let best = -1, bd = 14 * 14;
    for (let i = 0; i < M; i++) {
      if (!somaOk[i]) continue;
      tmpV.set(somas[i * 3], somas[i * 3 + 1], somas[i * 3 + 2]).applyMatrix4(pivot.matrixWorld).project(camera);
      const x = (tmpV.x * 0.5 + 0.5) * W, y = (-tmpV.y * 0.5 + 0.5) * H;
      const d = (x - mx) ** 2 + (y - my) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    if (best < 0) { tip.style.display = 'none'; return; }
    const S = man.slots;
    const kind = SUPER[S.superclass[best]] || (S.superclass[best] || 'neuron').replace(/_/g, ' ');
    const side = S.side[best] ? ` · ${S.side[best]}` : '';
    const role = S.cat[best] === 1 ? ' · stimulated' : S.cat[best] === 2 ? ' · readout' : '';
    let rate = '';
    if (st.clip) {
      const sp = st.clip.info.slot_spikes[best];
      rate = `<br><small>${sp ? `${fmt(sp / (st.clip.ms / 1000))} Hz in this clip` : 'silent in this clip'} · body ${S.body_id[best]}</small>`;
    } else rate = `<br><small>body ${S.body_id[best]}</small>`;
    tip.innerHTML = `<b>${S.type[best] || 'untyped'}</b> · ${kind}${side}${role}${rate}`;
    tip.style.display = 'block';
    const tw = tip.offsetWidth;
    tip.style.transform = `translate(${Math.round(clamp(mx + 12, 4, W - tw - 4))}px, ${Math.round(clamp(my + 14, 4, H - 50))}px)`;
  }

  // ---------------------------------------------------------------- per-frame
  const labPos = new THREE.Vector3();
  function placeLabels() {
    const ca = Math.cos(cam.az);
    for (const L of labs) {
      const a = A[L.key];
      let op = 1, dx = 0, dy = 0, anchorX = 0.5;
      if (L.key.startsWith('optic')) {
        const z = cam.zoom;                      // enlarged: labels go above the lobes (the cord is off screen)
        labPos.set(a.x * (1.45 - 0.3 * z), a.y - 125 + 265 * z, a.z);
        op = clamp((Math.abs(ca) - 0.45) / 0.35, 0, 1);
      } else if (L.key === 'central_brain') {
        labPos.copy(a);
      } else {
        labPos.set(0, a.y, 0);
        dx = 0; anchorX = 0;
        op = clamp(1 - 2 * cam.zoom, 0, 1);
      }
      labPos.applyMatrix4(pivot.matrixWorld).project(camera);
      let x = (labPos.x * 0.5 + 0.5) * W, y = (-labPos.y * 0.5 + 0.5) * H;
      if (L.key === 'nerve_cord') x = W / 2 + 190 * pxPerUm;
      const w = L.w || (L.w = L.el.offsetWidth), hh = L.h || (L.h = L.el.offsetHeight);
      x = clamp(x - w * anchorX + dx, 6, W - w - 6);
      y = clamp(y - hh / 2 + dy, 6, H - hh - 34);
      L.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      L.el.style.opacity = op.toFixed(3);
    }
    scaleBar.style.width = `${(100 * pxPerUm).toFixed(1)}px`;
  }

  function update(now) {
    const dt = st.lastNow == null ? 1 / 60 : clamp(now - st.lastNow, 0, 0.1);
    st.lastNow = now;

    if (st.playing) advance(dt * 1000 * st.speed);

    // flash decay (screen time) + auto exposure
    const kl = Math.exp(-dt / TAU_LEVEL), kh = Math.exp(-dt / TAU_HEAT);
    let lit = 0, any = false;
    for (let s = 1; s <= M; s++) {
      let l = level[s];
      if (l > 1e-3) {
        l *= kl; level[s] = l; heat[s] *= kh; any = true;
        if (l > 0.08) lit++;
      } else if (l !== 0) { level[s] = 0; heat[s] = 0; any = true; }
      actData[s * 4] = level[s]; actData[s * 4 + 1] = heat[s];
    }
    if (any) actTex.needsUpdate = true;
    const gTarget = clamp(T.gain / Math.pow(1 + lit / T.gainRef, T.gainPow), 0.035, T.gain);
    st.gain += (gTarget - st.gain) * (1 - Math.exp(-dt / 0.35));
    common.uGain.value = st.gain;

    // colour mode crossfade
    const cm = st.mode === 'cells' ? 1 : 0;
    st.colorMix += (cm - st.colorMix) * (1 - Math.exp(-dt / 0.18));
    pmat.uniforms.uColorMix.value = st.colorMix;
    pmat.uniforms.uBase.value = T.base * (st.playing || lit > 0 ? 1 : 0.85) * (1 + 0.55 * st.colorMix);
    pmat.uniforms.uGrow.value = T.grow; smat.uniforms.uShell.value = T.shell; wmat.uniforms.uRest.value = T.rest; wmat.uniforms.uRestStim.value = T.restStim; wmat.uniforms.uWireFlash.value = T.wireFlash;
    bloom.strength = T.bloom; bloom.radius = T.bloomR; bloom.threshold = T.thr; renderer.toneMappingExposure = T.exposure;
    common.uFlashOn.value = 1;

    // rotation
    if (st.front) {
      const tgt = Math.round(cam.az / (2 * Math.PI)) * 2 * Math.PI;
      cam.az += (tgt - cam.az) * (1 - Math.exp(-dt / 0.35));
    } else if (!st.drag) cam.az += AUTO_SPIN * dt;
    pivot.rotation.y = cam.az;
    const zt = enlarged ? 1 : 0;
    if (Math.abs(zt - cam.zoom) > 1e-4) { cam.zoom += (zt - cam.zoom) * (1 - Math.exp(-dt / 0.3)); frame(); }
    pivot.updateMatrixWorld();

    if (W > 4 && H > 4) composer.render(dt);
    placeLabels();

    // raster
    const frac = st.playing ? (st.C / BIN) - Math.floor(st.C / BIN) : 0;
    raster.draw(frac, st.playing ? 1 : 0.35);

    // bars (precomputed from the clip's real spikes, see manifest) with a soft spring
    const c = st.clip;
    const tcur = st.t;
    for (let k = 0; k < bars.length; k++) {
      let target = 0;
      if (st.playing && c) {
        const ser = c.info.bars[k].value;
        const x = tcur / man.series_ms, i0 = Math.min(ser.length - 1, Math.floor(x)), i1 = Math.min(ser.length - 1, i0 + 1);
        target = ser[i0] + (ser[i1] - ser[i0]) * (x - i0);
      }
      const B = bars[k];
      B.v += (target - B.v) * (1 - Math.exp(-dt / 0.12));
      B.fill.style.transform = `scaleX(${clamp(B.v, 0, 1).toFixed(4)})`;
    }

    // numbers ~10x per second
    st.uiT += dt;
    if (st.uiT > 0.1) {
      st.uiT = 0;
      let sec = 0;
      if (st.playing) { const lim = st.C - 1000; for (let s = 1; s <= M; s++) if (lastSpike[s] > lim) sec++; }
      const spk = st.playing ? st.lastSpk : 0, act = st.playing ? st.lastAct : 0;
      V.spk.textContent = fmt(spk); V.act.textContent = fmt(act); V.now.textContent = fmt(act); V.sec.textContent = fmt(sec);
      V.time.textContent = (st.C / 1000).toFixed(2);
      for (const B of bars) { const s = clamp(B.v, 0, 1).toFixed(2); if (s !== B.shown) { B.shown = s; B.val.textContent = s; } }
      if (st.mouse && !st.drag) hover(st.mouse);      // keep the tooltip on the neuron while the brain turns
    }
  }

  let ro = null;
  if (window.ResizeObserver) { ro = new ResizeObserver(() => resize()); ro.observe(el); }
  resize();
  update(performance.now() / 1000);

  function dispose() {
    if (ro) ro.disconnect();
    pg.dispose(); sg.dispose(); pmat.dispose(); smat.dispose(); wmat.dispose(); actTex.dispose();
    composer.dispose && composer.dispose();
    renderer.dispose();
    el.innerHTML = '';
  }

  return {
    play, stop, update, resize, dispose,
    get clips() { return clipNames.slice(); },
    get playing() { return st.playing ? st.clip.name : null; },
    get stats() { return { points: NP, slots: M, neuralTimeMs: st.C, lastBinSpikes: st.lastSpk, lastBinActive: st.lastAct }; },
    _debug: { pmat, smat, wmat, bloom, renderer, cam, st, tune: T },
  };
}
