/* rides.js — Fahrten-Seite.
 *
 * Oben der EF-Trend (Chart.js), darunter Kennzahlen und die Liste.
 * Die Detailansicht baut Verlauf, Scatter und MMP aus EINER Serie
 * (analysis/{id}.json) — das Backend liefert nicht mehr drei Varianten
 * desselben Datensatzes.
 */

// ── Canvas-Helfer ───────────────────────────────────────────────────────────
/* WICHTIG: Nur aufrufen, wenn der Container sichtbar ist. Bei display:none ist
 * clientWidth 0, der Puffer waere 0 px breit und CSS zerrt ihn auf. Deshalb
 * zeichnet index.html Seiten erst beim Anzeigen. */
function canvas(box, h, forceW) {
  box.innerHTML = '';
  const w = forceW || box.clientWidth || 600;
  const c = document.createElement('canvas');
  const dpr = window.devicePixelRatio || 1;
  c.width = w * dpr; c.height = h * dpr;
  c.style.width = w + 'px'; c.style.height = h + 'px';
  box.appendChild(c);
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  return { ctx, w, h };
}

/* Achsenrahmen. X/Y sind fertige Skalenfunktionen (linear oder log), die Ticks
 * kommen als Liste [{v, l}]. Ein Code fuer beide Achsentypen. */
function frame(ctx, w, h, pad, X, Y, xTicks, yTicks, xlab, ylab) {
  ctx.font = '9px ' + CSSVAR('--mono');
  // Gitter
  ctx.strokeStyle = 'rgba(255,255,255,.05)'; ctx.lineWidth = 1;
  yTicks.forEach(t => {
    const y = Y(t.v);
    if (y < pad.t || y > h - pad.b) return;
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
  });
  xTicks.forEach(t => {
    const x = X(t.v);
    if (x < pad.l || x > w - pad.r) return;
    ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, h - pad.b); ctx.stroke();
  });
  // Achsen
  ctx.strokeStyle = CSSVAR('--border2');
  ctx.beginPath();
  ctx.moveTo(pad.l, pad.t); ctx.lineTo(pad.l, h - pad.b); ctx.lineTo(w - pad.r, h - pad.b);
  ctx.stroke();
  // Beschriftung
  ctx.fillStyle = CSSVAR('--t4');
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  yTicks.forEach(t => {
    const y = Y(t.v);
    if (y < pad.t - 2 || y > h - pad.b + 2) return;
    ctx.fillText(t.l, pad.l - 5, y);
  });
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  xTicks.forEach(t => {
    const x = X(t.v);
    if (x < pad.l - 2 || x > w - pad.r + 2) return;
    ctx.fillText(t.l, x, h - pad.b + 5);
  });
  ctx.fillStyle = CSSVAR('--t5');
  if (xlab) { ctx.textAlign = 'center'; ctx.fillText(xlab, (pad.l + w - pad.r) / 2, h - 11); }
  if (ylab) {
    ctx.save(); ctx.translate(9, (pad.t + h - pad.b) / 2); ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText(ylab, 0, 0); ctx.restore();
  }
}

/* Skalen. lin/log liefern eine Funktion Wert -> Pixel. */
const linScale = (d0, d1, p0, p1) => v => p0 + (v - d0) / (d1 - d0) * (p1 - p0);
const logScale = (d0, d1, p0, p1) => {
  const l0 = Math.log(d0), l1 = Math.log(d1);
  return v => p0 + (Math.log(Math.max(v, d0)) - l0) / (l1 - l0) * (p1 - p0);
};
const durLabel = s => s < 60 ? s + 's' : s < 3600 ? (s / 60) + 'm' : (s / 3600) + 'h';

function smooth(arr, win) {
  const out = new Array(arr.length).fill(null);
  for (let i = 0; i < arr.length; i++) {
    let s = 0, n = 0;
    for (let j = Math.max(0, i - win + 1); j <= i; j++) if (arr[j] != null) { s += arr[j]; n++; }
    if (n >= Math.max(2, win / 3)) out[i] = s / n;
  }
  return out;
}

