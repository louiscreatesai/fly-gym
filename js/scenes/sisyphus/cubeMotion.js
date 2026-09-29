// Where the sugar cube is at loop time u. All analytic (pure functions of u).
//  push:   progress p (mm) = position of the cube's front-bottom edge along the ground.
//          p <= 0 flat floor, 0..a tilting onto the ramp (concave corner), a..S+0.4a on the slope.
//  teeter: pivots on the lip corner, tilts flat onto the plateau ... and tips back.
//  tumble: rolls back over its edge, bounces over the ducking fly, two more bounces, crashes on the floor.
import { HILL } from './world.js';
import { CUBE_A } from './cube.js';
import { track, clamp, lerp, sstep, window4 } from './util.js';

export const PERIOD = 9.0;
export const U_FALL = 2.0;       // fly ducks, stepper domain ends
export const U_WAKE = 3.15;      // stepper domain starts (after the slide)
/** stepper/push time: continuous over [U_WAKE, PERIOD + U_FALL) */
export const sigmaOf = u => (u >= U_WAKE ? u : u + PERIOD);

const a = CUBE_A, H = HILL, RE = 0.16;
const th = H.theta;
export const OVERHANG = 0.4 * a;          // how far the front sticks out over the lip before it tips
export const P_LIP = H.S + OVERHANG;
export const P_REST = -0.5;

/** support radius of the rounded cube along a direction at angle psi to its face normal */
export const support = psi => (a / 2 - RE) * (Math.abs(Math.cos(psi)) + Math.abs(Math.sin(psi))) + RE;

// ---- push progress (sigma domain) ------------------------------------------------------
// the slip (payoff 2): the fly loses its footing, cube + fly slide back, a hind leg stomps, it holds.
export const SLIP = { t0: 6.1, t1: 6.34, catch: 6.34, hold: 6.66 };
const pKeys = [
  [U_WAKE, P_REST], [3.9, P_REST],
  [4.06, P_REST + 0.3],               // headbutt shove
  [4.28, 0.0],                        // bumps into the foot of the ramp
  [4.95, a],                          // levered onto the ramp
  [SLIP.t0, a + 2.0],
  [SLIP.t1, a + 0.95],                // slips back a whole millimetre
  [SLIP.hold, a + 1.0],               // caught, holding
  [9.0, 8.15],                         // loop point: cube ~80% up, slowing down
  [10.6, P_LIP],                      // front edge over the lip
];
const pTrack = track(pKeys);
/** heave rhythm while pushing: velocity pulses, never backwards */
function surge(s) {
  const w = window4(4.35, 4.6, 5.9, 6.1, s) + window4(6.62, 6.9, 10.3, 10.55, s);
  const f = 1.55;
  return w * 0.13 * Math.sin(6.2832 * f * s);
}
export function pushP(s) { return pTrack(s) + surge(s); }

// ---- teeter + tumble (u domain) --------------------------------------------------------
export const T_TIP0 = 1.60, T_FLAT = 1.79, T_BACK = 2.08;
function teeterPsi(u) {
  if (u < T_TIP0) return th;
  if (u < T_FLAT) { const k = (u - T_TIP0) / (T_FLAT - T_TIP0); return th * (1 - k * k); }    // falls forward, flat
  if (u < 1.95) {                                                                          // teeters on the lip
    const k = u - T_FLAT;
    return 0.075 * Math.max(0, Math.sin(k * 26)) * Math.exp(-k * 4) + 0.05 * sstep(1.86, 1.95, u);
  }
  const k = clamp((u - 1.95) / (T_BACK - 1.95), 0, 1);
  return 0.05 + (th - 0.05) * k * k;                                                        // tips back
}
const lipP = { x: H.x1, y: H.H };

function gpt(s) {   // ground point at arclength s (z=0)
  if (s <= 0) return { x: H.x0 + s, y: 0 };
  if (s <= H.S) return { x: H.x0 + s * H.cos, y: s * H.sin };
  return { x: H.x1 + (s - H.S), y: H.H };
}
/** lowest allowed centre y at x for rotation psi (slope + floor; plateau when past the lip) */
export function floorY(x, psi) {
  const yf = support(psi);
  const ys = (support(psi - th) + H.sin * (x - H.x0)) / H.cos;
  let y = Math.max(yf, x < H.x1 + 0.3 ? ys : -1);
  if (x > H.x1) y = Math.max(y, H.H + support(psi));
  return y;
}

const Bt = gpt(H.S - 0.6 * a);                    // back edge when it lands back on the slope
const rollC = psi => ({ x: Bt.x + (a / 2) * (Math.cos(psi) - Math.sin(psi)), y: Bt.y + (a / 2) * (Math.sin(psi) + Math.cos(psi)) });
const PSI_R1 = th + 0.62;
const onSlopeC = (s, psiRel = 0) => { const g = gpt(s); return { x: g.x - H.sin * support(psiRel), y: g.y + H.cos * support(psiRel) }; };
export const X_REST = H.x0 + P_REST - a / 2;

