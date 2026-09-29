// Particle and screen effects. Everything is instanced (one draw call per system) and every
// particle's state is a pure function of scene time, so frozen frames are exact.
import * as THREE from 'three';

/** deterministic hash -> [0,1) */
export function hash(a, b = 0, c = 0) {
  const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Soft round billboards. set(i, x,y,z, size, r,g,b,a) then commit(count). */
export class SpriteCloud {
  constructor(max, { additive = false, soft = 1.0, depthTest = true } = {}) {
    const base = new THREE.PlaneGeometry(1, 1);
    const g = this.geo = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.getAttribute('position'));
    this.pos = new Float32Array(max * 4);
    this.col = new Float32Array(max * 4);
    this.aPos = new THREE.InstancedBufferAttribute(this.pos, 4).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.InstancedBufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aPos', this.aPos);
    g.setAttribute('aCol', this.aCol);
    g.instanceCount = max;
    this.max = max; this.last = max;
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, depthTest,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uSoft: { value: soft } },
      vertexShader: `
        attribute vec4 aPos; attribute vec4 aCol; varying vec4 vCol; varying vec2 vUv;
        void main() {
          vUv = position.xy; vCol = aCol;
          vec4 mv = modelViewMatrix * vec4(aPos.xyz, 1.0);
          mv.xy += position.xy * aPos.w;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform float uSoft; varying vec4 vCol; varying vec2 vUv;
        void main() {
          float r = length(vUv) * 2.0;
          if (r >= 1.0 || vCol.a <= 0.0) discard;
          float a = pow(1.0 - r, uSoft);
          ${additive ? 'gl_FragColor = vec4(vCol.rgb * vCol.a * a, 1.0);' : 'gl_FragColor = vec4(vCol.rgb, vCol.a * a);'}
        }`,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.n = 0;
  }
  begin() { this.n = 0; }
  push(x, y, z, size, r, g, b, a) {
    if (this.n >= this.max || a <= 0.002) return;
    const i = this.n++ * 4;
    this.pos[i] = x; this.pos[i + 1] = y; this.pos[i + 2] = z; this.pos[i + 3] = size;
    this.col[i] = r; this.col[i + 1] = g; this.col[i + 2] = b; this.col[i + 3] = a;
  }
  end() {
    // fixed instance count (unused slots get size 0, alpha 0): changing counts upset ANGLE here
    for (let i = this.n * 4; i < this.last * 4; i++) { this.pos[i] = 0; this.col[i] = 0; }
    this.last = this.n;
    this.aPos.needsUpdate = true; this.aCol.needsUpdate = true;
  }
}

/** Camera-facing streaks from A (head) to B (tail), additive. push(ax,ay,az, bx,by,bz, width, r,g,b) */
export class StreakCloud {
  constructor(max) {
    const g = this.geo = new THREE.InstancedBufferGeometry();
    // quad: x in {0,1} = along (head..tail), y in {-0.5,0.5} = across
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, -0.5, 0, 1, -0.5, 0, 1, 0.5, 0, 0, 0.5, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.a = new Float32Array(max * 4); this.b = new Float32Array(max * 3); this.c = new Float32Array(max * 3);
    this.aA = new THREE.InstancedBufferAttribute(this.a, 4).setUsage(THREE.DynamicDrawUsage);
    this.aB = new THREE.InstancedBufferAttribute(this.b, 3).setUsage(THREE.DynamicDrawUsage);
    this.aC = new THREE.InstancedBufferAttribute(this.c, 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aA', this.aA); g.setAttribute('aB', this.aB); g.setAttribute('aC', this.aC);
    g.instanceCount = max;
    this.max = max; this.last = max;
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `
        attribute vec4 aA; attribute vec3 aB; attribute vec3 aC; varying vec3 vC; varying vec2 vQ;
        void main() {
          vec4 a = modelViewMatrix * vec4(aA.xyz, 1.0);
          vec4 b = modelViewMatrix * vec4(aB, 1.0);
          vec4 p = mix(a, b, position.x);
          vec2 d = b.xy - a.xy; float l = length(d); d = l > 1e-5 ? d / l : vec2(1.0, 0.0);
          p.xy += vec2(-d.y, d.x) * position.y * aA.w;
          vC = aC; vQ = position.xy;
          gl_Position = projectionMatrix * p;
        }`,
      fragmentShader: `
        varying vec3 vC; varying vec2 vQ;
        void main() {
          float across = clamp(1.0 - abs(vQ.y) * 2.0, 0.0, 1.0);
          float along = pow(clamp(1.0 - vQ.x, 0.0, 1.0), 1.4);   // clamp: pow of a negative is NaN, and bloom smears NaN
          gl_FragColor = vec4(vC * across * along, 1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.n = 0;
  }
  begin() { this.n = 0; }
  push(ax, ay, az, bx, by, bz, w, r, g, b) {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.a.set([ax, ay, az, w], i * 4); this.b.set([bx, by, bz], i * 3); this.c.set([r, g, b], i * 3);
  }
  end() {
    for (let i = this.n; i < this.last; i++) { this.a[i * 4 + 3] = 0; this.c[i * 3] = this.c[i * 3 + 1] = this.c[i * 3 + 2] = 0; }
    this.last = this.n;
    this.aA.needsUpdate = true; this.aB.needsUpdate = true; this.aC.needsUpdate = true;
  }
}

/** The loose belt after it snaps: a strip of quads whose vertices are written every frame. */
export class BeltRibbon {
  constructor(segments, width, material) {
    this.seg = segments; this.width = width;
    const n = (segments + 1) * 2;
    this.posArr = new Float32Array(n * 3);
    const g = this.geo = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.posArr, 3).setUsage(THREE.DynamicDrawUsage));
    const uv = new Float32Array(n * 2), idx = [];
    for (let i = 0; i <= segments; i++) {
      uv.set([i / segments, 0, i / segments, 1], i * 4);
      if (i < segments) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.visible = false;
  }
  /** fn(s in 0..1, out Vector3 centre, out Vector3 side) */
  write(fn) {
    const c = this._c || (this._c = new THREE.Vector3()), s = this._s || (this._s = new THREE.Vector3());
    const P = this.posArr, hw = this.width / 2;
    for (let i = 0; i <= this.seg; i++) {
      fn(i / this.seg, c, s);
      P[i * 6] = c.x - s.x * hw; P[i * 6 + 1] = c.y - s.y * hw; P[i * 6 + 2] = c.z - s.z * hw;
      P[i * 6 + 3] = c.x + s.x * hw; P[i * 6 + 4] = c.y + s.y * hw; P[i * 6 + 5] = c.z + s.z * hw;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.computeVertexNormals();
  }
}

/** White flash over the 3D view only (inserted under the HUD and the brain panel). */
export class FlashOverlay {
  constructor() {
    let el = document.getElementById('pw-flash');
    if (!el) {
      el = document.createElement('div');
      el.id = 'pw-flash';
      el.style.cssText = 'position:fixed;inset:0;pointer-events:none;opacity:0;' +
        'background:radial-gradient(ellipse at 36% 45%, #ffffff 0%, #fff6fb 45%, #ffd9f4 100%);';
      const canvas = document.getElementById('stage');
      canvas.after(el);
    }
    this.el = el; this.v = -1;
  }
  set(v) {
    v = Math.round(v * 1000) / 1000;
    if (v === this.v) return;
    this.v = v;
    this.el.style.opacity = String(v);
  }
}
