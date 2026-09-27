'use strict';
/* =========================================================================
   SKYROCKET СПЕКУЛЯНТ · игра «Точка Б» — логика и интерфейс
   ========================================================================= */

const CONFIG = {
  startDeposit: 100000,
  historicRounds: 11,                 // сколько реальных эпизодов (из 15) попадёт в одну игру
  futureRounds: 3,                    // сколько сценариев будущего
  mustInclude: ['r2020a', 'r2022a'],  // эпизоды, которые есть в каждой игре
  maxRebuys: 2,
  ctxCandles: 40, revCandles: 30,
  // Кнопка в финале. {ending} заменится на код концовки: liq / loss / survive / profit / x_skill / x_luck
  ctaText: 'Получить разбор ошибок в боте',
  ctaUrl: 'https://t.me/speculant?start=game_{ending}',
  // true — отправить результат боту через Telegram.WebApp.sendData (работает, только если игра открыта reply-кнопкой)
  sendData: false,
};

const tg = (window.Telegram && window.Telegram.WebApp) || null;
const ROCKET = '<svg class="rocket" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
  + '<path d="M12 2.5c2.9 2.1 4.4 5.4 4.4 9.2v4.1H7.6v-4.1c0-3.8 1.5-7.1 4.4-9.2z"/><circle cx="12" cy="9.6" r="1.7"/>'
  + '<path d="M7.6 12.4 4.8 15.3v3.2l2.8-1.4M16.4 12.4l2.8 2.9v3.2l-2.8-1.4"/><path d="M10.3 18.2 12 21.5l1.7-3.3"/></svg>';
const BRAND = `<span class="brand">${ROCKET}<b>SKYROCKET</b><span>СПЕКУЛЯНТ</span></span>`;
const SRC = { BTC: 'Yahoo Finance', SPX: 'Yahoo Finance', GOLD: 'Yahoo Finance · COMEX', BRENT: 'Yahoo Finance · ICE', SBER: 'Московская биржа', USDRUB: 'Мосбиржа / ЦБ РФ' };
const app = document.getElementById('app');
let G = null;

/* ---------- утилиты ---------- */
const nf0 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const fmtR = v => nf0.format(Math.round(v)) + ' ₽';
const fmtRs = v => (v > 0 ? '+' : v < 0 ? '−' : '') + nf0.format(Math.abs(Math.round(v))) + ' ₽';
const fmtPct = (v, d = 1) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v * 100).toFixed(d).replace('.', ',') + '%';
const pct0 = v => Math.round(v * 100) + '%';
const fmtPrice = (v, dec) => new Intl.NumberFormat('ru-RU', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(v);
const fmtDate = t => { const d = new Date(t); return `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`; };
const fmtShort = t => { const d = new Date(t); return `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${String(d.getUTCFullYear()).slice(2)}`; };
const cls = v => v > 0 ? 'up' : v < 0 ? 'dn' : '';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function monthsText(ms) {
  const m = Math.round(ms / DAY / 30.44);
  if (m < 1) return 'меньше месяца';
  const y = Math.floor(m / 12), r = m % 12;
  const plural = (n, a, b, c) => { const n10 = n % 10, n100 = n % 100; return n10 === 1 && n100 !== 11 ? a : n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20) ? b : c; };
  return [y ? `${y} ${plural(y, 'год', 'года', 'лет')}` : '', r ? `${r} мес.` : ''].filter(Boolean).join(' ');
}
function waitText(years) {
  if (!isFinite(years) || years > 13.8e9) return 'реже, чем раз за возраст Вселенной';
  if (years < 1 / 12) return `раз в ${Math.max(1, Math.round(years * 365))} дн.`;
  if (years < 1) return `раз в ${Math.round(years * 12)} мес.`;
  if (years < 1e3) return `раз в ${years < 10 ? years.toFixed(1).replace('.', ',') : Math.round(years)} лет`;
  if (years < 1e6) return `раз в ${Math.round(years / 1e3)} тыс. лет`;
  if (years < 1e9) return `раз в ${Math.round(years / 1e6)} млн лет`;
  return `раз в ${(years / 1e9).toFixed(1).replace('.', ',')} млрд лет`;
}

const haptic = t => {
  try {
    if (!tg || !tg.HapticFeedback) return;
    if (t === 'selection') tg.HapticFeedback.selectionChanged();
    else if (['error', 'success', 'warning'].includes(t)) tg.HapticFeedback.notificationOccurred(t);
    else tg.HapticFeedback.impactOccurred(t || 'light');
  } catch (e) { /* не в Telegram */ }
};
const store = {
  get() { try { return JSON.parse(localStorage.getItem('tochkaB') || '{}'); } catch (e) { return {}; } },
  set(v) { try { localStorage.setItem('tochkaB', JSON.stringify(v)); } catch (e) { /* приватный режим */ } },
};

function show(html) { clearTimeout(G && G.timer); app.innerHTML = html; window.scrollTo(0, 0); }

/* =========================================================================
   НОВАЯ ИГРА
   ========================================================================= */
function newGame(assetId) {
  const seed = (Math.random() * 4294967296) >>> 0;
  const rng = makeRng(seed);
  const must = ROUNDS.filter(r => CONFIG.mustInclude.includes(r.id));
  const rest = rng.shuffle(ROUNDS.filter(r => !CONFIG.mustInclude.includes(r.id))).slice(0, CONFIG.historicRounds - must.length);
  const hist = must.concat(rest).sort((a, b) => parseD(a.decision) - parseD(b.decision));
  const fut = rng.shuffle(SCENARIOS).slice(0, CONFIG.futureRounds);
  G = {
    seed, rng, asset: assetId,
    rounds: hist.map(d => ({ kind: 'hist', def: d })).concat(fut.map((d, i) => ({ kind: 'fut', def: d, fi: i }))),
    ri: -1, deposit: CONFIG.startDeposit, invested: CONFIG.startDeposit, peak: CONFIG.startDeposit, rebuys: 0,
    log: [], lessons: [], lessonIds: new Set(), equity: [CONFIG.startDeposit], invLine: [CONFIG.startDeposit],
    sel: { dir: null, size: 0.25, lev: 1, stop: 0.07 }, lastPrice: null, lastT: null, futIntro: false, brokeStop: false,
    sig: { n: 0, ok: 0 }, speed: 1,
  };
}
const cur = () => G.rounds[G.ri];
const A = () => ASSETS[G.asset];

function addLesson(id, L) {
  if (G.lessonIds.has(id)) return false;
  G.lessonIds.add(id); G.lessons.push({ id, ...L });
  if (G.newLessons) G.newLessons.push({ id, ...L });
  return true;
}

