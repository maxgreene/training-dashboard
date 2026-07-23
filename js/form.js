/* form.js — Form-Seite.
 *
 * Belastungsmodell (CTL/ATL/TSB) und Erholungsmarker. Beide Charts laufen ueber
 * Chart.js, damit Achsen, Ticks und Tooltips stimmen.
 */

// ── Belastungsmodell ────────────────────────────────────────────────────────
/* Impulse-Response nach Banister: CTL = Exponentialmittel der TSS ueber
 * CTL_TAU Tage (Fitness), ATL ueber ATL_TAU (Ermuedung), TSB = CTL - ATL
 * (Form). Die Zeitkonstanten sind Konvention, keine Messung. */
function loadModel() {
  if (!DATA.acts.length) return [];
  const L = CFG.ui.load;
  const byDay = {};
  DATA.acts.forEach(a => { byDay[a.date] = (byDay[a.date] || 0) + tssOf(a); });
  // Korrekte Abklingkonstanten (nicht 1/tau, sondern 1-exp(-1/tau)).
  const kC = 1 - Math.exp(-1 / L.ctlTau), kA = 1 - Math.exp(-1 / L.atlTau);
  const out = [];
  let ctl = L.seedCtl, atl = L.seedAtl, i = 0;
  for (let dt = d(DATA.acts[DATA.acts.length - 1].date); dt <= today(); dt = addDays(dt, 1)) {
    const tss = byDay[iso(dt)] || 0;
    ctl += kC * (tss - ctl);
    atl += kA * (tss - atl);
    out.push({ date: iso(dt), tss, ctl: +ctl.toFixed(1), atl: +atl.toFixed(1),
               tsb: +(ctl - atl).toFixed(1), settling: i < L.settleDays });
    i++;
  }
  return out;
}

// ewmaBand ist nach shared.js gewandert (auch vom EF-Trend genutzt).

function baseline(key, days) {
  const lo = addDays(today(), -days);
  const v = DATA.health.filter(x => d(x.date) >= lo && x[key] != null)
                       .map(x => x[key]).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : null;
}

// ── Charts ──────────────────────────────────────────────────────────────────
let _ff = null, _hrv = null;

