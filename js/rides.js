/* rides.js — Fahrten-Seite.
 *
 * Liste aus dem Index (activities.json), Detailansicht aus der Serie
 * (analysis/{id}.json). Chart, Scatter und EF-Verlauf entstehen hier aus
 * EINER Serie — das Backend liefert nicht mehr drei Varianten desselben.
 */

// ── Zeichen-Helfer ──────────────────────────────────────────────────────────
function canvas(box, h) {
  const c = document.createElement('canvas');
  const w = box.clientWidth || 800;
  const dpr = window.devicePixelRatio || 1;
  c.width = w * dpr; c.height = h * dpr;
  c.style.height = h + 'px';
  box.appendChild(c);
  const x = c.getContext('2d');
  x.scale(dpr, dpr);
  return { ctx: x, w, h };
}
const CSSVAR = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

function axes(ctx, w, h, pad) {
  ctx.strokeStyle = CSSVAR('--border'); ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.l, pad.t); ctx.lineTo(pad.l, h - pad.b); ctx.lineTo(w - pad.r, h - pad.b);
  ctx.stroke();
}

/* Gleitendes Mittel ueber die Serie. None-Luecken (z.B. bereinigte HF)
 * unterbrechen das Fenster, statt es zu verfaelschen. */
function smooth(arr, win) {
  const out = new Array(arr.length).fill(null);
  for (let i = 0; i < arr.length; i++) {
    let s = 0, n = 0;
    for (let j = Math.max(0, i - win + 1); j <= i; j++) {
      if (arr[j] != null) { s += arr[j]; n++; }
    }
    if (n >= Math.max(2, win / 3)) out[i] = s / n;
  }
  return out;
}

// ── Detail: Leistung + HF ueber die Zeit ────────────────────────────────────
function drawTrace(box, s) {
  const { ctx, w, h } = canvas(box, 190);
  const pad = { l: 38, r: 38, t: 10, b: 20 };
  const n = s.n;
  const W = smooth(s.w || [], 6), H = s.hr || [];
  const wv = W.filter(x => x != null), hv = H.filter(x => x != null);
  if (!wv.length && !hv.length) return;
  const wMax = Math.max(100, ...wv) * 1.05;
  const hLo = hv.length ? Math.min(...hv) - 5 : 60, hHi = hv.length ? Math.max(...hv) + 5 : 180;
  const X = i => pad.l + i / (n - 1) * (w - pad.l - pad.r);
  const YP = v => h - pad.b - (v / wMax) * (h - pad.t - pad.b);
  const YH = v => h - pad.b - ((v - hLo) / (hHi - hLo)) * (h - pad.t - pad.b);

  axes(ctx, w, h, pad);
  // Watt als Flaeche
  ctx.beginPath(); ctx.moveTo(X(0), h - pad.b);
  W.forEach((v, i) => { if (v != null) ctx.lineTo(X(i), YP(v)); });
  ctx.lineTo(X(n - 1), h - pad.b); ctx.closePath();
  ctx.fillStyle = 'rgba(96,165,250,.18)'; ctx.fill();
  ctx.beginPath();
  W.forEach((v, i) => { if (v != null) (i ? ctx.lineTo(X(i), YP(v)) : ctx.moveTo(X(i), YP(v))); });
  ctx.strokeStyle = 'rgba(96,165,250,.8)'; ctx.lineWidth = 1; ctx.stroke();
  // HF, Luecken bleiben Luecken
  ctx.beginPath(); let up = false;
  H.forEach((v, i) => {
    if (v == null) { up = false; return; }
    up ? ctx.lineTo(X(i), YH(v)) : ctx.moveTo(X(i), YH(v)); up = true;
  });
  ctx.strokeStyle = '#e05555'; ctx.lineWidth = 1.4; ctx.stroke();
  // Beschriftung
  ctx.font = '9px ' + CSSVAR('--mono'); ctx.fillStyle = CSSVAR('--t5');
  ctx.textAlign = 'right'; ctx.fillText(Math.round(wMax) + ' W', pad.l - 4, pad.t + 8);
  ctx.textAlign = 'left';  ctx.fillText(Math.round(hHi) + ' bpm', w - pad.r + 3, pad.t + 8);
  ctx.textAlign = 'center';
  ctx.fillText(Math.round(n * s.step / 60) + ' min', w / 2, h - 5);
}