/* Echte Uhrzeit-Achse: die Serie laeuft auf Aufzeichnungszeit, die Pausen
 * stehen getrennt in s.gaps. Daraus die verstrichene Zeit je Punkt bauen,
 * damit Pausen als Luecken sichtbar werden statt weggerafft. */
function elapsedAxis(s) {
  const g = {};
  (s.gaps || []).forEach(([i, sec]) => { g[i] = (g[i] || 0) + sec; });
  const t = new Array(s.n);
  let off = 0;
  for (let i = 0; i < s.n; i++) { if (g[i]) off += g[i]; t[i] = i * s.step + off; }
  return t;
}

// ── Detail: Leistung und HF ueber die echte Zeit ────────────────────────────
function drawTrace(box, s) {
  const { ctx, w, h } = canvas(box, 200);
  const pad = { l: 46, r: 46, t: 10, b: 32 };
  const T = elapsedAxis(s);
  const W = smooth(s.w || [], 6), H = s.hr || [];
  const wv = W.filter(x => x != null), hv = H.filter(x => x != null);
  if (!wv.length && !hv.length) return;
  const wMax = Math.max(100, ...wv) * 1.05;
  const hLo = hv.length ? Math.min(...hv) - 5 : 60, hHi = hv.length ? Math.max(...hv) + 5 : 180;
  const tMax = T[s.n - 1] || 1;

  const X = linScale(0, tMax, pad.l, w - pad.r);
  const Y = linScale(0, wMax, h - pad.b, pad.t);
  const YH = linScale(hLo, hHi, h - pad.b, pad.t);
  const xT = [], step = tMax / 5;
  for (let i = 0; i <= 5; i++) xT.push({ v: i * step, l: Math.round(i * step / 60) + '′' });
  const yT = [0, .25, .5, .75, 1].map(f => ({ v: f * wMax, l: Math.round(f * wMax) }));
  frame(ctx, w, h, pad, X, Y, xT, yT, 'Zeit inkl. Pausen', 'Watt');

  // Pausen als graue Baender
  (s.gaps || []).forEach(([i, sec]) => {
    if (i >= s.n) return;
    const x0 = X(T[i] - sec), x1 = X(T[i]);
    ctx.fillStyle = 'rgba(255,255,255,.06)';
    ctx.fillRect(x0, pad.t, Math.max(1, x1 - x0), h - pad.t - pad.b);
  });
  const trace = (arr, sc, col, lw) => {
    ctx.beginPath(); let up = false;
    arr.forEach((v, i) => { if (v == null) { up = false; return; }
      up ? ctx.lineTo(X(T[i]), sc(v)) : ctx.moveTo(X(T[i]), sc(v)); up = true; });
    ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.stroke();
  };
  trace(W, Y, 'rgba(96,165,250,.85)', 1);
  trace(H, YH, '#e05555', 1.4);
  ctx.font = '9px ' + CSSVAR('--mono'); ctx.fillStyle = '#e05555';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(Math.round(hHi) + ' bpm', w - pad.r + 4, pad.t + 4);
  ctx.fillText(Math.round(hLo) + ' bpm', w - pad.r + 4, h - pad.b);
}

// ── Detail: HF gegen Leistung, nur stabile Phasen ───────────────────────────
/* Nur Punkte, an denen die Leistung stabil und die HF eingeschwungen ist.
 * Sonst zeigt die Wolke vor allem die Traegheit des Herzens statt einen
 * Zusammenhang. */
const SQ_MAX = 340;   // Kantenlaenge der quadratischen Detailplots

/* Nur Punkte, an denen die Leistung stabil und die HF eingeschwungen ist.
 * Sonst zeigt die Wolke vor allem die Traegheit des Herzens statt einen
 * Zusammenhang. Achsen sind FEST (config), damit Fahrten vergleichbar sind. */