/* ---------- подготовка раунда ---------- */
function prepareRound(R) {
  const a = A(), rng = G.rng, nC = CONFIG.ctxCandles, nR = CONFIG.revCandles;
  let muTotal = 0;
  if (R.kind === 'hist') {
    // реальный эпизод: настоящие дневные свечи
    const d = R.def;
    R.t0 = parseD(d.from); R.t1 = parseD(d.to);
    R.ctx = realCandles(a.id, R.t0, parseD(d.decision), nC, rng, a.vol);
    R.rev = realCandles(a.id, parseD(d.decision) + DAY, R.t1, nR, rng, a.vol);
    R.tD = R.ctx[R.ctx.length - 1].t;
    R.t1 = R.rev[R.rev.length - 1].t;
  } else {
    // сценарий будущего: первый стартует с реальных котировок последних 3 месяцев
    const sc = R.def, m = sc.m[a.id] || [0, 0.1], sig = a.vol * sc.vm;
    let start;
    if (R.fi === 0 || G.lastPrice == null) {
      const tLast = dayToT(lastRealDay(a.id));
      R.t0 = tLast - 92 * DAY;
      R.ctx = realCandles(a.id, R.t0, tLast, nC, rng, a.vol);
      R.tD = R.ctx[R.ctx.length - 1].t;
      R.realCtx = true;
      start = R.ctx[R.ctx.length - 1].c;
    } else {
      start = G.lastPrice;
      R.tD = G.lastT + 150 * DAY; R.t0 = R.tD - 92 * DAY;
      R.ctx = buildSeries([
        { t: R.t0, p: start * Math.exp(rng.normal() * a.vol * 0.18) },
        { t: R.t0 + 46 * DAY, p: start * Math.exp(rng.normal() * a.vol * 0.12) },
        { t: R.tD, p: start },
      ], nC, sig, rng);
    }
    R.t1 = R.tD + 91 * DAY;
    const total = m[0] + m[1] * rng.t4();
    const revA = [{ t: R.tD, p: start }];
    const J = sc.jump && sc.jump[a.id];
    if (J && rng.u() < 0.75) {
      const tj = R.tD + (0.15 + 0.45 * rng.u()) * (R.t1 - R.tD);
      revA.push({ t: tj, p: start * Math.exp(total * 0.2 + J), f: 'gap' });
    }
    revA.push({ t: R.t1, p: start * Math.exp(total) });
    R.rev = buildSeries(revA, nR, sig, rng);
    muTotal = m[0];
    G.lastPrice = R.rev[R.rev.length - 1].c;
  }
  R.dtCtx = (R.tD - R.t0) / DAY / R.ctx.length;
  R.dtRev = (R.t1 - R.tD) / DAY / R.rev.length;
  const sc = ewmaSigma(R.ctx) * Math.sqrt(R.dtRev / R.dtCtx);
  R.sigC = Math.max(sc, a.vol * Math.sqrt(R.dtRev / 365) * 0.5);
  R.muC = muTotal / R.rev.length;
  R.ind = indicators(R.ctx);
  R.entry = R.ctx[R.ctx.length - 1].c;
  R.mcSeed = (G.seed ^ (G.ri * 7919 + 13)) >>> 0;
  R.gapText = G.lastT ? monthsText(R.tD - G.lastT) : null;
}

/* =========================================================================
   ЭКРАНЫ
   ========================================================================= */
function scrIntro() {
  const st = store.get();
  G = null;
  show(`
  <div class="scr intro">
    <div class="sysbar"><span class="dot"></span> TERMINAL · ${PRICES_META.updated.split('-').reverse().join('.')}</div>
    <div class="hero-rocket">${ROCKET}</div>
    <div class="brand-top">SKYROCKET</div>
    <h1 class="logo">СПЕКУЛЯНТ<i class="cur">▌</i></h1>
    <div class="game-name">игра «Точка <span class="acc">Б</span>» · симулятор трейдера</div>
    <p class="lead">Путь от первого депозита до первых денег — или до ликвидации. Реальные котировки и кризисы 2018–2026, сценарии будущего.</p>
    <pre class="term" id="typer"></pre>
    ${st.plays ? `<div class="note">Сыграно: ${st.plays} · лучший результат ×${(st.best || 0).toFixed(2).replace('.', ',')}</div>` : ''}
    <div class="sticky"><div class="sticky-in"><button class="btn primary" data-act="toAsset">Начать из точки А →</button></div></div>
  </div>`);
  typeLines(['> январь 2018', '> в ленте скрины: биткоин ×20 за год', '> у тебя 100 000 ₽ накоплений', '> ты решаешь заняться трейдингом', '> впереди 8 лет кризисов', '> точка Б: ликвидация или иксы?']);
}

function typeLines(lines) {
  const el = document.getElementById('typer');
  if (!el) return;
  const text = lines.join('\n'); let i = 0;
  const step = () => {
    if (!document.body.contains(el)) return;
    i += 2; el.textContent = text.slice(0, i);
    if (i < text.length) setTimeout(step, 22);
  };
  step();
}

function scrAsset() {
  const st = store.get(), played = st.assets || {};
  const cards = Object.values(ASSETS).map(a => `
    <button class="asset" data-act="pickAsset" data-id="${a.id}">
      <div class="a-top"><b>${a.ticker}</b><span class="tag">${a.tag}</span>${played[a.id] ? '<span class="done">✓ пройден</span>' : ''}</div>
      <div class="a-name">${a.name}</div>
      <div class="a-desc">${a.desc}</div>
      <div class="a-meta"><span>волатильность ${Math.round(a.vol * 100)}%/год</span><span>плечо до ${a.maxLev}x</span></div>
    </button>`).join('');
  show(`
  <div class="scr">
    <div class="sysbar">${BRAND}<span class="sep">·</span> ШАГ 1 / 2</div>
    <h2 class="h">Чем будешь торговать?</h2>
    <p class="sub">Один актив на всю игру. У каждого своя волатильность, свои кризисы и свой максимальный уровень плеча. Сыграй разными — сценарии будут отличаться.</p>
    <div class="assets">${cards}
      <button class="asset rnd" data-act="pickAsset" data-id="RANDOM"><div class="a-top"><b>СЛУЧАЙНЫЙ</b></div><div class="a-desc">Пусть решит рынок.</div></button>
    </div>
  </div>`);
}