// ── Detail: HF gegen Leistung, nur stabile Phasen ───────────────────────────
/* Nur Punkte, an denen Leistung stabil und HF eingeschwungen ist. Sonst zeigt
 * die Wolke vor allem die Traegheit des Herzens (hohe Watt bei noch niedriger
 * HF am Anfang eines Antritts) statt einen Zusammenhang. */
function drawScatter(box, s) {
  const { ctx, w, h } = canvas(box, 210);
  const pad = { l: 42, r: 12, t: 10, b: 24 };
  const W = s.w || [], H = s.hr || [];
  const win = Math.max(3, Math.round(30 / s.step));   // 30-s-Fenster
  const pts = [];
  for (let i = win; i < s.n; i++) {
    const ww = W.slice(i - win, i + 1), hh = H.slice(i - win, i + 1);
    if (ww.some(x => x == null) || hh.some(x => x == null)) continue;
    if (W[i] < 60 || H[i] < 90) continue;
    const m = ww.reduce((a, b) => a + b, 0) / ww.length;
    if (!m) continue;
    const sd = Math.sqrt(ww.reduce((a, b) => a + (b - m) ** 2, 0) / ww.length);
    if (sd / m > 0.12) continue;                       // Leistung nicht stabil
    if (Math.abs(hh[0] - hh[hh.length - 1]) > 6) continue;  // HF nicht eingeschwungen
    pts.push([W[i], H[i]]);
  }
  axes(ctx, w, h, pad);
  ctx.font = '9px ' + CSSVAR('--mono'); ctx.fillStyle = CSSVAR('--t5');
  if (pts.length < 12) {
    ctx.textAlign = 'center';
    ctx.fillText('zu wenige stabile Phasen', w / 2, h / 2);
    return;
  }
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const x0 = Math.min(...xs) - 10, x1 = Math.max(...xs) + 10;
  const y0 = Math.min(...ys) - 4, y1 = Math.max(...ys) + 4;
  const X = v => pad.l + (v - x0) / (x1 - x0) * (w - pad.l - pad.r);
  const Y = v => h - pad.b - (v - y0) / (y1 - y0) * (h - pad.t - pad.b);
  ctx.fillStyle = 'rgba(96,165,250,.5)';
  pts.forEach(p => { ctx.beginPath(); ctx.arc(X(p[0]), Y(p[1]), 2, 0, 7); ctx.fill(); });
  // Regression
  const n = pts.length, mx = xs.reduce((a, b) => a + b) / n, my = ys.reduce((a, b) => a + b) / n;
  const cov = pts.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0);
  const varx = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  if (varx) {
    const b = cov / varx, a = my - b * mx;
    const ssTot = ys.reduce((s2, y) => s2 + (y - my) ** 2, 0);
    const ssRes = pts.reduce((s2, p) => s2 + (p[1] - (a + b * p[0])) ** 2, 0);
    ctx.beginPath(); ctx.moveTo(X(x0), Y(a + b * x0)); ctx.lineTo(X(x1), Y(a + b * x1));
    ctx.strokeStyle = CSSVAR('--ok'); ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = CSSVAR('--t4'); ctx.textAlign = 'left';
    ctx.fillText('R² ' + (1 - ssRes / ssTot).toFixed(2) + ' · n=' + n, pad.l + 4, pad.t + 9);
  }
  ctx.fillStyle = CSSVAR('--t5'); ctx.textAlign = 'center';
  ctx.fillText('Watt', w / 2, h - 5);
}

