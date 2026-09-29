// The 3D stage shared by every scene: renderer, dark grid world, glowing platform,
// soft lights, bloom, and camera presets with smooth moves.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const PALETTE = {
  bg: 0x090b13,
  grid: 0x2b3150,
  gridMajor: 0x3d4570,
  platform: 0x9ea9c6,       // light blue-grey slab
  platformSide: 0x5d6782,
  edge: 0xb78cff,           // glowing purple rim
  steel: 0x8e9ab3,
  steelDark: 0x4a5470,
  accent: 0xc79bff,         // purple/pink hex accents
  teal: 0x2dd4bf,
};

export class Stage {
  constructor(canvas, { bloom = true } = {}) {
    this.canvas = canvas;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    const coarse = window.matchMedia && matchMedia('(pointer: coarse)').matches;   // phones: cap resolution for speed
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.25 : 1.5));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.92;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;

    const s = this.scene = new THREE.Scene();
    s.background = new THREE.Color(PALETTE.bg);
    s.fog = new THREE.Fog(PALETTE.bg, 30, 90);

    const pm = new THREE.PMREMGenerator(r);
    s.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    s.environmentIntensity = 0.35;

    this.camera = new THREE.PerspectiveCamera(32, 16 / 9, 0.05, 400);
    this.camera.position.set(6, 5, 9);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, 1.5, 0);
    this.focus = { x: 0.36, y: 0.5 };   // where the target lands on screen (fraction of width/height)

    this._lights();
    this.grid = this._grid();
    s.add(this.grid);

    this.composer = null;
    if (bloom) {
      this.composer = new EffectComposer(r);
      this.composer.addPass(new RenderPass(s, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.3, 0.45, 0.95);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    }
    this.presets = {};
    this.tween = null;
    this.shake = 0;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  _lights() {
    const s = this.scene;
    s.add(new THREE.HemisphereLight(0xbcc8ff, 0x1a1626, 0.55));
    const key = this.key = new THREE.DirectionalLight(0xfff1dc, 2.0);
    key.position.set(6, 12, 7);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const sc = key.shadow.camera;
    sc.left = -9; sc.right = 9; sc.top = 9; sc.bottom = -9; sc.near = 1; sc.far = 40;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    key.shadow.radius = 4;
    s.add(key);
    const rim = new THREE.DirectionalLight(0x9d7bff, 1.4);
    rim.position.set(-8, 5, -6);
    s.add(rim);
    const fill = new THREE.DirectionalLight(0x7fd6ff, 0.45);
    fill.position.set(-4, 2, 8);
    s.add(fill);
  }

  _grid() {
    const size = 400;
    const g = new THREE.PlaneGeometry(size, size, 1, 1);
    g.rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: {
        uMinor: { value: new THREE.Color(PALETTE.grid) },
        uMajor: { value: new THREE.Color(PALETTE.gridMajor) },
        uBg: { value: new THREE.Color(PALETTE.bg) },
        uCell: { value: 1.0 },
      },
      vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
      fragmentShader: `
        uniform vec3 uMinor; uniform vec3 uMajor; uniform vec3 uBg; uniform float uCell; varying vec3 vW;
        float line(vec2 p, float cell, float w){ vec2 c = p/cell; vec2 d = abs(fract(c-0.5)-0.5)/fwidth(c); return 1.0-min(min(d.x,d.y)/w,1.0); }
        void main(){
          float minor = line(vW.xz, uCell, 1.0);
          float major = line(vW.xz, uCell*5.0, 1.3);
          float dist = length(vW.xz);
          float fade = 1.0 - smoothstep(12.0, 70.0, dist);
          vec3 col = mix(uBg, uMinor, minor*0.55);
          col = mix(col, uMajor, major*0.8);
          float a = max(minor*0.55, major*0.85) * fade;
          gl_FragColor = vec4(col, a);
        }`,
    });
    const m = new THREE.Mesh(g, mat);
    m.position.y = -0.46;            // under the slab bottom (default platform h 0.45), no z-fighting with the slab top
    m.renderOrder = -1;
    return m;
  }

  /**
   * A slab platform with rounded corners and a glowing purple rim.
   * Returns a Group whose top surface is at y = 0 of the group.
   */
  platform({ w = 12, d = 8, h = 0.45, color = PALETTE.platform, edge = PALETTE.edge, radius = 0.12 } = {}) {
    const grp = new THREE.Group();
    const slab = new THREE.Mesh(
      new RoundedBoxGeometry(w, h, d, 4, radius),
      new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.08 }),
    );
    slab.position.y = -h / 2;
    slab.receiveShadow = true;
    slab.castShadow = true;
    grp.add(slab);
    // glowing rim just inside the top edge
    const inset = 0.08;
    const pts = [
      [-w / 2 + inset, -d / 2 + inset], [w / 2 - inset, -d / 2 + inset],
      [w / 2 - inset, d / 2 - inset], [-w / 2 + inset, d / 2 - inset],
    ];
    const rimMat = new THREE.MeshBasicMaterial({ color: edge, toneMapped: false });
    for (let i = 0; i < 4; i++) {
      const a = pts[i], b = pts[(i + 1) % 4];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(len, 0.025, 0.035), rimMat);
      bar.position.set((a[0] + b[0]) / 2, 0.005, (a[1] + b[1]) / 2);
      bar.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]);
      grp.add(bar);
    }
    // soft glow skirt under the slab
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(w * 1.25, d * 1.25),
      new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { uC: { value: new THREE.Color(edge) }, uR: { value: new THREE.Vector2(w / 2, d / 2) } },
        vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
        fragmentShader: `uniform vec3 uC; uniform vec2 uR; varying vec2 vP;
          void main(){ vec2 q = abs(vP) - uR; float dd = length(max(q,0.)) + min(max(q.x,q.y),0.);
          float a = exp(-max(dd,0.)*2.2) * 0.22 * step(0.0, dd); gl_FragColor = vec4(uC*a, 1.0); }`,
      }),
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = -h + 0.002;
    grp.add(glow);
    grp.userData.size = { w, d, h };
    return grp;
  }

  /** Register camera presets: { name: { pos:[x,y,z], target:[x,y,z], fov } }. */
  setPresets(p) { this.presets = p; }

  /** Move the camera to a preset. dur in seconds (0 = cut). */
  goto(name, dur = 0.9) {
    const p = this.presets[name];
    if (!p) return;
    this.current = name;             // scenes can read this to run a follow camera for one preset
    const from = { pos: this.camera.position.clone(), target: this.controls.target.clone(), fov: this.camera.fov };
    const to = { pos: new THREE.Vector3(...p.pos), target: new THREE.Vector3(...p.target), fov: p.fov || from.fov };
    if (!dur) {
      this.camera.position.copy(to.pos); this.controls.target.copy(to.target); this.camera.fov = to.fov;
      this.camera.updateProjectionMatrix(); this.tween = null; return;
    }
    this.tween = { from, to, t: 0, dur };
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.camera.aspect = w / h;
    this.focus.x = w / h < 1 ? 0.5 : 0.36;   // portrait (phones): centred; wide: the phone strip at 36%
    // shift the image so the orbit target lands at focus.x of the screen width
    const dx = (0.5 - this.focus.x) * w, dy = (0.5 - this.focus.y) * h;
    this.camera.setViewOffset(w, h, dx, dy, w, h);
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
    }
  }

  /** Call every frame. */
  render(dt) {
    if (this.tween) {
      const tw = this.tween;
      tw.t = Math.min(1, tw.t + dt / tw.dur);
      const e = tw.t < 0.5 ? 4 * tw.t ** 3 : 1 - (-2 * tw.t + 2) ** 3 / 2;
      this.camera.position.lerpVectors(tw.from.pos, tw.to.pos, e);
      this.controls.target.lerpVectors(tw.from.target, tw.to.target, e);
      this.camera.fov = tw.from.fov + (tw.to.fov - tw.from.fov) * e;
      this.camera.updateProjectionMatrix();
      if (tw.t >= 1) this.tween = null;
    }
    this.controls.update();
    let saved = null;
    if (this.calm) this.shake = 0;   // calm mode: no camera shake
    if (this.shake > 0.0005) {
      saved = this.camera.position.clone();
      const k = this.shake;
      this.camera.position.x += (Math.random() - 0.5) * k;
      this.camera.position.y += (Math.random() - 0.5) * k;
      this.camera.position.z += (Math.random() - 0.5) * k;
      this.shake *= Math.pow(0.02, dt);   // decays fast
    }
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
    if (saved) this.camera.position.copy(saved);
  }
}
