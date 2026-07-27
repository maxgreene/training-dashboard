/* plan.js — Plan-Seite.
 *
 * PRINZIP
 * Zukunft entsteht aus CFG.plan.template. Vergangenheit kommt aus den echten
 * Fahrten in activities.json. Es gibt keine handgepflegte Tagesliste mehr und
 * damit auch keine erfundenen EF-Werte, keine haengengebliebenen Tests und
 * keine doppelten Wochen.
 *
 * Reihenfolge durchgehend: neu oben, alt unten — auf Wochen- wie Tagesebene.
 */

// ── Was ist an einem Tag geplant? ───────────────────────────────────────────
function plannedFor(dt, weekIdx) {
  const isoD = iso(dt);

  const ev = CFG.plan.events.find(e => e.date === isoD);
  if (ev) return { ...ev, source: 'event' };

  if (dt < d(CFG.plan.start)) return null;          // vor Planbeginn: nichts

  const t = CFG.plan.template[dowOf(dt)];
  if (!t) return null;

  const deload = ((weekIdx + 1) % CFG.plan.deloadEvery) === 0;
  const parts = [];

  if (t.commutes) {
    parts.push({ type: 'comm', ...CFG.plan.units.commute });
  }

  if (t.slot === 'hard') {
    if (deload) {
      parts.push({ type: 'roll', ...CFG.plan.units.deload });
    } else {
      // Aufbauwochen durchzaehlen (Entlastungswochen zaehlen nicht mit)
      const buildIdx = weekIdx - Math.floor(weekIdx / CFG.plan.deloadEvery);
      const p = CFG.plan.hardProgression[buildIdx % CFG.plan.hardProgression.length];
      parts.push({ type: 'roll', title: 'Rolle: ' + p.title, desc: p.desc });
    }
  } else if (t.slot === 'long' || t.slot === 'long_alt') {
    const u = deload
      ? { title: 'Ausfahrt kurz', desc: '2 h · sehr locker' }
      : CFG.plan.units[t.slot];
    parts.push({ type: 'aus', ...u });
  }

  if (!parts.length) parts.push({ type: 'rest', ...CFG.plan.units.rest });
  return { parts, deload };
}

// ── Wochen bauen ────────────────────────────────────────────────────────────
function buildWeeks() {
  const start = mondayOf(d(CFG.plan.start));
  const first = DATA.acts.length
    ? mondayOf(d(DATA.acts[DATA.acts.length - 1].date))
    : start;
  const from = first < start ? first : start;
  const to = mondayOf(addDays(today(), CFG.plan.futureWeeks * 7));

  const weeks = [];
  for (let m = new Date(from); m <= to; m = addDays(m, 7)) {
    const weekIdx = Math.floor(dayDiff(m, start) / 7);
    const days = [];
    for (let i = 0; i < 7; i++) {
      const dt = addDays(m, i);
      days.push({
        dt,
        acts: DATA.acts.filter(a => a.date === iso(dt)),
        plan: weekIdx >= 0 ? plannedFor(dt, weekIdx) : null,
        isToday: +dt === +today(),
        isPast: dt < today(),
      });
    }
    weeks.push({ mon: m, kw: kwOf(m), weekIdx, days });
  }
  return weeks.reverse();     // neueste Woche oben
}

// ── Bausteine ───────────────────────────────────────────────────────────────
function dp4Rings(a, size) {
  if (!a.power_curve || !a.has_power) return '';
  size = size || 36;
  const c = size / 2, sw = 3, gap = 1.2;
  let s = '', tip = [];
  CFG.ui.dp4.forEach((z, i) => {
    const r = (size / 2 - sw / 2) - i * (sw + gap);
    if (r < sw * 0.8) return;
    const C = 2 * Math.PI * r, bench = z.mult * CFG.athlete.ftp, v = a.power_curve[z.key];
    s += `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="#262626" stroke-width="${sw}"/>`;
    if (v) {
      const p = Math.min(1, v / bench);
      s += `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${z.color}" stroke-width="${sw}"`
         + ` stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - p)).toFixed(1)}"`
         + ` stroke-linecap="round"/>`;
      tip.push(`${z.label}: ${v} W (${Math.round(100 * v / bench)} %)`);
    } else {
      s += `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${z.color}" stroke-width="1"`
         + ` stroke-dasharray="1.5 2.5" opacity=".45"/>`;
      tip.push(`${z.label}: n/a (Fahrt zu kurz)`);
    }
  });
  return `<div class="dp4" title="${tip.join('&#10;')}"><svg width="${size}" height="${size}">${s}</svg></div>`;
}