// ── Detail: MMP-Kurve ───────────────────────────────────────────────────────
function drawMMP(box, act) {
  const { ctx, w, h } = canvas(box, 210);
  const pad = { l: 42, r: 12, t: 12, b: 24 };
  const pc = act.power_curve || {};
  const ks = Object.keys(pc).map(Number).sort((a, b) => a - b);
  axes(ctx, w, h, pad);
  ctx.font = '9px ' + CSSVAR('--mono');
  if (!ks.length) { ctx.fillStyle = CSSVAR('--t5'); ctx.textAlign = 'center';
                    ctx.fillText('keine Leistungsdaten', w / 2, h / 2); return; }
  const vals = ks.map(k => pc[k]);
  const yMax = Math.max(...vals) * 1.08;
  const X = k => pad.l + (Math.log(k) - Math.log(ks[0])) / (Math.log(ks[ks.length - 1]) - Math.log(ks[0]) || 1) * (w - pad.l - pad.r);
  const Y = v => h - pad.b - v / yMax * (h - pad.t - pad.b);
  // Zonenlinien
  CFG.zones.power.bounds.forEach((b, i) => {
    if (!i) return;
    const y = Y(b * CFG.athlete.ftp);
    if (y < pad.t) return;
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y);
    ctx.strokeStyle = CFG.zones.power.colors[i] + '55'; ctx.setLineDash([2, 3]);
    ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
  });
  ctx.beginPath();
  ks.forEach((k, i) => i ? ctx.lineTo(X(k), Y(pc[k])) : ctx.moveTo(X(k), Y(pc[k])));
  ctx.strokeStyle = '#ddd'; ctx.lineWidth = 1.6; ctx.stroke();
  ctx.fillStyle = '#ddd';
  ks.forEach(k => { ctx.beginPath(); ctx.arc(X(k), Y(pc[k]), 2.5, 0, 7); ctx.fill(); });
  ctx.fillStyle = CSSVAR('--t4'); ctx.textAlign = 'center';
  ks.forEach(k => {
    const lab = k < 60 ? k + 's' : k < 3600 ? (k / 60) + 'm' : '1h';
    ctx.fillText(lab, X(k), h - 6);
  });
  ctx.textAlign = 'right';
  ctx.fillText(Math.round(yMax) + ' W', pad.l - 4, pad.t + 8);
}

// ── Zonen-Tabelle aus dem Histogramm ────────────────────────────────────────
function zoneTable(act) {
  const rows = (times, cfg, unit, absMax) => {
    if (!times) return '';
    const p = pct(times);
    return cfg.names.map((n, i) => {
      const lo = Math.round(cfg.bounds[i] * absMax);
      const hi = i < cfg.bounds.length - 1 ? Math.round(cfg.bounds[i + 1] * absMax) : null;
      return `<div class="hrow" style="grid-template-columns:110px 90px 1fr 60px">
        <span style="color:${cfg.colors[i]}">${n}</span>
        <span class="hd">${lo}${hi ? '–' + hi : '+'} ${unit}</span>
        <span><span class="zbar" style="height:8px"><span style="width:${p[i]}%;background:${cfg.colors[i]};display:block;height:100%"></span></span></span>
        <span class="hval"><b>${p[i].toFixed(1)}</b> %</span></div>`;
    }).join('');
  };
  return `<div class="grid2">
    <div><div class="lbl">Leistungszonen</div>${rows(powerZoneTimes(act), CFG.zones.power, 'W', CFG.athlete.ftp)}</div>
    <div><div class="lbl">HF-Zonen</div>${rows(hrZoneTimes(act), CFG.zones.hr, 'bpm', CFG.athlete.hrmax)}</div>
  </div>`;
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
      <div class="lbl" style="margin-top:12px">Verlauf · Leistung und Herzfrequenz</div>
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

  box.innerHTML = `<div class="stats">
      ${stat('Fahrten', A.length, 'seit ' + (A.length ? fmtDay(d(A[A.length - 1].date)) : '—'))}
      ${stat('Volumen', totH.toFixed(1) + '<small> h</small>', 'Bewegungszeit')}
      ${stat('TSS gesamt', Math.round(totTSS), 'mit FTP ' + CFG.athlete.ftp)}
      ${stat('Ø Watt', Math.round(avgW) + '<small> W</small>', 'inkl. Rollen')}
      ${stat('Beste NP', bestNP + '<small> W</small>', 'normalisiert')}
      ${stat('FTP-Schätzung', '~' + (b20 ? Math.round(b20.w * 0.95) : CFG.athlete.ftp) + '<small> W</small>',
             ((b20 ? b20.w * 0.95 : CFG.athlete.ftp) / CFG.athlete.weight).toFixed(2).replace('.', ',') + ' W/kg')}
    </div>
    <div id="ride-list"></div>`;

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