function drawScatter(box, s) {
  const side = Math.min(box.clientWidth || 340, SQ_MAX);
  const { ctx, w, h } = canvas(box, side, side);
  const pad = { l: 44, r: 10, t: 10, b: 34 };
  const C = CFG.ui.detail.scatter;
  const yMax = C.yMax || CFG.athlete.hrmax;
  const X = linScale(C.xMin, C.xMax, pad.l, w - pad.r);
  const Y = linScale(C.yMin, yMax, h - pad.b, pad.t);
  const xT = [], yT = [];
  for (let v = C.xMin; v <= C.xMax; v += 100) xT.push({ v, l: v });
  for (let v = C.yMin; v <= yMax; v += 20) yT.push({ v, l: v });
  frame(ctx, w, h, pad, X, Y, xT, yT, 'Watt', 'HF (bpm)');

  // Zonengrenzen
  CFG.zones.power.bounds.forEach((b, i) => {
    if (!i) return;
    const x = b * CFG.athlete.ftp;
    if (x < C.xMin || x > C.xMax) return;
    ctx.beginPath(); ctx.moveTo(X(x), pad.t); ctx.lineTo(X(x), h - pad.b);
    ctx.strokeStyle = CFG.zones.power.colors[i] + '77'; ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = CFG.zones.power.colors[i]; ctx.font = '8px ' + CSSVAR('--mono');
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText('Z' + (i + 1), X(x), pad.t + 1);
  });

  const win = Math.max(3, Math.round(30 / s.step));
  const W = s.w || [], H = s.hr || [], pts = [];
  for (let i = win; i < s.n; i++) {
    const ww = W.slice(i - win, i + 1), hh = H.slice(i - win, i + 1);
    if (ww.some(x => x == null) || hh.some(x => x == null)) continue;
    if (W[i] < 60 || H[i] < 90) continue;
    const m = ww.reduce((a, b) => a + b, 0) / ww.length;
    if (!m) continue;
    const sd = Math.sqrt(ww.reduce((a, b) => a + (b - m) ** 2, 0) / ww.length);
    if (sd / m > 0.12) continue;
    if (Math.abs(hh[0] - hh[hh.length - 1]) > 6) continue;
    pts.push([W[i], H[i]]);
  }
  ctx.font = '9px ' + CSSVAR('--mono');
  if (pts.length < 12) {
    ctx.fillStyle = CSSVAR('--t5'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('zu wenige stabile Phasen', w / 2, h / 2);
    return;
  }
  // Clipping: feste Achsen koennen Punkte ausserhalb lassen.
  ctx.save();
  ctx.beginPath(); ctx.rect(pad.l, pad.t, w - pad.l - pad.r, h - pad.t - pad.b); ctx.clip();
  ctx.fillStyle = 'rgba(96,165,250,.5)';
  pts.forEach(p => { ctx.beginPath(); ctx.arc(X(p[0]), Y(p[1]), 2.2, 0, 7); ctx.fill(); });
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), n = pts.length;
  const mx = xs.reduce((a, b) => a + b) / n, my = ys.reduce((a, b) => a + b) / n;
  const varx = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  let r2 = null;
  if (varx) {
    const bb = pts.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0) / varx, a0 = my - bb * mx;
    const ssTot = ys.reduce((s2, y) => s2 + (y - my) ** 2, 0);
    const ssRes = pts.reduce((s2, p) => s2 + (p[1] - (a0 + bb * p[0])) ** 2, 0);
    r2 = 1 - ssRes / ssTot;
    ctx.beginPath(); ctx.moveTo(X(C.xMin), Y(a0 + bb * C.xMin));
    ctx.lineTo(X(C.xMax), Y(a0 + bb * C.xMax));
    ctx.strokeStyle = CSSVAR('--ok'); ctx.lineWidth = 1.5; ctx.stroke();
  }
  ctx.restore();
  const off = pts.filter(p => p[0] > C.xMax || p[1] > yMax || p[0] < C.xMin || p[1] < C.yMin).length;
  ctx.fillStyle = CSSVAR('--t3'); ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText((r2 != null ? 'R² ' + r2.toFixed(2) + ' · ' : '') + 'n=' + n
               + (off ? ' · ' + off + ' außerhalb' : ''), pad.l + 5, pad.t + 2);
}

