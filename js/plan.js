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
/* Rampentests AUTOMATISCH aus den Fahrten ableiten.
 *
 * Eine Fahrt gilt als Rampentest, wenn ihr Datum auf einen geplanten Test
 * faellt (CFG.plan.events, type:'test') ODER ihr Name "ramp" enthaelt. Der FTP
 * folgt dann der Rampen-Konvention dieses Projekts: FTP = 0.75 x MAP, wobei
 * MAP der beste 60-s-Wert ist. So muss kein Rampentest mehr von Hand in
 * CFG.tests eingetragen werden - er erscheint nach der Analyse von selbst. */
function autoRampTests() {
  const testDates = new Set(
    (CFG.plan.events || []).filter(e => e.type === 'test').map(e => e.date));
  const out = [];
  for (const a of DATA.acts) {
    const isRamp = testDates.has(a.date) || /ramp/i.test(a.name || '');
    const map = a.power_curve && a.power_curve['60'];
    if (isRamp && a.has_power && map) {
      out.push({ date: a.date, kind: 'ramp', id: String(a.id),
                 map, ftp: Math.round(map * 0.75), auto: true });
    }
  }
  return out;
}

/* Gemessene Tests aufbereiten. Zwei Quellen, zusammengefuehrt nach Datum:
 *   1. autoRampTests()  - Rampen aus den Fahrten (0.75 x MAP), keine Pflege noetig.
 *   2. CFG.tests        - Handeintraege: Altfahrten ohne Daten hier sowie
 *                         20-Min-Tests; ein Handeintrag mit gesetztem ftp hat
 *                         Vorrang (Override) vor dem automatischen Wert.
 * Fuer 20-Min-Handeintraege ohne ftp bleibt die 20-Min-Ableitung (x0.95). */
function testPoints() {
  const manual = CFG.tests.map(t => {
    let ftp = t.ftp, map = t.map;
    if (t.id) {
      const a = DATA.acts.find(x => String(x.id) === String(t.id));
      const pc = a && a.power_curve;
      if (pc) {
        if (ftp == null && pc['1200']) ftp = Math.round(pc['1200'] * 0.95);
        if (map == null && pc['300']) map = pc['300'];
      }
    }
    return { ...t, ftp, map };
  });

  const byDate = new Map();
  autoRampTests().forEach(t => byDate.set(t.date, t));      // Auto zuerst …
  manual.forEach(t => { if (t.ftp) byDate.set(t.date, t); });// … Handeintrag gewinnt
  return [...byDate.values()].filter(t => t.ftp)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/* Kerngroesse fuer den Plan: der FTP des juengsten Tests. Der Plan (Zonen,
 * IF, Intervall-Vorgaben "% FTP") richtet sich danach.
 *
 * OFFEN (Entscheidung, siehe PR): Soll dieser Wert auch CFG.athlete.ftp (heute
 * 250, zusaetzlich in scripts/analyze_activities.py) ersetzen? Das steuert IF,
 * Zonen und die im Backend vorberechnete TSS - eine Aenderung braucht dort
 * einen Reprocess, damit IF und TSS konsistent bleiben. Bis dahin bleibt
 * athlete.ftp die Rechengroesse; planFtp() ist die angezeigte Kerngroesse. */
function planFtp() {
  const tp = testPoints();
  return tp.length ? tp[tp.length - 1] : null;
}

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
  // nicht gemessen — sie sagen nur "hier kommt ein Nullpunkt".
  (CFG.plan.events || [])
    .filter(e => e.type === 'test' && e.date >= iso(today()) && e.date >= tp[0].date && e.date <= goalDate)
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

  // ── Rechts: 14-Tage-Bilanz ──
  const ezBar = (val, label) => {
    if (val == null) return `<div class="ez-none">${label}: keine Daten</div>`;
    const col = val >= tLo ? '#34d399' : val >= 65 ? '#fbbf24' : '#f97316';
    return `<div class="ez-item">
      <div class="ez-head"><span class="ez-name">${label}</span>
        <span class="ez-val" style="color:${col}">${val.toFixed(0)}<small> %</small></span></div>
      <div class="ez-bar"><div class="ez-fill" style="width:${Math.min(100, val)}%;background:${col}"></div>
        <div class="ez-tgt" style="left:${tLo}%;right:${100 - tHi}%"></div></div></div>`;
  };

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
  return `<div class="card">
    <div class="card-hd"><span class="t">WEG ZU FTP ${goal}</span>
      <span class="s">${latest ? `Plan-FTP <b>${latest.ftp} W</b> (${wkg} W/kg) · noch ${gap > 0 ? gap : 0} W · ${daysLeft} Tage bis ${fmtDay(d(goalDate))}` : 'noch keine Tests'}</span></div>
    <div class="ftp3-grid">
      <div>
        <div class="lbl">FTP-Tests · Ziel ${goal} bis ${fmtDay(d(goalDate))}</div>
        ${testTimeline(tp, goal, goalDate)}
        <div class="tst-list" style="margin-top:6px">${testRows}</div>
        <div class="ez-hint">△ Rampe · ○ 20-Min · leerer △ = geplant · Methoden ~10-20 W verschieden</div>
      </div>
      <div>
        <div class="lbl">Letzte ${win} Tage</div>
        ${ezBar(cur.hr, 'Easy nach HF')}
        ${ezBar(cur.power, 'Easy nach Leistung')}
        <div class="ez-meta">${cur.hours.toFixed(1)} h · ${cur.rides} Fahrten · Ziel Easy ${tLo}–${tHi} %</div>
        <div class="ez-hint" style="margin-top:10px">${best20html}</div>
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
            ${a.tss ? `· TSS <b>${Math.round(a.tss)}</b>` : ''}
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
  const tss = w.days.reduce((s, dy) => s + dy.acts.reduce((t, a) => t + (a.tss || 0), 0), 0);
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

function renderPlan() {
  const box = $('#page-plan');
  if (!box) return;
  const weeks = buildWeeks();
  box.innerHTML = ftpWidget() + weeks.map(weekCard).join('');
}
