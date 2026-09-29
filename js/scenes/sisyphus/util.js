// Small deterministic helpers: easing, monotone keyframe tracks, smooth noise.
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const smoother = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * t * (t * (t * 6 - 15) + 10); };
export const easeIn = t => t * t;
export const easeOut = t => 1 - (1 - t) * (1 - t);
/** 0 outside [a, d], 1 on [b, c], smooth ramps between. */
export const window4 = (a, b, c, d, x) => sstep(a, b, x) * (1 - sstep(c, d, x));

/**
 * Monotone cubic (PCHIP) track through keys [[t, v], ...]. Holds the end values outside.
 * End tangents are zero unless `ends` gives slopes.
 */
export function track(keys, ends = [0, 0]) {
  const n = keys.length;
  const T = keys.map(k => k[0]), V = keys.map(k => k[1]);
  const h = [], del = [], d = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) { h[i] = T[i + 1] - T[i]; del[i] = (V[i + 1] - V[i]) / h[i]; }
  for (let i = 1; i < n - 1; i++) {
    if (del[i - 1] * del[i] <= 0) d[i] = 0;
    else {
      const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1];
      d[i] = (w1 + w2) / (w1 / del[i - 1] + w2 / del[i]);
    }
  }
  d[0] = ends[0]; d[n - 1] = ends[1];
  const f = t => {
    if (t <= T[0]) return V[0];
    if (t >= T[n - 1]) return V[n - 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (T[m] <= t) lo = m; else hi = m; }
    const i = lo, s = (t - T[i]) / h[i], s2 = s * s, s3 = s2 * s;
    return (2 * s3 - 3 * s2 + 1) * V[i] + (s3 - 2 * s2 + s) * h[i] * d[i]
      + (-2 * s3 + 3 * s2) * V[i + 1] + (s3 - s2) * h[i] * d[i + 1];
  };
  f.keys = keys;
  return f;
}

/** Smooth deterministic noise in [-1, 1] (sum of incommensurate sines). */
export function wob(t, seed = 0) {
  return 0.5 * Math.sin(t * 1.0 + seed * 12.9898)
    + 0.3 * Math.sin(t * 2.31 + seed * 78.233 + 1.3)
    + 0.2 * Math.sin(t * 4.13 + seed * 37.719 + 2.1);
}
/** Fast tremble (Hz-ish frequency f), deterministic. */
export function trem(t, f, seed = 0) {
  return 0.6 * Math.sin(t * f * 6.2832 + seed * 3.7) + 0.4 * Math.sin(t * f * 1.618 * 6.2832 + seed * 9.1);
}
