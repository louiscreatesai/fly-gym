// NeuroMechFly rig for three.js.
// Loads assets/fly/fly.json + fly.bin (made by tools/export_fly.py) and builds the
// MuJoCo body tree. Units are millimetres. fly.root is Y-up (three.js); inside it the
// MuJoCo frame is kept (x forward, y left, z up), so joint axes match the MJCF.
//
// Joints are hinges applied in MJCF order: body.quat = rest * R(axis1,a1) * R(axis2,a2) ...
// Bodies without joints in the MJCF (wings, halteres, abdomen, eyes...) get three
// virtual hinges named like the real ones: joint_<Body>_yaw (x), joint_<Body> (y),
// joint_<Body>_roll (z).
import * as THREE from 'three';

export const LEGS = ['LF', 'LM', 'LH', 'RF', 'RM', 'RH'];
// folded-wing rest angles (least squares on the wing mesh: blade axis back and slightly inward, crossing over the abdomen)
export const WING_FOLD = {
  joint_LWing_yaw: 0.0106, joint_LWing: -0.2734, joint_LWing_roll: 0.0166,
  joint_RWing_yaw: -0.0106, joint_RWing: -0.2734, joint_RWing_roll: -0.0166,
};
export const LEG_SEGMENTS = ['Coxa', 'Femur', 'Tibia', 'Tarsus1', 'Tarsus2', 'Tarsus3', 'Tarsus4', 'Tarsus5'];

export async function loadFly({ base = './assets/fly/' } = {}) {
  const [meta, buf] = await Promise.all([
    fetch(base + 'fly.json').then(r => r.json()),
    fetch(base + 'fly.bin').then(r => r.arrayBuffer()),
  ]);
  return new Fly(meta, buf);
}

export function makeFlyMaterials() {
  return {
    body: new THREE.MeshPhysicalMaterial({
      color: 0xe8940f, roughness: 0.6, metalness: 0.0, sheen: 0.25, sheenColor: 0xffc860,
      sheenRoughness: 0.6, emissive: 0x2a1000, emissiveIntensity: 0.3,
    }),
    abdomen: new THREE.MeshPhysicalMaterial({
      color: 0xeca83a, roughness: 0.58, metalness: 0.0, sheen: 0.25, sheenColor: 0xffe0a0,
      emissive: 0x2a1400, emissiveIntensity: 0.25,
    }),
    eye: new THREE.MeshPhysicalMaterial({
      color: 0xe0260f, roughness: 0.35, metalness: 0.0, clearcoat: 0.7, clearcoatRoughness: 0.3,
      emissive: 0x4a0600, emissiveIntensity: 0.3,
    }),
    wing: new THREE.MeshPhysicalMaterial({
      color: 0xc9d4ee, roughness: 0.35, metalness: 0.0, transparent: true, opacity: 0.26,
      side: THREE.DoubleSide, depthWrite: false, iridescence: 0.6, iridescenceIOR: 1.5,
      iridescenceThicknessRange: [250, 650], envMapIntensity: 0.35, specularIntensity: 0.4,
    }),
  };
}