// ── Detail: MMP-Kurve ───────────────────────────────────────────────────────
/* MMP mit festen log-log-Achsen (config). yMin kann nicht 0 sein: log(0)
 * existiert nicht. Feste Achsen machen Fahrten direkt vergleichbar. */
function drawMMP(box, act) {
  const side = Math.min(box.clientWidth || 340, SQ_MAX);
  const { ctx, w, h } = canvas(box, side, side);
  const pad = { l: 44, r: 10, t: 10, b: 34 };
  const C = CFG.ui.detail.mmp;
  const X = logScale(C.xMin, C.xMax, pad.l, w - pad.r);
  const Y = logScale(C.yMin, C.yMax, h - pad.b, pad.t);
  frame(ctx, w, h, pad,
        X, Y,
        C.xTicks.map(v => ({ v, l: durLabel(v) })),
        C.yTicks.map(v => ({ v, l: v })),
        'Dauer (log)', 'Watt (log)');

  // Zonengrenzen
  CFG.zones.power.bounds.forEach((b, i) => {
    if (!i) return;
    const y = b * CFG.athlete.ftp;
    if (y < C.yMin || y > C.yMax) return;
    ctx.beginPath(); ctx.moveTo(pad.l, Y(y)); ctx.lineTo(w - pad.r, Y(y));
    ctx.strokeStyle = CFG.zones.power.colors[i] + '77'; ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = CFG.zones.power.colors[i]; ctx.font = '8px ' + CSSVAR('--mono');
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText('Z' + (i + 1), pad.l + 3, Y(y) - 1);
  });

  const pc = act.power_curve || {};
  const ks = Object.keys(pc).map(Number).sort((a, b) => a - b)
             .filter(k => k >= C.xMin && k <= C.xMax);
  if (!ks.length) {
    ctx.fillStyle = CSSVAR('--t5'); ctx.font = '9px ' + CSSVAR('--mono');
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('keine Leistungsdaten', w / 2, h / 2);
    return;
  }
  ctx.save();
  ctx.beginPath(); ctx.rect(pad.l, pad.t, w - pad.l - pad.r, h - pad.t - pad.b); ctx.clip();
  ctx.beginPath();
  ks.forEach((k, i) => i ? ctx.lineTo(X(k), Y(pc[k])) : ctx.moveTo(X(k), Y(pc[k])));
  ctx.strokeStyle = '#ddd'; ctx.lineWidth = 1.6; ctx.stroke();
  ctx.fillStyle = '#ddd'; ctx.font = '8px ' + CSSVAR('--mono');
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ks.forEach(k => {
    ctx.beginPath(); ctx.arc(X(k), Y(pc[k]), 2.5, 0, 7); ctx.fill();
    ctx.fillText(pc[k], X(k), Y(pc[k]) - 5);
  });
  ctx.restore();
}

// ── Zonentabelle aus dem Histogramm ─────────────────────────────────────────
function zoneTable(act) {
  const rows = (times, cfg, unit, absMax) => {
    if (!times) return '<div class="muted">keine Daten</div>';
    const p = pct(times);
    return cfg.names.map((n, i) => {
      const lo = Math.round(cfg.bounds[i] * absMax);
      const hi = i < cfg.bounds.length - 1 ? Math.round(cfg.bounds[i + 1] * absMax) : null;
      return `<div class="zrow">
        <span style="color:${cfg.colors[i]}">${n}</span>
        <span class="hd">${lo}${hi ? '–' + hi : '+'} ${unit}</span>
        <span class="zb"><span style="width:${p[i]}%;background:${cfg.colors[i]}"></span></span>
        <span class="zv"><b>${p[i].toFixed(1)}</b> %</span></div>`;
    }).join('');
  };
  return `<div class="grid2">
    <div><div class="lbl">Leistungszonen</div>${rows(powerZoneTimes(act), CFG.zones.power, 'W', CFG.athlete.ftp)}</div>
    <div><div class="lbl">HF-Zonen</div>${rows(hrZoneTimes(act), CFG.zones.hr, 'bpm', CFG.athlete.hrmax)}</div>
  </div>`;
}

