'use strict';
/* =========================================================================
   МАТЕМАТИЧЕСКОЕ ЯДРО
   Модель цены:  ln(Pₜ₊₁/Pₜ) = μΔt + σₜ√Δt·εₜ ,  εₜ ~ t-Стьюдента (ν=4), дисперсия 1
   Волатильность: GARCH(1,1)  σ²ₜ = ω + α·ε²ₜ₋₁ + β·σ²ₜ₋₁
   Реальные эпизоды строятся из настоящих дневных свечей (prices.js).
   Сценарии будущего — дискретный броуновский мост к случайной цели с этой моделью шума.
   ========================================================================= */

const DAY = 864e5;
const parseD = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function makeRng(seed) {
  const u = mulberry32(seed);
  let spare = null;
  const normal = () => {
    if (spare !== null) { const s = spare; spare = null; return s; }
    let a, b, r;
    do { a = u() * 2 - 1; b = u() * 2 - 1; r = a * a + b * b; } while (r >= 1 || r === 0);
    const f = Math.sqrt(-2 * Math.log(r) / r);
    spare = b * f; return a * f;
  };
  // t-распределение с ν=4, нормированное на единичную дисперсию (Var t4 = 2)
  const t4 = () => {
    const z = normal(); let c = 0;
    for (let i = 0; i < 4; i++) { const g = normal(); c += g * g; }
    return z / Math.sqrt(c / 4) * Math.SQRT1_2;
  };
  const shuffle = arr => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(u() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };
  return { u, normal, t4, shuffle, int: n => Math.floor(u() * n) };
}

/* ---------- генерация свечей по опорным точкам ---------- */
function buildSeries(anchors, n, sigAnnual, rng, sub = 6) {
  const t0 = anchors[0].t, t1 = anchors[anchors.length - 1].t, S = n * sub;
  const L = new Float64Array(S + 1), halt = new Uint8Array(S + 1), pre = new Map();
  const s = sigAnnual * Math.sqrt((t1 - t0) / DAY / 365 / S);

  const ks = anchors.map((a, i) => {
    let k = Math.round((a.t - t0) / (t1 - t0) * S);
    if (a.f === 'gap' || a.f === 'halt' || (i > 0 && anchors[i - 1].f === 'halt')) k = Math.round(k / sub) * sub;
    return k;
  });
  ks[0] = 0; ks[ks.length - 1] = S;
  for (let i = 1; i < ks.length; i++) if (ks[i] <= ks[i - 1]) ks[i] = ks[i - 1] + 1;
  for (let i = ks.length - 1; i > 0; i--) {
    if (i === ks.length - 1) ks[i] = S;
    if (ks[i - 1] >= ks[i]) ks[i - 1] = ks[i] - 1;
  }

  const A = 0.08, B = 0.9;          // GARCH(1,1)
  let h = s * s;
  L[0] = Math.log(anchors[0].p);
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i], b = anchors[i + 1], ka = ks[i], kb = ks[i + 1], m = kb - ka;
    const x0 = L[ka];
    if (a.f === 'halt') {
      for (let k = ka; k <= kb; k++) { L[k] = x0; halt[k] = 1; }
      halt[kb] = 0; pre.set(kb, x0); L[kb] = Math.log(b.p);
      continue;
    }
    const target = b.f === 'gap' ? x0 : Math.log(b.p);
    const W = new Float64Array(m + 1);
    for (let j = 1; j <= m; j++) {
      const e = Math.sqrt(h) * rng.t4();
      W[j] = W[j - 1] + e;
      h = s * s * (1 - A - B) + A * e * e + B * h;
    }
    for (let j = 1; j <= m; j++) L[ka + j] = x0 + W[j] - (j / m) * W[m] + (j / m) * (target - x0);
    if (b.f === 'gap') { pre.set(kb, target); L[kb] = Math.log(b.p); }
  }

  const out = [];
  for (let c = 0; c < n; c++) {
    const s0 = c * sub, e0 = s0 + sub;
    const o = L[s0], cl = pre.has(e0) ? pre.get(e0) : L[e0];
    let hi = Math.max(o, cl), lo = Math.min(o, cl), halted = true;
    for (let k = s0 + 1; k < e0; k++) { if (L[k] > hi) hi = L[k]; if (L[k] < lo) lo = L[k]; }
    for (let k = s0; k < e0; k++) if (!halt[k]) { halted = false; break; }
    if (!halted) { hi += Math.abs(rng.normal()) * s * 0.5; lo -= Math.abs(rng.normal()) * s * 0.5; }
    out.push({ t: t0 + (c + 1) / n * (t1 - t0), o: Math.exp(o), h: Math.exp(hi), l: Math.exp(lo), c: Math.exp(cl), halt: halted });
  }
  return out;
}

