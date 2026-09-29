// The fly's blackjack policy and the two-hand loop planned from it.
// Every HIT / STAND the scene shows comes from the policy table for the total on screen:
//   real:     assets/brain/blackjack_policy.json (MN9_L still firing -> HIT, else STAND), per total 4..21
//   fallback: HIT below 17 (only used if the JSON cannot be loaded; the HUD note says so)
// The deck is ours, so the cards are staged; the decisions are not.
import { handTotal } from './cards.js';

export const FALLBACK_STAND_FROM = 17;          // <-- FALLBACK POLICY (used only without the JSON)
const AVOID_TOTALS = new Set([7]);              // t07's trial-0 clip is a rare quiet trial (almost empty panel)

export async function loadPolicy(url = './assets/brain/blackjack_policy.json') {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    const j = await r.json();
    const table = {};
    for (const k in j.totals) {
      const d = String(j.totals[k].decision).toUpperCase();
      if (d !== 'HIT' && d !== 'STAND') throw new Error(`bad decision for ${k}: ${d}`);
      table[+k] = { decision: d, clip: j.totals[k].clip || clipName(+k), mn9: j.totals[k].mn9_hz };
    }
    return {
      source: 'real', raw: j, table,
      decide: t => (table[t] ? table[t].decision : (t >= (j.stand_from ?? 22) ? 'STAND' : 'HIT')),
      clip: t => (table[t] ? table[t].clip : clipName(t)),
    };
  } catch (e) {
    console.warn('blackjack: policy JSON not loaded, using the fallback (HIT below 17):', e);
    return {
      source: 'fallback', raw: null, table: null,
      decide: t => (t < FALLBACK_STAND_FROM ? 'HIT' : 'STAND'),
      clip: t => clipName(t),
    };
  }
}
export const clipName = t => 't' + String(t).padStart(2, '0');

const SUITS = ['S', 'H', 'D', 'C'];
/** two non-ace cards for a total (4..20) */
function twoCards(t, alt = 0) {
  if (t >= 12) return [alt ? 'K' : '10', String(t - 10)];
  const a = Math.floor(t / 2) + (alt && t >= 6 ? 1 : 0), b = t - a;
  return [String(a), String(b)];
}
function rankFor(v) { return v === 1 || v === 11 ? 'A' : String(v); }

/**
 * Plan the loop from the policy.
 * Hand 1 loses and hand 2 wins by the same bet, so the bankroll (and the chips) loop seamlessly.
 *   Hand 1: HIT at the highest HIT total h, the drawn card lands on a STAND total (11 if the policy stands
 *           there: the "any human would double down" moment), STAND, the dealer's 10 + hole beats it.
 *           (If the policy stands everywhere: STAND at once. If it never stands up to 19: HIT and bust.)
 *   Hand 2: STAND on the lowest STAND total >= 5 (comically low for this cautious brain), the dealer
 *           shows 6, turns 16, must draw and busts. (If the policy never stands: HIT to exactly 21.)
 */
export function planLoop(P) {
  const D = t => P.decide(t);
  const hitTotals = [], standTotals = [];
  for (let t = 4; t <= 20; t++) (D(t) === 'HIT' ? hitTotals : standTotals).push(t);

  // ---------------- hand 1
  const h1 = { player: [], hits: [], dealer: [], dealerDraws: [], decisions: [] };
  const hitOK = hitTotals.filter(t => !AVOID_TOTALS.has(t));
  if (hitOK.length) {
    const h = Math.max(...hitOK);
    h1.player = twoCards(h);
    // the hit: prefer landing on 11 with a STAND, else the smallest STAND total <= 19, else bust
    let pick = null;
    const cands = [];
    for (let c = 2; c <= 10; c++) cands.push(c);
    const standAt = t => t <= 21 && D(t) === 'STAND' && !AVOID_TOTALS.has(t);
    if (standAt(11) && cands.includes(11 - h)) pick = 11 - h;
    if (pick === null) for (const c of cands) if (h + c <= 19 && standAt(h + c)) { pick = c; break; }
    if (pick === null) for (const c of cands.slice().reverse()) if (h + c > 21) { pick = c; break; }
    if (pick === null) pick = 10;
    h1.hits = [rankFor(pick)];
  } else {
    const s = standTotals.find(t => t >= 12 && !AVOID_TOTALS.has(t)) ?? standTotals[0];
    h1.player = twoCards(s);
  }
  // decisions from the policy, strictly by the running total
  simulate(h1, D);
  const f1 = handTotal([...h1.player, ...h1.hits]);
  const dTarget = f1 > 21 ? 18 : Math.min(21, Math.max(18, f1 + 2));
  h1.dealer = ['10', rankFor(dTarget - 10)];
  h1.outcome = 'LOSE';

  // ---------------- hand 2
  const h2 = { player: [], hits: [], dealer: ['6', 'K'], dealerDraws: ['Q'], decisions: [] };
  const standOK = standTotals.filter(t => t >= 5 && !AVOID_TOTALS.has(t));
  if (standOK.length) {
    const s = [6, 5].find(t => standOK.includes(t)) ?? standOK[0];   // comically low if the brain stands there
    h2.player = twoCards(s, 1);
    if (h2.player[0] === h2.player[1] && s >= 6) h2.player = [String(s - 2), '2'];
  } else {
    const h = hitTotals.find(t => t >= 12 && t <= 20) ?? 12;
    h2.player = twoCards(h, 1);
    h2.hits = [rankFor(21 - h)];
  }
  simulate(h2, D);
  h2.outcome = 'WIN';

  // suits (fixed, varied)
  const suits = { h1: ['S', 'H', 'D', 'C', 'S', 'D'], h2: ['C', 'D', 'H', 'S', 'D', 'H'] };
  const mk = (ranks, su, k0) => ranks.map((r, i) => ({ rank: r, suit: su[(k0 + i) % su.length] }));
  h1.cards = { player: mk(h1.player, suits.h1, 0), hits: mk(h1.hits, suits.h1, 2), dealer: [{ rank: h1.dealer[0], suit: 'C' }, { rank: h1.dealer[1], suit: 'S' }] };
  h2.cards = { player: mk(h2.player, suits.h2, 0), hits: mk(h2.hits, suits.h2, 3), dealer: [{ rank: '6', suit: 'H' }, { rank: 'K', suit: 'S' }], draws: [{ rank: 'Q', suit: 'D' }] };
  return { h1, h2, source: P.source };
}

/** run the policy on a hand: record each decision at its running total, stop at STAND / 21 / bust */
function simulate(h, D) {
  const cards = h.player.slice();
  const pending = h.hits.slice();
  const used = [];
  h.decisions = [];
  for (;;) {
    const t = handTotal(cards);
    if (t >= 21) break;                               // 21: the turn ends (casino rule, no decision)
    const d = D(t);
    h.decisions.push({ total: t, d });
    if (d === 'STAND') break;
    if (!pending.length) throw new Error(`plan: the policy hits on ${t} but no card was staged`);
    const c = pending.shift();
    cards.push(c); used.push(c);
  }
  if (pending.length) throw new Error('plan: a staged hit card was never asked for');
  h.hits = used;
  h.final = handTotal(cards);
}