function scrRules() {
  const a = A();
  show(`
  <div class="scr">
    <div class="sysbar">${BRAND}<span class="sep">·</span> ШАГ 2 / 2 · ${a.ticker}</div>
    <h2 class="h">Как устроена игра</h2>
    <div class="card"><div class="k">МАРШРУТ</div>
      <p>${CONFIG.historicRounds} реальных эпизодов 2018–2025 (случайная выборка из ${ROUNDS.length}) и ${CONFIG.futureRounds} сценария будущего — от сегодняшних котировок. В каждом раунде: <b>новость → решение → рынок → разбор</b>.</p></div>
    <div class="card"><div class="k">ПЛЕЧО И ЛИКВИДАЦИЯ</div>
      <p>Позиция = маржа × плечо. При плече L позицию ликвидируют при движении ≈ 90%/L против тебя:</p>
      <div class="mono-row"><span>2x → −45%</span><span>5x → −18%</span><span>10x → −9%</span><span>20x → −4,5%</span></div>
      <p class="dim">Маржа изолирована: в сделке рискует только выбранная доля депозита.</p></div>
    <div class="card"><div class="k">СТОП-ЛОСС</div>
      <p>Закрывает позицию, если цена прошла против тебя заданный %. На гэпе исполнится хуже, а при остановке торгов — не исполнится вовсе.</p></div>
    <div class="card"><div class="k">МОДЕЛЬ РЫНКА</div>
      <div class="formula">ln(Pₜ₊₁/Pₜ) = μΔt + σₜ√Δt · εₜ<br>εₜ ~ t-Стьюдента (ν = 4)<br>σ²ₜ = ω + α·ε²ₜ₋₁ + β·σ²ₜ₋₁</div>
      <p class="dim">Реальные эпизоды — настоящие дневные котировки (Мосбиржа, ЦБ РФ, Yahoo Finance). Сценарии будущего и 1500 альтернативных исходов каждой сделки строит модель: «толстые хвосты» t-распределения и кластеры волатильности GARCH.</p></div>
    <div class="card"><div class="k">ЦЕЛЬ</div>
      <p>Не угадать, а выжить и заработать. Каждую сделку оцениваем по двум осям: <b>качество решения</b> (какой был риск) и <b>результат</b> (что дал рынок). Это не одно и то же.</p></div>
    <div class="sticky"><div class="sticky-in"><button class="btn primary" data-act="start">В рынок →</button></div></div>
  </div>`);
}

function scrFutureIntro() {
  show(`
  <div class="scr center">
    <div class="sysbar"><span class="dot vio"></span> ${fmtDate(dayToT(lastRealDay(G.asset)))} → ?</div>
    <h2 class="h big">Реальные данные<br>закончились</h2>
    <p class="lead">Ты дошёл до сегодняшнего дня. Дальше — сценарии возможного будущего: первый стартует с реальной текущей цены, а исход модель генерирует заново в каждой игре:</p>
    <div class="card"><div class="formula">итог = μ + σ · ε,  ε ~ t(4)</div>
      <p class="dim">μ — ожидаемый эффект новости, σ — неопределённость. Даже у «очевидной» новости есть заметный шанс пойти против неё. Иногда случаются гэпы.</p></div>
    <p class="sub">Депозит: <b class="${cls(G.deposit - G.invested)}">${fmtR(G.deposit)}</b></p>
    <div class="sticky"><div class="sticky-in"><button class="btn vio" data-act="next">Шагнуть в будущее →</button></div></div>
  </div>`);
}

function scrBroke() {
  const can = G.rebuys < CONFIG.maxRebuys;
  haptic('error');
  show(`
  <div class="scr center">
    <div class="sysbar"><span class="dot red"></span> MARGIN CALL</div>
    <h2 class="h big red">Депозит уничтожен</h2>
    <p class="lead">На счёте <b>${fmtR(G.deposit)}</b> из ${fmtR(G.invested)} вложенных.</p>
    <div class="card"><p>Впереди ещё ${G.rounds.length - G.ri - 1} раунд(а). Можно долить денег и попробовать отыграться — или остановиться и посмотреть, где ты оказался.</p></div>
    <div class="sticky"><div class="sticky-in col">
      ${can ? `<button class="btn red" data-act="rebuy">Долить ${fmtR(CONFIG.startDeposit)} и отыграться</button>` : ''}
      <button class="btn ghost" data-act="stopGame">Остановиться → к точке Б</button>
    </div></div>
  </div>`);
}

/* ---------- раунд ---------- */
function topbar() {
  const pnl = G.deposit - G.invested, n = G.rounds.length;
  return `
  <div class="top">
    <div class="tl"><span class="tb">${ROCKET}</span><span>${String(G.ri + 1).padStart(2, '0')}/${n}</span><span class="tk">${A().ticker}</span></div>
    <div class="tr"><span class="dim">ДЕПО</span> <b class="${cls(pnl)}">${fmtR(G.deposit)}</b></div>
    <div class="prog"><i style="width:${(G.ri + 1) / n * 100}%"></i></div>
  </div>`;
}

function renderRound() {
  const R = cur(), a = A(), fut = R.kind === 'fut';
  const ind = R.ind;
  show(`
  ${topbar()}
  <section class="card news">
    <div class="meta"><span class="date">${fmtDate(R.tD)}</span>
      ${fut ? '<span class="badge vio">СЦЕНАРИЙ</span>' : '<span class="badge">РЕАЛЬНЫЙ ЭПИЗОД</span>'}
      ${R.gapText ? `<span class="dim">· прошло ${R.gapText}</span>` : ''}</div>
    <h2>${esc(R.def.title)}</h2>
    ${G.phase === 'decide' ? `<p>${R.def.before}</p>` : ''}
  </section>
  <section class="card chartcard">
    <div class="chead"><b>${a.ticker}</b><span class="px" id="px">${fmtPrice(R.entry, a.dec)}</span><span id="chg" class="chg"></span>
      <span class="tf">свеча ≈ ${R.dtCtx < 1.5 ? '1 дн.' : Math.round(R.dtCtx) + ' дн.'}</span></div>
    <canvas id="chart"></canvas>
    <div class="chips">
      <span class="chip ${ind.trend > 0 ? 'up' : 'dn'}">ТРЕНД ${ind.trend > 0 ? '↑' : '↓'} SMA10 ${ind.trend > 0 ? '>' : '<'} SMA30</span>
      <span class="chip ${ind.rsi > 70 ? 'dn' : ind.rsi < 30 ? 'up' : ''}">RSI ${Math.round(ind.rsi)}${ind.rsi > 70 ? ' перекуплен' : ind.rsi < 30 ? ' перепродан' : ''}</span>
      <span class="chip">σ свечи ${(R.sigC * 100).toFixed(1).replace('.', ',')}%</span>
    </div>
    <div class="src">${fut ? (R.realCtx ? `● история — реальные котировки (${SRC[a.id]}), дальше — модель` : '● сценарий модели') : `● реальные котировки · ${SRC[a.id]}`}</div>
  </section>
  <section id="panel">${G.phase === 'decide' ? panelDecide() : G.phase === 'live' ? panelLive() : panelResult()}</section>
  <div class="sticky"><div class="sticky-in" id="bar">${barHtml()}</div></div>`);
  drawRoundChart();
  if (G.phase === 'decide') updateCalc();
  if (G.phase === 'result') drawResultCharts();
}

function chartLines() {
  const P = G.pos, a = A();
  if (!P) return [];
  const f = v => fmtPrice(v, a.dec);
  const lines = [{ p: P.entry, col: COL.cyan, label: f(P.entry), dash: true }];
  if (P.stopP) lines.push({ p: P.stopP, col: COL.amber, label: 'SL ' + f(P.stopP), dash: true });
  lines.push({ p: P.liqP > 0 ? P.liqP : null, col: COL.down, label: 'LIQ ' + f(P.liqP), dash: true });
  return lines;
}