function zbar(act) {
  const zt = powerZoneTimes(act);
  if (!zt) return '';
  const p = pct(zt);
  return '<div class="zbar">' + p.map((x, i) =>
    `<div style="width:${x}%;background:${CFG.zones.power.colors[i]}"></div>`).join('') + '</div>';
}

// ── FTP-Widget ──────────────────────────────────────────────────────────────
/* Die FTP-Herleitung (autoRampTests / testPoints / planFtp / currentFtp) liegt
 * zentral in shared.js - genau eine Quelle, die auch Zonen, IF und TSS speist.
 * Hier wird sie nur noch angezeigt. */

/* Test-Timeline als SVG. Zeitachse vom ersten Test bis zum Zieldatum, die
 * 300-Marke als waagerechte Referenz oben. KEINE Soll-Linie: die echten
 * Punkte sollen fuer sich sprechen. Rampe = Dreieck, 20-Min = Kreis, weil die
 * Methoden 10-20 W auseinanderliegen und nicht als Fitness-Sprung
 * missverstanden werden duerfen. */
function testTimeline(tp, goal, goalDate) {
  const W = 300, H = 150, pad = { l: 30, r: 14, t: 14, b: 22 };
  if (!tp.length) return '<div class="ez-none">Noch keine Tests erfasst.</div>';

  const t0 = d(tp[0].date).getTime();
  const t1 = d(goalDate).getTime();
  const span = Math.max(1, (t1 - t0) / 86400000);
  const vals = tp.map(t => t.ftp).concat([goal]);
  const lo = Math.min(...vals) - 8, hi = Math.max(...vals) + 8;
  const X = ds => pad.l + ((d(ds).getTime() - t0) / 86400000) / span * (W - pad.l - pad.r);
  const Y = v => H - pad.b - (v - lo) / (hi - lo) * (H - pad.t - pad.b);

  const KCOL = { ramp: '#a855f7', '20min': '#60a5fa', '4dp': '#f59e0b' };
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%">`;

  // Gitter: waagerechte Werte-Ticks
  for (let i = 0; i <= 3; i++) {
    const v = lo + (hi - lo) * i / 3, y = Y(v);
    s += `<line x1="${pad.l}" y1="${y.toFixed(1)}" x2="${W - pad.r}" y2="${y.toFixed(1)}"
          stroke="rgba(255,255,255,.05)"/>
          <text x="${pad.l - 4}" y="${(y + 3).toFixed(1)}" text-anchor="end"
          font-size="8" font-family="var(--mono)" fill="var(--t5)">${Math.round(v)}</text>`;
  }
  // 300-Marke
  s += `<line x1="${pad.l}" y1="${Y(goal).toFixed(1)}" x2="${W - pad.r}" y2="${Y(goal).toFixed(1)}"
        stroke="#34d399" stroke-width="1.2" stroke-dasharray="4 3"/>
        <text x="${W - pad.r}" y="${(Y(goal) - 4).toFixed(1)}" text-anchor="end"
        font-size="9" font-weight="700" font-family="var(--mono)" fill="#34d399">Ziel ${goal} W</text>`;

  // Verbindungslinie der Tests (chronologisch), dezent
  if (tp.length > 1) {
    s += `<path d="${tp.map((t, i) => (i ? 'L' : 'M') + X(t.date).toFixed(1) + ' ' + Y(t.ftp).toFixed(1)).join(' ')}"
          fill="none" stroke="#4a6a8a" stroke-width="1.2"/>`;
  }
  // Zieldatum als senkrechte Markierung
  s += `<line x1="${X(goalDate).toFixed(1)}" y1="${pad.t}" x2="${X(goalDate).toFixed(1)}" y2="${H - pad.b}"
        stroke="#34d399" stroke-width="1" stroke-dasharray="2 2" opacity=".4"/>`;

  // Geplante Tests (CFG.plan.events, type:'test', heute oder spaeter): leere
  // Marker auf der x-Achse mit senkrechter Datumslinie. Kein Y-Wert, weil noch
  // nicht gemessen — sie sagen nur "hier kommt ein Nullpunkt". Sobald an dem
  // Datum ein echter Test vorliegt (heute gefahrene Rampe), faellt der geplante
  // Marker samt Datumslinie weg — der gemessene Punkt ersetzt ihn.
  const doneDates = new Set(tp.map(t => t.date));
  (CFG.plan.events || [])
    .filter(e => e.type === 'test' && !doneDates.has(e.date)
      && e.date >= iso(today()) && e.date >= tp[0].date && e.date <= goalDate)
    .forEach(e => {
      const x = X(e.date), yb = H - pad.b;
      s += `<line x1="${x.toFixed(1)}" y1="${pad.t}" x2="${x.toFixed(1)}" y2="${yb.toFixed(1)}"
            stroke="${KCOL.ramp}" stroke-width="1" stroke-dasharray="2 3" opacity=".45"/>
            <path d="M${x.toFixed(1)} ${(yb-6).toFixed(1)} L${(x+3.6).toFixed(1)} ${yb.toFixed(1)} L${(x-3.6).toFixed(1)} ${yb.toFixed(1)} Z"
            fill="none" stroke="${KCOL.ramp}" stroke-width="1.2"/>`;
    });

  // Punkte: Rampe = Dreieck, sonst Kreis
  tp.forEach(t => {
    const x = X(t.date), y = Y(t.ftp), col = KCOL[t.kind] || '#60a5fa';
    if (t.kind === 'ramp') {
      s += `<path d="M${x.toFixed(1)} ${(y-4).toFixed(1)} L${(x+3.6).toFixed(1)} ${(y+3).toFixed(1)} L${(x-3.6).toFixed(1)} ${(y+3).toFixed(1)} Z" fill="${col}"/>`;
    } else {
      s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" fill="${col}"/>`;
    }
  });
  // x-Achse: erster Test + Zieldatum
  s += `<text x="${pad.l}" y="${H - 6}" font-size="8" font-family="var(--mono)" fill="var(--t5)">${fmtDay(d(tp[0].date))}</text>
        <text x="${W - pad.r}" y="${H - 6}" text-anchor="end" font-size="8" font-family="var(--mono)" fill="var(--t5)">${fmtDay(d(goalDate))}</text>`;
  s += '</svg>';
  return s;
}