export class Fly {
  constructor(meta, buf, materials = makeFlyMaterials()) {
    this.meta = meta;
    this.materials = materials;
    this.root = new THREE.Group();
    this.root.name = 'FlyRoot';
    this.mj = new THREE.Group();
    this.mj.rotation.x = -Math.PI / 2;           // MuJoCo z-up -> three y-up
    this.root.add(this.mj);
    this.bodies = {};
    this.meshes = {};
    this.joints = {};        // name -> { body, axis: Vector3, range }
    this.bodyJoints = {};    // body name -> [joint names] in order
    this.rest = {};
    this.angles = {};
    this._q = new THREE.Quaternion();

    for (const b of meta.bodies) {
      const o = new THREE.Group();
      o.name = b.name;
      o.position.set(b.pos[0], b.pos[1], b.pos[2]);
      o.quaternion.set(b.quat[1], b.quat[2], b.quat[3], b.quat[0]).normalize();
      this.rest[b.name] = o.quaternion.clone();
      (b.parent ? this.bodies[b.parent] : this.mj).add(o);
      this.bodies[b.name] = o;

      let js = b.joints;
      if (!js.length && b.name !== 'FlyBody') {
        js = [
          { name: `joint_${b.name}_yaw`, axis: [1, 0, 0] },
          { name: `joint_${b.name}`, axis: [0, 1, 0] },
          { name: `joint_${b.name}_roll`, axis: [0, 0, 1] },
        ];
      }
      this.bodyJoints[b.name] = js.map(j => j.name);
      for (const j of js) {
        this.joints[j.name] = { body: b.name, axis: new THREE.Vector3(...j.axis).normalize(), range: j.range || null };
        this.angles[j.name] = 0;
      }

      for (const m of b.meshes) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buf, m.pOff, m.vcount * 3), 3));
        g.setAttribute('normal', new THREE.BufferAttribute(new Int8Array(buf, m.nOff, m.vcount * 3), 3, true));
        g.setIndex(new THREE.BufferAttribute(new Uint32Array(buf, m.iOff, m.icount), 1));
        g.computeBoundingSphere();
        const mat = /Eye/.test(m.name) ? materials.eye
          : /Wing/.test(m.name) ? materials.wing
          : /^A\d/.test(m.name) ? materials.abdomen
          : materials.body;
        const mesh = new THREE.Mesh(g, mat);
        mesh.name = 'mesh_' + m.name;
        mesh.position.set(m.pos[0], m.pos[1], m.pos[2]);
        mesh.quaternion.set(m.quat[1], m.quat[2], m.quat[3], m.quat[0]).normalize();
        mesh.castShadow = !/Wing/.test(m.name);
        mesh.receiveShadow = true;
        if (/Wing/.test(m.name)) mesh.renderOrder = 2;
        o.add(mesh);
        this.meshes[m.name] = mesh;
      }
    }
    // wings: a hinge group between thorax and wing so scenes can spread / flap them
    // in the thorax frame. Rest = folded back over the abdomen (solved from the mesh).
    this.wingHinge = {};
    for (const w of ['LWing', 'RWing']) {
      const body = this.bodies[w];
      const hinge = new THREE.Group();
      hinge.name = w + 'Hinge';
      hinge.position.copy(body.position);
      hinge.rotation.order = 'XYZ';
      body.parent.add(hinge);
      body.position.set(0, 0, 0);
      hinge.add(body);
      this.wingHinge[w] = hinge;
    }
    this.tripod = { ...meta.tripod, ...WING_FOLD };
    this.setPose(this.tripod);
    this.apply();
  }

  /**
   * Wings in the thorax frame. spread: 0 folded, ~1.3 straight out sideways.
   * pitch: raises the tips (radians). flap: stroke about the body axis (use with spread).
   */
  setWings({ spread = 0, pitch = 0, flap = 0 } = {}) {
    const L = this.wingHinge.LWing, R = this.wingHinge.RWing;
    L.rotation.set(flap, pitch, -spread);
    R.rotation.set(-flap, pitch, spread);
    return this;
  }

  /** Set one joint angle in radians. */
  set(name, a) {
    if (name in this.angles) this.angles[name] = a;
    return this;
  }
  get(name) { return this.angles[name] || 0; }

  /** Set many joints from {jointName: radians}. With w < 1 it blends from the current angles. */
  setPose(pose, w = 1) {
    for (const k in pose) if (k in this.angles) this.angles[k] = w >= 1 ? pose[k] : this.angles[k] + (pose[k] - this.angles[k]) * w;
    return this;
  }
  /** Add offsets {jointName: radians} to the current angles. */
  addPose(pose, w = 1) {
    for (const k in pose) if (k in this.angles) this.angles[k] += pose[k] * w;
    return this;
  }
  getPose() { return { ...this.angles }; }
  /** Linear blend of two poses. */
  static mix(a, b, t) {
    const o = {};
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) o[k] = (a[k] || 0) + ((b[k] || 0) - (a[k] || 0)) * t;
    return o;
  }

  /** Write the joint angles into the body quaternions. Call once per frame after posing. */
  apply() {
    const q = this._q;
    for (const name in this.bodyJoints) {
      const o = this.bodies[name];
      o.quaternion.copy(this.rest[name]);
      for (const jn of this.bodyJoints[name]) {
        const a = this.angles[jn];
        if (a) o.quaternion.multiply(q.setFromAxisAngle(this.joints[jn].axis, a));
      }
    }
    this.root.updateWorldMatrix(true, true);   // parents too, so reach() sees fresh matrices
    return this;
  }

  /** Re-pose one body and its subtree only (cheap, used by reach()). */
  applyBody(name) {
    const o = this.bodies[name];
    o.quaternion.copy(this.rest[name]);
    for (const jn of this.bodyJoints[name]) {
      const a = this.angles[jn];
      if (a) o.quaternion.multiply(this._q.setFromAxisAngle(this.joints[jn].axis, a));
    }
    o.updateMatrixWorld(true);
  }

  /** World position of a body origin (e.g. 'LFTarsus5', 'Head'). */
  worldPos(body, out = new THREE.Vector3()) {
    return this.bodies[body].getWorldPosition(out);
  }
  /** World position of a leg tip (end of tarsus 5). */
  tip(leg, out = new THREE.Vector3()) {
    const o = this.bodies[leg + 'Tarsus5'];
    return out.set(0, 0, -0.06).applyMatrix4(o.matrixWorld);
  }

  /**
   * CCD inverse kinematics: move a leg tip toward a world target.
   * joints: which hinges may move (default coxa pitch/roll, femur, tibia, tarsus1).
   * Returns remaining distance (mm).
   */
  reach(leg, target, { iters = 12, gain = 1, joints = null, tipBody = null } = {}) {
    const chain = joints || [
      `joint_${leg}Tarsus1`, `joint_${leg}Tibia`, `joint_${leg}Femur`, `joint_${leg}Femur_roll`,
      `joint_${leg}Coxa`, `joint_${leg}Coxa_roll`, `joint_${leg}Coxa_yaw`,
    ];
    this.apply();
    const tipOf = () => tipBody ? this.worldPos(tipBody, _t) : this.tip(leg, _t);
    const wq = _wq;
    for (let it = 0; it < iters; it++) {
      for (const jn of chain) {
        const J = this.joints[jn];
        if (!J) continue;
        const body = this.bodies[J.body];
        const p = body.getWorldPosition(_p);
        // world axis of this joint = parentWorld * rest * R(previous joints in this body) * axis
        body.parent.getWorldQuaternion(wq);
        wq.multiply(this.rest[J.body]);
        for (const pj of this.bodyJoints[J.body]) {
          if (pj === jn) break;
          wq.multiply(this._q.setFromAxisAngle(this.joints[pj].axis, this.angles[pj]));
        }
        const w = _w.copy(J.axis).applyQuaternion(wq).normalize();
        const tip = tipOf();
        const a = _a.subVectors(tip, p); a.addScaledVector(w, -a.dot(w));
        const b = _b.subVectors(target, p); b.addScaledVector(w, -b.dot(w));
        if (a.lengthSq() < 1e-10 || b.lengthSq() < 1e-10) continue;
        let ang = Math.atan2(_c.crossVectors(a, b).dot(w), a.dot(b));
        let na = this.angles[jn] + ang * gain;
        if (J.range) na = Math.min(Math.max(na, J.range[0]), J.range[1]);
        this.angles[jn] = na;
        this.applyBody(J.body);
      }
      if (tipOf().distanceTo(target) < 0.005) break;
    }
    return tipOf().distanceTo(target);
  }
}

const _t = new THREE.Vector3(), _p = new THREE.Vector3(), _w = new THREE.Vector3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _wq = new THREE.Quaternion();
