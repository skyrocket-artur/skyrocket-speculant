'use strict';
/* Отрисовка: свечной график, гистограмма Монте-Карло, кривая капитала */

const COL = {
  grid: '#151c25', axis: '#5f6c7b', text: '#c9d3de', up: '#1fd17d', down: '#ff4d5e', halt: '#4f5b69',
  amber: '#ffb020', cyan: '#35c3ff', vio: '#a58bff', future: 'rgba(53,195,255,0.045)',
};
const MONO = '"JetBrains Mono", ui-monospace, Menlo, monospace';

function setupCanvas(cv) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

function niceStep(range, count) {
  const raw = range / count, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
}

function tag(ctx, x, y, text, bg, fg = '#05080b') {
  ctx.font = `600 10px ${MONO}`;
  const w = ctx.measureText(text).width + 8;
  ctx.fillStyle = bg; ctx.fillRect(x, y - 8, w, 16);
  ctx.fillStyle = fg; ctx.textBaseline = 'middle'; ctx.fillText(text, x + 4, y);
}

/* o = {candles, shown, slots, split, lines:[{p,col,label,dash}], fmt, entryIdx, exit:{i,p,reason}, dates:[{i,label}]} */
function drawCandles(cv, o) {
  const { ctx, w, h } = setupCanvas(cv);
  const padR = 60, padT = 10, padB = 18, pw = w - padR, ph = h - padT - padB;
  const vis = o.candles.slice(0, o.shown);
  let lo = Infinity, hi = -Infinity;
  for (const c of vis) { if (c.l < lo) lo = c.l; if (c.h > hi) hi = c.h; }
  const base = hi - lo || hi * 0.01;
  for (const L of o.lines || []) {
    if (L.p == null) continue;
    if (L.p > lo - base * 0.6 && L.p < hi + base * 0.6) { lo = Math.min(lo, L.p); hi = Math.max(hi, L.p); }
  }
  const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
  const y = p => padT + (hi - p) / (hi - lo) * ph;
  const sw = pw / o.slots, x = i => i * sw + sw / 2;

  // зона будущего
  if (o.split != null) {
    const xs = o.split * sw;
    ctx.fillStyle = COL.future; ctx.fillRect(xs, padT, pw - xs, ph);
    ctx.strokeStyle = 'rgba(53,195,255,0.35)'; ctx.setLineDash([3, 4]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(xs, padT); ctx.lineTo(xs, padT + ph); ctx.stroke(); ctx.setLineDash([]);
    if (o.shown <= o.split) {
      ctx.fillStyle = 'rgba(53,195,255,0.18)'; ctx.font = `700 54px ${MONO}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('?', xs + (pw - xs) / 2, padT + ph / 2);
      ctx.textAlign = 'left';
    }
  }

  // сетка и шкала цен
  const step = niceStep(hi - lo, 4);
  ctx.font = `10px ${MONO}`; ctx.textBaseline = 'middle';
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    const yy = Math.round(y(v)) + 0.5;
    ctx.strokeStyle = COL.grid; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(pw, yy); ctx.stroke();
    ctx.fillStyle = COL.axis; ctx.fillText(o.fmt(v), pw + 6, yy);
  }

  // свечи
  const bw = Math.max(1, Math.min(9, sw * 0.62));
  for (let i = 0; i < vis.length; i++) {
    const c = vis[i], up = c.c >= c.o, xx = x(i);
    const col = c.halt ? COL.halt : up ? COL.up : COL.down;
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1;
    if (c.halt) {
      ctx.beginPath(); ctx.moveTo(xx - bw / 2, y(c.c)); ctx.lineTo(xx + bw / 2, y(c.c)); ctx.stroke();
      continue;
    }
    ctx.beginPath(); ctx.moveTo(Math.round(xx) + 0.5, y(c.h)); ctx.lineTo(Math.round(xx) + 0.5, y(c.l)); ctx.stroke();
    const top = y(Math.max(c.o, c.c)), bh = Math.max(1, Math.abs(y(c.o) - y(c.c)));
    ctx.fillRect(xx - bw / 2, top, bw, bh);
  }

  // горизонтальные уровни + метки справа (без наложений)
  const tags = [];
  for (const L of o.lines || []) {
    if (L.p == null) continue;
    const inside = L.p >= lo && L.p <= hi;
    const yy = inside ? y(L.p) : (L.p > hi ? padT + 8 : padT + ph - 8);
    if (inside) {
      ctx.strokeStyle = L.col; ctx.lineWidth = 1; ctx.setLineDash(L.dash ? [4, 4] : []);
      ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(pw, yy); ctx.stroke(); ctx.setLineDash([]);
    }
    tags.push({ y: yy, text: (inside ? '' : L.p > hi ? '↑' : '↓') + L.label, col: L.col });
  }
  if (vis.length) {
    const last = vis[vis.length - 1];
    tags.push({ y: y(last.c), text: o.fmt(last.c), col: last.c >= last.o ? COL.up : COL.down, pri: 1 });
  }
  tags.sort((a, b) => a.y - b.y);
  for (let i = 1; i < tags.length; i++) if (tags[i].y - tags[i - 1].y < 17) tags[i].y = tags[i - 1].y + 17;
  const over = tags.length ? tags[tags.length - 1].y - (h - padB - 2) : 0;
  if (over > 0) for (const t of tags) t.y -= over;
  for (const t of tags) tag(ctx, pw + 1, t.y, t.text, t.col);

  // маркеры входа/выхода
  if (o.entryIdx != null && o.entryIdx < vis.length) {
    const c = vis[o.entryIdx], xx = x(o.entryIdx);
    ctx.fillStyle = COL.cyan; ctx.beginPath();
    const yy = y(c.o);
    ctx.moveTo(xx - 5, yy); ctx.lineTo(xx - 11, yy - 5); ctx.lineTo(xx - 11, yy + 5); ctx.fill();
  }
  if (o.exit && o.exit.i < vis.length) {
    const xx = x(o.exit.i), yy = y(o.exit.p);
    ctx.strokeStyle = o.exit.reason === 'liq' ? COL.down : COL.amber; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(xx - 5, yy - 5); ctx.lineTo(xx + 5, yy + 5); ctx.moveTo(xx + 5, yy - 5); ctx.lineTo(xx - 5, yy + 5); ctx.stroke();
  }

  // даты
  ctx.fillStyle = COL.axis; ctx.font = `9.5px ${MONO}`; ctx.textBaseline = 'alphabetic';
  for (const d of o.dates || []) {
    if (d.i >= vis.length && !d.force) continue;
    const xx = Math.min(Math.max(x(d.i), 2), pw - 2);
    ctx.textAlign = d.align || 'center';
    ctx.fillText(d.label, xx, h - 4);
  }
  ctx.textAlign = 'left';
  if (o.split != null) {
    ctx.fillStyle = 'rgba(53,195,255,0.8)'; ctx.font = `600 9px ${MONO}`;
    ctx.fillText('СЕЙЧАС', o.split * sw + 4, padT + 10);
  }
}

/* Гистограмма исходов Монте-Карло (в % депозита) */
function drawHist(cv, sorted, actual) {
  const { ctx, w, h } = setupCanvas(cv);
  const N = sorted.length;
  let lo = sorted[Math.floor(N * 0.005)], hi = sorted[Math.floor(N * 0.995)];
  lo = Math.min(lo, actual, 0); hi = Math.max(hi, actual, 0);
  if (hi - lo < 0.01) { hi += 0.005; lo -= 0.005; }
  const bins = 30, bw = (hi - lo) / bins, cnt = new Array(bins).fill(0);
  for (const v of sorted) { let b = Math.floor((v - lo) / bw); if (b < 0) b = 0; if (b >= bins) b = bins - 1; cnt[b]++; }
  const mx = Math.max(...cnt), padB = 16, ph = h - padB - 4, cw = w / bins;
  for (let i = 0; i < bins; i++) {
    const mid = lo + (i + 0.5) * bw, bh = cnt[i] / mx * ph;
    ctx.fillStyle = mid < 0 ? 'rgba(255,77,94,0.75)' : 'rgba(31,209,125,0.75)';
    ctx.fillRect(i * cw + 1, 4 + ph - bh, cw - 2, bh);
  }
  const X = v => (v - lo) / (hi - lo) * w;
  ctx.strokeStyle = COL.axis; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(X(0), 4); ctx.lineTo(X(0), 4 + ph); ctx.stroke(); ctx.setLineDash([]);
  ctx.strokeStyle = COL.amber; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(X(actual), 0); ctx.lineTo(X(actual), 4 + ph); ctx.stroke();
  ctx.font = `600 9.5px ${MONO}`; ctx.fillStyle = COL.amber; ctx.textBaseline = 'top';
  const lbl = 'ТЫ', tw = ctx.measureText(lbl).width;
  ctx.fillText(lbl, Math.min(Math.max(X(actual) + 4, 0), w - tw), 2);
  ctx.fillStyle = COL.axis; ctx.font = `9.5px ${MONO}`; ctx.textBaseline = 'alphabetic';
  const pc = v => (v > 0 ? '+' : '') + Math.round(v * 100) + '%';
  ctx.textAlign = 'left'; ctx.fillText(pc(lo), 0, h - 3);
  ctx.textAlign = 'center'; ctx.fillText('0', X(0), h - 3);
  ctx.textAlign = 'right'; ctx.fillText(pc(hi), w, h - 3);
  ctx.textAlign = 'left';
}

/* Кривая капитала */
function drawEquity(cv, eq, inv) {
  const { ctx, w, h } = setupCanvas(cv);
  const all = eq.concat(inv), lo = Math.min(...all) * 0.95, hi = Math.max(...all) * 1.05;
  const X = i => i / (eq.length - 1 || 1) * (w - 8) + 4, Y = v => 6 + (hi - v) / (hi - lo) * (h - 12);
  ctx.strokeStyle = COL.axis; ctx.setLineDash([3, 4]); ctx.lineWidth = 1;
  ctx.beginPath(); inv.forEach((v, i) => i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))); ctx.stroke(); ctx.setLineDash([]);
  const up = eq[eq.length - 1] >= inv[inv.length - 1];
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, up ? 'rgba(31,209,125,0.25)' : 'rgba(255,77,94,0.25)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.beginPath(); eq.forEach((v, i) => i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v)));
  ctx.lineTo(X(eq.length - 1), h); ctx.lineTo(X(0), h); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = up ? COL.up : COL.down; ctx.lineWidth = 2;
  ctx.beginPath(); eq.forEach((v, i) => i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))); ctx.stroke();
  eq.forEach((v, i) => { ctx.fillStyle = up ? COL.up : COL.down; ctx.beginPath(); ctx.arc(X(i), Y(v), 2.2, 0, 7); ctx.fill(); });
}
