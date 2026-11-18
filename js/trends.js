/* trends.js — Verlauf: geht es aufwärts?
 *
 * Kompakte Trendkarten, jede mit Wert jetzt und Änderung gegen "vor 4 Wochen"
 * (CFG.trend.compareDays), Pfeil grün wenn in die gute Richtung. Dazu der Weg
 * zum FTP-Ziel und der EF-Trend (renderEF aus rides.js, eine Quelle).
 */
const TCFG = CFG.trend;
const n1 = v => v == null ? '–' : v.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// Sparkline als SVG. pts: [{x (Tag), y}], bars: Balken statt Linie.
function spark(pts, o = {}) {
  const W = 300, H = o.h || TCFG.height, P = 4;
  if (!pts.length) return '<div class="ez-hint">noch keine Daten</div>';
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y).concat(o.ref != null ? [o.ref] : []);
  const x0 = o.x0 ?? Math.min(...xs), x1 = o.x1 ?? Math.max(...xs);
  let lo = o.lo ?? Math.min(...ys), hi = o.hi ?? Math.max(...ys);
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const X = x => P + (x - x0) / Math.max(1, x1 - x0) * (W - 2 * P);
  const Y = y => H - P - (y - lo) / (hi - lo) * (H - 2 * P);
  let s = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="t-spark" style="height:${H}px">`;
  if (o.ref != null) s += `<line x1="${P}" x2="${W - P}" y1="${Y(o.ref)}" y2="${Y(o.ref)}" stroke="var(--t5)" stroke-dasharray="3 3"/>`;
  if (o.bars) {
    const bw = Math.max(3, (W - 2 * P) / Math.max(1, (x1 - x0) / 7 + 1) - 4);
    pts.forEach(p => s += `<rect x="${X(p.x) - bw / 2}" y="${Y(p.y)}" width="${bw}" height="${Math.max(1, Y(lo) - Y(p.y))}" rx="1.5" fill="${p.col || o.col}"/>`);
    (o.marks || []).forEach(p => s += `<line x1="${X(p.x) - bw / 2 - 1}" x2="${X(p.x) + bw / 2 + 1}" y1="${Y(p.y)}" y2="${Y(p.y)}" stroke="var(--t2)" stroke-width="1.5"/>`);
  } else {
    if (o.dots) o.dots.forEach(p => s += `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="2" fill="${o.col}" opacity=".45"/>`);
    s += `<polyline fill="none" stroke="${o.col}" stroke-width="2" points="${pts.map(p => X(p.x).toFixed(1) + ',' + Y(p.y).toFixed(1)).join(' ')}"/>`;
    const e = pts[pts.length - 1];
    s += `<circle cx="${X(e.x)}" cy="${Y(e.y)}" r="3.5" fill="${o.col}"/>`;
  }
  return s + '</svg>';
}

// Änderung mit Pfeil; good = +1 wenn steigend gut, -1 wenn fallend gut.
function delta(now, then, good, unit = '', short = false) {
  if (now == null || then == null) return '<span class="muted">vor 4 Wo –</span>';
  const dv = now - then, up = dv > 0;
  const ok = Math.abs(dv) < 1e-9 ? null : (up ? good > 0 : good < 0);
  const col = ok == null ? 'var(--t4)' : ok ? 'var(--ok)' : 'var(--warn)';
  return `<span style="color:${col}">${up ? '↑' : dv < 0 ? '↓' : '→'} ${n1(Math.abs(dv))}${unit}</span>${short ? '' : ' <span class="muted">vs. vor 4 Wo</span>'}`;
}

// Benannte Teilreihe in einer Karte: Label in Linienfarbe, Wert, Δ.
const lab = (txt, col) => `<span style="color:${col}">${txt}</span>`;
function sRow(name, col, val, dlt, svg) {
  return `<div class="t-sl">${lab('● ' + name, col)} <b>${val}</b><span class="t-sd">${dlt}</span></div>${svg}`;
}

function tCard(title, value, sub, dlt, svg, hint) {
  return `<div class="card t-card">
    <div class="t-hd"><span class="lbl">${title}</span><span class="t-d">${dlt}</span></div>
    <div class="t-v"><span class="big">${value}</span><span class="muted">${sub}</span></div>
    ${svg}
    ${hint ? `<div class="ez-hint">${hint}</div>` : ''}</div>`;
}

const dnum = dt => Math.round(dt.getTime() / 86400000);
function atOrBefore(pts, x) { let r = null; pts.forEach(p => { if (p.x <= x) r = p; }); return r; }

function renderTrend() {
  const page = $('#page-trend');
  if (hToken() && !HEALTH.file && !HEALTH.loading) {
    HEALTH.loading = true;
    ghFile().then(f => { HEALTH.file = f.data; HEALTH.sha = f.sha; }, () => {})
            .finally(() => { HEALTH.loading = false; if (curPage === 'trend') renderTrend(); });
  }
  const now = dnum(today()), x0 = now - TCFG.weeks * 7, cmp = now - TCFG.compareDays;
  const cards = [];

  // Fitness (CTL)
  const m = loadModel().map(r => ({ x: dnum(d(r.date)), y: r.ctl, tsb: r.tsb })).filter(p => p.x >= x0);
  const mNow = m[m.length - 1], mThen = atOrBefore(m, cmp);
  cards.push(tCard('FITNESS (CTL)', mNow ? Math.round(mNow.y) : '–', mNow ? `Form ${mNow.tsb > 0 ? '+' : ''}${Math.round(mNow.tsb)}` : '',
    delta(mNow && mNow.y, mThen && mThen.y, +1), spark(m, { col: CSSVAR('--accent'), x0, x1: now }), 'CTL ↑ = fitter · Form > 0 = frisch'));

  // Rad-Stunden je Woche, Soll als Strich
  const weeks = [...Array(TCFG.weeks).keys()].map(i => weekState(addDays(mondayOf(today()), -7 * (TCFG.weeks - 1 - i))));
  const wb = weeks.map(w => ({ x: dnum(w.mon), y: w.ist / 60, col: w.hasSoll && w.ist < w.soll - WCFG.onTrackMin ? CSSVAR('--warn') : CSSVAR('--ok') }));
  const wm = weeks.filter(w => w.hasSoll).map(w => ({ x: dnum(w.mon), y: w.soll / 60 }));
  const last4 = weeks.slice(-5, -1), prev4 = weeks.slice(-9, -5);
  const avgH = ws => ws.length ? ws.reduce((s, w) => s + w.ist, 0) / ws.length / 60 : null;
  const wTss = w => DATA.acts.filter(a => { const x = dnum(d(a.date)) - dnum(w.mon); return x >= 0 && x < 7; }).reduce((t, a) => t + (tssOf(a) || 0), 0);
  const tb = weeks.map(w => ({ x: dnum(w.mon), y: wTss(w) }));
  const avgT = ws => ws.length ? ws.reduce((t, w) => t + wTss(w), 0) / ws.length : null;
  const hNow = weeks[weeks.length - 1].ist / 60, tNowW = tb[tb.length - 1].y, sh = TCFG.smallHeight;
  cards.push(tCard('RAD JE WOCHE', n1(hNow) + ' h', `diese Woche · TSS ${Math.round(tNowW)}`, '',
    sRow('Zeit', CSSVAR('--ok'), n1(hNow) + ' h', delta(avgH(last4), avgH(prev4), +1, ' h', true),
      spark(wb, { bars: true, marks: wm, lo: 0, hi: Math.max(1, ...wb.map(p => p.y), ...wm.map(p => p.y)), h: sh })) +
    sRow('TSS', TCFG.tssCol, Math.round(tNowW), delta(avgT(last4), avgT(prev4), +1, '', true),
      spark(tb.map(p => ({ ...p, col: TCFG.tssCol })), { bars: true, lo: 0, h: sh })),
    'Strich = Soll · TSS = Zeit × Intensität² · Δ = Ø 4 Wo'));

  const E = HEALTH.file ? HEALTH.file.entries : null;
  if (E) {
    // Gewicht
    const wpts = Object.keys(E).sort().filter(k => E[k].weight != null).map(k => ({ x: dnum(d(k)), y: E[k].weight }));
    const tr = hTrend(wpts, CFG.health.weight.tau);
    const tNow = tr[tr.length - 1], tThen = atOrBefore(tr, cmp), goal = HEALTH.file.goals.kg;
    cards.push(tCard('GEWICHT', tNow ? n1(tNow.y) : '–', tNow ? `kg Trend${goal ? ' · Ziel ' + n1(goal) : ''}` : 'kg',
      delta(tNow && tNow.y, tThen && tThen.y, -1, ' kg'), spark(tr.filter(p => p.x >= x0), { col: CSSVAR('--warn'), dots: wpts.filter(p => p.x >= x0), x0, x1: now, ref: goal }),
      'Trend 10 d · ↓ = Richtung Ziel'));

    // Rücken: Wochenschnitt
    const bw = weeks.map(w => {
      const v = [...Array(7).keys()].map(i => E[iso(addDays(w.mon, i))]).filter(e => e && e.back != null).map(e => e.back);
      return v.length ? { x: dnum(w.mon), y: v.reduce((a, b) => a + b, 0) / v.length } : null;
    }).filter(Boolean).map(p => ({ ...p, col: p.y >= CFG.health.back.bad ? CSSVAR('--err') : p.y >= CFG.health.back.warn ? CSSVAR('--warn') : CSSVAR('--ok') }));
    const bAvg = (a, b) => { const v = Object.keys(E).filter(k => dnum(d(k)) > a && dnum(d(k)) <= b && E[k].back != null).map(k => E[k].back); return v.length ? v.reduce((p, q) => p + q, 0) / v.length : null; };
    cards.push(tCard('RÜCKEN', n1(bAvg(now - 7, now)), 'Ø 7 Tage · 0–10', delta(bAvg(now - 7, now), bAvg(cmp - 7, cmp), -1),
      spark(bw, { bars: true, lo: 0, hi: 10 }), 'Wochenschnitt · ↓ = besser'));

    // Routine-Quote: erledigte Haken / fällige Haken je Woche
    const rq = weeks.map(w => {
      const c = Object.values(w.habits).reduce((a, h) => ({ done: a.done + h.done, due: a.due + h.due }), { done: 0, due: 0 });
      return c.due ? { x: dnum(w.mon), y: c.done / c.due * 100 } : null;
    }).filter(Boolean);
    const rNow = rq[rq.length - 1], rThen = atOrBefore(rq, cmp);
    cards.push(tCard('ROUTINE', rNow ? Math.round(rNow.y) + ' %' : '–', 'Haken erledigt, diese Woche',
      delta(rNow && rNow.y, rThen && rThen.y, +1, ' %'), spark(rq.map(p => ({ ...p, col: CSSVAR('--ok') })), { bars: true, lo: 0, hi: 100 }),
      'Meditation · Physio · Kraft · Yoga'));
  } else {
    cards.push(`<div class="card t-card"><div class="lbl">GEWICHT · RÜCKEN · ROUTINE</div><div class="ez-hint">${hToken() ? 'lade Check-in …' : 'Check-in auf diesem Gerät verbinden (Tab Check-in)'}</div></div>`);
  }

  // Erholung: HRV und Ruhepuls, 7-Tage-Mittel
  const H = DATA.health.slice().reverse();
  const roll = key => H.map((r, i) => {
    const w = H.slice(Math.max(0, i - 6), i + 1).map(x => x[key]).filter(v => v != null);
    return w.length ? { x: dnum(d(r.date)), y: w.reduce((a, b) => a + b, 0) / w.length } : null;
  }).filter(p => p && p.x >= x0);
  const rec = [
    { key: 'hrv',        name: 'HRV',      unit: ' ms',  good: +1, col: TCFG.hrvCol,    f: v => Math.round(v) },
    { key: 'resting_hr', name: 'Ruhepuls', unit: ' bpm', good: -1, col: TCFG.rhrCol,    f: v => Math.round(v) },
    { key: 'sleep_h',    name: 'Schlaf',   unit: ' h',   good: +1, col: TCFG.sleepCol,  f: n1 },
    { key: 'stress_avg', name: 'Stress',   unit: '',     good: -1, col: TCFG.stressCol, f: v => Math.round(v) },
  ].map(k => { const p = roll(k.key); return { ...k, p, now: p[p.length - 1], then: atOrBefore(p, cmp) }; });
  const hv = rec[0].now;
  cards.push(tCard('ERHOLUNG', hv ? lab(Math.round(hv.y) + ' ms', TCFG.hrvCol) : '–', 'HRV · Ø 7 Tage', '',
    rec.map(k => sRow(k.name, k.col, k.now ? k.f(k.now.y) + k.unit : '–', delta(k.now && k.now.y, k.then && k.then.y, k.good, k.unit, true),
      spark(k.p, { col: k.col, x0, x1: now, h: TCFG.smallHeight }))).join(''),
    'HRV ↑ · Ruhepuls ↓ · Schlaf ↑ · Stress ↓ = erholt · Pfeil = Δ vs. vor 4 Wo, grün = gut'));

  page.innerHTML = `
    <div class="t-grid">${cards.join('')}</div>
    <div class="grid2">${goalCard()}${profileNowCard()}</div>
    <div class="card">
      <div class="card-hd"><span class="t">AEROBE FORM (EF)</span>
        <span class="s">EF = NP / Ø-HF · ↑ = besser · ab ${CFG.ui.efTrend.minDurMin} min</span></div>
      <div id="ef-box"></div>
    </div>`;
  renderEF();
}

function goalCard() {
  const goal = CFG.athlete.ftpGoal, goalDate = CFG.athlete.ftpGoalDate, tp = testPoints();
  const latest = tp.length ? tp[tp.length - 1] : null;
  const next = CFG.plan.events.filter(e => e.type === 'test' && d(e.date) >= today()).sort((a, b) => a.date < b.date ? -1 : 1)[0];
  return `<div class="card">
    <div class="card-hd"><span class="t">WEG ZU ${goal} W</span>
      <span class="s">${latest ? `zuletzt <b>${latest.ftp} W</b> (${fmtDay(d(latest.date))}) · noch ${Math.max(0, goal - latest.ftp)} W` : ''} · ${dayDiff(d(goalDate), today())} Tage bis ${fmtDay(d(goalDate))}</span></div>
    ${testTimeline(tp, goal, goalDate)}
    <div class="ez-hint">${next ? `Nächste Rampe ${fmtDay(d(next.date))} · ` : ''}△ Rampe · leerer △ = geplant</div>
  </div>`;
}

// Leistungsprofil seit Neustart gegen Bestwert seit Trainingsstart: zeigt
// Fortschritt statt "veraltet".
function profileNowCard() {
  const tp = CFG.plan.templatePhases || [];
  const from = tp.length ? d(tp[0].from) : today();
  const best = (key, since) => DATA.acts.reduce((b, a) => {
    const v = a.power_curve && a.power_curve[key];
    return v && d(a.date) >= since && v > (b ? b.w : 0) ? { w: v, date: a.date } : b;
  }, null);
  const rows = CFG.profile.anchors.map(an => {
    const n = best(an.key, from), all = best(an.key, d(CFG.profile.since));
    const pct = n && all ? Math.min(100, n.w / all.w * 100) : 0;
    return `<div class="t-prow"><span class="lbl" style="margin:0">${an.label || an.key}</span>
      <div class="w-bar"><div class="w-fill" style="width:${pct}%;background:var(--accent)"></div></div>
      <span><b>${n ? n.w : '–'}</b> / ${all ? all.w : '–'} W</span></div>`;
  }).join('');
  return `<div class="card">
    <div class="card-hd"><span class="t">LEISTUNG SEIT NEUSTART</span><span class="s">seit ${fmtDay(from)} / Bestwert seit ${fmtDay(d(CFG.profile.since))}</span></div>
    ${rows}
    <div class="ez-hint" style="margin-top:6px">Balken = Anteil am Bestwert · füllt sich mit der Form</div>
  </div>`;
}
