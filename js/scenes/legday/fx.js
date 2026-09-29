// Effects for the leg press: glowing platform cracks, floating "+90 LB" labels, the loop-reset flash.
import * as THREE from 'three';

// small deterministic RNG
export function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/**
 * Crack network on the platform top (y = 0). Grows from `roots` outward; reveal with setReveal(dist).
 * One merged ribbon mesh for the hot core and one for the soft glow (2 draw calls).
 */
export function buildCracks(scene, { roots, bounds, seed = 7 }) {
  const R = rng(seed);
  const segs = [];   // [x0,z0,x1,z1,d0,d1,w0,w1]
  let maxD = 0;
  function walk(x, z, ang, d, w, len, depth) {
    const step = 0.2;
    let n = Math.round(len / step);
    for (let i = 0; i < n; i++) {
      ang += (R() - 0.5) * 0.75;
      const nx = x + Math.cos(ang) * step, nz = z + Math.sin(ang) * step;
      if (nx < bounds[0] || nx > bounds[1] || nz < bounds[2] || nz > bounds[3]) break;
      const nw = w * (1 - 0.7 / n);
      segs.push([x, z, nx, nz, d, d + step, w, nw]);
      maxD = Math.max(maxD, d + step);
      x = nx; z = nz; d += step; w = nw;
      if (depth < 2 && R() < 0.2 - depth * 0.06) walk(x, z, ang + (R() < 0.5 ? -1 : 1) * (0.6 + R() * 0.6), d, w * 0.7, len * (0.3 + R() * 0.35), depth + 1);
    }
  }
  for (const r of roots) {
    const k = r.n || 4;
    for (let i = 0; i < k; i++) {
      const ang = (r.a0 ?? 0) + (i / k) * Math.PI * 2 + (R() - 0.5) * 0.9;
      walk(r.x, r.z, ang, r.d0 || 0, r.w || 0.075, (r.len || 4) * (0.6 + R() * 0.6), 0);
    }
  }
  const mk = (widthMul) => {
    const pos = [], dist = [], side = [];
    for (const [x0, z0, x1, z1, d0, d1, w0, w1] of segs) {
      const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz) || 1;
      const nx = -dz / l, nz = dx / l;
      const a = w0 * widthMul, b = w1 * widthMul;
      // extend each quad a little along the segment to hide joints
      const ex = dx / l * 0.02, ez = dz / l * 0.02;
      const p = [
        [x0 - ex + nx * a, z0 - ez + nz * a, d0, 1], [x0 - ex - nx * a, z0 - ez - nz * a, d0, -1],
        [x1 + ex + nx * b, z1 + ez + nz * b, d1, 1], [x1 + ex - nx * b, z1 + ez - nz * b, d1, -1],
      ];
      for (const i of [0, 1, 2, 2, 1, 3]) { pos.push(p[i][0], 0, p[i][1]); dist.push(p[i][2]); side.push(p[i][3]); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aDist', new THREE.Float32BufferAttribute(dist, 1));
    g.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
    return g;
  };
  const uniforms = { uReveal: { value: 0 }, uHeat: { value: 0 }, uTime: { value: 0 } };
  const vs = `attribute float aDist; attribute float aSide; varying float vD; varying float vS;
    void main(){ vD = aDist; vS = aSide; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`;
  const core = new THREE.Mesh(mk(0.75), new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: vs,
    fragmentShader: `uniform float uReveal; uniform float uHeat; uniform float uTime; varying float vD; varying float vS;
      void main(){
        float edge = uReveal - vD;
        if (edge < 0.0) discard;
        float tipHot = 1.0 + 1.2 * exp(-edge * 5.0);
        float a = 1.0 - smoothstep(0.35, 1.0, abs(vS));
        float flick = 0.85 + 0.15 * sin(uTime * 23.0 + vD * 7.0);
        vec3 c = vec3(0.95, 0.3, 1.45) * a * tipHot * flick * (0.7 + 0.3 * uHeat);
        gl_FragColor = vec4(c, 1.0);
      }`,
  }));
  // soft purple tint around each crack: normal blending, so it colours the slab without pushing it over the
  // bloom threshold (a wide additive glow blooms the whole platform and washes the fly out)
  const glow = new THREE.Mesh(mk(6.5), new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: vs,
    fragmentShader: `uniform float uReveal; uniform float uHeat; varying float vD; varying float vS;
      void main(){
        float edge = uReveal - vD;
        if (edge < 0.0) discard;
        float a = pow(1.0 - abs(vS), 1.6) * (0.35 + 0.25 * uHeat) * smoothstep(0.0, 0.3, edge);
        gl_FragColor = vec4(0.52, 0.2, 0.85, a);
      }`,
  }));
  // dark gap line under the glow (drawn normally, darkens the slab)
  const gap = new THREE.Mesh(mk(3.2), new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: vs,
    fragmentShader: `uniform float uReveal; varying float vD; varying float vS;
      void main(){ if (uReveal - vD < 0.0) discard; float a = (1.0 - smoothstep(0.3, 1.0, abs(vS))) * 0.9; gl_FragColor = vec4(0.05, 0.01, 0.1, a); }`,
  }));
  gap.position.y = 0.003; glow.position.y = 0.004; core.position.y = 0.005;
  gap.renderOrder = 3; glow.renderOrder = 4; core.renderOrder = 5;
  const grp = new THREE.Group();
  grp.add(gap, glow, core);
  scene.add(grp);
  return { group: grp, uniforms, maxD };
}