function ftpWidget() {
  const goal = CFG.athlete.ftpGoal;
  const goalDate = CFG.athlete.ftpGoalDate;
  const win = CFG.ui.easyWindowDays;
  const cur = easyShare(win, 0);
  const [tLo, tHi] = CFG.ui.easyTarget;
  const tp = testPoints();
  const best20 = best('1200', 42);

  // ── Rechts: Easy-Verlauf (Punkte je Fahrt, siehe drawEasyTrend) ──
  const EP = CFG.ui.easyPlot;

  // ── Links: Test-Fortschritt ──
  const latest = tp.length ? tp[tp.length - 1] : null;
  const KIND = { ramp: 'Rampe △', '20min': '20-Min ○', '4dp': '4DP' };
  const gap = latest ? goal - latest.ftp : goal;
  const daysLeft = Math.max(0, dayDiff(d(goalDate), today()));
  const testRows = tp.slice().reverse().map(t =>
    `<div>${fmtDay(d(t.date))} · ${KIND[t.kind] || t.kind} · <b>${t.ftp} W</b>${t.map ? ` · MAP ${t.map}` : ''}</div>`
  ).join('');

  const best20html = best20
    ? `20-Min-Bestwert <b>${best20.w} W</b> (FTP ≈ ${Math.round(best20.w * 0.95)}) · ${fmtDay(d(best20.date))}`
    : 'Noch kein 20-Min-Wert in den letzten 6 Wochen';

  const wkg = latest ? (latest.ftp / CFG.athlete.weight).toFixed(2) : null;
  const cp = cpModel();
  const cpTag = cp ? ` · CP ${cp.cp} W` : '';
  return `<div class="card">
    <div class="card-hd"><span class="t">WEG ZU FTP ${goal}</span>
      <span class="s">${latest ? `Plan-FTP <b>${latest.ftp} W</b> (${wkg} W/kg)${cpTag} · noch ${gap > 0 ? gap : 0} W · ${daysLeft} Tage bis ${fmtDay(d(goalDate))}` : 'noch keine Tests'}</span></div>
    <div class="ftp3-grid">
      <div>
        <div class="lbl">FTP-Tests · Ziel ${goal} bis ${fmtDay(d(goalDate))}</div>
        ${testTimeline(tp, goal, goalDate)}
        <div class="tst-list" style="margin-top:6px">${testRows}</div>
        <div class="ez-hint">△ Rampe · ○ 20-Min · leerer △ = geplant · Methoden ~10-20 W verschieden</div>
      </div>
      <div>
        <div class="lbl">Easy-Verlauf · letzte ${win} Tage</div>
        <div id="easy-box"></div>
        <div class="ez-meta">Band = Ziel ${tLo}–${tHi} % ·
          <span style="color:${EP.colP}">●</span> Leistung ·
          <span style="color:${EP.colHr}">●</span> HF · Größe = Dauer ·
          ${cur.hours.toFixed(1)} h · ${cur.rides} Fahrten</div>
        <div class="ez-hint" style="margin-top:8px">${best20html}</div>
      </div>
    </div>
  </div>`;
}

