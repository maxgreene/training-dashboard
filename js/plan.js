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

// Entlastungswoche? 4er-Raster, ausser CFG.plan.weekPhase sagt fuer den
// Montag etwas anderes.
function weekPhase(weekIdx, mon) {
  const o = (CFG.plan.weekPhase || {})[iso(mon)];
  const deload = o ? o.deload
    : weekIdx >= 0 && ((weekIdx + 1) % CFG.plan.deloadEvery) === 0;
  return { deload, label: o ? o.label : deload ? 'Entlastung' : '' };
}

// ── Was ist an einem Tag geplant? ───────────────────────────────────────────
function plannedFor(dt, weekIdx) {
  const isoD = iso(dt);

  const ev = CFG.plan.events.find(e => e.date === isoD);
  if (ev) return { ...ev, source: 'event' };

  if (dt < d(CFG.plan.start)) return null;          // vor Planbeginn: nichts

  const tp = (CFG.plan.templatePhases || []).filter(p => d(p.from) <= dt).pop();
  const t = (tp ? tp.template : CFG.plan.template)[dowOf(dt)];
  if (!t) return null;

  const deload = weekPhase(weekIdx, mondayOf(dt)).deload;
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
  } else if (t.slot && CFG.plan.units[t.slot]) {
    // Weitere Bausteine (Kraft, Yoga, Rolle locker ...) direkt aus units;
    // type steuert die Randfarbe (.p-part.t-*).
    parts.push({ type: 'roll', ...CFG.plan.units[t.slot] });
  }

  if (!parts.length) parts.push({ type: 'rest', ...CFG.plan.units.rest });
  return { parts, deload };
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
  const W = 300, H = 156, pad = { l: 30, r: 14, t: 14, b: 28 };
  const xl = [];   // x-Achsen-Labels, am Ende ohne Überlappung gesetzt
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

  // Heute als senkrechte Linie (nur wenn im Fenster)
  const tx = X(iso(today()));
  if (tx >= pad.l && tx <= W - pad.r) {
    s += `<line x1="${tx.toFixed(1)}" y1="${pad.t}" x2="${tx.toFixed(1)}" y2="${H - pad.b}"
          stroke="var(--t2)" stroke-width="1" opacity=".65"/>
          <text x="${tx.toFixed(1)}" y="${(pad.t - 4).toFixed(1)}" text-anchor="middle"
          font-size="7.5" font-family="var(--mono)" fill="var(--t2)">heute</text>`;
  }

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
      xl.push({ x, t: fmtDay(d(e.date)), col: KCOL.ramp, op: .75 });
    });

  // Punkte: Rampe = Dreieck, sonst Kreis, mit FTP-Wert darueber
  tp.forEach(t => {
    const x = X(t.date), y = Y(t.ftp), col = KCOL[t.kind] || '#60a5fa';
    if (t.kind === 'ramp') {
      s += `<path d="M${x.toFixed(1)} ${(y-4).toFixed(1)} L${(x+3.6).toFixed(1)} ${(y+3).toFixed(1)} L${(x-3.6).toFixed(1)} ${(y+3).toFixed(1)} Z" fill="${col}"/>`;
    } else {
      s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" fill="${col}"/>`;
    }
    const lx = Math.max(pad.l + 8, Math.min(W - pad.r - 8, x));
    s += `<text x="${lx.toFixed(1)}" y="${(y - 7).toFixed(1)}" text-anchor="middle"
          font-size="8" font-weight="700" font-family="var(--mono)" fill="${col}">${t.ftp}</text>`;
  });
  // x-Achse: Datum je gemessenem Test unter seinem Marker, plus Zieldatum rechts.
  tp.forEach(t => xl.push({ x: X(t.date), t: fmtDay(d(t.date)), col: 'var(--t3)' }));
  // Zwei Label-Zeilen: kollidiert ein Label mit dem vorigen in Zeile 1, rutscht es
  // in Zeile 2; kollidiert es auch dort, entfällt es. Zieldatum hat Vorrang (rechts).
  const cw = 4.3, gw = 6 * cw;   // Zeichenbreite bei 7 px Mono, Breite "TT.MM."
  const goalL = W - pad.r - gw;
  const ends = [-1e9, -1e9];
  xl.sort((a, b) => a.x - b.x).forEach(l => {
    const cx = Math.max(pad.l + gw / 2, Math.min(W - pad.r - gw / 2, l.x)), a = cx - gw / 2, b = cx + gw / 2;
    const row = [0, 1].find(r => a > ends[r] + 2 && (r === 1 || b < goalL - 2));
    if (row == null) return;
    ends[row] = b;
    s += `<text x="${cx.toFixed(1)}" y="${H - 15 + row * 9}" text-anchor="middle" font-size="7"
          font-family="var(--mono)" fill="${l.col}" opacity="${l.op || 1}">${l.t}</text>`;
  });
  s += `<text x="${W - pad.r}" y="${H - 15}" text-anchor="end" font-size="7.5" font-weight="700"
        font-family="var(--mono)" fill="#34d399">${fmtDay(d(goalDate))}</text>`;
  s += '</svg>';
  return s;
}