function renderFF() {
  const box = $('#ff-box');
  const m = loadModel();
  if (!box || !window.Chart || m.length < 7) return;
  box.style.height = '300px';
  box.innerHTML = '<canvas id="ff-canvas"></canvas>';
  const T = timeAxis();
  const X = r => T.dayOf(r.date);
  const settleEnd = m.filter(r => r.settling).length;
  if (_ff) _ff.destroy();
  _ff = new Chart($('#ff-canvas'), {
    data: {
      datasets: [
        // TSS auf EIGENE Achse: die Tagesspitzen gehen bis ~380 und wuerden
        // die gemeinsame Achse auf 400 zwingen. CTL (~70) und ATL (~120)
        // waeren dann ins untere Drittel gequetscht.
        { type: 'bar', label: 'TSS', data: m.map(r => ({ x: X(r), y: r.tss })),
          backgroundColor: 'rgba(255,255,255,.10)', yAxisID: 'yTss',
          barThickness: 2, order: 3 },
        { type: 'line', label: 'CTL (Fitness)', data: m.map(r => ({ x: X(r), y: r.ctl })),
          borderColor: '#4a9eff', backgroundColor: 'rgba(74,158,255,.12)',
          borderWidth: 2, pointRadius: 0, fill: true, yAxisID: 'y', order: 1 },
        { type: 'line', label: 'ATL (Ermüdung)', data: m.map(r => ({ x: X(r), y: r.atl })),
          borderColor: '#e0663c', borderWidth: 1.3, pointRadius: 0, fill: false, yAxisID: 'y', order: 1 },
        { type: 'line', label: 'TSB (Form)', data: m.map(r => ({ x: X(r), y: r.tsb })),
          borderColor: '#9aa5b1', borderWidth: 1.2, borderDash: [4, 3], pointRadius: 0,
          fill: false, yAxisID: 'y1', order: 2 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: timeScale(T),
        y: { position: 'left', beginAtZero: true,
             title: { display: true, text: 'CTL / ATL',
             color: CSSVAR('--t5'), font: { size: 10 } },
             ticks: { color: CSSVAR('--t4'), font: { size: 9 } },
             grid: { color: 'rgba(255,255,255,.05)' } },
        y1: { position: 'right', title: { display: true, text: 'TSB',
              color: CSSVAR('--t5'), font: { size: 10 } },
              ticks: { color: CSSVAR('--t4'), font: { size: 9 } },
              grid: { drawOnChartArea: false } },
        // Unsichtbar, Maximum bewusst hoch: die Balken bleiben Kontext am
        // unteren Rand und ueberdecken die Linien nicht.
        yTss: { display: false, min: 0,
                max: Math.max(100, ...m.map(r => r.tss)) * 3 },
      },
      plugins: {
        legend: { labels: { color: CSSVAR('--t3'), font: { size: 10 }, boxWidth: 10 } },
        annotation: undefined,
      },
    },
    // Einschwing-Phase grau hinterlegen: solange ist das Modell nicht belastbar.
    plugins: [{
      id: 'settle',
      beforeDatasetsDraw(ch) {
        if (!settleEnd) return;
        const { ctx, chartArea: a, scales } = ch;
        const x1 = scales.x.getPixelForValue(settleEnd);
        ctx.save();
        ctx.fillStyle = 'rgba(255,255,255,.035)';
        ctx.fillRect(a.left, a.top, Math.max(0, x1 - a.left), a.bottom - a.top);
        ctx.fillStyle = CSSVAR('--t5');
        ctx.font = '9px ' + CSSVAR('--mono');
        ctx.fillText('Einschwingphase', a.left + 5, a.top + 11);
        ctx.restore();
      },
    }],
  });
}

function renderHrv() {
  const box = $('#hrv-box');
  if (!box || !window.Chart) return;
  const H = DATA.health.filter(x => x.hrv != null || x.resting_hr != null).slice().reverse();
  if (H.length < 5) { box.innerHTML = '<div class="muted">zu wenige Daten</div>'; return; }
  box.style.height = '260px';
  box.innerHTML = '<canvas id="hrv-canvas"></canvas>';
  const T = timeAxis();
  const X = r => T.dayOf(r.date);
  const hrvPts = H.filter(x => x.hrv != null).map(x => ({ x: X(x), y: x.hrv }));
  const rhrPts = H.filter(x => x.resting_hr != null).map(x => ({ x: X(x), y: x.resting_hr }));
  const hE = ewmaBand(hrvPts, 0.1), rE = ewmaBand(rhrPts, 0.1);
  const band = (e, col, axis) => ([
    { type: 'line', data: e.upper, borderWidth: 0, pointRadius: 0, fill: '+1',
      backgroundColor: col.replace('rgb', 'rgba').replace(')', ',.12)'), yAxisID: axis, order: 5 },
    { type: 'line', data: e.lower, borderWidth: 0, pointRadius: 0, fill: false, yAxisID: axis, order: 5 },
    { type: 'line', data: e.line, borderColor: col, borderWidth: 2, pointRadius: 0,
      fill: false, yAxisID: axis, order: 2 },
  ]);
  if (_hrv) _hrv.destroy();
  _hrv = new Chart($('#hrv-canvas'), {
    data: { datasets: [
      { type: 'scatter', label: 'HRV', data: hrvPts, backgroundColor: 'rgba(126,200,160,.65)',
        pointRadius: 2.5, yAxisID: 'y', order: 1 },
      ...band(hE, 'rgb(126,200,160)', 'y'),
      { type: 'scatter', label: 'Ruhepuls', data: rhrPts, backgroundColor: 'rgba(224,102,60,.65)',
        pointRadius: 2.5, yAxisID: 'y1', order: 1 },
      ...band(rE, 'rgb(224,102,60)', 'y1'),
    ] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      scales: {
        x: timeScale(T),
        y: { position: 'left', title: { display: true, text: 'HRV (ms)',
             color: '#7ec8a0', font: { size: 10 } },
             ticks: { color: CSSVAR('--t4'), font: { size: 9 } },
             grid: { color: 'rgba(255,255,255,.05)' } },
        y1: { position: 'right',
              title: { display: true, text: 'Ruhepuls (bpm)', color: '#e0663c', font: { size: 10 } },
              ticks: { color: CSSVAR('--t4'), font: { size: 9 } },
              grid: { drawOnChartArea: false } },
      },
      plugins: { legend: { labels: { color: CSSVAR('--t3'), font: { size: 10 }, boxWidth: 10,
                 filter: i => ['HRV', 'Ruhepuls'].includes(i.text) } } },
    },
  });
}

// ── Seite ───────────────────────────────────────────────────────────────────
function renderForm() {
  const box = $('#page-form');
  if (!box) return;
  const m = loadModel();
  const last = m.length ? m[m.length - 1] : null;
  const H = DATA.health;   // alle Tage, aeltester unten
  const bHrv = baseline('hrv', 30), bRhr = baseline('resting_hr', 30);
  const cmp = (v, base, higherBetter) => {
    if (v == null) return '<b>—</b>';
    if (base == null) return `<b>${v}</b>`;
    const good = higherBetter ? v >= base : v <= base;
    return `<b style="color:${good ? 'var(--ok)' : 'var(--warn)'}">${v}</b>`;
  };
  const kpi = last
    ? `<span class="s">CTL ${last.ctl.toFixed(0)} · ATL ${last.atl.toFixed(0)} · TSB ${last.tsb.toFixed(0)}</span>`
    : '';

  box.innerHTML = `
    <div class="card">
      <div class="card-hd"><span class="t">BELASTUNG</span>${kpi}</div>
      <div id="ff-box"></div>
      <div class="ez-hint">CTL ${CFG.ui.load.ctlTau} d = Fitness · ATL ${CFG.ui.load.atlTau} d = Ermüdung ·
        TSB = CTL − ATL · TSB ↑ = frisch</div>
    </div>

    <div class="card">
      <div class="card-hd"><span class="t">ERHOLUNG</span>
        <span class="s">Band = normale Schwankung (EWMA ± 1σ) · Median 30 d: HRV ${bHrv ?? '—'} · RHR ${bRhr ?? '—'}</span></div>
      <div id="hrv-box"></div>
      <div class="hrow" style="background:none;border:none">
        <span class="hd">Datum</span><span class="hd">HRV</span><span class="hd">Ruhepuls</span>
        <span class="hd">Schlaf</span><span class="hd">Stress</span></div>
      ${H.map(x => `<div class="hrow">
        <span class="hd">${fmtDay(d(x.date))}</span>
        <span class="hval">${cmp(x.hrv, bHrv, true)}</span>
        <span class="hval">${cmp(x.resting_hr, bRhr, false)}</span>
        <span class="hval"><b>${x.sleep_h != null ? x.sleep_h + ' h' : '—'}</b></span>
        <span class="hval"><b>${x.stress_avg ?? '—'}</b></span></div>`).join('')}
      <div class="ez-hint" style="margin-top:8px">HRV ↑ = besser · RHR ↓ = besser · beides vegetativ, nicht muskulär</div>
    </div>`;

  renderFF();
  renderHrv();
}
