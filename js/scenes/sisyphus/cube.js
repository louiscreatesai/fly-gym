// The sugar cube: rounded, white, granular (canvas grain as colour + bump + roughness),
// with glittering crystal specks (one Points draw call), plus a dust puff and crumbs
// for impacts. Everything is a pure function of the time you pass in.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const CUBE_A = 2.2;   // edge (mm): about 1.3x the fly's standing height

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function grainCanvas(size, seed, kind) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const r = rng(seed);
  if (kind === 'color') {
    g.fillStyle = '#f4f3ef'; g.fillRect(0, 0, size, size);
  } else {
    g.fillStyle = '#808080'; g.fillRect(0, 0, size, size);
  }
  // pressed granules: many small rotated crystals of varied brightness
  const n = size * size / 18;
  for (let i = 0; i < n; i++) {
    const x = r() * size, y = r() * size;
    const w = 2 + r() * 6, h = 2 + r() * 5;
    const a = r() * Math.PI;
    const v = r();
    g.save(); g.translate(x, y); g.rotate(a);
    if (kind === 'color') {
      const l = 0.86 + v * 0.14;
      const warm = (r() - 0.5) * 6;
      g.fillStyle = `rgb(${Math.round(255 * l + warm)},${Math.round(252 * l)},${Math.round(246 * l - warm)})`;
    } else {
      const l = Math.round(60 + v * 150);
      g.fillStyle = `rgb(${l},${l},${l})`;
    }
    g.fillRect(-w / 2, -h / 2, w, h);
    g.restore();
  }
  // a few darker pits (air gaps between granules)
  for (let i = 0; i < n / 10; i++) {
    const x = r() * size, y = r() * size, rr = 0.8 + r() * 1.6;
    g.fillStyle = kind === 'color' ? 'rgba(200,196,190,0.8)' : 'rgba(20,20,20,0.9)';
    g.beginPath(); g.arc(x, y, rr, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 8;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (kind === 'color') t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildCube(ctx) {
  const a = CUBE_A;
  const grp = new THREE.Group();        // anchor: contact frame (pos/rot/squash set by the scene)
  const spin = new THREE.Group();       // cube centre + rotation
  grp.add(spin);

  const geo = new RoundedBoxGeometry(a, a, a, 4, 0.16);
  const map = grainCanvas(512, 7, 'color');
  const bump = grainCanvas(512, 7, 'bump');
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, map, bumpMap: bump, bumpScale: 1.6,
    roughnessMap: bump, roughness: 0.78, metalness: 0,
    sheen: 0.6, sheenColor: 0xfff6ee, sheenRoughness: 0.5,
    clearcoat: 0.15, clearcoatRoughness: 0.55,
    emissive: 0xe8ecff, emissiveIntensity: 0.07,
    transmission: 0.0, thickness: 1.2,
  });
  const cube = new THREE.Mesh(geo, mat);
  cube.castShadow = true;
  cube.receiveShadow = true;
  spin.add(cube);

  // glitter: specks on the cube's surface that twinkle
  const N = 90;
  const r = rng(99);
  const pos = new Float32Array(N * 3), ph = new Float32Array(N), sz = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const face = Math.floor(r() * 6), ax = face >> 1, sgn = face & 1 ? 1 : -1;
    const p = [(r() - 0.5) * a * 0.9, (r() - 0.5) * a * 0.9, (r() - 0.5) * a * 0.9];
    p[ax] = sgn * (a / 2 + 0.012);
    pos.set(p, i * 3);
    ph[i] = r() * 100;
    sz[i] = 0.6 + r() * 0.8;
  }
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  pg.setAttribute('aPh', new THREE.BufferAttribute(ph, 1));
  pg.setAttribute('aSz', new THREE.BufferAttribute(sz, 1));
  const glitterMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uScale: { value: 1 } },
    vertexShader: `
      attribute float aPh; attribute float aSz; uniform float uTime; uniform float uScale; varying float vA;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        // twinkle: short bright glints at random times
        float s = sin(uTime * (2.3 + fract(aPh) * 2.0) + aPh);
        float tw = pow(max(s, 0.0), 14.0);
        // glints mostly on faces turned to the viewer
        vec3 n = normalize(normalMatrix * normalize(position));
        float facing = clamp(dot(n, normalize(-mv.xyz)), 0.0, 1.0);
        vA = tw * (0.35 + 0.65 * facing);
        gl_PointSize = aSz * uScale * (0.4 + 1.6 * tw) / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying float vA;
      void main(){
        vec2 d = gl_PointCoord - 0.5;
        float r = length(d);
        float star = max(0.0, 1.0 - r * 2.0);
        float cross = max(0.0, 1.0 - abs(d.x) * 9.0) * max(0.0, 1.0 - abs(d.y) * 2.2)
                    + max(0.0, 1.0 - abs(d.y) * 9.0) * max(0.0, 1.0 - abs(d.x) * 2.2);
        float a = (star * star + cross * 0.7) * vA;
        gl_FragColor = vec4(vec3(1.6, 1.55, 1.7) * a, a);
      }`,
  });
  const glitter = new THREE.Points(pg, glitterMat);
  glitter.frustumCulled = false;
  spin.add(glitter);

  // dust puffs (one group of particles per impact) + crumbs for the big crash (world space)
  const G = 44, NG = 5, DN = G * NG;
  const dpos = new Float32Array(DN * 3), dA = new Float32Array(DN), dS = new Float32Array(DN);
  const dg = new THREE.BufferGeometry();
  dg.setAttribute('position', new THREE.BufferAttribute(dpos, 3));
  dg.setAttribute('aA', new THREE.BufferAttribute(dA, 1));
  dg.setAttribute('aS', new THREE.BufferAttribute(dS, 1));
  const dustMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uScale: { value: 1 } },
    vertexShader: `attribute float aA; attribute float aS; uniform float uScale; varying float vA;
      void main(){ vec4 mv = modelViewMatrix*vec4(position,1.); vA = aA;
        gl_PointSize = uScale * aS / -mv.z; gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `varying float vA; void main(){ float r = length(gl_PointCoord-0.5)*2.0; float a = smoothstep(1.0,0.0,r)*vA;
      gl_FragColor = vec4(vec3(0.98,0.97,1.0)*1.05, a); }`,
  });
  const dust = new THREE.Points(dg, dustMat);
  dust.frustumCulled = false;
  dust.renderOrder = 3;
  const dr = rng(5);
  const dustSeed = [];
  for (let i = 0; i < DN; i++) {
    const ang = dr() * Math.PI * 2;
    const sp = 0.6 + dr() * 1.0;
    dustSeed.push({ c: Math.cos(ang), s: Math.sin(ang), sp, up: 0.2 + dr() * 0.9, life: 0.55 + dr() * 0.6, sz: 0.5 + dr() * 0.9 });
  }

  const CN = 18;
  const crumbGeo = new RoundedBoxGeometry(0.17, 0.17, 0.17, 1, 0.035);
  const crumbs = new THREE.InstancedMesh(crumbGeo, new THREE.MeshStandardMaterial({ color: 0xf6f4ef, roughness: 0.7, emissive: 0xffffff, emissiveIntensity: 0.06 }), CN);
  crumbs.castShadow = true;
  crumbs.frustumCulled = false;
  const cr = rng(11);
  const crumbSeed = [];
  for (let i = 0; i < CN; i++) {
    const ang = cr() * Math.PI * 2;
    const sp = 0.7 + cr() * 2.0;
    crumbSeed.push({ vx: Math.cos(ang) * sp, vz: Math.sin(ang) * sp, vy: 1.4 + cr() * 2.4, s: 0.45 + cr() * 0.9, rx: cr() * 20, ry: cr() * 20 });
  }
  ctx.scene.add(grp, dust, crumbs);

  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();

  return {
    grp, spin, cube, glitter, dust, crumbs, mat,
    setTime(t, pxScale) {
      glitterMat.uniforms.uTime.value = t;
      glitterMat.uniforms.uScale.value = pxScale * 0.12;
      dustMat.uniforms.uScale.value = pxScale * 0.55;
    },
    /**
     * Dust for up to 5 impacts [{t, x, y, z, dust, crumbs}] at time u (pure function of u).
     * groundY(x) is the floor height; crumbs fly from the impact flagged `crumbs`.
     */
    impacts(u, list, groundY) {
      for (let g = 0; g < NG; g++) {
        const im = list[g];
        const dt = im ? u - im.t : -1;
        const on = im && im.dust > 0 && dt >= 0 && dt < 1.6;
        for (let j = 0; j < G; j++) {
          const i = g * G + j;
          if (!on) { dA[i] = 0; dpos[i * 3 + 1] = -99; continue; }
          const d = dustSeed[i];
          const st = im.dust;
          const k = 1 - Math.exp(-dt * 4.0);
          const r = d.sp * (0.55 + 0.9 * st) * k;
          const x = im.x + d.c * r;
          const z = im.z + d.s * r;
          const y = Math.max(groundY(x), im.y) + 0.08 + d.up * (0.4 + 0.8 * st) * k - 0.05 * dt;
          dpos[i * 3] = x; dpos[i * 3 + 1] = Math.max(y, groundY(x) + 0.04); dpos[i * 3 + 2] = z;
          const life = d.life * (0.6 + 0.6 * st);
          dA[i] = Math.max(0, 1 - dt / life) ** 1.5 * Math.min(1, dt * 25) * (0.35 + 0.35 * st);
          dS[i] = d.sz * (0.5 + 1.1 * k) * (0.6 + 0.6 * st);
        }
      }
      dg.attributes.position.needsUpdate = true;
      dg.attributes.aA.needsUpdate = true;
      dg.attributes.aS.needsUpdate = true;
      const im = list.find(e => e && e.crumbs);
      const dt = im ? u - im.t : -1;
      for (let i = 0; i < CN; i++) {
        const c = crumbSeed[i];
        if (!(dt >= 0 && dt < 1.7)) { _m.makeScale(0, 0, 0); crumbs.setMatrixAt(i, _m); continue; }
        const g = 12.0;
        const y0 = im.y + 0.2;
        const gy = groundY(im.x) + 0.08 * c.s;
        const tl = (c.vy + Math.sqrt(c.vy * c.vy + 2 * g * Math.max(0, y0 - gy))) / g;   // landing time
        const tt = Math.min(dt, tl);
        let x = im.x + c.vx * tt, z = im.z + c.vz * tt, y = y0 + c.vy * tt - 0.5 * g * tt * tt;
        if (dt >= tl) {                        // a little skid after landing
          const sk = 0.25 * (1 - Math.exp(-(dt - tl) * 8));
          x += c.vx * sk * 0.3; z += c.vz * sk * 0.3; y = groundY(x) + 0.08 * c.s;
        }
        const fade = dt > 1.3 ? Math.max(0, 1 - (dt - 1.3) / 0.4) : 1;
        _e.set(c.rx * tt, c.ry * tt, 0);
        _q.setFromEuler(_e);
        _s.setScalar(c.s * fade);
        _m.compose(_v.set(x, y, z), _q, _s);
        crumbs.setMatrixAt(i, _m);
      }
      crumbs.instanceMatrix.needsUpdate = true;
    },
  };
}