/* ---------- свечи из реальных дневных котировок (prices.js) ----------
   Дневные бары группируются в ≤ target свечей. Пропуски торгов дольше двух недель
   (например, закрытие Мосбиржи 28.02–23.03.2022) превращаются в «остановленные» свечи.
   Для дней, где есть только цена закрытия (курс ЦБ), тени свечи моделируются. */
const PRICE_EPOCH = Date.UTC(2017, 0, 1);
const dayToT = d => PRICE_EPOCH + d * DAY;

function lastRealDay(id) { const r = PRICES[id]; return r[r.length - 1][0]; }

function realCandles(id, fromT, toT, target, rng, sigAnnual) {
  const all = PRICES[id], a = (fromT - PRICE_EPOCH) / DAY, b = (toT - PRICE_EPOCH) / DAY;
  let i0 = all.findIndex(r => r[0] >= a); if (i0 < 0) i0 = all.length;
  const rows = [];
  for (let i = i0; i < all.length && all[i][0] <= b; i++) rows.push(all[i]);
  const prev = i0 > 0 ? all[i0 - 1] : null;
  const sd = sigAnnual / Math.sqrt(252);
  const closeOf = r => r[r.length - 1];

  // бары → единицы времени (бар или день остановки торгов)
  const units = [];
  let pc = prev ? closeOf(prev) : closeOf(rows[0]), pd = prev ? prev[0] : null;
  for (const r of rows) {
    if (pd !== null && r[0] - pd > 14) {
      let wd = 0;
      for (let d = pd + 1; d < r[0]; d++) { const w = new Date(dayToT(d)).getUTCDay(); if (w !== 0 && w !== 6) wd++; }
      for (let k = 0; k < wd; k++) units.push({ halt: true, day: pd + (k + 1) * (r[0] - pd) / (wd + 1), c: pc });
    }
    let bar;
    if (r.length >= 5) bar = { o: r[1], h: r[2], l: r[3], c: r[4] };
    else {
      const o = pc, c = r[1];
      bar = { o, c, h: Math.max(o, c) * Math.exp(Math.abs(rng.normal()) * sd * 0.5), l: Math.min(o, c) * Math.exp(-Math.abs(rng.normal()) * sd * 0.5) };
    }
    units.push({ day: r[0], ...bar });
    pc = bar.c; pd = r[0];
  }

  const n = units.length, g = Math.min(target, n), out = [];
  let lastC = prev ? closeOf(prev) : units[0].c;
  for (let k = 0; k < g; k++) {
    const grp = units.slice(Math.floor(k * n / g), Math.floor((k + 1) * n / g));
    const bars = grp.filter(u => !u.halt), t = dayToT(grp[grp.length - 1].day);
    if (!bars.length) { out.push({ t, o: lastC, h: lastC, l: lastC, c: lastC, halt: true }); continue; }
    const c = { t, o: bars[0].o, c: bars[bars.length - 1].c, h: -Infinity, l: Infinity, halt: false };
    for (const u of bars) { if (u.h > c.h) c.h = u.h; if (u.l < c.l) c.l = u.l; }
    out.push(c); lastC = c.c;
  }
  return out;
}

/* ---------- оценка волатильности: EWMA (RiskMetrics, λ=0.94) ---------- */
function ewmaSigma(candles, lambda = 0.94) {
  const r = [];
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].halt || candles[i - 1].halt) continue;
    r.push(Math.log(candles[i].c / candles[i - 1].c));
  }
  if (r.length < 3) return 0.01;
  let v = r.slice(0, 8).reduce((s, x) => s + x * x, 0) / Math.min(8, r.length);
  for (let i = 8; i < r.length; i++) v = lambda * v + (1 - lambda) * r[i] * r[i];
  return Math.sqrt(v);
}

/* ---------- индикаторы ---------- */
function indicators(candles) {
  const cl = candles.map(c => c.c);
  const avg = a => a.reduce((s, x) => s + x, 0) / a.length;
  const s10 = avg(cl.slice(-10)), s30 = avg(cl.slice(-30));
  let g = 0, l = 0;
  for (let i = cl.length - 14; i < cl.length; i++) { const d = cl[i] - cl[i - 1]; if (d > 0) g += d; else l -= d; }
  const rsi = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  return { trend: s10 >= s30 ? 1 : -1, rsi, s10, s30 };
}