// ── Tag ─────────────────────────────────────────────────────────────────────
function dayTile(day) {
  const cls = ['day'];
  if (day.isToday) cls.push('today');
  else if (day.isPast) cls.push('past');
  if (day.plan && day.plan.deload) cls.push('deload');

  const head = `<div class="day-hd"><span class="dow">${dowOf(day.dt)}</span>
    <span class="dat">${fmtDay(day.dt)}</span></div>`;
  const wrap = body => `<div class="${cls.join(' ')}">${head}<div class="day-body">${body}</div></div>`;

  // Vergangenheit: echte Fahrten, keine Behauptungen.
  if (day.acts.length) {
    const body = day.acts.map(a => {
      const i = IF(a);
      return `<div class="act">
        <div class="act-main">
          <div class="act-name">${a.name || 'Fahrt'}</div>
          <div class="act-num">${fmtDur(a.moving_sec || a.duration_sec)}
            ${a.np ? `· NP <b>${a.np}</b>` : ''}
            ${i ? `· IF <b>${i.toFixed(2)}</b>` : ''}
            ${tssOf(a) ? `· TSS <b>${Math.round(tssOf(a))}</b>` : ''}
            ${a.ef ? `· EF <b>${a.ef.toFixed(2)}</b>` : ''}</div>
          ${zbar(a)}
        </div>${dp4Rings(a, 30)}</div>`;
    }).join('');
    const planned = day.plan && day.plan.parts
      ? `<div class="was-planned">geplant: ${day.plan.parts.map(p => p.title).join(' + ')}</div>` : '';
    return wrap(body + planned);
  }

  if (!day.plan) return `<div class="${cls.join(' ')} empty">${head}<div class="day-body"></div></div>`;
  if (day.plan.source === 'event') {
    return `<div class="${cls.join(' ')} ev-${day.plan.type}">${head}<div class="day-body">
      <div class="p-title">${day.plan.title}</div>
      <div class="p-desc">${day.plan.desc || ''}</div></div></div>`;
  }
  return wrap(day.plan.parts.map(p =>
    `<div class="p-part t-${p.type}"><div class="p-title">${p.title}</div>
      <div class="p-desc">${p.desc || ''}</div></div>`).join(''));
}

// ── Woche ───────────────────────────────────────────────────────────────────
function weekCard(w) {
  const tss = w.days.reduce((s, dy) => s + dy.acts.reduce((t, a) => t + tssOf(a), 0), 0);
  const hrs = w.days.reduce((s, dy) => s + dy.acts.reduce((t, a) => t + (a.moving_sec || 0), 0), 0) / 3600;
  const end = addDays(w.mon, 6);
  const deload = ((w.weekIdx + 1) % CFG.plan.deloadEvery) === 0 && w.weekIdx >= 0;
  const label = w.weekIdx >= 0 ? `Block-Woche ${w.weekIdx + 1}` : 'vor Planbeginn';
  return `<div class="wcard${deload ? ' deload' : ''}">
    <div class="wcard-hd">
      ${CFG.plan.showKW ? `<span class="kw">KW ${w.kw}</span>` : ''}
      <span class="wlbl">${label}${deload ? ' · Entlastung' : ''}</span>
      <span class="wdates">${fmtDay(w.mon)}–${fmtDay(end)}</span>
      <span class="wvol">${hrs ? hrs.toFixed(1) + ' h · ' + Math.round(tss) + ' TSS' : ''}</span>
    </div>
    <div class="days">${w.days.slice().reverse().map(dayTile).join('')}</div>
  </div>`;
}

