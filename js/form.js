/* form.js — Form-Seite.
 *
 * Belastungsmodell (CTL/ATL/TSB), Erholungsmarker aus Garmin und der
 * EF-Trend. Alles aus dem Index, keine Serie noetig.
 */

// ── Belastungsmodell ────────────────────────────────────────────────────────
/* Impulse-Response nach Banister: CTL = 42-Tage-Exponentialmittel der TSS
 * (Fitness), ATL = 7-Tage (Ermuedung), TSB = CTL - ATL (Form).
 * Beide Zeitkonstanten sind Konvention, keine Messung. */
const CTL_TAU = 42, ATL_TAU = 7;

function loadModel() {
  if (!DATA.acts.length) return [];
  const byDay = {};
  DATA.acts.forEach(a => { byDay[a.date] = (byDay[a.date] || 0) + (a.tss || 0); });
  const from = d(DATA.acts[DATA.acts.length - 1].date);
  const to = today();
  const out = [];
  let ctl = 0, atl = 0;
  for (let dt = new Date(from); dt <= to; dt = addDays(dt, 1)) {
    const tss = byDay[iso(dt)] || 0;
    ctl += (tss - ctl) / CTL_TAU;
    atl += (tss - atl) / ATL_TAU;
    out.push({ date: iso(dt), tss, ctl, atl, tsb: ctl - atl });
  }
  return out;
}

// ── Erholung ────────────────────────────────────────────────────────────────
/* Vergleicht die letzten Werte mit dem Median der Vorwochen. HRV und Ruhepuls
 * sagen etwas ueber das vegetative Nervensystem — NICHT ueber Muskelglykogen
 * oder muskulaere Ermuedung. Nach einem harten Rennen kann die HRV laengst
 * wieder gut sein, waehrend die Beine leer sind. */
function baseline(key, days) {
  const lo = addDays(today(), -days);
  const v = DATA.health.filter(x => d(x.date) >= lo && x[key] != null).map(x => x[key]).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : null;
}

// ── Charts ──────────────────────────────────────────────────────────────────
function drawFF(box) {
  const m = loadModel();
  if (m.length < 7) return;
  const { ctx, w, h } = canvas(box, 220);
  const pad = { l: 40, r: 40, t: 12, b: 22 };
  const maxY = Math.max(30, ...m.map(x => Math.max(x.ctl, x.atl))) * 1.1;
  const tsbAbs = Math.max(20, ...m.map(x => Math.abs(x.tsb)));
  const X = i => pad.l + i / (m.length - 1) * (w - pad.l - pad.r);
  const Y = v => h - pad.b - v / maxY * (h - pad.t - pad.b);
  const YT = v => (h - pad.b + pad.t) / 2 - v / tsbAbs * ((h - pad.t - pad.b) / 2);

  axes(ctx, w, h, pad);
  // TSB als Flaeche um die Nulllinie
  ctx.beginPath(); ctx.moveTo(X(0), YT(0));
  m.forEach((x, i) => ctx.lineTo(X(i), YT(x.tsb)));
  ctx.lineTo(X(m.length - 1), YT(0)); ctx.closePath();
  ctx.fillStyle = 'rgba(120,120,120,.15)'; ctx.fill();

  const line = (key, col, lw) => {
    ctx.beginPath();
    m.forEach((x, i) => i ? ctx.lineTo(X(i), Y(x[key])) : ctx.moveTo(X(i), Y(x[key])));
    ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.stroke();
  };
  line('atl', '#e0663c', 1.2);
  line('ctl', '#4a9eff', 2);

  const last = m[m.length - 1];
  ctx.font = '10px ' + CSSVAR('--mono'); ctx.textAlign = 'left';
  ctx.fillStyle = '#4a9eff'; ctx.fillText('CTL ' + last.ctl.toFixed(0), pad.l + 4, pad.t + 10);
  ctx.fillStyle = '#e0663c'; ctx.fillText('ATL ' + last.atl.toFixed(0), pad.l + 4, pad.t + 22);
  ctx.fillStyle = last.tsb >= 0 ? CSSVAR('--ok') : CSSVAR('--warn');
  ctx.fillText('TSB ' + last.tsb.toFixed(0), pad.l + 4, pad.t + 34);
}