function drawRoundChart() {
  const R = cur(), a = A(), cv = document.getElementById('chart');
  if (!cv) return;
  const all = R.ctx.concat(R.rev), split = R.ctx.length;
  const shown = G.phase === 'decide' ? split : G.phase === 'live' ? split + G.live.i : all.length;
  const lines = G.phase === 'decide' ? previewLines() : chartLines();
  const L = G.live, ex = L && L.exit ? { i: split + L.exit.i, p: L.exit.price, reason: L.exit.reason } : null;
  drawCandles(cv, {
    candles: all, shown, slots: all.length, split, lines, fmt: v => fmtPrice(v, a.dec),
    entryIdx: G.pos && G.phase !== 'decide' ? split : null, exit: ex,
    dates: [{ i: 0, label: fmtShort(R.ctx[0].t - R.dtCtx * DAY), align: 'left' }, { i: split - 1, label: fmtShort(R.tD), force: true },
            { i: all.length - 1, label: fmtShort(R.t1), align: 'right' }],
  });
  if (G.phase !== 'decide') {
    const last = all[shown - 1], chg = last.c / R.entry - 1;
    const px = document.getElementById('px'), ch = document.getElementById('chg');
    if (px) px.textContent = fmtPrice(last.c, a.dec);
    if (ch) { ch.textContent = fmtPct(chg); ch.className = 'chg ' + cls(chg); }
  }
}

function previewLines() {
  const s = G.sel, R = cur(), a = A();
  if (!s.dir) return [];
  const f = v => fmtPrice(v, a.dec), lines = [];
  if (s.stop) lines.push({ p: R.entry * (1 - s.dir * s.stop), col: COL.amber, label: 'SL ' + f(R.entry * (1 - s.dir * s.stop)), dash: true });
  const lp = R.entry * (1 - s.dir * 0.9 / s.lev);
  if (lp > 0) lines.push({ p: lp, col: COL.down, label: 'LIQ ' + f(lp), dash: true });
  return lines;
}

/* ---------- панель решения ---------- */
function levOptions() { return [1, 2, 5, 10, 20].filter(l => l <= A().maxLev); }

function panelDecide() {
  const s = G.sel;
  if (!levOptions().includes(s.lev)) s.lev = 1;
  const seg = (k, opts) => opts.map(([v, l]) => `<button data-act="sel" data-k="${k}" data-v="${v}" class="${s[k] === v ? 'on' : ''}">${l}</button>`).join('');
  const off = s.dir === 0 ? ' off' : '';
  return `
  <div class="card trade">
    <div class="lbl">НАПРАВЛЕНИЕ</div>
    <div class="seg dir">
      <button data-act="sel" data-k="dir" data-v="1" class="long ${s.dir === 1 ? 'on' : ''}">▲ ЛОНГ</button>
      <button data-act="sel" data-k="dir" data-v="-1" class="short ${s.dir === -1 ? 'on' : ''}">▼ ШОРТ</button>
      <button data-act="sel" data-k="dir" data-v="0" class="${s.dir === 0 ? 'on' : ''}">ПРОПУСК</button>
    </div>
    <div class="grp${off}">
      <div class="lbl">ДОЛЯ ДЕПОЗИТА В СДЕЛКЕ <span class="dim">(маржа)</span></div>
      <div class="seg">${seg('size', [[0.1, '10%'], [0.25, '25%'], [0.5, '50%'], [1, '100%']])}</div>
      <div class="lbl">ПЛЕЧО</div>
      <div class="seg">${seg('lev', levOptions().map(l => [l, l + 'x']))}</div>
      <div class="lbl">СТОП-ЛОСС</div>
      <div class="seg">${seg('stop', [[0, 'нет'], [0.03, '−3%'], [0.07, '−7%'], [0.15, '−15%']])}</div>
    </div>
    <div class="calc" id="calc"></div>
  </div>`;
}

function updateCalc() {
  const el = document.getElementById('calc');
  if (!el) return;
  const s = G.sel, R = cur(), a = A();
  if (s.dir === null) { el.innerHTML = '<div class="dim">Выбери направление: лонг — ставка на рост, шорт — на падение.</div>'; return; }
  if (s.dir === 0) { el.innerHTML = '<div class="dim">Смотришь со стороны: депозит не меняется, но разбор эпизода получишь.</div>'; return; }
  const pos = makePos(s, 1, G.deposit);
  const mc = monteCarlo(pos, { n: R.rev.length, sigC: R.sigC, muC: R.muC, dtDays: R.dtRev, A: a, deposit: G.deposit, N: 500, seed: R.mcSeed });
  const riskStop = s.stop ? pos.notional * s.stop : null;
  const warn = [];
  if (s.lev * s.size >= 5) warn.push('Позиция в 5+ раз больше депозита');
  if (riskStop && riskStop / G.deposit > 0.05) warn.push(`Риск по стопу ${pct0(riskStop / G.deposit)} депозита — профи рискуют 1–2%`);
  if (!s.stop && s.lev >= 5) warn.push('Высокое плечо без стопа');
  if (mc.pLiq > 0.2) warn.push('Вероятность ликвидации выше 20%');
  el.innerHTML = `
    <div class="crow"><span>Позиция</span><b>${fmtR(pos.notional)}</b></div>
    <div class="crow"><span>Ликвидация при движении</span><b class="dn">${fmtPct(-pos.liqPct)} против тебя</b></div>
    ${riskStop ? `<div class="crow"><span>Убыток по стопу ≈</span><b>${fmtR(riskStop)} · ${pct0(riskStop / G.deposit)} депо</b></div>` : ''}
    <div class="mc-mini">
      <div class="k">МОДЕЛЬ · 500 СЦЕНАРИЕВ НА ${monthsText(R.t1 - R.tD)} ВПЕРЁД</div>
      <div class="bars">
        <div><span>прибыль</span><i><b class="g" style="width:${mc.pWin * 100}%"></b></i><em>${pct0(mc.pWin)}</em></div>
        <div><span>стоп</span><i><b class="a" style="width:${mc.pStop * 100}%"></b></i><em>${pct0(mc.pStop)}</em></div>
        <div><span>ликвидация</span><i><b class="r" style="width:${mc.pLiq * 100}%"></b></i><em>${pct0(mc.pLiq)}</em></div>
      </div>
      <div class="dim small">Худшие 5% сценариев: в среднем ${fmtPct(-mc.es5, 0)} депозита</div>
    </div>
    ${warn.length ? `<div class="warn">${warn.map(w => '⚠ ' + w).join('<br>')}</div>` : ''}`;
}

