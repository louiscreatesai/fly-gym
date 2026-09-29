// "I let a fly brain play blackjack for eternity"
// The fly sits on a bar stool at a casino blackjack table and plays hand after hand. Its simulated
// brain makes every hit / stand call: sugar taste neurons = the win, bitter taste neurons at a rate
// that grows with the hand total = the risk; if MN9 (the feeding motor neuron) still fires it HITs,
// otherwise it STANDs (assets/brain/blackjack_policy.json, read at build time; fallback: HIT below 17).
// The cards are staged, the decisions are the policy's (policy.js plans the hands from it).
//
// Calm two-hand loop (PERIOD 9.6 s, seamless: every idle motion has a whole number of cycles per loop).
// With the real policy (MN9 still fires only at total 4: HIT on 4, STAND from 5 up):
//   8.30  hand 1 dealt (2 + 2 vs dealer 10 + hole), 8.96 total 4 shows, brain t04, the fly rubs its front legs
//   0.00  hook: 4 vs 10, rubbing           0.55  HIT: two taps on the felt (0.85, 1.05), proboscis twitch
//   1.17  the hit card slides out of the shoe, flips at 1.51: 7 -> 11, brain t11, rubbing again
//   2.25  STAND on 11 (flat wave over the cards)     2.90  dealer turns 8: 18      3.14  lose, deadpan look
//   3.17  cards swept, 3.43 the bet slides to the rack (bankroll -$65,536), 3.37-4.12 it pushes its side stack in
//   3.57  hand 2 dealt (4 + 2 vs dealer 6), 4.23 total 6 shows, brain t06 (the pan window)
//   5.70  STAND on 6 (wave)   6.42 dealer turns K: 16, must draw   6.84 draws Q, 7.28 26 bust   7.42 win
//   7.46  cards swept, 7.76 payout rises out of the rack, 8.21 in the circle (bankroll back to $1,048,576)
//   8.31  payout slides to the fly, 8.40 it rubs its front legs for the next hand ... forever.
// The plan (and so every time above) is derived from the policy JSON at build time (policy.js); the scene
// refuses to run a plan whose on-screen decisions differ from the policy.
import * as THREE from 'three';
import { buildSet, TABLE, SPOT, CARD_STEP, CARD } from './blackjack/table.js';
import { SeatedFly } from './blackjack/flyrig.js';
import { CardSet, placeCard, handTotal } from './blackjack/cards.js';
import { Chips, Stack, buildStatic, CHIP_COLORS, CHIP } from './blackjack/chips.js';
import { loadPolicy, planLoop } from './blackjack/policy.js';

const PERIOD = 9.6;
const WRAP1 = 8.0;                 // loop time after which hand-1 events belong to the next loop
const DEAL_STAGGER = 0.1, SLIDE = 0.34, FLIP = 0.2;
const SWEEP = 0.28, HOP = 0.14, SWEEP_STAGGER = 0.03;
const TAP_DUR = 0.7, WAVE_DUR = 0.8, HIT_DEAL = 0.62;   // gesture lengths; the hit card leaves the shoe after the taps
const TR = 0.2;                    // leg gesture blend time
const BET = 65536, BANK0 = 1048576;

const clamp01 = k => (k <= 0 ? 0 : k >= 1 ? 1 : k);
const smooth = k => { k = clamp01(k); return k * k * (3 - 2 * k); };
const smoother = k => { k = clamp01(k); return k * k * k * (k * (k * 6 - 15) + 10); };
const easeOut = k => 1 - Math.pow(1 - clamp01(k), 3);
const easeIn = k => Math.pow(clamp01(k), 2);
const bump = (x, w) => (x <= 0 || x >= w ? 0 : Math.sin(Math.PI * x / w));
const lerp = (a, b, k) => a + (b - a) * k;
const fmtMoney = n => '$' + Math.round(n).toLocaleString('en-US');
const wrapU = t => ((t % PERIOD) + PERIOD) % PERIOD;
// idle oscillators with a whole number of cycles per loop, so the loop (and the captured cycle) is seamless
const osc = (u, cycles, ph = 0) => Math.sin(2 * Math.PI * cycles * u / PERIOD + ph);

// camera helper: target, elevation, azimuth (deg, negative = camera on the -z side), distance
function orbit(tgt, el, az, d, fov) {
  const e = el * Math.PI / 180, a = az * Math.PI / 180;
  return { pos: [tgt[0] - d * Math.cos(e) * Math.cos(a), tgt[1] + d * Math.sin(e), tgt[2] + d * Math.cos(e) * Math.sin(a)], target: tgt, fov };
}

const V = () => new THREE.Vector3();
const _a = V(), _b = V(), _c = V(), _d = V();
const REST = { LF: new THREE.Vector3(2.95, TABLE.y + 0.012, 0.4), RF: new THREE.Vector3(2.95, TABLE.y + 0.012, -0.4) };
const RUB = new THREE.Vector3(2.6, 3.8, 0.0);    // claws cross here, in front of the chest

