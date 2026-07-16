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
function testPoints() {
  return CFG.tests.map(t => {
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
  }).filter(t => t.ftp).sort((a, b) => a.date.localeCompare(b.date));
}

function ftpWidget() {
  const goal = CFG.athlete.ftpGoal;
  const p20Goal = Math.round(goal / 0.95);
  const cur = easyShare(CFG.ui.easyWindowDays, 0);
  const prev = easyShare(CFG.ui.easyWindowDays, CFG.ui.easyWindowDays);
  const p20 = best('1200', 42);
  const [tLo, tHi] = CFG.ui.easyTarget;

  const bar = (val, label, hint) => {
    if (val == null) return `<div class="ez-none">${label}: keine Daten</div>`;
    const col = val >= tLo ? '#34d399' : val >= 65 ? '#fbbf24' : '#f97316';
    return `<div class="ez-item">
      <div class="ez-head"><span class="ez-name">${label}</span>
        <span class="ez-val" style="color:${col}">${val.toFixed(0)}<small> %</small></span></div>
      <div class="ez-bar"><div class="ez-fill" style="width:${Math.min(100, val)}%;background:${col}"></div>
        <div class="ez-tgt" style="left:${tLo}%;right:${100 - tHi}%"></div></div>
      <div class="ez-hint">${hint}</div></div>`;
  };

  let delta = '';
  if (prev.power != null && cur.power != null) {
    const dv = cur.power - prev.power;
    delta = `<span style="color:${dv >= 0 ? '#34d399' : '#ef4444'}">${dv >= 0 ? '▲' : '▼'} ${Math.abs(dv).toFixed(0)} Pp. vs. Vormonat</span>`;
  }

  let p20html = '<div class="ez-none">Noch kein 20-Min-Wert in den letzten 6 Wochen.</div>';
  if (p20) {
    const prog = Math.min(100, 100 * p20.w / p20Goal);
    p20html = `<div><span class="big" style="color:#60a5fa">${p20.w}</span><small> W</small>
        <span class="muted"> beste 20 Min · ${fmtDay(d(p20.date))}</span></div>
      <div class="ez-bar"><div class="ez-fill" style="width:${prog}%;background:linear-gradient(90deg,#3b82f6,#60a5fa)"></div></div>
      <div class="ez-hint">entspricht FTP ≈ <b>${Math.round(p20.w * 0.95)} W</b> · noch
        <b>${Math.max(0, p20Goal - p20.w)} W</b> bis Ziel ${p20Goal} W.
        Werte aus Ausfahrten sind eine Untergrenze — nur ein Test misst sauber.</div>`;
  }

  const tp = testPoints();
  let spark = '<div class="ez-none">Noch keine Rollentests erfasst.</div>';
  if (tp.length) {
    const W = 170, H = 48, pad = 6;
    const lo = Math.min(goal, ...tp.map(t => t.ftp)) - 10;
    const hi = Math.max(goal, ...tp.map(t => t.ftp)) + 10;
    const X = i => tp.length === 1 ? W / 2 : pad + i * (W - 2 * pad) / (tp.length - 1);
    const Y = v => H - pad - ((v - lo) / (hi - lo)) * (H - 2 * pad);
    let s = `<svg width="${W}" height="${H}">
      <line x1="0" y1="${Y(goal).toFixed(1)}" x2="${W}" y2="${Y(goal).toFixed(1)}"
            stroke="#34d399" stroke-width="1" stroke-dasharray="3 3" opacity=".7"/>`;
    if (tp.length > 1) s += `<path d="${tp.map((t, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(t.ftp).toFixed(1)).join(' ')}"
            fill="none" stroke="#60a5fa" stroke-width="2"/>`;
    tp.forEach((t, i) => s += `<circle cx="${X(i).toFixed(1)}" cy="${Y(t.ftp).toFixed(1)}" r="3" fill="#60a5fa"/>`);
    s += '</svg>';
    const KIND = { ramp: 'Rampe', '4dp': '4DP', '20min': '20-Min' };
    const rows = tp.slice().reverse().slice(0, 3).map(t =>
      `<div>${fmtDay(d(t.date))} · ${KIND[t.kind] || t.kind} · FTP <b>${t.ftp} W</b>${t.map ? ` · MAP ${t.map} W` : ''}</div>`).join('');
    spark = `<div class="tst-row"><div>${s}</div><div class="tst-list">${rows}</div></div>`;
  }

  return `<div class="card ftp3">
    <div class="card-hd"><span class="t">WEG ZU FTP ${goal}</span>
      <span class="s">Steuergrößen des Aufbaus</span></div>
    <div class="ftp3-grid">
      <div>
        <div class="lbl">Easy-Anteil · letzte ${CFG.ui.easyWindowDays} Tage</div>
        ${bar(cur.hr, 'nach Herzfrequenz', 'Was der Kreislauf gemerkt hat. Der ehrlichere Wert für die Verteilung.')}
        ${bar(cur.power, 'nach Leistung', 'Zählt auch kurze Spitzen, die die HF nie erreicht haben.')}
        <div class="ez-meta">${cur.hours.toFixed(1)} h · ${cur.rides} Fahrten · Ziel ${tLo}–${tHi} % ${delta}</div>
      </div>
      <div>
        <div class="lbl">20-Min-Bestleistung</div>
        ${p20html}
        <div class="lbl" style="margin-top:14px">Rollentests · gemessene FTP</div>
        ${spark}
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