// ── EF-Trend (Chart.js) ─────────────────────────────────────────────────────
let _efChart = null;
function renderEF() {
  const C = CFG.ui.efTrend;
  const box = $('#ef-box');
  if (!box || !window.Chart) return;
  box.style.height = C.height + 'px';
  const acts = DATA.acts.filter(a =>
    a.ef && a.ef > 0.8 && a.ef < 2.5 && (a.moving_sec || 0) >= C.minDurMin * 60);
  if (!acts.length) { box.innerHTML = '<div class="muted">keine Fahrten im Filter</div>'; return; }

  const t0 = d(acts[acts.length - 1].date).getTime();
  const dayOf = x => Math.round((d(x).getTime() - t0) / 86400000);
  const span = Math.log(C.dotMaxDur / C.dotMinDur);
  const rOf = min => C.dotMinR + (C.dotMaxR - C.dotMinR) *
    Math.max(0, Math.min(1, Math.log(Math.max(min, C.dotMinDur) / C.dotMinDur) / span));
  const colOf = (name, min) => {
    const a = C.alpha;
    if (/bonn|saar/i.test(name)) return `rgba(150,150,150,${a})`;
    if (/ftp|rampe|test/i.test(name)) return `rgba(180,60,220,${a})`;
    if (min >= 90) return `rgba(249,115,22,${a})`;
    return `rgba(96,165,250,${a})`;
  };
  const pts = acts.map(a => {
    const min = (a.moving_sec || 0) / 60;
    return { x: dayOf(a.date), y: a.ef, r: rOf(min),
             bg: colOf(a.name || '', min), name: a.name || 'Fahrt', dur: Math.round(min) };
  });
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y), n = xs.length;
  const sx = xs.reduce((a, b) => a + b, 0), sy = ys.reduce((a, b) => a + b, 0);
  const sxy = xs.reduce((a, x, i) => a + x * ys[i], 0), sx2 = xs.reduce((a, x) => a + x * x, 0);
  const sl = (n * sxy - sx * sy) / (n * sx2 - sx * sx) || 0, ic = (sy - sl * sx) / n;
  const x0 = Math.min(...xs), x1 = Math.max(...xs);

  box.innerHTML = '<canvas id="ef-canvas"></canvas>';
  if (_efChart) _efChart.destroy();
  _efChart = new Chart($('#ef-canvas'), {
    type: 'bubble',
    data: { datasets: [
      { label: 'EF', data: pts, backgroundColor: pts.map(p => p.bg), borderWidth: 0 },
      ...(C.showTrend ? [{ label: 'Trend', type: 'line',
          data: [{ x: x0, y: ic + sl * x0 }, { x: x1, y: ic + sl * x1 }],
          borderColor: 'rgba(249,115,22,.45)', borderWidth: 1.5, borderDash: [5, 4],
          pointRadius: 0, fill: false, order: -1 }] : []) ] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      scales: {
        x: { title: { display: true, text: 'Tage seit ' + fmtDay(d(acts[acts.length - 1].date)),
                      color: CSSVAR('--t5'), font: { size: 10 } },
             ticks: { color: CSSVAR('--t4'), font: { size: 9 },
                      callback: v => fmtDay(addDays(new Date(t0), v)) },
             grid: { color: 'rgba(255,255,255,.05)' } },
        y: { min: C.yMin, max: C.yMax,
             title: { display: true, text: 'EF (NP / Ø-HF)', color: CSSVAR('--t5'), font: { size: 10 } },
             ticks: { color: CSSVAR('--t4'), font: { size: 9 } },
             grid: { color: 'rgba(255,255,255,.05)' } },
      },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => `${c.raw.name} · ${c.raw.dur} min · EF ${c.raw.y.toFixed(2)}` } },
      },
    },
  });
}