function barHtml() {
  if (G.phase === 'decide') {
    const s = G.sel;
    const label = s.dir === 0 ? 'Пропустить и смотреть' : s.dir === 1 ? '▲ Открыть лонг' : s.dir === -1 ? '▼ Открыть шорт' : 'Выбери направление';
    const c = s.dir === 1 ? 'primary' : s.dir === -1 ? 'red' : 'ghost';
    return `<button class="btn ${c}" data-act="open" ${s.dir === null ? 'disabled' : ''}>${label}</button>`;
  }
  if (G.phase === 'live') {
    const L = G.live, done = !G.pos || L.exit;
    const halted = L.i > 0 && cur().rev[L.i - 1].halt;
    return `${done ? '' : `<button class="btn amber" data-act="close" ${halted ? 'disabled' : ''}>${halted ? 'Торги остановлены' : 'Закрыть позицию'}</button>`}
      <button class="btn ghost sq" data-act="fast">${G.speed > 1 ? '▶▶' : '▶'}</button>`;
  }
  const last = G.ri >= G.rounds.length - 1;
  return `<button class="btn primary" data-act="next">${last ? 'К точке Б →' : 'Следующий раунд →'}</button>`;
}
const refreshBar = () => { const b = document.getElementById('bar'); if (b) b.innerHTML = barHtml(); };

/* ---------- live ---------- */
function panelLive() {
  const P = G.pos, a = A();
  if (!P) return `<div class="card live"><div class="lbl">ТЫ ВНЕ РЫНКА</div><div class="pnl">0 ₽</div><div class="status" id="status">Наблюдаешь, как развивались события…</div></div>`;
  const f = v => fmtPrice(v, a.dec);
  return `
  <div class="card live">
    <div class="lrow"><span class="lbl">ПОЗИЦИЯ</span><span class="ptag ${P.dir > 0 ? 'up' : 'dn'}">${P.dir > 0 ? 'ЛОНГ' : 'ШОРТ'} ×${P.lev} · ${fmtR(P.notional)}</span></div>
    <div class="pnl" id="pnl">0 ₽</div>
    <div class="lrow small"><span>вход <b>${f(P.entry)}</b></span>${P.stopP ? `<span>стоп <b class="am">${f(P.stopP)}</b></span>` : ''}<span>ликв. <b class="dn">${P.liqP > 0 ? f(P.liqP) : '—'}</b></span></div>
    <div class="lprog"><i id="lprog"></i></div>
    <div class="status" id="status">Рынок движется…</div>
  </div>`;
}

function openTrade() {
  const R = cur(), s = G.sel;
  G.pos = s.dir ? makePos(s, R.entry, G.deposit) : null;
  G.newLessons = [];
  if (G.pos && s.size >= 1) addLesson('allin', DYN_LESSONS.allin);
  G.live = { i: 0, exit: null, depBefore: G.deposit };
  G.phase = 'live';
  haptic('medium');
  renderRound();
  tick();
}

function tick() {
  clearTimeout(G.timer);
  const L = G.live, R = cur();
  if (L.i >= R.rev.length) { G.timer = setTimeout(finishRound, 350); return; }
  const cd = R.rev[L.i];
  if (G.pos && !L.exit) {
    const hit = checkCandle(G.pos, cd);
    if (hit) { L.exit = { ...hit, i: L.i }; onExit(); }
  }
  L.i++;
  updateLive();
  const base = !G.pos || L.exit ? 70 : 170;
  G.timer = setTimeout(tick, base / G.speed);
}

function unrealized() {
  const L = G.live, R = cur(), P = G.pos;
  if (!P) return 0;
  if (L.exit) return calcPnl(P, L.exit.price, L.exit.reason, (L.exit.i + 1) * R.dtRev, A()).pnl;
  if (L.i === 0) return 0;
  return calcPnl(P, R.rev[L.i - 1].c, 'mark', L.i * R.dtRev, A()).pnl;
}

function updateLive() {
  drawRoundChart();
  const L = G.live, R = cur();
  const pr = document.getElementById('lprog'); if (pr) pr.style.width = (L.i / R.rev.length * 100) + '%';
  const st = document.getElementById('status');
  const cd = R.rev[L.i - 1];
  if (G.pos) {
    const v = unrealized(), el = document.getElementById('pnl');
    if (el) { el.textContent = fmtRs(v); el.className = 'pnl ' + cls(v); }
    if (st && !L.exit) st.textContent = cd && cd.halt ? '⏸ Торги остановлены — выйти невозможно' : `${fmtDate(cd ? cd.t : R.tD)} · ${fmtPct(v / L.depBefore)} к депозиту`;
  } else if (st && cd) st.textContent = cd.halt ? '⏸ Торги остановлены' : fmtDate(cd.t);
  refreshBar();
}

function onExit() {
  const L = G.live, st = document.getElementById('status');
  const txt = { liq: '✕ ЛИКВИДАЦИЯ. Брокер закрыл позицию.', stop: '■ Сработал стоп-лосс.', manual: '■ Позиция закрыта вручную.' }[L.exit.reason];
  haptic(L.exit.reason === 'liq' ? 'error' : 'warning');
  if (st) { st.textContent = txt + ' Смотрим, что было дальше…'; st.className = 'status ' + (L.exit.reason === 'liq' ? 'dn' : 'am'); }
}

function closeManual() {
  const L = G.live, R = cur();
  if (!G.pos || L.exit) return;
  const i = Math.max(0, L.i - 1);
  L.exit = { price: L.i === 0 ? R.entry : R.rev[i].c, reason: 'manual', i };
  onExit(); updateLive();
}

