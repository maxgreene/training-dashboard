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
function canvas(box, h) {
  box.innerHTML = '';
  const w = box.clientWidth || 600;
  const c = document.createElement('canvas');
  const dpr = window.devicePixelRatio || 1;
  c.width = w * dpr; c.height = h * dpr;
  c.style.width = w + 'px'; c.style.height = h + 'px';
  box.appendChild(c);
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  return { ctx, w, h };
}

/* Achsen mit Ticks und Beschriftung. fx/fy formatieren die Werte. */
function frame(ctx, w, h, pad, xr, yr, fx, fy, xlab, ylab) {
  ctx.strokeStyle = CSSVAR('--border2'); ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.l, pad.t); ctx.lineTo(pad.l, h - pad.b); ctx.lineTo(w - pad.r, h - pad.b);
  ctx.stroke();
  ctx.font = '9px ' + CSSVAR('--mono');
  ctx.fillStyle = CSSVAR('--t4');
  const X = v => pad.l + (v - xr[0]) / (xr[1] - xr[0]) * (w - pad.l - pad.r);
  const Y = v => h - pad.b - (v - yr[0]) / (yr[1] - yr[0]) * (h - pad.t - pad.b);
  // y-Ticks
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let i = 0; i <= 4; i++) {
    const v = yr[0] + (yr[1] - yr[0]) * i / 4, y = Y(v);
    ctx.fillText(fy(v), pad.l - 5, y);
    ctx.strokeStyle = 'rgba(255,255,255,.05)';
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
  }
  // x-Ticks
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (let i = 0; i <= 4; i++) {
    const v = xr[0] + (xr[1] - xr[0]) * i / 4;
    ctx.fillText(fx(v), X(v), h - pad.b + 5);
  }
  ctx.fillStyle = CSSVAR('--t5');
  if (xlab) { ctx.textAlign = 'center'; ctx.fillText(xlab, (pad.l + w - pad.r) / 2, h - 10); }
  if (ylab) {
    ctx.save(); ctx.translate(9, (pad.t + h - pad.b) / 2); ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText(ylab, 0, 0); ctx.restore();
  }
  return { X, Y };
}

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
  const pad = { l: 46, r: 46, t: 10, b: 30 };
  const T = elapsedAxis(s);
  const W = smooth(s.w || [], 6), H = s.hr || [];
  const wv = W.filter(x => x != null), hv = H.filter(x => x != null);
  if (!wv.length && !hv.length) return;
  const wMax = Math.max(100, ...wv) * 1.05;
  const hLo = hv.length ? Math.min(...hv) - 5 : 60, hHi = hv.length ? Math.max(...hv) + 5 : 180;
  const tMax = T[s.n - 1] || 1;
  const A = frame(ctx, w, h, pad, [0, tMax], [0, wMax],
                  v => Math.round(v / 60) + '′', v => Math.round(v), 'Zeit (mit Pausen)', 'Watt');
  const YH = v => h - pad.b - (v - hLo) / (hHi - hLo) * (h - pad.t - pad.b);

  // Pausen als graue Baender
  (s.gaps || []).forEach(([i, sec]) => {
    if (i >= s.n) return;
    const x0 = A.X(T[i] - sec), x1 = A.X(T[i]);
    ctx.fillStyle = 'rgba(255,255,255,.05)';
    ctx.fillRect(x0, pad.t, Math.max(1, x1 - x0), h - pad.t - pad.b);
  });
  // Watt (Luecken bleiben Luecken)
  ctx.beginPath(); let up = false;
  W.forEach((v, i) => { if (v == null) { up = false; return; }
    up ? ctx.lineTo(A.X(T[i]), A.Y(v)) : ctx.moveTo(A.X(T[i]), A.Y(v)); up = true; });
  ctx.strokeStyle = 'rgba(96,165,250,.85)'; ctx.lineWidth = 1; ctx.stroke();
  // HF
  ctx.beginPath(); up = false;
  H.forEach((v, i) => { if (v == null) { up = false; return; }
    up ? ctx.lineTo(A.X(T[i]), YH(v)) : ctx.moveTo(A.X(T[i]), YH(v)); up = true; });
  ctx.strokeStyle = '#e05555'; ctx.lineWidth = 1.4; ctx.stroke();
  ctx.font = '9px ' + CSSVAR('--mono'); ctx.fillStyle = '#e05555';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(Math.round(hHi) + ' bpm', w - pad.r + 4, pad.t + 4);
  ctx.fillText(Math.round(hLo) + ' bpm', w - pad.r + 4, h - pad.b);
}

// ── Detail: HF gegen Leistung, nur stabile Phasen ───────────────────────────
/* Nur Punkte, an denen die Leistung stabil und die HF eingeschwungen ist.
 * Sonst zeigt die Wolke vor allem die Traegheit des Herzens statt einen
 * Zusammenhang. */
