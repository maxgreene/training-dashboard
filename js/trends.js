/* trends.js — Verlauf: geht es aufwärts?
 *
 * Kompakte Trendkarten, jede mit Wert jetzt und Änderung gegen "vor 4 Wochen"
 * (CFG.trend.compareDays), Pfeil grün wenn in die gute Richtung. Dazu der Weg
 * zum FTP-Ziel und der EF-Trend (renderEF aus rides.js, eine Quelle).
 */
const TCFG = CFG.trend;
const n1 = v => v == null ? '–' : v.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// Sparkline als SVG. pts: [{x (Tag), y}], bars: Balken statt Linie.
// o.lines: weitere Linien [{pts, col}] auf derselben Skala, o.band: [{x, lo, hi}]
// Min-Max-Band, o.ref (+ o.refLabel): gestrichelte Referenz, o.maxLabel: Wert oben links.
function spark(pts, o = {}) {
  const W = 300, H = o.h || TCFG.height, P = 4;
  if (!pts.length) return '<div class="ez-hint">noch keine Daten</div>';
  const all = pts.concat(...(o.lines || []).map(l => l.pts));
  const xs = all.map(p => p.x);
  const ys = all.map(p => p.y).concat(o.ref != null ? [o.ref] : [], (o.marks || []).map(p => p.y),
    ...(o.band || []).map(b => [b.lo, b.hi]));
  const x0 = o.x0 ?? Math.min(...xs), x1 = o.x1 ?? Math.max(...xs);
  let lo = o.lo ?? Math.min(...ys), hi = o.hi ?? Math.max(...ys);
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const X = x => P + (x - x0) / Math.max(1, x1 - x0) * (W - 2 * P);
  const Y = y => H - P - (y - lo) / (hi - lo) * (H - 2 * P);
  const line = (q, col) => `<polyline fill="none" stroke="${col}" stroke-width="2" points="${q.map(p => X(p.x).toFixed(1) + ',' + Y(p.y).toFixed(1)).join(' ')}"/>`
    + `<circle cx="${X(q[q.length - 1].x)}" cy="${Y(q[q.length - 1].y)}" r="3.5" fill="${col}"/>`;
  let s = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="t-spark" style="height:${H}px">`;
  if (o.band && o.band.length) {
    const up = o.band.map(b => X(b.x).toFixed(1) + ',' + Y(b.hi).toFixed(1));
    const dn = o.band.slice().reverse().map(b => X(b.x).toFixed(1) + ',' + Y(b.lo).toFixed(1));
    s += `<polygon points="${up.concat(dn).join(' ')}" fill="${o.bandCol || o.col}" opacity="${o.bandOp || .16}"/>`;
  }
  if (o.ref != null) s += `<line x1="${P}" x2="${W - P}" y1="${Y(o.ref)}" y2="${Y(o.ref)}" stroke="${o.refCol || 'var(--t4)'}" stroke-dasharray="4 3"/>`;
  if (o.bars) {
    const bw = Math.max(3, (W - 2 * P) / Math.max(1, (x1 - x0) / 7 + 1) - 4), base = Y(Math.max(lo, 0));
    pts.forEach(p => s += `<rect x="${X(p.x) - bw / 2}" y="${Math.min(base, Y(p.y))}" width="${bw}" height="${Math.max(1, Math.abs(base - Y(p.y)))}" rx="1.5" fill="${p.col || o.col}" opacity="${p.op ?? 1}"/>`);
    (o.marks || []).forEach(p => s += `<line x1="${X(p.x) - bw / 2 - 1}" x2="${X(p.x) + bw / 2 + 1}" y1="${Y(p.y)}" y2="${Y(p.y)}" stroke="var(--t1)" stroke-width="2"/>`);
  } else {
    if (o.dots) o.dots.forEach(p => s += `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="2" fill="${o.col}" opacity=".45"/>`);
    (o.lines || []).forEach(l => { if (l.pts.length) s += line(l.pts, l.col); });
    s += line(pts, o.col);
  }
  s += '</svg>';
  // Beschriftungen als HTML über dem SVG (SVG ist verzerrt, Text darin auch)
  // Max-Wert steht in einem eigenen Streifen über der Grafik, damit er nichts verdeckt.
  const top = o.maxLabel != null && o.maxLabel !== '' ? 12 : 0, tags = [];
  if (top) tags.push(`<span class="t-tag" style="top:0;left:0">max ${o.maxLabel}</span>`);
  if (o.refLabel) tags.push(`<span class="t-tag" style="top:${Math.max(0, top + Y(o.ref) - 13).toFixed(0)}px;right:0">${o.refLabel}</span>`);
  return tags.length ? `<div class="t-wrap" style="padding-top:${top}px">${s}${tags.join('')}</div>` : s;
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
function sRow(name, col, val, dlt, svg, extra = '') {
  return `<div class="t-sl">${lab('● ' + name, col)} <b>${val}</b>${extra}<span class="t-sd">${dlt}</span></div>${svg}`;
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
  const sh = TCFG.smallHeight;
  const cards = [];

  // Fitness: CTL und ATL in einer Grafik, Form (TSB) darunter
  const mAll = loadModel().map(r => ({ x: dnum(d(r.date)), y: r.ctl, atl: r.atl, tsb: r.tsb }));
  const m = mAll.filter(p => p.x >= x0);
  const mNow = m[m.length - 1], mThen = atOrBefore(m, cmp);
  const sg = v => (v > 0 ? '+' : '') + Math.round(v);
  // CTL-Zielkorridor (CFG.plan.ctlCorridor), Karte reicht aheadDays in die Zukunft
  const xF = now + TCFG.aheadDays, cc = (CFG.plan.ctlCorridor || []).map(c => ({ x: dnum(d(c.date)), lo: c.lo, hi: c.hi }));
  const ccAt = x => {
    for (let i = 1; i < cc.length; i++) if (x >= cc[i - 1].x && x <= cc[i].x) {
      const f = (x - cc[i - 1].x) / Math.max(1, cc[i].x - cc[i - 1].x);
      return { x, lo: cc[i - 1].lo + f * (cc[i].lo - cc[i - 1].lo), hi: cc[i - 1].hi + f * (cc[i].hi - cc[i - 1].hi) };
    }
    return null;
  };
  const band = [...Array(xF - x0 + 1).keys()].map(i => ccAt(x0 + i)).filter(Boolean);
  const cNow = mNow && ccAt(now);
  const cTxt = !cNow ? '' : mNow.y < cNow.lo ? ' · <span style="color:var(--warn)">unter Korridor</span>'
    : mNow.y > cNow.hi ? ' · <span style="color:var(--warn)">über Korridor</span>' : ' · <span style="color:var(--ok)">im Korridor</span>';
  cards.push(tCard('FITNESS', mNow ? Math.round(mNow.y) : '–', mNow ? `CTL · Form ${sg(mNow.tsb)}${cTxt}` : '', '',
    sRow('CTL', TCFG.ctlCol, mNow ? Math.round(mNow.y) : '–', delta(mNow && mNow.y, mThen && mThen.y, +1, '', true),
      spark(m, { col: TCFG.ctlCol, lines: [{ pts: m.map(p => ({ x: p.x, y: p.atl })), col: TCFG.atlCol }], band, bandCol: CSSVAR('--ok'), bandOp: .2, x0, x1: band.length ? xF : now, h: sh }),
      ' ' + lab('● ATL', TCFG.atlCol) + ` <b>${mNow ? Math.round(mNow.atl) : '–'}</b>`) +
    sRow('Form (TSB)', TCFG.tsbCol, mNow ? sg(mNow.tsb) : '–', '',
      spark(m.map(p => ({ x: p.x, y: p.tsb })), { col: TCFG.tsbCol, ref: 0, x0, x1: band.length ? xF : now, h: sh })),
    'grünes Band = CTL-Ziel · CTL 42 d = Fitness · ATL 7 d = Ermüdung · TSB = CTL − ATL · TSB ↑ = frisch'));

  // Rad-Stunden je Woche, Soll als Strich
  const weeks = [...Array(TCFG.weeks).keys()].map(i => weekState(addDays(mondayOf(today()), -7 * (TCFG.weeks - 1 - i))));
  const cur = weeks.length - 1;   // laufende Woche: blasser, ist noch nicht fertig
  const wb = weeks.map((w, i) => ({ x: dnum(w.mon), y: w.ist / 60, op: i === cur ? .55 : 1,
    col: w.hasSoll && i < cur && w.ist < w.soll - WCFG.onTrackMin ? CSSVAR('--warn') : CSSVAR('--ok') }));
  const wm = weeks.filter(w => w.hasSoll).map(w => ({ x: dnum(w.mon), y: w.soll / 60 }));
  const last4 = weeks.slice(-5, -1), prev4 = weeks.slice(-9, -5);
  const avgH = ws => ws.length ? ws.reduce((s, w) => s + w.ist, 0) / ws.length / 60 : null;
  const wTss = w => DATA.acts.filter(a => { const x = dnum(d(a.date)) - dnum(w.mon); return x >= 0 && x < 7; }).reduce((t, a) => t + (tssOf(a) || 0), 0);
  const tb = weeks.map((w, i) => ({ x: dnum(w.mon), y: wTss(w), col: TCFG.tssCol, op: i === cur ? .55 : 1 }));
  const avgT = ws => ws.length ? ws.reduce((t, w) => t + wTss(w), 0) / ws.length : null;
  const W0 = weeks[cur], hNow = W0.ist / 60, tNowW = tb[cur].y;
  const hold = mNow ? Math.round(7 * mNow.y) : null;   // TSS je Woche, bei dem CTL gleich bleibt
  const hMax = Math.max(1, ...wb.map(p => p.y), ...wm.map(p => p.y)), tMax = Math.max(hold || 0, ...tb.map(p => p.y));
  cards.push(tCard('RAD JE WOCHE', n1(hNow) + ' h', W0.hasSoll ? `von ${n1(W0.soll / 60)} h Soll · TSS ${Math.round(tNowW)}` : `diese Woche · TSS ${Math.round(tNowW)}`, '',
    sRow('Zeit', CSSVAR('--ok'), n1(hNow) + ' h', delta(avgH(last4), avgH(prev4), +1, ' h', true),
      spark(wb, { bars: true, marks: wm, lo: 0, hi: hMax * 1.08, h: sh, maxLabel: n1(hMax) + ' h' })) +
    sRow('TSS', TCFG.tssCol, Math.round(tNowW), delta(avgT(last4), avgT(prev4), +1, '', true),
      spark(tb, { bars: true, lo: 0, hi: tMax * 1.08, h: sh, maxLabel: Math.round(tMax), ref: hold, refLabel: hold ? `CTL halten ${hold}` : '' })),
    'Strich = Soll · gestrichelt = TSS, die CTL hält · TSS = Zeit × Intensität²'));

  cards.push('%%REC%%');
  let hNote = '';
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
    hNote = `<div class="ez-hint" style="margin:-4px 0 12px">Gewicht · Rücken · Routine: ${hToken() ? 'lade Check-in …' : 'Check-in auf diesem Gerät verbinden (Tab Check-in)'}</div>`;
  }

  // Erholung: HRV und Ruhepuls, 7-Tage-Mittel mit Min-Max-Band; Schlaf und Stress nur als Zahl
  const H = DATA.health.slice().reverse();
  const roll = key => H.map((r, i) => {
    const w = H.slice(Math.max(0, i - 6), i + 1).map(x => x[key]).filter(v => v != null);
    return w.length ? { x: dnum(d(r.date)), y: w.reduce((a, b) => a + b, 0) / w.length, lo: Math.min(...w), hi: Math.max(...w) } : null;
  }).filter(p => p && p.x >= x0);
  const rec = [
    { key: 'hrv',        name: 'HRV',      unit: ' ms',  good: +1, col: TCFG.hrvCol, f: v => Math.round(v) },
    { key: 'resting_hr', name: 'Ruhepuls', unit: ' bpm', good: -1, col: TCFG.rhrCol, f: v => Math.round(v) },
    { key: 'sleep_h',    name: 'Schlaf',   unit: ' h',   good: +1, f: n1 },
    { key: 'stress_avg', name: 'Stress',   unit: '',     good: -1, f: v => Math.round(v) },
  ].map(k => { const p = roll(k.key); return { ...k, p, now: p[p.length - 1], then: atOrBefore(p, cmp) }; });
  const kv = k => k.now ? k.f(k.now.y) + k.unit : '–', kd = k => delta(k.now && k.now.y, k.then && k.then.y, k.good, k.unit, true);
  const hv = rec[0].now;
  const recCard = tCard('ERHOLUNG', hv ? lab(Math.round(hv.y) + ' ms', TCFG.hrvCol) : '–', 'HRV · Ø 7 Tage', '',
    rec.slice(0, 2).map(k => sRow(k.name, k.col, kv(k), kd(k),
      spark(k.p, { col: k.col, band: k.p, x0, x1: now, h: sh, maxLabel: k.p.length ? k.f(Math.max(...k.p.map(q => q.hi))) : '' }))).join('') +
    `<div class="t-sl t-sx">${rec.slice(2).map(k => `<span>${k.name} <b>${kv(k)}</b> ${kd(k)}</span>`).join('')}</div>`,
    'Linie = Ø 7 d · Band = Min–Max · HRV ↑ · Ruhepuls ↓ = erholt');

  page.innerHTML = `
    <div class="t-grid">${cards.map(c => c === '%%REC%%' ? recCard : c).join('')}</div>${hNote}
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

// Leistungsprofil in W/kg: Bestwert der letzten 4 Wochen gegen Saisonbestwert.
// Gewicht aus dem Check-in-Trend (nur mit Token), sonst CFG.athlete.weight.
function kgNow() {
  const E = HEALTH.file && HEALTH.file.entries;
  if (E) {
    const w = Object.keys(E).sort().filter(k => E[k].weight != null).map(k => ({ x: dnum(d(k)), y: E[k].weight }));
    const t = hTrend(w, CFG.health.weight.tau);
    if (t.length) return { kg: t[t.length - 1].y, src: 'Check-in' };
  }
  return { kg: CFG.athlete.weight, src: 'Config' };
}
function profileNowCard() {
  const from = addDays(today(), -TCFG.compareDays), since = d(CFG.profile.since), K = kgNow();
  const best = (key, lo) => DATA.acts.reduce((b, a) => {
    const v = a.power_curve && a.power_curve[key];
    return v && d(a.date) >= lo && v > (b ? b.w : 0) ? { w: v, date: a.date } : b;
  }, null);
  const wkg = w => (w / K.kg).toFixed(1).replace('.', ',');
  const dur = k => +k < 60 ? k + ' s' : (+k / 60) + ' min';
  const rows = CFG.profile.anchors.map(an => {
    const n = best(an.key, from), all = best(an.key, since);
    const pct = n && all ? Math.min(100, n.w / all.w * 100) : 0;
    return `<div class="t-prow"><span class="lbl" style="margin:0">${an.label} <span class="muted">${dur(an.key)}</span></span>
      <div class="w-bar"><div class="w-fill" style="width:${pct}%;background:${an.col}"></div></div>
      <span><b>${n ? wkg(n.w) : '–'}</b> <span class="muted">/ ${all ? wkg(all.w) : '–'} W/kg</span></span></div>`;
  }).join('');
  return `<div class="card">
    <div class="card-hd"><span class="t">LEISTUNGSPROFIL</span><span class="s">W/kg bei ${n1(K.kg)} kg</span></div>
    ${rows}
    <div class="ez-hint" style="margin-top:6px">links = Bestwert ${TCFG.compareDays} d · rechts = Saisonbest seit ${fmtDay(since)} · Balken voll = Saisonform</div>
  </div>`;
}