/* ---------- итоги раунда ---------- */
function finishRound() {
  const R = cur(), a = A(), P = G.pos, L = G.live;
  const first = R.ctx[R.ctx.length - 1].c, lastC = R.rev[R.rev.length - 1].c;
  const res = { title: R.def.title, kind: R.kind, id: R.def.id, date: R.tD, move: lastC / first - 1, depBefore: L.depBefore };
  G.newLessons = G.newLessons || [];

  // самая сильная свеча в σ
  let prev = first, maxR = 0;
  for (const c of R.rev) { const r = Math.log(c.c / prev); if (Math.abs(r) > Math.abs(maxR)) maxR = r; prev = c.c; }
  const z = Math.abs(maxR) / R.sigC;
  const candlesPerYear = 365 / R.dtRev;
  res.tail = z >= 3 ? { r: Math.exp(maxR) - 1, z, yN: 1 / normSF(z) / candlesPerYear, yT: 1 / t4SF(z) / candlesPerYear } : null;

  // сигнал тренда
  res.signalOk = Math.sign(res.move) === R.ind.trend;
  G.sig.n++; if (res.signalOk) G.sig.ok++;

  if (P) {
    const ex = L.exit || { price: lastC, reason: 'end', i: R.rev.length - 1 };
    const r = calcPnl(P, ex.price, ex.reason, (ex.i + 1) * R.dtRev, a);
    const mc = monteCarlo(P, { n: R.rev.length, sigC: R.sigC, muC: R.muC, dtDays: R.dtRev, A: a, deposit: L.depBefore, N: 1500, seed: R.mcSeed + 1 });
    const frac = r.pnl / L.depBefore;
    const q = mc.pLiq > 0.2 || mc.es5 > 0.35 ? 'bad' : mc.pLiq < 0.05 && mc.es5 < 0.12 ? 'good' : 'ok';
    Object.assign(res, {
      trade: true, dir: P.dir, lev: P.lev, size: P.size, stop: P.stopPct, entry: P.entry, exit: ex.price, reason: ex.reason, gap: !!ex.gap,
      pnl: r.pnl, fees: r.fees, over: ex.gap ? r.over : 0, frac, mc, pct: percentileOf(mc.sorted, frac), q, exposure: P.size * P.lev,
    });
    if (ex.reason === 'stop' || ex.reason === 'manual') {
      const ghost = { ...P, stopP: null };
      let h = null, hi = R.rev.length - 1;
      for (let i = 0; i < R.rev.length; i++) { h = checkCandle(ghost, R.rev[i]); if (h) { hi = i; break; } }
      const alt = calcPnl(P, h ? h.price : lastC, h ? h.reason : 'end', (hi + 1) * R.dtRev, a);
      res.alt = { pnl: alt.pnl, liq: h && h.reason === 'liq' };
    }
    G.deposit = Math.max(0, G.deposit + r.pnl);
    if (ex.reason === 'liq') addLesson('liq', DYN_LESSONS.liq);
    if (ex.gap && ex.reason === 'stop') addLesson('slip', DYN_LESSONS.slip);
    if (ex.reason === 'manual') addLesson('manual', DYN_LESSONS.manual);
    if (q === 'bad' && r.pnl > 0) addLesson('luck', DYN_LESSONS.luck);
  } else {
    res.trade = false;
    addLesson('skip', DYN_LESSONS.skip);
  }
  addLesson(R.def.id, R.def.lesson);
  G.peak = Math.max(G.peak, G.deposit);
  if (G.deposit < G.peak * 0.5) addLesson('dd', DYN_LESSONS.dd);
  G.equity.push(G.deposit); G.invLine.push(G.invested);
  G.lastT = R.t1;
  res.lessons = G.newLessons.filter(x => x.id !== R.def.id); G.newLessons = [];
  G.log.push(res);
  G.res = res;
  G.phase = 'result';
  haptic(res.trade ? (res.pnl > 0 ? 'success' : 'warning') : 'light');
  renderRound();
}

const VERDICT = {
  good_win:  { t:'ЗАСЛУЖЕННО',       c:'up', x:'Риск был под контролем, и рынок пошёл в твою сторону. Так выглядит нормальная сделка.' },
  good_loss: { t:'НЕ ПОВЕЗЛО',       c:'cy', x:'Решение было разумным: риск ограничен. Убыток — нормальная часть статистики. Хорошее решение не гарантирует хороший результат в отдельной сделке.' },
  ok_win:    { t:'НЕПЛОХО',          c:'up', x:'Прибыль есть, но риск был выше комфортного. Посмотри на левый хвост распределения ниже — готов ли ты к нему?' },
  ok_loss:   { t:'В ПРЕДЕЛАХ РИСКА', c:'am', x:'Убыток, но не катастрофа. Риск был заметным, хотя и не безрассудным. Проверь, соответствовал ли размер позиции твоей уверенности.' },
  bad_win:   { t:'ПОВЕЗЛО',          c:'am', x:'Ты заработал, но решение было плохим. Не путай удачу с навыком: на дистанции такой риск выставляет счёт.' },
  bad_loss:  { t:'ЗАКОНОМЕРНО',      c:'dn', x:'Слишком большой риск — и рынок его реализовал. В значительной части альтернативных сценариев эта сделка тоже заканчивалась плохо.' },
};
const REASON = { liq: 'ликвидация', stop: 'стоп-лосс', manual: 'закрыта вручную', end: 'конец раунда' };

function panelResult() {
  const r = G.res, a = A(), R = cur();
  const f = v => fmtPrice(v, a.dec);
  const lastC = R.rev[R.rev.length - 1].c;
  let hero;
  if (r.trade) {
    const v = VERDICT[r.q + '_' + (r.pnl > 0 ? 'win' : 'loss')];
    hero = `
    <div class="card hero">
      <div class="verdict ${v.c}">${v.t}</div>
      <div class="pnl big ${cls(r.pnl)}">${fmtRs(r.pnl)}</div>
      <div class="dim">${fmtPct(r.frac)} к депозиту · ${r.dir > 0 ? 'лонг' : 'шорт'} ×${r.lev} · ${REASON[r.reason]}</div>
      <div class="kv">
        <div><span>вход</span><b>${f(r.entry)}</b></div><div><span>выход</span><b>${f(r.exit)}</b></div>
        <div><span>комиссии и плечо</span><b>${fmtR(r.fees)}</b></div><div><span>депозит</span><b>${fmtR(G.deposit)}</b></div>
      </div>
      <p>${v.x}</p>
      ${r.gap && r.reason !== 'end' ? `<p class="am">⚡ Цена открылась гэпом за уровнем ${r.reason === 'liq' ? 'ликвидации' : 'стопа'} — исполнение хуже заявленного.</p>` : ''}
      ${r.over > 0 ? `<p class="dn">Убыток по рынку превысил маржу на ${fmtR(r.over)}. У брокера без изолированной маржи ты остался бы ему должен.</p>` : ''}
      ${r.alt ? `<p class="dim">Если бы держал до конца без стопа: ${r.alt.liq ? '<b class="dn">ликвидация</b>' : `<b class="${cls(r.alt.pnl)}">${fmtRs(r.alt.pnl)}</b>`}.</p>` : ''}
    </div>`;
  } else {
    hero = `
    <div class="card hero">
      <div class="verdict cy">НАБЛЮДАТЕЛЬ</div>
      <div class="pnl big">0 ₽</div>
      <div class="dim">Ты пропустил раунд. Депозит: ${fmtR(G.deposit)}</div>
    </div>`;
  }

  const moveTxt = `<div class="move"><b>${a.ticker}</b>: ${f(R.entry)} → ${f(lastC)} <b class="${cls(r.move)}">${fmtPct(r.move)}</b> за ${monthsText(R.t1 - R.tD)}</div>`;
  const what = `
    <div class="card"><div class="k">${R.kind === 'fut' ? 'КАК РАЗВИВАЛСЯ СЦЕНАРИЙ' : 'ЧТО ПРОИЗОШЛО НА САМОМ ДЕЛЕ'}</div>
      ${moveTxt}<p>${R.def.after}</p>
      ${R.kind === 'fut' ? `<p class="dim">Модель сценария давала ожидаемое изменение ${fmtPct(Math.exp(R.muC * R.rev.length) - 1, 0)}; вероятность роста ≈ ${pct0(probUp(R))}. Реальность выбрала ${r.move > 0 ? 'рост' : 'падение'}.</p>` : ''}
    </div>`;

  const mcCard = r.trade ? `
    <div class="card"><div class="k">1500 АЛЬТЕРНАТИВНЫХ ВСЕЛЕННЫХ</div>
      <p class="dim small">Та же сделка, те же настройки, случайные пути цены по модели с толстыми хвостами. Результат в % депозита:</p>
      <canvas id="hist" class="hist"></canvas>
      <div class="kv">
        <div><span>прибыльных</span><b class="up">${pct0(r.mc.pWin)}</b></div>
        <div><span>ликвидаций</span><b class="dn">${pct0(r.mc.pLiq)}</b></div>
        <div><span>медиана</span><b>${fmtPct(r.mc.median)}</b></div>
        <div><span>худшие 5%</span><b class="dn">${fmtPct(-r.mc.es5)}</b></div>
      </div>
      <p><b>Твой результат лучше, чем ${pct0(r.pct)} сценариев.</b> ${r.pct > 0.8 ? 'Это везение выше среднего — не стоит считать его нормой.' : r.pct < 0.2 ? (r.q === 'bad' ? 'Неудача, но при таком риске она была вполне ожидаемой.' : 'Это неудача хуже среднего — такое бывает даже с хорошими решениями.') : 'Это обычный исход для такого решения.'}</p>
    </div>` : '';

  const tail = r.tail ? `
    <div class="card"><div class="k">ТОЛСТЫЙ ХВОСТ</div>
      <p>Самая сильная свеча раунда: <b class="${cls(r.tail.r)}">${fmtPct(r.tail.r)}</b> — это <b>${r.tail.z.toFixed(1).replace('.', ',')}σ</b> от ожидаемой волатильности.</p>
      <div class="tailbox">
        <div><span>нормальное распределение</span><b>${waitText(r.tail.yN)}</b></div>
        <div><span>t-распределение (ν=4)</span><b>${waitText(r.tail.yT)}</b></div>
      </div>
      <p class="dim small">Модель, которая верит в «колокол» Гаусса, недооценивает кризисы на порядки.</p>
    </div>` : '';

  const sig = `
    <div class="card"><div class="k">ПРОВЕРКА СИГНАЛА</div>
      <p>Трендовый сигнал (SMA10 vs SMA30) говорил: <b class="${R.ind.trend > 0 ? 'up' : 'dn'}">${R.ind.trend > 0 ? 'ЛОНГ' : 'ШОРТ'}</b> — ${r.signalOk ? '<b class="up">сработал</b>' : '<b class="dn">не сработал</b>'}.</p>
      <p class="dim small">За игру сигнал сработал: ${G.sig.ok} из ${G.sig.n} (${pct0(G.sig.ok / G.sig.n)}). Паттерны дают вероятность, а не гарантию.</p>
    </div>`;

  const lesson = R.def.lesson;
  const les = `
    <div class="card lesson"><div class="k">УРОК · добавлен в конспект</div>
      <h3>${lesson.t}</h3><p>${lesson.x}</p></div>` +
    (r.lessons || []).map(l => `<div class="card lesson"><div class="k">ОТКРЫТ УРОК ПО ТВОЕЙ СДЕЛКЕ</div><h3>${l.t}</h3><p>${l.x}</p></div>`).join('');
  return hero + what + mcCard + tail + sig + les;
}