function drawScatter(box, s) {
  const { ctx, w, h } = canvas(box, box.clientWidth);
  const pad = { l: 46, r: 12, t: 12, b: 34 };
  const W = s.w || [], H = s.hr || [];
  const win = Math.max(3, Math.round(30 / s.step));
  const pts = [];
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
  if (pts.length < 12) {
    frame(ctx, w, h, pad, [0, 400], [90, 180], v => Math.round(v), v => Math.round(v), 'Watt', 'HF (bpm)');
    ctx.fillStyle = CSSVAR('--t5'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('zu wenige stabile Phasen', w / 2, h / 2);
    return;
  }
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const xr = [Math.min(...xs) - 10, Math.max(...xs) + 10];
  const yr = [Math.min(...ys) - 4, Math.max(...ys) + 4];
  const A = frame(ctx, w, h, pad, xr, yr, v => Math.round(v), v => Math.round(v), 'Watt', 'HF (bpm)');

  // Zonengrenzen als senkrechte Linien
  CFG.zones.power.bounds.forEach((b, i) => {
    if (!i) return;
    const x = b * CFG.athlete.ftp;
    if (x < xr[0] || x > xr[1]) return;
    ctx.beginPath(); ctx.moveTo(A.X(x), pad.t); ctx.lineTo(A.X(x), h - pad.b);
    ctx.strokeStyle = CFG.zones.power.colors[i] + '66'; ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = CFG.zones.power.colors[i]; ctx.font = '8px ' + CSSVAR('--mono');
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText('Z' + (i + 1), A.X(x), pad.t + 1);
  });
  ctx.fillStyle = 'rgba(96,165,250,.5)';
  pts.forEach(p => { ctx.beginPath(); ctx.arc(A.X(p[0]), A.Y(p[1]), 2.2, 0, 7); ctx.fill(); });
  // Regression
  const n = pts.length, mx = xs.reduce((a, b) => a + b) / n, my = ys.reduce((a, b) => a + b) / n;
  const varx = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  if (varx) {
    const b = pts.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0) / varx, a0 = my - b * mx;
    const ssTot = ys.reduce((s2, y) => s2 + (y - my) ** 2, 0);
    const ssRes = pts.reduce((s2, p) => s2 + (p[1] - (a0 + b * p[0])) ** 2, 0);
    ctx.beginPath(); ctx.moveTo(A.X(xr[0]), A.Y(a0 + b * xr[0]));
    ctx.lineTo(A.X(xr[1]), A.Y(a0 + b * xr[1]));
    ctx.strokeStyle = CSSVAR('--ok'); ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = CSSVAR('--t3'); ctx.font = '9px ' + CSSVAR('--mono');
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText('R² ' + (1 - ssRes / ssTot).toFixed(2) + ' · n=' + n, pad.l + 5, pad.t + 2);
  }
}

// ── Detail: MMP-Kurve ───────────────────────────────────────────────────────
function drawMMP(box, act) {
  const { ctx, w, h } = canvas(box, box.clientWidth);
  const pad = { l: 46, r: 12, t: 12, b: 34 };
  const pc = act.power_curve || {};
  const ks = Object.keys(pc).map(Number).sort((a, b) => a - b);
  if (!ks.length) {
    frame(ctx, w, h, pad, [0, 1], [0, 1], () => '', () => '', 'Dauer', 'Watt');
    ctx.fillStyle = CSSVAR('--t5'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('keine Leistungsdaten', w / 2, h / 2);
    return;
  }
  const yMax = Math.max(...ks.map(k => pc[k])) * 1.08;
  const lx = k => Math.log(k);
  const xr = [lx(ks[0]), lx(ks[ks.length - 1])];
  const durLab = v => { const k = Math.exp(v);
    return k < 60 ? Math.round(k) + 's' : k < 3600 ? Math.round(k / 60) + 'm' : (k / 3600).toFixed(0) + 'h'; };
  const A = frame(ctx, w, h, pad, xr, [0, yMax], durLab, v => Math.round(v), 'Dauer (log)', 'Watt');

  CFG.zones.power.bounds.forEach((b, i) => {
    if (!i) return;
    const y = b * CFG.athlete.ftp;
    if (y > yMax) return;
    ctx.beginPath(); ctx.moveTo(pad.l, A.Y(y)); ctx.lineTo(w - pad.r, A.Y(y));
    ctx.strokeStyle = CFG.zones.power.colors[i] + '66'; ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = CFG.zones.power.colors[i]; ctx.font = '8px ' + CSSVAR('--mono');
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText('Z' + (i + 1), pad.l + 3, A.Y(y) - 1);
  });
  ctx.beginPath();
  ks.forEach((k, i) => i ? ctx.lineTo(A.X(lx(k)), A.Y(pc[k])) : ctx.moveTo(A.X(lx(k)), A.Y(pc[k])));
  ctx.strokeStyle = '#ddd'; ctx.lineWidth = 1.6; ctx.stroke();
  ctx.fillStyle = '#ddd'; ctx.font = '8px ' + CSSVAR('--mono');
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ks.forEach(k => {
    ctx.beginPath(); ctx.arc(A.X(lx(k)), A.Y(pc[k]), 2.5, 0, 7); ctx.fill();
    ctx.fillText(pc[k] + 'W', A.X(lx(k)), A.Y(pc[k]) - 5);
  });
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
        <div><div class="lbl">HF gegen Leistung · stabile Phasen</div><div class="chartbox sq" id="c-sc-${id}"></div></div>
        <div><div class="lbl">Bestleistungen (MMP)</div><div class="chartbox sq" id="c-mp-${id}"></div></div>
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
        <span class="s">NP / Ø-HF · Punktgröße = Fahrtdauer · nur Fahrten ab ${CFG.ui.efTrend.minDurMin} min</span></div>
      <div id="ef-box"></div>
      <div class="ez-hint">Kürzere Fahrten sind ausgeschlossen: dort hinkt die Herzfrequenz der
        Leistung 30–60 s hinterher und täuscht einen hohen EF vor. Schwelle in
        <code>config.js</code> unter <code>ui.efTrend.minDurMin</code>.</div>
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