function drawHrv(box) {
  const H = DATA.health.filter(x => x.hrv != null).slice().reverse();
  if (H.length < 5) return;
  const { ctx, w, h } = canvas(box, 150);
  const pad = { l: 34, r: 12, t: 10, b: 20 };
  const v = H.map(x => x.hrv);
  const lo = Math.min(...v) - 3, hi = Math.max(...v) + 3;
  const X = i => pad.l + i / (H.length - 1) * (w - pad.l - pad.r);
  const Y = x => h - pad.b - (x - lo) / (hi - lo) * (h - pad.t - pad.b);
  axes(ctx, w, h, pad);
  // Median als Referenz
  const med = baseline('hrv', 30);
  if (med) {
    ctx.beginPath(); ctx.moveTo(pad.l, Y(med)); ctx.lineTo(w - pad.r, Y(med));
    ctx.strokeStyle = CSSVAR('--t5'); ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.beginPath();
  H.forEach((x, i) => i ? ctx.lineTo(X(i), Y(x.hrv)) : ctx.moveTo(X(i), Y(x.hrv)));
  ctx.strokeStyle = '#7ec8a0'; ctx.lineWidth = 1.5; ctx.stroke();
  H.forEach((x, i) => { ctx.beginPath(); ctx.arc(X(i), Y(x.hrv), 2, 0, 7);
                        ctx.fillStyle = '#7ec8a0'; ctx.fill(); });
  ctx.font = '9px ' + CSSVAR('--mono'); ctx.fillStyle = CSSVAR('--t5'); ctx.textAlign = 'right';
  ctx.fillText(hi.toFixed(0), pad.l - 4, pad.t + 8);
  ctx.fillText(lo.toFixed(0), pad.l - 4, h - pad.b);
  if (med) { ctx.textAlign = 'left'; ctx.fillText('Median ' + med, pad.l + 4, Y(med) - 3); }
}

/* EF-Trend. Nur Fahrten ab EF_MIN_MIN Minuten: bei kurzen, intensiven Fahrten
 * ist der EF systematisch aufgeblaeht, weil die Herzfrequenz der Leistung
 * 30-60 s hinterherhinkt. Ein 20-Minuten-Antritt am Berg sieht dann aus wie
 * Weltklasse-Effizienz. Solche Punkte gehoeren nicht in einen Fitness-Trend. */
const EF_MIN_MIN = 60;

function drawEF(box) {
  const A = DATA.acts.filter(a => a.ef && (a.moving_sec || 0) >= EF_MIN_MIN * 60)
                     .slice().reverse();
  const { ctx, w, h } = canvas(box, 230);
  const pad = { l: 40, r: 14, t: 12, b: 24 };
  axes(ctx, w, h, pad);
  ctx.font = '10px ' + CSSVAR('--mono');
  if (A.length < 3) {
    ctx.fillStyle = CSSVAR('--t5'); ctx.textAlign = 'center';
    ctx.fillText('zu wenige Fahrten ab ' + EF_MIN_MIN + ' min', w / 2, h / 2);
    return;
  }
  const t0 = d(A[0].date), t1 = today();
  const span = Math.max(1, dayDiff(t1, t0));
  const v = A.map(a => a.ef);
  const lo = Math.min(...v) - .05, hi = Math.max(...v) + .05;
  const X = a => pad.l + dayDiff(d(a.date), t0) / span * (w - pad.l - pad.r);
  const Y = e => h - pad.b - (e - lo) / (hi - lo) * (h - pad.t - pad.b);

  // Physiologische Orientierung: FTP / Schwellen-HF
  const ceiling = CFG.athlete.ftp / (0.90 * CFG.athlete.hrmax);
  if (ceiling > lo && ceiling < hi) {
    ctx.beginPath(); ctx.moveTo(pad.l, Y(ceiling)); ctx.lineTo(w - pad.r, Y(ceiling));
    ctx.strokeStyle = 'rgba(96,165,250,.5)'; ctx.setLineDash([4, 3]); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(96,165,250,.7)'; ctx.textAlign = 'right';
    ctx.fillText('FTP / Schwellen-HF ≈ ' + ceiling.toFixed(2), w - pad.r - 3, Y(ceiling) - 4);
  }
  // Punkte, Groesse nach Dauer
  A.forEach(a => {
    const r = Math.min(7, 2.5 + Math.log(a.moving_sec / 3600 + 1) * 3);
    ctx.beginPath(); ctx.arc(X(a), Y(a.ef), r, 0, 7);
    ctx.fillStyle = 'rgba(232,163,61,.75)'; ctx.fill();
  });
  // Trend, linear
  const xs = A.map(a => dayDiff(d(a.date), t0)), ys = v, n = A.length;
  const mx = xs.reduce((a, b) => a + b) / n, my = ys.reduce((a, b) => a + b) / n;
  const varx = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  if (varx) {
    const b = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / varx, a0 = my - b * mx;
    ctx.beginPath(); ctx.moveTo(pad.l, Y(a0)); ctx.lineTo(X({ date: iso(t1) }), Y(a0 + b * span));
    ctx.strokeStyle = 'rgba(249,115,22,.6)'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 3]);
    ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = CSSVAR('--t4'); ctx.textAlign = 'left';
    ctx.fillText((b * 30 >= 0 ? '+' : '') + (b * 30).toFixed(2) + ' EF / Monat', pad.l + 4, pad.t + 10);
  }
  ctx.fillStyle = CSSVAR('--t5'); ctx.textAlign = 'right';
  ctx.fillText(hi.toFixed(2), pad.l - 4, pad.t + 8);
  ctx.fillText(lo.toFixed(2), pad.l - 4, h - pad.b);
  ctx.textAlign = 'center';
  ctx.fillText(fmtDay(t0), pad.l + 16, h - 6);
  ctx.fillText(fmtDay(t1), w - pad.r - 16, h - 6);
}