export default {
  pageTitle: 'Fly Gym · blackjack',
  cameras: {
    gym: orbit([1.9, 2.95, 0.0], 27, -8, 9.6, 30),
    front: orbit([3.1, 3.3, 0.0], 12, -4, 9.5, 24),
    close: orbit([1.95, 3.1, 0.05], 50, -22, 5.6, 30),
  },
  defaultCam: 'gym',
  hud: {
    title: 'BLACKJACK · HIGH ROLLER', sub: 'THE FLY BRAIN DECIDES EVERY CARD',
    cams: [['gym', 'Gym view'], ['front', 'Front view'], ['close', 'Close-up']],
    stats: [{ key: 'hand', label: 'HAND' }, { key: 'dealer', label: 'DEALER' }, { key: 'bank', label: 'BANKROLL', small: true }],
    phases: ['DEAL', 'BRAIN DECIDES', 'PAYOUT'],
    footer: 'NeuroMechFly body · MaleCNS brain decides · Methods',
  },

  async build(ctx) {
    const { scene } = ctx;
    const plat = ctx.stage.platform({ w: 15, d: 12 });
    plat.position.set(1.2, 0, 0);
    scene.add(plat);
    this.set = buildSet(ctx);

    // ---- policy -> plan ----
    // &policy=<file> loads another policy JSON from assets/brain/ (a missing file tests the fallback)
    const pq = ctx.params.get('policy');
    this.policy = await loadPolicy(pq ? `./assets/brain/${pq}` : undefined);
    this.plan = planLoop(this.policy);
    this._checkPlan();
    console.info(`blackjack: policy = ${this.policy.source}`, JSON.stringify({ h1: this.plan.h1.decisions, h2: this.plan.h2.decisions }));

    // ---- timeline from the plan ----
    this._buildTimeline();

    // ---- cards ----
    const specs = this.cardTracks.map(c => c.spec);
    this.cards = new CardSet(scene, specs);
    this.cardTracks.forEach((c, i) => { c.mesh = this.cards.meshes[i]; });

    // ---- chips ----
    this.chips = new Chips(scene, 700);
    buildStatic(this.chips);
    const P = CHIP_COLORS;
    const cols = [P.purple, P.pink, P.purple, P.gold, P.purple, P.pink, P.purple];
    // three identical stacks rotate roles every loop (bet -> lost, side -> bet, payout -> side)
    this.X = new Stack(this.chips, cols, 3);
    this.Y = new Stack(this.chips, cols, 3);
    this.Z = new Stack(this.chips, cols, 3);

    // ---- fly ----
    this.rig = new SeatedFly(ctx.fly);
    this.rig.build();
    this._legSeeds();
    this.st = {
      lean: 0.2, sway: 0, breath: 0, head: [0.5, 0, 0], antL: [0, 0, 0], antR: [0, 0, 0], prob: 0,
      wings: { spread: 0, pitch: 0, flap: 0 },
      LF: { A: null, B: null, k: 0 },
      RF: { A: null, B: null, k: 0 },
    };
    this._ta = { LF: V(), RF: V() }; this._tb = { LF: V(), RF: V() };
    this._rj = { LF: {}, RF: {} };
    const mkD = () => ({ type: 'ik', seed: '', target: V(), tip: V(), wrist: V(), joints: null });
    this._desc = { LF: [mkD(), mkD()], RF: [mkD(), mkD()] };
    this.clip = null;
    // compile every program once with everything visible (first card flip must not stall)
    for (const m of this.cards.meshes) m.visible = true;
    ctx.stage.renderer.compile(scene, ctx.camera);
    for (const m of this.cards.meshes) m.visible = false;
    for (let i = 0; i < 3; i++) await new Promise(r => requestAnimationFrame(r));
  },

  /** refuse to run a plan whose on-screen decisions differ from the policy */
  _checkPlan() {
    const { h1, h2 } = this.plan;
    for (const h of [h1, h2]) for (const d of h.decisions) {
      if (this.policy.decide(d.total) !== d.d) throw new Error(`plan contradicts the policy at ${d.total}`);
    }
  },

  _buildTimeline() {
    const { h1, h2 } = this.plan;
    const tl = this.tl = {};
    const tracks = this.cardTracks = [];
    const cy = TABLE.y + CARD.t / 2 + 0.003;
    const spotP = k => [SPOT.cards[0] + k * CARD_STEP[0], cy + k * 0.021, SPOT.cards[1] + k * CARD_STEP[1]];
    const spotD = k => [SPOT.dealer[0] + k * CARD_STEP[0], cy + k * 0.021, SPOT.dealer[1] + k * CARD_STEP[1]];
    const yawOf = i => (Math.sin(i * 12.9898) * 43758.5453 % 1) * 0.07;

    // ---------------- hand 1 (hand time: tau = u, or u - PERIOD once u >= WRAP1)
    const d1 = 8.3 - PERIOD;
    tl.h1 = { deal: d1, shown: d1 + 2 * DEAL_STAGGER + SLIDE + FLIP * 0.6 };
    const addHand = (h, hand, t0, cardsIn, dealerIn) => {
      // deal order: player 0, dealer up, player 1, hole
      const P0 = { who: 'P', spec: cardsIn.player[0], hand, pos: spotP(0), deal: t0, flip: t0 + SLIDE, yaw: yawOf(tracks.length) };
      const DU = { who: 'D', spec: dealerIn[0], hand, pos: spotD(0), deal: t0 + DEAL_STAGGER, flip: t0 + DEAL_STAGGER + SLIDE, yaw: yawOf(tracks.length + 1) };
      const P1 = { who: 'P', spec: cardsIn.player[1], hand, pos: spotP(1), deal: t0 + 2 * DEAL_STAGGER, flip: t0 + 2 * DEAL_STAGGER + SLIDE, yaw: yawOf(tracks.length + 2) };
      const DH = { who: 'D', spec: dealerIn[1], hand, pos: spotD(1), deal: t0 + 3 * DEAL_STAGGER, flip: null, yaw: yawOf(tracks.length + 3) };
      P0.order = 0; DU.order = 1; P1.order = 2; DH.order = 3;
      tracks.push(P0, DU, P1, DH);
      return { P0, DU, P1, DH };
    };
    const c1 = addHand(h1, 1, d1, h1.cards, h1.cards.dealer);
    // decisions (hand 1): HIT = taps, then the card; STAND = the flat wave, then the dealer's turn
    tl.h1.dec = [];
    let tt = 0.55;
    const hitCards1 = [];
    h1.decisions.forEach(d => {
      tl.h1.dec.push({ t: tt, ...d });
      if (d.d === 'HIT') {
        const k = 2 + hitCards1.length;
        const card = { who: 'P', spec: h1.cards.hits[hitCards1.length], hand: 1, pos: spotP(k), deal: tt + HIT_DEAL, flip: tt + HIT_DEAL + SLIDE, yaw: yawOf(tracks.length) };
        tracks.push(card); hitCards1.push(card);
        tt = Math.max(tt + 1.7, 2.25);        // next decision slot
      }
    });
    tl.h1.hitShown = hitCards1.map(c => c.flip + FLIP * 0.5);
    const last1 = tl.h1.dec[tl.h1.dec.length - 1];
    tl.h1.reveal = last1.d === 'STAND' ? last1.t + 0.65 : tl.h1.hitShown[tl.h1.hitShown.length - 1] + 0.35;
    c1.DH.flip = tl.h1.reveal;
    tl.h1.result = tl.h1.reveal + 0.24;
    tl.h1.sweep = tl.h1.result + 0.03;
    // chips move only after the cards are off the felt (their paths cross the card rows)
    tl.xOut = tl.h1.sweep + 0.26;                       // lost bet slides to the rack
    tl.push = { reach: tl.xOut - 0.06 };
    tl.push.contact = tl.push.reach + 0.22; tl.push.end = tl.push.contact + 0.32; tl.push.back = tl.push.end + 0.21;

    // ---------------- hand 2 (loop time)
    const d2 = tl.xOut + 0.14;
    tl.h2 = { deal: d2, shown: d2 + 2 * DEAL_STAGGER + SLIDE + FLIP * 0.6 };
    const c2 = addHand(h2, 2, d2, h2.cards, h2.cards.dealer);
    tl.h2.dec = [];
    tt = 5.7;
    const hitCards2 = [];
    h2.decisions.forEach(d => {
      tl.h2.dec.push({ t: tt, ...d });
      if (d.d === 'HIT') {
        const k = 2 + hitCards2.length;
        const card = { who: 'P', spec: h2.cards.hits[hitCards2.length], hand: 2, pos: spotP(k), deal: tt + HIT_DEAL, flip: tt + HIT_DEAL + SLIDE, yaw: yawOf(tracks.length) };
        tracks.push(card); hitCards2.push(card);
        tt += 1.0;
      }
    });
    tl.h2.hitShown = hitCards2.map(c => c.flip + FLIP * 0.5);
    const last2 = tl.h2.dec[tl.h2.dec.length - 1];
    tl.h2.reveal = last2.d === 'STAND' ? last2.t + 0.72 : tl.h2.hitShown[tl.h2.hitShown.length - 1] + 0.35;
    c2.DH.flip = tl.h2.reveal;
    tl.h2.draws = [];
    (h2.cards.draws || []).forEach((spec, i) => {
      const t0 = tl.h2.reveal + 0.42 + i * 0.6;
      const card = { who: 'D', spec, hand: 2, pos: spotD(2 + i), deal: t0, flip: t0 + SLIDE, yaw: yawOf(tracks.length) };
      tracks.push(card);
      tl.h2.draws.push(card.flip + FLIP * 0.5);
    });
    tl.h2.result = (tl.h2.draws.length ? tl.h2.draws[tl.h2.draws.length - 1] : tl.h2.reveal + 0.2) + 0.14;
    tl.h2.sweep = tl.h2.result + 0.04;
    // sweeps
    let n1 = 0, n2 = 0;
    for (const c of tracks) {
      if (c.hand === 1) c.sweep = tl.h1.sweep + SWEEP_STAGGER * n1++;
      else c.sweep = tl.h2.sweep + SWEEP_STAGGER * n2++;
    }
    tl.zIn = tl.h2.sweep + 0.3;                           // payout rises out of the rack
    tl.zCircle = tl.zIn + 0.45;
    tl.zSide = tl.zCircle + 0.1;
    tl.zSideEnd = tl.zSide + 0.35;
    // leg gesture segments (loop time; the first one wraps)
    const seg = this.segs = { LF: [], RF: [] };
    const both = (t0, t1, kind) => { seg.LF.push({ t0, t1, kind }); seg.RF.push({ t0, t1, kind }); };
    const g = (L, t0, t1, kind) => seg[L].push({ t0, t1, kind });
    const gesture = d => {
      if (d.d === 'HIT') { g('LF', d.t, d.t + TAP_DUR, 'tap'); g('RF', d.t, d.t + TAP_DUR, 'rest'); return d.t + TAP_DUR; }
      g('RF', d.t, d.t + WAVE_DUR, 'wave'); g('LF', d.t, d.t + WAVE_DUR, 'rest'); return d.t + WAVE_DUR;
    };
    const RUB0 = 8.4;
    let cur = RUB0 - PERIOD;
    tl.h1.dec.forEach((d, i) => {
      const think0 = i === 0 ? cur : tl.h1.hitShown[i - 1];
      if (think0 > cur) both(cur, think0, 'rest');
      both(think0, d.t, 'rub');
      cur = gesture(d);
    });
    both(cur, tl.push.reach, 'rest');
    g('LF', tl.push.reach, tl.push.back, 'push'); g('RF', tl.push.reach, tl.push.back, 'rest');
    cur = tl.push.back;
    tl.h2.dec.forEach((d, i) => {
      const think0 = i === 0 ? tl.h2.shown : tl.h2.hitShown[i - 1];
      if (think0 > cur) both(cur, think0, 'rest');
      both(Math.max(cur, think0), d.t, 'rub');
      cur = gesture(d);
    });
    both(cur, RUB0, 'rest');
    // brain clips: the total being decided on, from the moment it shows until the next one shows
    const cl = this.clips = [];
    const pol = this.policy;
    cl.push({ t: tl.h1.shown, clip: pol.clip(h1.decisions[0].total) });
    if (h1.decisions[1]) cl.push({ t: tl.h1.hitShown[0], clip: pol.clip(h1.decisions[1].total) });
    cl.push({ t: tl.h2.shown, clip: pol.clip(h2.decisions[0].total) });
    if (h2.decisions[1]) cl.push({ t: tl.h2.hitShown[0], clip: pol.clip(h2.decisions[1].total) });
    // HUD spans per hand (hand time): [t0, t1, phase, desc | fn(dealerTotal)]
    const spans = (H, T, end, dealerFirst) => {
      const out = [[T.deal, T.shown, 0, 'New hand']];
      let w0 = T.shown;
      T.dec.forEach((d, i) => {
        out.push([w0, d.t, 1, `Hand ${d.total} · brain deciding…`]);
        if (d.d === 'HIT') { out.push([d.t, T.hitShown[i], 0, `Hand ${d.total} · brain says HIT`]); w0 = T.hitShown[i]; }
        else { out.push([d.t, d.t + 0.6, 2, `Hand ${d.total} · brain says STAND`]); w0 = d.t + 0.6; }
      });
      const fin = H.final;
      if (fin > 21) out.push([w0, T.result, 2, `Bust · ${fin}`]);
      else if (fin === 21 && T.dec.length && T.dec[T.dec.length - 1].d === 'HIT') out.push([w0, T.reveal, 2, "21 · dealer's turn"]);
      else out.push([w0, T.reveal, 2, `Stands on ${fin} · dealer's turn`]);
      if (dealerFirst !== undefined) {
        out.push([T.reveal, dealerFirst, 2, dt => `Dealer ${dt} · must draw`]);
        out.push([dealerFirst, T.result, 2, dt => (dt > 21 ? `Dealer busts · ${dt}` : `Dealer ${dt}`)]);
      } else out.push([T.reveal, T.result, 2, dt => `Dealer shows ${dt}`]);
      out.push([T.result, end, 2, dt => (H.outcome === 'WIN' ? (dt > 21 ? 'Dealer busts · Win' : `Win · ${fin} beats ${dt}`) : (fin > 21 ? 'Bust · lose' : `Lose · ${dt} beats ${fin}`))]);
      return out;
    };
    tl.h1.dealerFinal = handTotal(h1.cards.dealer.map(c => c.rank));
    tl.h2.dealerFinal = handTotal([...h2.cards.dealer, ...(h2.cards.draws || [])].map(c => c.rank));
    this.hudSpans = {
      1: spans(h1, tl.h1, tl.h1.sweep + 0.2),
      2: spans(h2, tl.h2, 8.3, tl.h2.draws.length ? tl.h2.draws[0] : undefined),
    };
    tl.h1.payout0 = this.hudSpans[1].find(x => x[2] === 2 && x[0] > tl.h1.deal)?.[0];
  },

  _legSeeds() {
    const r = this.rig;
    const f = this.rig.fly;
    r.place(0.26);
    const solve = (L, name, p, from) => {
      for (const j of r.legJoints[L]) f.set(j, r.seeds[from][j]);
      for (let k = 0; k < 3; k++) f.reach(L, p, { iters: 40 });
      r.seeds[name] = r._grab(L);
    };
    solve('LF', 'LF_rest', REST.LF, 'LF_rest');
    solve('RF', 'RF_rest', REST.RF, 'RF_rest');
    solve('LF', 'LF_up', _a.set(RUB.x, RUB.y, RUB.z - 0.1), 'LF_up');
    solve('RF', 'RF_up', _a.set(RUB.x, RUB.y - 0.04, RUB.z + 0.1), 'RF_up');
    // grooming poses: tarsi crossed under the head, A = left claw up / right down, B = the reverse
    const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
    const rub = (L, sg, up) => {
      for (const j of r.legJoints[L]) f.set(j, r.seeds[L + '_up'][j]);
      return r.solveChain(L, V3(2.86, 3.42, 0.5 * sg), V3(2.6, up ? 3.86 : 3.56, 0.17 * sg), V3(2.52, up ? 4.2 : 3.8, (up ? -0.17 : -0.04) * sg));
    };
    this.rubPose = { LF: [rub('LF', 1, true), rub('LF', 1, false)], RF: [rub('RF', -1, false), rub('RF', -1, true)] };
    solve('LF', 'LF_tap', _a.set(2.02, TABLE.y + 0.12, 0.62), 'LF_rest');
    for (const j of r.legJoints.RF) f.set(j, r.seeds.RF_rest[j]);
    r.seeds.RF_wave = r.seeds.RF_rest;
    for (let q = 0; q < 4; q++) r.solveDesc('RF', { type: 'chain', seed: q ? 'RF_wave' : 'RF_rest', wrist: _a.set(2.45, TABLE.y + 0.64, -0.5), tip: _b.set(1.95, TABLE.y + 0.44, -0.4) }), r.seeds.RF_wave = r._grab('RF');
    // left front wave (only used if a policy makes the left leg stand) mirrors it
    for (let q = 0; q < 4; q++) r.solveDesc('LF', { type: 'chain', seed: q ? 'LF_wave' : 'LF_rest', wrist: _a.set(2.45, TABLE.y + 0.64, 0.5), tip: _b.set(1.95, TABLE.y + 0.44, 0.4) }), r.seeds.LF_wave = r._grab('LF');
    solve('LF', 'LF_push', _a.set(SPOT.side[0], TABLE.y + 0.22, SPOT.side[1] + 0.3), 'LF_rest');
    f.setPose(r.base);
  },

  reset() { this.clip = null; },

  // ------------------------------------------------------------------ per-frame
  update(ctx, t, dt, prevT) {
    const u = wrapU(t);
    const tau1 = u >= WRAP1 ? u - PERIOD : u;           // hand-1 time (dealt at the end of the previous loop)
    const tl = this.tl;

    this._cards(u, tau1);
    this._chipsUpdate(u);
    this._fly(ctx, t, u, tau1);
    this._hud(ctx, u, tau1);
    this._brain(ctx, u, tau1);
  },

  // ------------------------------------------------------------------ cards
  _cards(u, tau1) {
    const mouth = SPOT.shoeMouth;
    const disc = SPOT.discard;
    for (const c of this.cardTracks) {
      const tau = c.hand === 1 ? tau1 : u;
      const m = c.mesh;
      if (tau < c.deal || tau >= c.sweep + SWEEP + HOP) { m.visible = false; continue; }
      m.visible = true;
      const [px, py, pz] = c.pos;
      let x = px, y = py, z = pz, yaw = c.yaw, flip = 0;
      // flip state: face down until c.flip, then turns over in FLIP s
      if (c.flip === null || tau < c.flip) flip = 1;
      else flip = 1 - smoother((tau - c.flip) / FLIP);
      const a = (tau - c.deal) / SLIDE;
      if (a < 1) {
        // slide out of the shoe along the felt, curving in, easing to a stop
        const k = easeOut(a);
        x = lerp(mouth[0], px, k); z = lerp(mouth[1], pz, k);
        const side = Math.sin(Math.PI * k) * 0.22;
        x += side * 0.6; z += side * 0.2;
        y = py + 0.03 * (1 - k) + (0.04 + 0.03 * (c.order || 0)) * Math.sin(Math.PI * k);   // later cards pass over earlier ones
        yaw = lerp(-0.7, c.yaw, smooth(a * 1.2));
      }
      const s = tau - c.sweep;
      if (s > 0) {
        // swept to the discard holder, then hop in and vanish
        const k = easeIn(s / SWEEP);
        const ex = disc[0] + 0.25, ez = disc[1] + 0.9;
        x = lerp(px, ex, k); z = lerp(pz, ez, k);
        yaw = lerp(c.yaw, -0.55, k);
        y = py + 0.02 * k;
        if (s > SWEEP) {
          const h = clamp01((s - SWEEP) / HOP);
          x = lerp(ex, disc[0], h); z = lerp(ez, disc[1], h);
          y = lerp(py + 0.02, TABLE.y + 0.55, h) + 0.25 * Math.sin(Math.PI * h);
          if (h >= 1) { m.visible = false; continue; }
        }
      }
      placeCard(m, x, y, z, flip, yaw);
    }
  },

  // ------------------------------------------------------------------ chips
  _pushPos(u, out) {
    // stack Y: at the fly's side, pushed by the left front leg into the circle
    const P = this.tl.push;
    const k = smoother((u - P.contact) / (P.end - P.contact));
    out.set(lerp(SPOT.side[0], SPOT.circle[0], k), TABLE.y, lerp(SPOT.side[1], SPOT.circle[1], k));
    return out;
  },

  _chipsUpdate(u) {
    const tl = this.tl, Y0 = TABLE.y;
    const C = SPOT.circle, S = SPOT.side, Tr = SPOT.tray;
    // X: the bet in the circle, lost in hand 1 -> slides to the rack and sinks
    {
      const a = (u - tl.xOut) / 0.36;
      if (a < 0) this.X.write(C[0], Y0, C[1]);
      else if (a < 1) { const k = smoother(a); this.X.write(lerp(C[0], Tr[0], k), Y0, lerp(C[1], Tr[1], k)); }
      else { const g = 1 - clamp01((u - tl.xOut - 0.36) / 0.15); this.X.write(Tr[0], Y0, Tr[1], { grow: g, hidden: g <= 0 }); }
    }
    // Y: the fly's side stack, pushed into the circle before hand 2 (the new bet)
    this._pushPos(u, _a);
    this.Y.write(_a.x, Y0, _a.z, { lean: 0.35 * bump(u - tl.push.contact, tl.push.end - tl.push.contact), dx: 0, dz: -1 });
    // Z: the payout, rises out of the rack, slides next to the bet, then over to the fly
    {
      const P2 = [C[0] - 0.12, C[1] + 0.5];
      if (u < tl.zIn) this.Z.write(0, 0, 0, { hidden: true });
      else if (u < tl.zIn + 0.15) this.Z.write(Tr[0], Y0, Tr[1], { grow: smooth((u - tl.zIn) / 0.15) });
      else if (u < tl.zCircle) { const k = smoother((u - tl.zIn - 0.15) / (tl.zCircle - tl.zIn - 0.15)); this.Z.write(lerp(Tr[0], P2[0], k), Y0, lerp(Tr[1], P2[1], k)); }
      else if (u < tl.zSide) this.Z.write(P2[0], Y0, P2[1]);
      else { const k = smoother((u - tl.zSide) / (tl.zSideEnd - tl.zSide)); this.Z.write(lerp(P2[0], S[0], k), Y0, lerp(P2[1], S[1], k)); }
    }
    this.chips.commit();
  },

  // ------------------------------------------------------------------ fly
  /** leg pose descriptor for a gesture kind at loop time u (s = time into the gesture) */
  _legPose(L, kind, u, s, slot) {
    const tl = this.tl;
    const D = this._desc[L][slot];
    if (kind === 'rub') {
      // grooming: wrists in front of the chest, claws crossed and rubbing up and down in antiphase
      const sg = L === 'LF' ? 1 : -1;
      const ph = osc(u, 24) * sg;                                   // 2.5 Hz
      D.type = 'joints'; D.joints = this._rubJoints(L, u);
      return D;
    }
    D.type = 'ik'; D.seed = L + '_rest';
    const out = D.target;
    if (kind === 'rest') { out.copy(REST[L]); return D; }
    if (kind === 'tap') {
      // two taps on the felt beside its cards (the casino HIT signal)
      const lift = 0.3 * (1 - smooth((s - 0.16) / 0.14)) + 0.2 * bump(s - 0.33, 0.17) + 0.3 * smooth((s - 0.5) / 0.14);
      out.set(2.02, TABLE.y + 0.012 + lift, 0.62);
      D.seed = 'LF_tap';
      return D;
    }
    if (kind === 'wave') {
      // tarsus held flat over its cards, one slow side-to-side sweep (the casino STAND signal)
      const k = clamp01((s - 0.2) / 0.45);
      const z = SPOT.cards[1] + 0.22 + 0.5 * Math.sin(k * Math.PI * 2);
      D.type = 'chain'; D.seed = L + '_wave';
      const lift = 0.25 * (1 - smooth((s - 0.08) / 0.14)) + 0.25 * smooth((s - 0.62) / 0.14);   // comes in high, leaves high
      D.tip.set(1.84, TABLE.y + 0.42 + lift, z);
      D.wrist.set(2.36, TABLE.y + 0.62 + lift, Math.min(z * 0.6 - 0.32, -0.3));
      return D;
    }
    if (kind === 'push') {
      const P = tl.push;
      const cp = this._pushPos(u, _c);
      const contact = _d.set(cp.x + 0.02, TABLE.y + 0.2, cp.z + CHIP.r + 0.04);
      if (u < P.contact) {
        const k = smooth((u - P.reach) / (P.contact - P.reach));
        out.lerpVectors(REST.LF, contact, k); out.y += 0.3 * Math.sin(Math.PI * k);
      } else if (u < P.end) out.copy(contact);
      else {
        const k = smooth((u - P.end) / (P.back - P.end));
        out.lerpVectors(contact, REST.LF, k); out.y += 0.25 * Math.sin(Math.PI * k);
      }
      D.seed = 'LF_push';
      return D;
    }
    out.copy(REST[L]);
    return D;
  },

  /** joint-space grooming: blend the two crossed poses back and forth */
  _rubJoints(L, u) {
    const [A, B] = this.rubPose[L];
    const k = 0.5 + 0.5 * osc(u, 24);                    // 2.5 Hz
    const o = this._rj[L];
    for (const j in A) o[j] = A[j] + (B[j] - A[j]) * k;
    return o;
  },

  _legState(L, u) {
    const segs = this.segs[L];
    // find the segment (they tile the loop starting at a negative time)
    let uu = u;
    if (uu >= segs[segs.length - 1].t1) uu -= PERIOD;
    let i = segs.findIndex(sg => uu >= sg.t0 && uu < sg.t1);
    if (i < 0) i = 0;
    const sg = segs[i];
    const prev = segs[(i - 1 + segs.length) % segs.length];
    const st = this.st[L];
    const s0 = uu - sg.t0;
    st.stag = 0;
    const k = smooth(s0 / (prev.kind === 'rub' || sg.kind === 'rub' ? 0.3 : TR));
    const cur = this._legPose(L, sg.kind, u, s0, 1);
    if (k < 1 && !(prev.kind === sg.kind && sg.kind === 'rest')) {
      st.A = this._legPose(L, prev.kind, u, uu - prev.t0 + (i === 0 ? PERIOD : 0), 0);
      st.B = cur; st.k = k;
    } else { st.A = cur; st.B = null; st.k = 0; }
    return sg.kind;
  },

  _fly(ctx, t, u, tau1) {
    const tl = this.tl, st = this.st;
    const kL = this._legState('LF', u), kR = this._legState('RF', u);
    // lean in for the gestures, slump a touch after the loss
    const leanIn = this._gestureWeight(u);
    const slump = bump(u - tl.h1.result, 0.9) * 0.9;
    st.lean = 0.2 + 0.2 * leanIn - 0.07 * slump + 0.012 * osc(u, 2);
    st.sway = 0.03 * osc(u, 1) + 0.02 * osc(u, 3, 1);
    st.breath = 0.035 * osc(u, 7);
    // head: looks at its cards while thinking, follows the dealer's cards, droops after the loss
    const gz = this._gaze(u);
    st.head[0] = gz[0] + 0.25 * slump + 0.02 * osc(u, 3);
    st.head[1] = gz[1] + 0.03 * osc(u, 1, 2);
    st.head[2] = 0.04 * osc(u, 2, 0.5);
    // antennae: small twitches, a flick when a card turns over
    let flick = 0;
    for (const c of this.cardTracks) if (c.flip !== null) {
      const tau = c.hand === 1 ? tau1 : u;
      flick += bump(tau - c.flip, 0.25);
    }
    for (const [side, ph, arr] of [['L', 0, st.antL], ['R', 1.9, st.antR]]) {
      const tw = 0.1 * osc(u, 9, ph) + (osc(u, 26, ph * 3) > 0.94 ? 0.18 : 0) - 0.3 * flick;
      arr[0] = tw; arr[1] = 0.08 * osc(u, 4, ph); arr[2] = 0.12 * osc(u, 7, ph) - 0.15 * flick;
    }
    // proboscis twitch on each HIT decision (MN9 drives the proboscis)
    let prob = 0;
    for (const d of [...tl.h1.dec, ...tl.h2.dec]) if (d.d === 'HIT') prob += bump(u - d.t, 0.38) + bump(u - d.t - PERIOD, 0.38);
    st.prob = 0.5 * prob;
    // wings: folded, a small flick on the win
    const wf = bump(u - tl.h2.draws[0], 0.5);
    st.wings.spread = 0.05 + 0.18 * wf;
    st.wings.pitch = 0.22 + 0.08 * wf;
    st.wings.flap = 0.12 * wf * Math.sin(u * 2 * Math.PI * 12);
    this.rig.pose(st);
  },

  /** 0..1: how far the fly leans in (reaching for the felt) */
  _gestureWeight(u) {
    let w = 0;
    for (const L of ['LF', 'RF']) for (const sg of this.segs[L]) {
      if (sg.kind === 'rest' || sg.kind === 'rub') continue;
      const a = smooth((u - sg.t0) / 0.25) * (1 - smooth((u - sg.t1 + 0.2) / 0.25));
      w = Math.max(w, a);
    }
    return w;
  },

  /** head [pitch, turn] from gaze keyframes (x = loop time, the last 1.6 s of the loop map to negative x) */
  _gaze(u) {
    const G = {
      cards: [0.8, -0.04], dealer: [0.64, 0.3], shoe: [0.5, 0.44], stack: [0.74, 0.3], circle: [0.84, 0.06], cam: [0.42, -0.1],
    };
    const keys = this._gazeKeys || (this._gazeKeys = [
      [8.3, 'shoe'], [8.7, 'dealer'], [9.05, 'cards'], [0.1, 'dealer'], [0.4, 'cards'],
      [1.15, 'shoe'], [1.5, 'cards'], [1.85, 'dealer'], [2.05, 'cards'],
      [2.8, 'dealer'], [3.14, 'cam'], [3.45, 'stack'], [3.85, 'shoe'], [4.2, 'cards'],
      [4.8, 'dealer'], [5.15, 'cards'], [6.35, 'dealer'], [6.8, 'shoe'], [7.15, 'dealer'], [7.85, 'circle'], [8.2, 'stack'],
    ].map(([t, n]) => [t >= WRAP1 ? t - PERIOD : t, n]).sort((p, q) => p[0] - q[0]));
    const x = u >= WRAP1 ? u - PERIOD : u;
    let ia = keys.length - 1;
    for (let i = 0; i < keys.length; i++) if (x >= keys[i][0]) ia = i;
    const ib = (ia + 1) % keys.length;
    const a = keys[ia], b = keys[ib];
    let bx = b[0];
    if (ib === 0 && x >= a[0]) bx += PERIOD;
    const k = smooth((x - bx + 0.3) / 0.3);
    const pa = G[a[1]], pb = G[b[1]];
    const out = this._gz || (this._gz = [0, 0]);
    out[0] = lerp(pa[0], pb[0], k); out[1] = lerp(pa[1], pb[1], k);
    return out;
  },

  // ------------------------------------------------------------------ HUD + brain
  _hud(ctx, u, tau1) {
    const tl = this.tl;
    const inH1 = tau1 >= tl.h1.deal && tau1 < tl.h1.sweep + 0.2;
    const hand = inH1 ? 1 : 2, tau = inH1 ? tau1 : u;
    // visible totals: cards that have turned face up (and are not swept yet)
    const pr = this._pr || (this._pr = []), dr = this._dr || (this._dr = []);
    pr.length = 0; dr.length = 0;
    const T = hand === 1 ? tl.h1 : tl.h2;
    const cleared = tau >= T.sweep + 0.2;
    for (const c of this.cardTracks) {
      if (c.hand !== hand || c.flip === null || tau < c.flip + FLIP * 0.5 || cleared) continue;
      (c.who === 'P' ? pr : dr).push(c.spec.rank);
    }
    const pt = pr.length ? handTotal(pr) : null, dt = dr.length ? handTotal(dr) : null;
    const dealerFinal = T.dealerFinal;
    const sp = this.hudSpans[hand];
    let cur = tau < sp[0][0] ? sp[0] : sp[sp.length - 1];
    for (const x of sp) if (tau >= x[0] && tau < x[1]) { cur = x; break; }
    // progress: within the span for DEAL / BRAIN DECIDES, across the whole payout for PAYOUT
    let prog;
    if (cur[2] === 2) {
      const p0 = sp.find(x => x[2] === 2 && x[0] >= (sp.find(y => y[2] === 1)?.[0] ?? -99))?.[0] ?? cur[0];
      const p1 = sp[sp.length - 1][1];
      prog = (tau - p0) / (p1 - p0);
    } else prog = (tau - cur[0]) / (cur[1] - cur[0]);
    const desc = typeof cur[3] === 'function' ? cur[3](dt ?? dealerFinal) : cur[3];
    let bank = BANK0;
    if (u >= tl.xOut && u < tl.zCircle) bank -= BET;
    const S = this._hudState || (this._hudState = { stats: {} });
    S.stats.hand = pt === null ? '–' : String(pt);
    S.stats.dealer = dt === null ? '–' : String(dt);
    S.stats.bank = fmtMoney(bank);
    S.phase = cur[2]; S.progress = clamp01(prog); S.desc = desc;
    S.note = this.policy.source === 'real'
      ? 'decision = MN9 feeding neuron · sugar = win, bitter = risk'
      : 'decision = MN9 feeding neuron · FALLBACK policy (hit < 17)';
    ctx.hud.update(S);
  },

  _brain(ctx, u, tau1) {
    // the clip for the total being decided on; the last one keeps playing until the next total shows
    const cl = this.clips;
    let want = cl[cl.length - 1].clip;
    const x = u >= WRAP1 ? u - PERIOD : u;
    for (const c of cl) {
      const ct = c.t > WRAP1 ? c.t - PERIOD : c.t;
      if (x >= ct) want = c.clip;
    }
    // before hand 1's total shows (end of the loop) hand 2's clip is still the latest
    if (x < (cl[0].t > WRAP1 ? cl[0].t - PERIOD : cl[0].t)) want = cl[cl.length - 1].clip;
    if (want !== this.clip) {
      ctx.brain.play(want, { loop: true, restart: true });
      this.clip = want;
    }
  },
};