/** A pool of DOM labels ("+90 LB") that float up from projected 3D points. */
export class LabelPool {
  constructor(n = 8) {
    const host = document.getElementById('hud') || document.body;
    this.layer = document.createElement('div');
    this.layer.className = 'legday-labels';
    this.layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;';
    host.appendChild(this.layer);
    this.els = [];
    for (let i = 0; i < n; i++) {
      const e = document.createElement('div');
      e.style.cssText = `position:absolute;left:0;top:0;white-space:nowrap;font:900 calc(34 * var(--u)) var(--font);
        color:#f0abfc;letter-spacing:.02em;text-shadow:0 0 calc(14 * var(--u)) rgba(240,171,252,.85),0 calc(3 * var(--u)) 0 rgba(20,8,40,.75);
        opacity:0;will-change:transform,opacity;`;
      this.layer.appendChild(e);
      this.els.push({ el: e, text: '', vis: false });
    }
    this._v = new THREE.Vector3();
  }
  /**
   * items: [{text, world:Vector3 | null, slot:[fx, fy] | null, age, size}]. A world label is projected, a slot label
   * sits at a fixed spot of the phone strip (fractions of its width / height). Both are kept inside the strip.
   */
  render(items, camera) {
    camera.updateMatrixWorld();
    const W = window.innerWidth, H = window.innerHeight, u = H / 1080;
    const sw = H * 9 / 16, sx = 0.36 * W - sw / 2;
    for (let i = 0; i < this.els.length; i++) {
      const s = this.els[i], it = items[i];
      if (!it) { if (s.vis) { s.el.style.opacity = '0'; s.vis = false; } continue; }
      if (s.text !== it.text) { s.el.textContent = it.text; s.text = it.text; s.w = s.el.offsetWidth; }
      let x, y;
      if (it.slot) { x = sx + it.slot[0] * sw; y = it.slot[1] * H; }
      else {
        const p = this._v.copy(it.world).project(camera);
        x = (p.x + 1) / 2 * W; y = (1 - p.y) / 2 * H;
      }
      const a = it.age;
      const pop = a < 0.12 ? 0.5 + 0.7 * (a / 0.12) : 1.2 - 0.2 * Math.min(1, (a - 0.12) / 0.15);
      const half = (s.w || 120) * (it.size || 1) * 0.6 + 12 * u;
      x = Math.min(sx + sw - half, Math.max(sx + half, x));
      const rise = -(a * 70 + 30) * u;
      y = Math.min(H * 0.6, Math.max(H * 0.13, y + rise)) - rise;   // never climb over the header
      const op = a < 0.06 ? a / 0.06 : a > 0.7 ? Math.max(0, 1 - (a - 0.7) / 0.35) : 1;
      s.el.style.transform = `translate(${x.toFixed(1)}px, ${(y + rise).toFixed(1)}px) translate(-50%, -50%) scale(${(pop * (it.size || 1)).toFixed(3)})`;
      s.el.style.opacity = op.toFixed(3);
      s.vis = true;
    }
  }
}

/** Full-canvas flash under the HUD and brain panel (hides the loop reset). */
export class ResetFlash {
  constructor() {
    const e = this.el = document.createElement('div');
    e.style.cssText = 'position:fixed;inset:0;pointer-events:none;opacity:0;background:radial-gradient(ellipse at 36% 45%, #ffffff 0%, #f5d0fe 35%, #a78bfa 75%, #5b21b6 100%);';
    const hud = document.getElementById('hud');
    document.body.insertBefore(e, hud || null);
    this.o = -1;
  }
  set(o) {
    o = Math.round(o * 100) / 100;
    if (o !== this.o) { this.el.style.opacity = String(o); this.o = o; }
  }
}