// flight segments: [t0, t1, x0, x1, psi0, psi1, apex, y0?, y1?]
const segs = [];
{
  const c0 = rollC(PSI_R1);
  const c1 = onSlopeC(3.25);
  segs.push({ t0: 2.17, t1: 2.50, x0: c0.x, y0: c0.y, x1: c1.x, y1: c1.y, p0: PSI_R1, p1: th + Math.PI, apex: 2.1 });
  const c2 = onSlopeC(0.95);
  segs.push({ t0: 2.50, t1: 2.69, x0: c1.x, y0: c1.y, x1: c2.x, y1: c2.y, p0: th + Math.PI, p1: th + 1.5 * Math.PI, apex: 0.95 });
  const c3 = { x: H.x0 - 1.22, y: a / 2 };
  segs.push({ t0: 2.69, t1: 2.86, x0: c2.x, y0: c2.y, x1: c3.x, y1: c3.y, p0: th + 1.5 * Math.PI, p1: 2 * Math.PI, apex: 0.75 });
  const c4 = { x: X_REST + 0.06, y: a / 2 };
  segs.push({ t0: 2.86, t1: 2.99, x0: c3.x, y0: c3.y, x1: c4.x, y1: c4.y, p0: 2 * Math.PI, p1: 2 * Math.PI - 0.07, apex: 0.16 });
}
export const IMPACTS = [
  { t: T_FLAT, x: H.x1 + 0.2, surf: 'plateau', sq: 0.06, dust: 0.0 },
  { t: T_BACK, x: Bt.x, surf: 'slope', sq: 0.0, dust: 0.35 },
  { t: 2.50, x: segs[0].x1, surf: 'slope', sq: 0.16, dust: 0.6 },
  { t: 2.69, x: segs[1].x1, surf: 'slope', sq: 0.12, dust: 0.45 },
  { t: 2.86, x: segs[2].x1, surf: 'flat', sq: 0.24, dust: 1.0, crumbs: true },
  { t: 2.99, x: segs[3].x1, surf: 'flat', sq: 0.06, dust: 0.0 },
];

/**
 * Cube pose at loop time u.
 * out: cx, cy (centre), psi (rotation about z), alpha (angle of the surface it sits on),
 *      bx, by (back-bottom edge, the face the fly pushes), sq (squash), progress (0..1), mode
 */
export function cubePose(u, out) {
  out.sq = 0;
  let mode;
  if (u >= T_TIP0 && u < U_WAKE) {
    if (u < T_BACK) {
      mode = 'teeter';
      const psi = teeterPsi(u);
      const c = Math.cos(psi), s = Math.sin(psi);
      out.psi = psi;
      out.cx = lipP.x + (-0.1 * a) * c - (0.5 * a) * s;
      out.cy = lipP.y + (-0.1 * a) * s + (0.5 * a) * c;
      out.bx = lipP.x - 0.6 * a * c;
      out.by = lipP.y - 0.6 * a * s;
      out.alpha = 0;
      out.progress = 1;
    } else {
      mode = 'tumble';
      if (u < segs[0].t0) {
        const k = (u - T_BACK) / (segs[0].t0 - T_BACK);
        const psi = th + (PSI_R1 - th) * (k * k * 0.4 + k * 0.6);
        const c = rollC(psi);
        out.psi = psi; out.cx = c.x; out.cy = c.y;
      } else {
        let sg = segs[segs.length - 1];
        for (const g of segs) if (u < g.t1) { sg = g; break; }
        if (u >= sg.t1) {
          // resting: a small rock and settle
          const k = u - sg.t1;
          out.cx = sg.x1 - 0.06 * sstep(0, 0.15, k);
          out.psi = 2 * Math.PI - 0.07 * Math.cos(k * 22) * Math.exp(-k * 14);
          out.cy = floorY(out.cx, out.psi);
        } else {
          const k = (u - sg.t0) / (sg.t1 - sg.t0);
          out.cx = lerp(sg.x0, sg.x1, k);
          out.psi = lerp(sg.p0, sg.p1, k);
          const yl = lerp(sg.y0, sg.y1, k) + 4 * sg.apex * k * (1 - k);
          out.cy = Math.max(yl, floorY(out.cx, out.psi));
        }
      }
      out.alpha = out.cx > H.x0 + 0.3 ? th : 0;
      // back face not used in tumble; keep something sane
      out.bx = out.cx; out.by = out.cy;
      const sF = out.cx < H.x0 ? 0 : (out.cx - H.x0) / H.cos + a / 2;
      out.progress = clamp(sF / H.S, 0, 1);
    }
    // squash from impacts
    for (const im of IMPACTS) {
      const dt = u - im.t;
      if (dt >= 0 && dt < 0.4 && im.sq) out.sq += im.sq * Math.exp(-dt * 13) * Math.cos(dt * 34);
    }
  } else {
    mode = 'push';
    const p = pushP(sigmaOf(u));
    poseFromP(p, out);
    out.progress = clamp(p / H.S, 0, 1);
  }
  out.mode = mode;
  return out;
}

/** cube pose while pushed, from progress p */
export function poseFromP(p, out) {
  let bx, by, psi;
  if (p <= 0) {
    psi = 0; bx = H.x0 + p - a; by = 0;
  } else if (p < a) {
    // concave corner: back edge on the floor, front edge on the slope
    const xB = H.x0 - a + p;
    let lo = 0, hi = th;
    for (let i = 0; i < 22; i++) {
      const m = (lo + hi) / 2;
      const x = H.x0 - a * Math.cos(m) + a * Math.sin(m) / Math.tan(th);
      if (x < xB) lo = m; else hi = m;
    }
    psi = (lo + hi) / 2; bx = xB; by = 0;
  } else {
    psi = th;
    const g = gpt(Math.min(p - a, H.S));
    bx = g.x; by = g.y;
  }
  const c = Math.cos(psi), s = Math.sin(psi);
  out.psi = psi;
  out.bx = bx; out.by = by;
  out.cx = bx + (a / 2) * (c - s);
  out.cy = by + (a / 2) * (s + c);
  out.alpha = p <= 0 ? 0 : psi;
  return out;
}