function probUp(R) {
  // вероятность роста за раунд при сценарном μ (t4 ≈ нормальное для суммы шагов)
  const m = R.muC * R.rev.length, sd = R.sigC * Math.sqrt(R.rev.length);
  return 1 - normSF(m / sd);
}

function drawResultCharts() {
  const r = G.res, cv = document.getElementById('hist');
  if (r.trade && cv) drawHist(cv, r.mc.sorted, r.frac);
}

/* =========================================================================
   ФИНАЛ
   ========================================================================= */
function scrEnd() {
  const a = A(), trades = G.log.filter(x => x.trade), n = trades.length;
  const mult = G.deposit / G.invested;
  const good = trades.filter(x => x.q === 'good').length, bad = trades.filter(x => x.q === 'bad').length;
  let ending;
  if (G.brokeStop || mult < 0.1) ending = 'liq';
  else if (mult < 0.7) ending = 'loss';
  else if (mult < 1.15) ending = 'survive';
  else if (mult < 2.5) ending = 'profit';
  else ending = bad >= good ? 'x_luck' : 'x_skill';
  const E = ENDINGS[ending];

  const wins = trades.filter(x => x.pnl > 0).length;
  const liqs = trades.filter(x => x.reason === 'liq').length;
  const stops = trades.filter(x => x.stop).length;
  const manual = trades.filter(x => x.reason === 'manual').length;
  const skips = G.log.length - n;
  const avgExp = n ? trades.reduce((s, x) => s + x.exposure, 0) / n : 0;
  const avgLev = n ? trades.reduce((s, x) => s + x.lev, 0) / n : 0;
  const skill = n ? Math.round(100 * trades.reduce((s, x) => s + (x.q === 'good' ? 1 : x.q === 'ok' ? 0.5 : 0), 0) / n) : 0;
  const luck = n ? Math.round(100 * trades.reduce((s, x) => s + x.pct, 0) / n) : 50;
  const survive = trades.reduce((p, x) => p * (1 - x.mc.pLiq), 1);

  let arch = 'intuitive';
  if (n && avgExp >= 5) arch = 'gambler';
  else if (skips / Math.max(1, G.log.length) >= 0.5) arch = 'watcher';
  else if (n && manual / n >= 0.5) arch = 'nervous';
  else if (n && stops / n >= 0.6 && avgExp <= 3) arch = 'system';
  const AR = ARCHETYPES[arch];

  // сохранение статистики
  const st = store.get();
  st.plays = (st.plays || 0) + 1; st.best = Math.max(st.best || 0, mult);
  st.assets = st.assets || {}; st.assets[G.asset] = 1; store.set(st);
  const untried = Object.values(ASSETS).filter(x => !st.assets[x.id]);
  const suggest = untried.length ? untried[Math.floor(Math.random() * untried.length)] : null;

  G.ending = { id: ending, mult, skill, luck, arch };
  const lessons = G.lessons.map((l, i) => `<details class="les"><summary><span>${String(i + 1).padStart(2, '0')}</span>${l.t}</summary><p>${l.x}</p></details>`).join('');
  const rows = G.log.map(x => `<div class="lr"><span>${new Date(x.date).getUTCFullYear()}</span><span class="t">${esc(x.title)}</span>
    <b class="${x.trade ? cls(x.pnl) : ''}">${x.trade ? fmtPct(x.frac, 0) : '—'}</b></div>`).join('');

  show(`
  <div class="scr end">
    <div class="sysbar">${BRAND}<span class="sep">·</span> ТОЧКА Б · ${a.ticker}</div>
    <div class="glyph ${E.col}">${E.glyph}</div>
    <h1 class="end-t ${E.col}">${E.title}</h1>
    <div class="end-dep"><b class="${cls(G.deposit - G.invested)}">${fmtR(G.deposit)}</b><span>×${mult.toFixed(2).replace('.', ',')} от вложенных ${fmtR(G.invested)}${G.rebuys ? ` (доливов: ${G.rebuys})` : ''}</span></div>
    <div class="card"><canvas id="eq" class="eq"></canvas><div class="dim small">Капитал по раундам · пунктир — вложенные деньги</div></div>
    <div class="card"><p>${G.rebuys && ending === 'survive' ? 'С учётом долива ты вышел примерно в ноль по всем вложенным деньгам. Но первый депозит был уничтожен, а в реальной жизни отыгрыш редко заканчивается так удачно.' : E.text}</p>
      ${G.rebuys ? `<p class="am">⚠ Ты доливал депозит ${G.rebuys === 1 ? 'один раз' : G.rebuys + ' раза'}. Результат считается от всех вложенных денег — ${fmtR(G.invested)}.</p>` : ''}</div>
    <div class="card arch"><div class="k">ТВОЙ СТИЛЬ</div><h3>${AR.t}</h3><p>${AR.x}</p></div>
    <div class="card"><div class="k">НАВЫК VS УДАЧА</div>
      <div class="meter"><span>качество решений</span><i><b class="g" style="width:${skill}%"></b></i><em>${skill}</em></div>
      <div class="meter"><span>индекс удачи</span><i><b class="a" style="width:${luck}%"></b></i><em>${luck}</em></div>
      <p class="dim small">Качество — насколько риск в сделках был под контролем (вероятность ликвидации и худшие 5% исходов). Удача — средний перцентиль твоих результатов среди альтернативных сценариев: 50 — обычная удача.</p>
      ${n ? `<p>Шанс пройти весь путь без единой ликвидации с твоим уровнем риска: <b class="${survive < 0.3 ? 'dn' : survive < 0.7 ? 'am' : 'up'}">${pct0(survive)}</b></p>` : ''}
    </div>
    <div class="card"><div class="k">СТАТИСТИКА</div>
      <div class="kv">
        <div><span>сделок / пропусков</span><b>${n} / ${skips}</b></div>
        <div><span>прибыльных</span><b>${n ? pct0(wins / n) : '—'}</b></div>
        <div><span>среднее плечо</span><b>${n ? avgLev.toFixed(1).replace('.', ',') + 'x' : '—'}</b></div>
        <div><span>ликвидаций</span><b class="${liqs ? 'dn' : ''}">${liqs}</b></div>
        <div><span>сделок со стопом</span><b>${n ? pct0(stops / n) : '—'}</b></div>
        <div><span>сигнал тренда</span><b>${G.sig.ok}/${G.sig.n}</b></div>
      </div>
      <div class="lrows">${rows}</div>
    </div>
    <div class="card"><div class="k">ЧТО ДАЛЬШЕ</div>${E.next.map(x => `<p>${x}</p>`).join('')}</div>
    <div class="card"><div class="k">КОНСПЕКТ · ${G.lessons.length} УРОКОВ</div>${lessons}</div>
    ${suggest ? `<p class="sub center">Попробуй <b>${suggest.ticker}</b>: другие эпизоды, другие риски.</p>` : ''}
    <div class="sticky"><div class="sticky-in col">
      <button class="btn primary" data-act="cta">${esc(CONFIG.ctaText)}</button>
      <button class="btn ghost" data-act="again">Сыграть снова</button>
    </div></div>
  </div>`);
  drawEquity(document.getElementById('eq'), G.equity, G.invLine);
  haptic(ending === 'liq' ? 'error' : 'success');
}