// ── Seite ───────────────────────────────────────────────────────────────────
function renderForm() {
  const box = $('#page-form');
  if (!box) return;
  const m = loadModel();
  const last = m.length ? m[m.length - 1] : null;
  const H = DATA.health.slice(0, 10);
  const bHrv = baseline('hrv', 30), bRhr = baseline('resting_hr', 30);

  const cmp = (v, base, higherBetter) => {
    if (v == null || base == null) return '';
    const good = higherBetter ? v >= base : v <= base;
    return `<span style="color:${good ? 'var(--ok)' : 'var(--warn)'}">${v}</span>`;
  };

  box.innerHTML = `
    <div class="card">
      <div class="card-hd"><span class="t">BELASTUNG</span>
        <span class="s">CTL ${CTL_TAU} d · ATL ${ATL_TAU} d · TSB = CTL − ATL</span></div>
      <div class="chartbox" id="c-ff"></div>
      <div class="ez-hint">TSB positiv = frisch, negativ = ermüdet. Das Modell kennt nur TSS —
        es weiß nichts über Schlaf, Stress oder leere Beine nach einem Rennen.</div>
    </div>

    <div class="card">
      <div class="card-hd"><span class="t">ERHOLUNG</span>
        <span class="s">Basis: Median der letzten 30 Tage · HRV ${bHrv ?? '—'} · RHR ${bRhr ?? '—'}</span></div>
      <div class="chartbox" id="c-hrv"></div>
      <div class="hrow" style="background:none;border:none">
        <span class="hd">Datum</span><span class="hd">HRV</span><span class="hd">Ruhepuls</span>
        <span class="hd">Schlaf</span><span class="hd">Stress</span></div>
      ${H.map(x => `<div class="hrow">
        <span class="hd">${fmtDay(d(x.date))}</span>
        <span class="hval">${cmp(x.hrv, bHrv, true)}</span>
        <span class="hval">${cmp(x.resting_hr, bRhr, false)}</span>
        <span class="hval"><b>${x.sleep_h != null ? x.sleep_h + ' h' : '—'}</b></span>
        <span class="hval"><b>${x.stress_avg ?? '—'}</b></span></div>`).join('')}
      <div class="ez-hint" style="margin-top:8px">HRV und Ruhepuls messen das vegetative
        Nervensystem. Über Muskelglykogen und müde Beine sagen sie nichts.</div>
    </div>

    <div class="card">
      <div class="card-hd"><span class="t">EF-TREND</span>
        <span class="s">NP / Ø-HF · nur Fahrten ab ${EF_MIN_MIN} min</span></div>
      <div class="chartbox" id="c-ef"></div>
      <div class="ez-hint">Kurze, intensive Fahrten sind bewusst ausgeschlossen: dort hinkt die
        Herzfrequenz der Leistung 30–60 s hinterher und täuscht einen hohen EF vor.
        Die gestrichelte Linie ist die physiologische Orientierung aus FTP und Schwellen-HF —
        deutlich darüber liegt man auf langen Fahrten nicht.</div>
    </div>`;

  drawFF($('#c-ff'));
  drawHrv($('#c-hrv'));
  drawEF($('#c-ef'));
}
