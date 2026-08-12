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

// Watt-Spanne aus einem Intensitaets-Anteil (x aktuellem FTP), live gerechnet.
function wRange(fr) {
  const f = CFG.athlete.ftp;
  return Math.round(fr[0] * f) + '–' + Math.round(fr[1] * f) + ' W';
}

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
    // Quality-Commute: 1 Weg als Sweet-Spot-Block (nur in Aufbauwochen, nur
    // wenn die Strecke frei ist). Der zeitgeknappte Reiz: Intensitaet statt
    // Dauer. In Entlastungswochen bleibt alles locker.
    if (t.commuteQuality === 'ss' && !deload) {
      parts.push({ type: 'comm', title: 'Commute: Sweet-Spot-Block',
        desc: `2×10 oder 3×8 min @ ${wRange(CFG.plan.intensity.ss)} · zweiter Weg locker · nur bei freier Strecke` });
    } else {
      parts.push({ type: 'comm', ...CFG.plan.units.commute });
    }
  }

  if (t.slot === 'hard') {
    if (deload) {
      parts.push({ type: 'roll', ...CFG.plan.units.deload });
    } else {
      // Aufbauwochen durchzaehlen (Entlastungswochen zaehlen nicht mit)
      const buildIdx = weekIdx - Math.floor(weekIdx / CFG.plan.deloadEvery);
      const p = CFG.plan.hardProgression[buildIdx % CFG.plan.hardProgression.length];
      parts.push({ type: 'roll', title: 'Rolle: ' + p.title,
                   desc: p.desc + ' · ' + wRange(CFG.plan.intensity.thr) });
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

/* Heute-Feld: live aus Health (HRV/RHP/Schlaf), Form (CTL/ATL/TSB) und dem
 * geplanten Tag eine Ampel plus konkrete Empfehlung (Coach-Rolle). Marker
 * gegen die 42-Tage-Basis (Median). Bei Konflikt Erholung vor Plan. */
function todayCard(plan) {
  const h = DATA.health[0] || {};
  const m = loadModel();
  const f = m.length ? m[m.length - 1] : null;
  const hrvB = baseline('hrv', 42), rhrB = baseline('resting_hr', 42);
  const hrv = h.hrv, rhr = h.resting_hr, sleep = h.sleep_h, st = h.hrv_status || '';

  const flags = [];
  if (hrvB != null && hrv != null && hrv < hrvB - 5) flags.push('HRV unter Basis');
  if (rhrB != null && rhr != null && rhr > rhrB + 3) flags.push('Ruhepuls erhöht');
  if (sleep != null && sleep < 6.5) flags.push('kurzer Schlaf');
  if (/LOW|POOR|UNBALANCED/i.test(st)) flags.push('HRV-Status ' + st);

  const level = (flags.length >= 2 || /LOW|POOR/i.test(st)) ? 'rot'
              : flags.length === 1 ? 'gelb' : 'grün';
  const col = { 'grün': '#34d399', gelb: '#d4a03c', rot: '#c0392b' }[level];

  // Heutige Einheit aus dem Plan-Tag ableiten.
  let sess = 'frei', hard = false, quality = false, long = false, rest = false, isTest = false;
  if (plan) {
    if (plan.source === 'event') { sess = plan.title; isTest = plan.type === 'test'; }
    else {
      sess = plan.parts.map(p => p.title).join(' + ');
      hard = plan.parts.some(p => /^Rolle:/.test(p.title));
      quality = plan.parts.some(p => /Sweet-Spot/.test(p.title));
      long = plan.parts.some(p => p.type === 'aus');
      rest = plan.parts.every(p => p.type === 'rest');
    }
  }

  let rec;
  if (isTest) rec = 'Testtag. Nur fahren, wenn die Marker grün sind, sonst 1 bis 2 Tage schieben. Ausgeruht = valider Wert.';
  else if (rest) rec = 'Ruhetag im Plan. Gut so, Erholung ist Teil des Trainings.';
  else if (level === 'rot') rec = (hard || quality || long)
    ? 'Erholung sagt Nein. Qualität heute raus, locker rollen oder Ruhetag. Den harten Reiz einen Tag schieben, er läuft dir nicht weg.'
    : 'Locker halten, kein Grau. Körper vor Plan.';
  else if (level === 'gelb') rec = (hard || quality)
    ? 'Gemischte Marker. Reiz ok, aber ans untere Ende der Zielwatt, nicht drüber. Bei Schwäche abbrechen.'
    : long ? 'Lange Ausfahrt ok, konsequent unter der Decke bleiben.'
    : 'Locker fahren, unter der Z2/Z3-Decke.';
  else rec = (hard || quality) ? 'Grün. Plan durchziehen, Zielwatt treffen.'
    : long ? 'Grün. Lange Ausfahrt wie geplant, ruhig unter der Decke.'
    : 'Locker wie geplant. Die harten Tage tragen den Reiz, heute nicht.';

  let tsbNote = '';
  if (f) {
    if (f.tsb < -20) tsbNote = ` TSB ${f.tsb.toFixed(0)}: tief ermüdet, eher konservativ.`;
    else if (f.tsb > 8) tsbNote = ` TSB ${f.tsb.toFixed(0)}: frisch, du kannst zugreifen.`;
  }

  const hLine = (hrv != null)
    ? `HRV ${hrv}${hrvB != null ? ` (Ø ${hrvB})` : ''} · RHP ${rhr}${rhrB != null ? ` (Ø ${rhrB})` : ''} · Schlaf ${sleep != null ? sleep + ' h' : '—'} · ${st || '—'}`
    : 'keine Health-Daten heute';
  const fLine = f ? `CTL ${f.ctl.toFixed(0)} · ATL ${f.atl.toFixed(0)} · TSB ${f.tsb.toFixed(0)}` : '—';

  return `<div class="card">
    <div class="card-hd"><span class="t">HEUTE · ${fmtDay(today())}</span>
      <span class="s"><span style="color:${col}">●</span> ${level}${flags.length ? ' · ' + flags.join(', ') : ''}</span></div>
    <div class="lbl">Health</div><div class="ez-meta">${hLine}</div>
    <div class="lbl" style="margin-top:8px">Form</div><div class="ez-meta">${fLine}</div>
    <div class="lbl" style="margin-top:8px">Plan heute</div><div class="ez-meta">${sess}</div>
    <div class="ez-meta" style="margin-top:10px;font-weight:600">${rec}${tsbNote}</div>
  </div>`;
}

function ftpWidget() {
  const goal = CFG.athlete.ftpGoal;
  const goalDate = CFG.athlete.ftpGoalDate;
  const win = CFG.ui.easyWindowDays;
  const cur = easyShare(win, 0);
  const tp = testPoints();
  const best20 = best('1200', 42);

  // ── Rechts: Ride vs Z2/Z3-Decke (Ø ± 1sd je Fahrt, siehe drawRideTargets) ──
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
        <div class="lbl">Ride vs Z2/Z3-Decke · letzte ${win} Tage</div>
        <div id="easy-box"></div>
        <div class="ez-meta">Linie = Decke (1.0) ·
          <span style="color:${EP.colP}">●</span> Leistung ·
          <span style="color:${EP.colHr}">●</span> HF · Punkt Ø, Balken ±1 sd · Größe = Dauer ·
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
/* Je Fahrt der letzten Tage: Ø-Punkt und ±1sd-Whisker von Leistung (blau) und
 * HF (gruen), RELATIV zur Z2/Z3-Decke. Ziel-Linie bei 1.0, der aerobe Bereich
 * darunter blau hinterlegt. Die zwei Serien um dx versetzt, damit die Whisker
 * am selben Tag nicht ueberlappen. */
function drawRideTargets() {
  const box = $('#easy-box');
  if (!box || !window.Chart) return;
  const EP = CFG.ui.easyPlot, days = CFG.ui.easyWindowDays;
  const pts = ridePoints(days);
  box.style.height = EP.height + 'px';
  box.innerHTML = '<canvas id="easy-canvas"></canvas>';
  const lo = addDays(today(), -days);
  const X = ds => dayDiff(d(ds), lo);
  const span = Math.log(Math.max(2, EP.dotMaxMin / EP.dotMinMin));
  const rOf = m => EP.dotMinR + (EP.dotMaxR - EP.dotMinR) *
    Math.max(0, Math.min(1, Math.log(Math.max(m, EP.dotMinMin) / EP.dotMinMin) / span));
  const set = (key, sdKey, dx) => pts.filter(p => p[key] != null)
    .map(p => ({ x: X(p.date) + dx, y: p[key], sd: p[sdKey] || 0, r: rOf(p.dur) }));

  if (_easy) _easy.destroy();
  _easy = new Chart($('#easy-canvas'), {
    type: 'scatter',
    data: { datasets: [
      { label: 'Leistung', data: set('pRel', 'pSd', -EP.dx),
        backgroundColor: EP.colP, pointRadius: c => c.raw.r, clip: false },
      { label: 'HF', data: set('hrRel', 'hrSd', EP.dx),
        backgroundColor: EP.colHr, pointRadius: c => c.raw.r, clip: false },
    ] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      scales: {
        x: { type: 'linear', min: 0, max: days,
             ticks: { color: CSSVAR('--t4'), font: { size: 9 }, stepSize: Math.ceil(days / 4),
                      callback: v => fmtDay(addDays(lo, v)) },
             grid: { color: 'rgba(255,255,255,.05)' } },
        y: { min: 0, max: EP.relMax,
             title: { display: true, text: '× Z2/Z3-Decke', color: CSSVAR('--t5'), font: { size: 10 } },
             ticks: { color: CSSVAR('--t4'), font: { size: 9 }, stepSize: 0.5 },
             grid: { color: 'rgba(255,255,255,.05)' } },
      },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c =>
          `${c.dataset.label}: ${Math.round(c.raw.y * 100)} % ± ${Math.round(c.raw.sd * 100)}` } },
      },
    },
    plugins: [{
      id: 'ridetarget',
      // aerober Bereich (< Decke) hinterlegen + Ziel-Linie bei 1.0
      beforeDatasetsDraw(ch) {
        const { ctx, chartArea: ca, scales } = ch;
        const yT = scales.y.getPixelForValue(1), yB = scales.y.getPixelForValue(0);
        ctx.save();
        ctx.fillStyle = `rgba(96,165,250,${EP.bandAlpha})`;
        ctx.fillRect(ca.left, yT, ca.right - ca.left, yB - yT);
        ctx.strokeStyle = 'rgba(148,163,184,.55)'; ctx.setLineDash([4, 3]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(ca.left, yT); ctx.lineTo(ca.right, yT); ctx.stroke();
        ctx.restore();
      },
      // ±1sd-Whisker mit Endkappen, je Punkt
      afterDatasetsDraw(ch) {
        const { ctx, scales, chartArea: ca } = ch;
        ctx.save();
        [0, 1].forEach(di => {
          const ds = ch.data.datasets[di], meta = ch.getDatasetMeta(di);
          ctx.strokeStyle = ds.backgroundColor; ctx.lineWidth = 1.4;
          ds.data.forEach((pt, i) => {
            const x = meta.data[i].x;
            const yT = Math.max(ca.top, scales.y.getPixelForValue(pt.y + pt.sd));
            const yB = Math.min(ca.bottom, scales.y.getPixelForValue(Math.max(0, pt.y - pt.sd)));
            ctx.beginPath(); ctx.moveTo(x, yT); ctx.lineTo(x, yB);
            ctx.moveTo(x - 3, yT); ctx.lineTo(x + 3, yT);
            ctx.moveTo(x - 3, yB); ctx.lineTo(x + 3, yB); ctx.stroke();
          });
        });
        ctx.restore();
      },
    }],
  });
}

function renderPlan() {
  const box = $('#page-plan');
  if (!box) return;
  const weeks = buildWeeks();
  let todayPlan = null;
  for (const w of weeks) for (const dd of w.days) if (dd.isToday) todayPlan = dd.plan;
  box.innerHTML = todayCard(todayPlan) + ftpWidget() + weeks.map(weekCard).join('');
  drawRideTargets();
}