// Leistungsprofil-Karte + Wochen-Plot liegen jetzt auf der Rides-Seite
// (Kapazitaets-Kennzahlen bei den Fahrten-Daten, aus denen sie stammen).
// Siehe profileCard()/drawProfileTrend() in rides.js.

/* Easy-Verlauf: Punkt je Fahrt (Easy-Anteil nach Leistung und HF), Ziel-Band
 * als Erwartungsbereich, zeit-gewichtete Trendlinie je Serie. Zeigt anschaulich,
 * ob und wohin sich die Verteilung ueber die letzten Tage bewegt. */
let _easy = null;
function drawEasyTrend() {
  const box = $('#easy-box');
  if (!box || !window.Chart) return;
  const EP = CFG.ui.easyPlot, days = CFG.ui.easyWindowDays;
  const [tLo, tHi] = CFG.ui.easyTarget;
  const pts = easyPoints(days);
  box.style.height = EP.height + 'px';
  box.innerHTML = '<canvas id="easy-canvas"></canvas>';
  const lo = addDays(today(), -days);
  const X = ds => dayDiff(d(ds), lo);
  const span = Math.log(Math.max(2, EP.dotMaxMin / EP.dotMinMin));
  const rOf = m => EP.dotMinR + (EP.dotMaxR - EP.dotMinR) *
    Math.max(0, Math.min(1, Math.log(Math.max(m, EP.dotMinMin) / EP.dotMinMin) / span));
  const bub = key => pts.filter(p => p[key] != null)
    .map(p => ({ x: X(p.date), y: p[key], r: rOf(p.dur) }));
  const trend = key => ewmaBand(
    pts.filter(p => p[key] != null).map(p => ({ x: X(p.date), y: p[key] })).sort((a, b) => a.x - b.x),
    0.3, CFG.ui.efTrend.trendTau).line;

  if (_easy) _easy.destroy();
  _easy = new Chart($('#easy-canvas'), {
    data: { datasets: [
      { type: 'bubble', label: 'Leistung', data: bub('p'),  backgroundColor: EP.colP + 'b3', borderWidth: 0, clip: false },
      { type: 'bubble', label: 'HF',       data: bub('hr'), backgroundColor: EP.colHr + 'b3', borderWidth: 0, clip: false },
      { type: 'line', data: trend('p'),  borderColor: EP.colP,  borderWidth: 1.6, pointRadius: 0, fill: false },
      { type: 'line', data: trend('hr'), borderColor: EP.colHr, borderWidth: 1.6, pointRadius: 0, fill: false },
    ] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      scales: {
        x: { type: 'linear', min: 0, max: days,
             ticks: { color: CSSVAR('--t4'), font: { size: 9 }, stepSize: Math.ceil(days / 4),
                      callback: v => fmtDay(addDays(lo, v)) },
             grid: { color: 'rgba(255,255,255,.05)' } },
        y: { min: 0, max: 100,
             title: { display: true, text: 'Easy %', color: CSSVAR('--t5'), font: { size: 10 } },
             ticks: { color: CSSVAR('--t4'), font: { size: 9 }, stepSize: 25 },
             grid: { color: 'rgba(255,255,255,.05)' } },
      },
      plugins: {
        legend: { display: false },
        tooltip: { filter: c => c.dataset.type === 'bubble',
          callbacks: { label: c => `${c.dataset.label}: ${Math.round(c.raw.y)} %` } },
      },
    },
    // Ziel-Band (Erwartungsbereich) als waagerechte Flaeche.
    plugins: [{
      id: 'easyband',
      beforeDatasetsDraw(ch) {
        const { ctx, chartArea: ca, scales } = ch;
        const y1 = scales.y.getPixelForValue(tHi), y2 = scales.y.getPixelForValue(tLo);
        ctx.save();
        ctx.fillStyle = `rgba(52,211,153,${EP.bandAlpha})`;
        ctx.fillRect(ca.left, y1, ca.right - ca.left, y2 - y1);
        ctx.restore();
      },
    }],
  });
}

function renderPlan() {
  const box = $('#page-plan');
  if (!box) return;
  const weeks = buildWeeks();
  box.innerHTML = ftpWidget() + weeks.map(weekCard).join('');
  drawEasyTrend();
}