function cta() {
  const e = G.ending;
  const payload = { game: 'tochka_b', ending: e.id, asset: G.asset, mult: +e.mult.toFixed(2), skill: e.skill, luck: e.luck, style: e.arch, rebuys: G.rebuys };
  if (CONFIG.sendData && tg && tg.initData) { try { tg.sendData(JSON.stringify(payload)); return; } catch (err) { /* fallback ниже */ } }
  const url = CONFIG.ctaUrl.replace('{ending}', e.id);
  try {
    if (tg && tg.initData && /^https:\/\/t\.me\//.test(url)) { tg.openTelegramLink(url); return; }
    if (tg && tg.initData) { tg.openLink(url); return; }
  } catch (err) { /* не в Telegram */ }
  window.open(url, '_blank');
}

/* =========================================================================
   ДЕЙСТВИЯ
   ========================================================================= */
function nextRound() {
  if (G.ri >= 0 && G.deposit < CONFIG.startDeposit * 0.03 && G.phase === 'result' && G.ri < G.rounds.length - 1) { G.phase = 'broke'; return scrBroke(); }
  if (G.ri >= G.rounds.length - 1) return scrEnd();
  const nx = G.rounds[G.ri + 1];
  if (nx.kind === 'fut' && !G.futIntro) { G.futIntro = true; return scrFutureIntro(); }
  G.ri++;
  G.pos = null; G.live = null; G.res = null;
  G.sel.dir = null;
  prepareRound(cur());
  G.phase = 'decide';
  renderRound();
}

const ACT = {
  toAsset: scrAsset,
  pickAsset: b => {
    let id = b.dataset.id;
    if (id === 'RANDOM') { const ks = Object.keys(ASSETS); id = ks[Math.floor(Math.random() * ks.length)]; }
    newGame(id); haptic('light'); scrRules();
  },
  start: () => nextRound(),
  sel: b => {
    const k = b.dataset.k, v = +b.dataset.v;
    if (k !== 'dir' && G.sel.dir === 0) return;
    G.sel[k] = v; haptic('selection');
    const p = document.getElementById('panel'); p.innerHTML = panelDecide();
    updateCalc(); refreshBar(); drawRoundChart();
  },
  open: () => { if (G.sel.dir !== null) openTrade(); },
  close: () => { haptic('medium'); closeManual(); },
  fast: () => { G.speed = G.speed > 1 ? 1 : 3; refreshBar(); },
  next: () => { haptic('light'); nextRound(); },
  rebuy: () => {
    G.rebuys++; G.deposit += CONFIG.startDeposit; G.invested += CONFIG.startDeposit; G.peak = Math.max(G.peak, G.deposit);
    G.equity[G.equity.length - 1] = G.deposit; G.invLine[G.invLine.length - 1] = G.invested;
    addLesson('rebuy', DYN_LESSONS.rebuy);
    G.phase = 'result'; nextRound();
  },
  stopGame: () => { G.brokeStop = true; scrEnd(); },
  cta: () => cta(),
  again: () => scrAsset(),
};

app.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  const f = ACT[b.dataset.act];
  if (f) f(b);
});

let rz;
window.addEventListener('resize', () => {
  clearTimeout(rz);
  rz = setTimeout(() => {
    if (!G) return;
    if (document.getElementById('chart')) drawRoundChart();
    if (document.getElementById('hist') && G.res) drawResultCharts();
    if (document.getElementById('eq')) drawEquity(document.getElementById('eq'), G.equity, G.invLine);
  }, 120);
});

(function init() {
  if (tg) {
    try {
      tg.ready(); tg.expand();
      if (tg.setHeaderColor) tg.setHeaderColor('#07090c');
      if (tg.setBackgroundColor) tg.setBackgroundColor('#07090c');
      if (tg.disableVerticalSwipes) tg.disableVerticalSwipes();
    } catch (e) { /* старая версия клиента */ }
  }
  scrIntro();
})();