/* ---------- позиция ---------- */
function makePos(sel, entry, deposit) {
  const margin = deposit * sel.size, notional = margin * sel.lev, liqPct = 0.9 / sel.lev;
  return {
    dir: sel.dir, lev: sel.lev, size: sel.size, entry, margin, notional, liqPct, stopPct: sel.stop,
    liqP: entry * (1 - sel.dir * liqPct),
    stopP: sel.stop ? entry * (1 - sel.dir * sel.stop) : null,
  };
}

// Проверка свечи: стоп/ликвидация, с учётом гэпа на открытии
function checkCandle(pos, cd) {
  if (cd.halt) return null;
  const d = pos.dir;
  const worse = (p, lvl) => d === 1 ? p <= lvl : p >= lvl;
  const ext = d === 1 ? cd.l : cd.h;
  if (worse(cd.o, pos.liqP)) return { price: cd.o, reason: 'liq', gap: true };
  if (pos.stopP !== null && worse(cd.o, pos.stopP)) return { price: cd.o, reason: 'stop', gap: true };
  const stopFirst = pos.stopP !== null && (d === 1 ? pos.stopP > pos.liqP : pos.stopP < pos.liqP);
  if (stopFirst && worse(ext, pos.stopP)) return { price: pos.stopP, reason: 'stop' };
  if (worse(ext, pos.liqP)) return { price: pos.liqP, reason: 'liq' };
  return null;
}

function calcPnl(pos, exit, reason, days, A) {
  const raw = pos.notional * pos.dir * (exit / pos.entry - 1);
  const fees = pos.notional * A.fee * 2 + pos.notional * (pos.lev - 1) / pos.lev * A.fin * days / 365;
  const net = raw - fees;
  let pnl = reason === 'liq' ? -pos.margin : net;
  const over = net < -pos.margin ? -(net + pos.margin) : 0;   // долг сверх маржи при гэпе
  if (pnl < -pos.margin) pnl = -pos.margin;
  return { pnl, raw, fees, over };
}

/* ---------- Монте-Карло: альтернативные сценарии той же сделки ---------- */
function monteCarlo(pos, { n, sigC, muC = 0, dtDays, A, deposit, N = 1500, seed = 1 }) {
  const rng = makeRng(seed), sub = 4, s = sigC / 2, mu = muC / sub;
  const p = { dir: pos.dir, liqP: 1 - pos.dir * pos.liqPct, stopP: pos.stopPct ? 1 - pos.dir * pos.stopPct : null };
  const unit = { ...pos, entry: 1 };
  const out = new Float64Array(N);
  let liq = 0, stop = 0, win = 0, up = 0;
  for (let k = 0; k < N; k++) {
    let x = 0, hit = null, ci = n - 1;
    for (let c = 0; c < n; c++) {
      const o = Math.exp(x); let hi = x, lo = x;
      for (let j = 0; j < sub; j++) { x += mu + s * rng.t4(); if (x > hi) hi = x; if (x < lo) lo = x; }
      hit = checkCandle(p, { o, h: Math.exp(hi), l: Math.exp(lo), c: Math.exp(x) });
      if (hit) { ci = c; break; }
    }
    if (x > 0) up++;
    const reason = hit ? hit.reason : 'end';
    const r = calcPnl(unit, hit ? hit.price : Math.exp(x), reason, (ci + 1) * dtDays, A);
    out[k] = r.pnl / deposit;
    if (reason === 'liq') liq++; else if (reason === 'stop') stop++;
    if (r.pnl > 0) win++;
  }
  const sorted = Array.from(out).sort((a, b) => a - b);
  const k5 = Math.max(1, Math.floor(N * 0.05));
  const es5 = -sorted.slice(0, k5).reduce((s, x) => s + x, 0) / k5;
  return { sorted, pLiq: liq / N, pStop: stop / N, pWin: win / N, pUp: up / N, es5, median: sorted[N >> 1], N };
}

function percentileOf(sorted, v) {
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < v) lo = m + 1; else hi = m; }
  let eq = lo; while (eq < sorted.length && sorted[eq] === v) eq++;
  return ((lo + eq) / 2) / sorted.length;
}

/* ---------- вероятности хвостов ---------- */
function erfc(x) {
  const z = Math.abs(x), t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 +
    t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}
const normSF = z => 0.5 * erfc(z / Math.SQRT2);
// хвост t-распределения ν=4 (единичная дисперсия): F(t)=½+⅜·t/√(1+t²/4)·(1−t²/(12(1+t²/4)))
function t4SF(z) {
  const t = z * Math.SQRT2, q = 1 + t * t / 4;
  const F = 0.5 + 0.375 * (t / Math.sqrt(q)) * (1 - t * t / (12 * q));
  return Math.max(1 - F, 1e-300);
}