// ── Liste ───────────────────────────────────────────────────────────────────
async function toggleRide(id, row) {
  const det = row.querySelector('.rdet');
  const open = det.classList.toggle('on');
  row.classList.toggle('on', open);
  if (!open || det.dataset.built) return;
  const act = DATA.acts.find(a => String(a.id) === String(id));
  det.innerHTML = '<div class="muted">lade Serie …</div>';
  try {
    const s = await loadSeries(id);
    det.innerHTML = `${zoneTable(act)}
      <div class="lbl" style="margin-top:14px">Verlauf · Leistung und Herzfrequenz</div>
      <div class="chartbox" id="c-tr-${id}"></div>
      <div class="grid2">
        <div><div class="lbl">HF gegen Leistung · stabile Phasen</div><div class="chartbox" id="c-sc-${id}"></div></div>
        <div><div class="lbl">Bestleistungen (MMP)</div><div class="chartbox" id="c-mp-${id}"></div></div>
      </div>`;
    drawTrace($('#c-tr-' + id), s);
    drawScatter($('#c-sc-' + id), s);
    drawMMP($('#c-mp-' + id), act);
    det.dataset.built = '1';
  } catch (e) {
    det.innerHTML = '<div class="muted">Serie nicht ladbar: ' + e.message + '</div>';
  }
}

function renderRides() {
  const box = $('#page-rides');
  if (!box) return;
  const A = DATA.acts;
  const withP = A.filter(a => a.has_power);
  const totH = A.reduce((s, a) => s + (a.moving_sec || 0), 0) / 3600;
  const totTSS = A.reduce((s, a) => s + (a.tss || 0), 0);
  const avgW = withP.length ? withP.reduce((s, a) => s + (a.avg_power || 0), 0) / withP.length : 0;
  const bestNP = Math.max(0, ...A.map(a => a.np || 0));
  const b20 = best('1200', 9999);
  const stat = (l, v, s) => `<div class="stat"><div class="stat-l">${l}</div>
    <div class="stat-v">${v}</div><div class="stat-s">${s || ''}</div></div>`;

  box.innerHTML = `
    <div class="card">
      <div class="card-hd"><span class="t">EF-TREND</span>
        <span class="s">EF = NP / Ø-HF · ↑ = besser · Punkt = Dauer · ab ${CFG.ui.efTrend.minDurMin} min</span></div>
      <div id="ef-box"></div>
    </div>
    <div class="stats">
      ${stat('Fahrten', A.length, 'seit ' + (A.length ? fmtDay(d(A[A.length - 1].date)) : '—'))}
      ${stat('Volumen', totH.toFixed(1) + '<small> h</small>', 'Bewegungszeit')}
      ${stat('TSS gesamt', Math.round(totTSS), 'mit FTP ' + CFG.athlete.ftp)}
      ${stat('Ø Watt', Math.round(avgW) + '<small> W</small>', 'inkl. Rollen')}
      ${stat('Beste NP', bestNP + '<small> W</small>', 'normalisiert')}
      ${stat('FTP-Schätzung', '~' + (b20 ? Math.round(b20.w * 0.95) : CFG.athlete.ftp) + '<small> W</small>',
             ((b20 ? b20.w * 0.95 : CFG.athlete.ftp) / CFG.athlete.weight).toFixed(2).replace('.', ',') + ' W/kg')}
    </div>
    <div id="ride-list"></div>`;

  renderEF();
  const list = $('#ride-list');
  A.forEach(a => {
    const i = IF(a);
    const row = el('div', 'rrow');
    row.innerHTML = `<div class="rmain">
        <span class="rdate">${fmtDay(d(a.date))} ${a.start_time || ''}</span>
        <span class="rname">${a.name || 'Fahrt'}</span>
        <span class="rmet">
          <span>${fmtDur(a.moving_sec || a.duration_sec)}</span>
          ${a.np ? `<span>NP <b>${a.np}</b></span>` : ''}
          ${i ? `<span>IF <b>${i.toFixed(2)}</b></span>` : ''}
          ${a.tss ? `<span>TSS <b>${Math.round(a.tss)}</b></span>` : ''}
          ${a.ef ? `<span>EF <b>${a.ef.toFixed(2)}</b></span>` : ''}
        </span>
        ${dp4Rings(a, 34)}
      </div>
      <div class="rdet"></div>`;
    row.querySelector('.rmain').onclick = () => toggleRide(a.id, row);
    list.appendChild(row);
  });
}
