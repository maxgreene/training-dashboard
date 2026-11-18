/* week.js — Woche (neue Startseite).
 *
 * Beantwortet drei Fragen auf einen Blick:
 *   Genug gefahren?   Rad-Soll (Minuten aus CFG.plan.units[].min) gegen Ist
 *   Dran geblieben?   Plan je Tag gegen erledigt (Rad automatisch, Kraft/Yoga/
 *                     Physio/Meditation aus dem Check-in, health.js)
 *   Was jetzt?        Ampel heute plus Empfehlung für den Rest der Woche
 *
 * Check-in-Haken am Tag D stehen im Eintrag von D+1 (morgens für gestern).
 */
const WCFG = CFG.week;

const minOfDay = dt => DATA.acts.filter(a => a.date === iso(dt))
                                .reduce((s, a) => s + (a.moving_sec || 0), 0) / 60;
const hFmt = m => (m / 60).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const weekIdxOf = dt => Math.floor(dayDiff(mondayOf(dt), mondayOf(d(CFG.plan.start))) / 7);
const habitLbl = k => (CFG.health.habits.find(h => h.key === k) || { lbl: k }).lbl;

// Wochen vor dem ersten templatePhases-Start hatten keine Soll-Minuten.
const sollFrom = () => {
  const tp = CFG.plan.templatePhases || [];
  return tp.length ? mondayOf(d(tp[0].from)) : null;
};

// Geplante Einheiten eines Tages, flach: {title, desc, min, habit}.
function dayItems(dt) {
  const p = plannedFor(dt, weekIdxOf(dt));
  if (!p) return [];
  if (p.source === 'event') return [{ title: p.title, desc: p.desc, min: p.min || 0, habit: null, ev: p.type }];
  return p.parts.filter(x => x.type !== 'rest')
                .map(x => ({ title: x.title, desc: x.desc, min: x.min || 0, habit: x.habit || null, type: x.type }));
}

// Check-in-Haken, die AM Tag dt erledigt wurden (stehen im Eintrag von dt+1).
function habitsOn(dt) {
  const E = HEALTH.file && HEALTH.file.entries;
  if (!E) return null;
  const e = E[iso(addDays(dt, 1))];
  return e ? (e.habits || {}) : undefined;     // undefined = noch kein Check-in
}

function dayState(dt) {
  const items = dayItems(dt), t0 = today();
  const past = dt < t0, isToday = +dt === +t0;
  const soll = items.filter(i => !i.habit).reduce((s, i) => s + i.min, 0);
  const ist = minOfDay(dt);
  const hb = habitsOn(dt);
  const st = done => done ? 'done' : past ? (hb === undefined ? 'unk' : 'miss') : 'open';
  const rad = soll > 0 ? (ist >= WCFG.doneFrac * soll ? 'done' : past ? 'miss' : isToday && ist > 0 ? 'part' : 'open')
                       : (ist > 0 ? 'bonus' : null);
  const hab = items.filter(i => i.habit).map(i => ({ ...i, st: st(hb && hb[i.habit]) }));
  const daily = WCFG.daily.map(k => ({ key: k, st: st(hb && hb[k]) }));
  return { dt, items, soll, ist, rad, hab, daily, past, isToday, hb };
}

function weekState(mon) {
  const days = [...Array(7).keys()].map(i => dayState(addDays(mon, i)));
  const t0 = today();
  const soll = days.reduce((s, x) => s + x.soll, 0);
  const ist = days.reduce((s, x) => s + x.ist, 0);
  const due = days.filter(x => x.dt < t0).reduce((s, x) => s + x.soll, 0);
  const count = (arr, key) => {
    const all = days.flatMap(x => arr(x)).filter(h => !key || h.habit === key || h.key === key);
    // fällig = schon entscheidbar (erledigt oder verpasst); ohne Check-in zählt nicht.
    return { plan: all.length, done: all.filter(h => h.st === 'done').length,
             due: all.filter(h => h.st === 'done' || h.st === 'miss').length };
  };
  const habits = {};
  [...new Set(days.flatMap(x => x.hab.map(h => h.habit)))].forEach(k => habits[k] = count(x => x.hab, k));
  WCFG.daily.forEach(k => habits[k] = count(x => x.daily, k));
  const sf = sollFrom();
  return { mon, days, soll, ist, due, habits, hasSoll: !!sf && mon >= sf };
}

// Ampel aus Garmin-Health (gleiche Regeln wie das Heute-Feld).
function readiness() {
  const h = DATA.health[0] || {};
  const age = h.date ? dayDiff(today(), d(h.date)) : Infinity;
  if (age >= CFG.ui.status.healthWarnDays) return { level: 'grau', flags: ['keine Garmin-Daten seit ' + (h.date ? fmtDay(d(h.date)) : '–') + ', Uhr syncen'] };
  const hrvB = baseline('hrv', 42), rhrB = baseline('resting_hr', 42), flags = [];
  if (hrvB != null && h.hrv != null && h.hrv < hrvB - 5) flags.push('HRV unter Basis');
  if (rhrB != null && h.resting_hr != null && h.resting_hr > rhrB + 3) flags.push('Ruhepuls erhöht');
  if (h.sleep_h != null && h.sleep_h < 6.5) flags.push('kurzer Schlaf');
  if (/LOW|POOR|UNBALANCED/i.test(h.hrv_status || '')) flags.push('HRV-Status ' + h.hrv_status);
  const level = (flags.length >= 2 || /LOW|POOR/i.test(h.hrv_status || '')) ? 'rot' : flags.length ? 'gelb' : 'grün';
  return { level, flags };
}

function back7() {
  const E = HEALTH.file && HEALTH.file.entries;
  if (!E) return null;
  const v = Object.keys(E).sort().slice(-7).map(k => E[k].back).filter(x => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

function advice(W, R) {
  const out = [], t0 = today(), b7 = back7();
  const rest = W.days.filter(x => x.dt >= t0);
  const todayD = W.days.find(x => x.isToday);
  const bodyFirst = R.level === 'rot' || (b7 != null && b7 >= WCFG.backBad);

  if (bodyFirst) out.push(['rot', `Körper vor Plan · heute frei oder 30 min Z1${b7 != null && b7 >= WCFG.backBad ? ' · Rücken Ø ' + b7.toFixed(1) : ''}`]);
  else if (todayD) {
    const t = todayD.items.map(i => i.title).join(' + ') || 'frei';
    out.push([R.level, `Heute: ${t}${R.flags.length ? ' · ' + R.flags.join(', ') : ''}${R.level === 'gelb' ? ' · lieber kürzer' : ''}`]);
  }

  if (W.soll > 0) {
    const behind = W.due - W.ist;
    if (W.ist >= W.soll) out.push(['grün', 'Rad-Soll erreicht ✓ · Rest der Woche frei oder locker']);
    else if (behind <= WCFG.onTrackMin) out.push(['grün', `Im Plan · noch ${hFmt(W.soll - W.ist)} h bis Sonntag`]);
    else if (bodyFirst) out.push(['gelb', `${hFmt(behind)} h hinter Plan · nicht nachholen, erst erholen`]);
    else {
      // Nachholen an der nächsten geplanten Einheit mit Spielraum: lang vor Rolle.
      const cand = rest.filter(x => x.items.some(i => !i.habit && i.min >= 45))
                       .sort((a, b) => Math.max(...b.items.map(i => i.min)) - Math.max(...a.items.map(i => i.min)))[0];
      const plus = Math.min(Math.round(behind / 5) * 5, WCFG.extraMaxMin);
      out.push(['gelb', `${hFmt(behind)} h hinter Plan` + (cand
        ? ` · Vorschlag: ${dowOf(cand.dt)} ${cand.items.find(i => i.min >= 45).title.split(' ')[0]} +${plus} min`
        : ' · in dieser Woche kein Platz mehr, nicht hetzen')]);
    }
  }

  Object.entries(W.habits).forEach(([k, c]) => {
    if (WCFG.daily.includes(k) || !c.plan) return;
    const left = rest.filter(x => x.hab.some(h => h.habit === k && h.st === 'open'));
    if (c.done < c.due && left.length) out.push(['gelb', `${habitLbl(k)} ${c.done}/${c.plan} · ${left.map(x => dowOf(x.dt)).join(', ')} nicht auslassen`]);
  });
  return out;
}

// ── Zeichnen ────────────────────────────────────────────────────────────────
const ICON = { done: '✓', miss: '✗', unk: '?', open: '○', part: '◐', bonus: '+' };
const ICOL = { done: 'var(--ok)', miss: 'var(--err)', unk: 'var(--t4)', open: 'var(--t5)', part: 'var(--warn)', bonus: 'var(--accent)' };
const LCOL = { 'grün': 'var(--ok)', gelb: 'var(--warn)', rot: 'var(--err)', grau: 'var(--t4)' };
const ico = s => `<span class="w-ico" style="color:${ICOL[s]}">${ICON[s]}</span>`;

function sollBar(ist, soll, due) {
  const pct = v => Math.min(100, soll ? v / soll * 100 : 0);
  const col = ist >= due - WCFG.onTrackMin ? 'var(--ok)' : 'var(--warn)';
  return `<div class="w-bar"><div class="w-fill" style="width:${pct(ist)}%;background:${col}"></div>
    ${due > 0 && due < soll ? `<div class="w-mark" style="left:${pct(due)}%" title="Soll bis gestern"></div>` : ''}</div>`;
}

function habitRow(W) {
  const keys = Object.keys(W.habits).filter(k => W.habits[k].plan);
  if (!HEALTH.file) return `<div class="ez-hint">Kraft · Yoga · Physio · Meditation: ${hToken() ? 'lade Check-in …' : 'Check-in auf diesem Gerät verbinden (Tab Check-in)'}</div>`;
  return `<div class="w-habits">${keys.map(k => {
    const c = W.habits[k];
    return `<div><b style="color:${c.done >= c.due && c.due ? 'var(--ok)' : 'var(--t1)'}">${c.done}/${c.plan}</b>${habitLbl(k)}</div>`;
  }).join('')}</div>`;
}

function dayRow(x) {
  const radTxt = x.soll || x.ist ? `${x.rad ? ico(x.rad) : ''} Rad <b>${Math.round(x.ist)}</b>${x.soll ? '/' + x.soll : ''} min` : '';
  const items = x.items.filter(i => !i.habit).map(i => i.title).join(' + ');
  const habs = x.hab.map(h => `${ico(HEALTH.file ? h.st : 'unk')} ${habitLbl(h.habit)}`).join(' ');
  const daily = HEALTH.file ? x.daily.map(h => `<span title="${habitLbl(h.key)}" style="color:${ICOL[h.st]}">${h.key === 'meditation' ? 'M' : 'P'}</span>`).join('') : '';
  return `<div class="w-day${x.isToday ? ' today' : ''}${x.past ? ' past' : ''}">
    <div class="w-dhd"><b>${dowOf(x.dt)}</b> <span>${fmtDay(x.dt)}</span></div>
    <div class="w-dbody">
      <div class="w-plan">${items || (x.hab.length ? '' : '<span class="muted">frei</span>')}</div>
      <div class="w-stat">${radTxt} ${habs}</div>
    </div>
    <div class="w-daily">${daily}</div>
  </div>`;
}

function renderWeek() {
  const page = $('#page-week');
  if (hToken() && !HEALTH.file && !HEALTH.loading) {
    HEALTH.loading = true;
    ghFile().then(f => { HEALTH.file = f.data; HEALTH.sha = f.sha; }, () => {})
            .finally(() => { HEALTH.loading = false; if (curPage === 'week') renderWeek(); });
  }
  const mon = mondayOf(today());
  const W = weekState(mon), R = readiness();
  const ph = weekPhase(weekIdxOf(mon), mon);
  const adv = advice(W, R);
  const next = [...Array(7).keys()].map(i => addDays(mon, 7 + i));
  const past = [...Array(WCFG.pastWeeks).keys()].map(i => weekState(addDays(mon, -7 * (i + 1))));

  page.innerHTML = `
    <div class="grid2">
      <div>
        <div class="card">
          <div class="card-hd"><span class="t">DIESE WOCHE</span><span class="s">KW ${kwOf(mon)}${ph.label ? ' · ' + ph.label : ''}</span></div>
          <div class="w-big"><span class="big">${hFmt(W.ist)}</span><span class="w-of">/ ${hFmt(W.soll)} h Rad</span></div>
          ${sollBar(W.ist, W.soll, W.due)}
          <div class="ez-hint" style="margin:6px 0 14px">Soll bis gestern ${hFmt(W.due)} h · Strich = da solltest du stehen</div>
          ${habitRow(W)}
        </div>
        <div class="card">
          <div class="card-hd"><span class="t">WAS JETZT</span></div>
          ${adv.map(([lv, t]) => `<div class="w-adv"><span class="dot" style="background:${LCOL[lv] || 'var(--t4)'}"></span><span>${t}</span></div>`).join('')}
        </div>
      </div>
      <div class="card">
        <div class="card-hd"><span class="t">TAGE</span><span class="s">✓ erledigt · ✗ verpasst · ○ offen · ? Check-in fehlt · M/P = Meditation/Physio</span></div>
        <div class="w-days">${W.days.map(dayRow).join('')}</div>
      </div>
    </div>
    <div class="grid2">
      <div class="card">
        <div class="card-hd"><span class="t">NÄCHSTE WOCHE</span><span class="s">KW ${kwOf(next[0])} · Soll ${hFmt(next.reduce((s, dt) => s + dayItems(dt).filter(i => !i.habit).reduce((a, i) => a + i.min, 0), 0))} h Rad</span></div>
        ${next.map(dt => `<div class="w-next"><b>${dowOf(dt)}</b><span>${dayItems(dt).map(i => i.title).join(' + ') || '<span class="muted">frei</span>'}</span></div>`).join('')}
      </div>
      <div class="card">
        <div class="card-hd"><span class="t">LETZTE WOCHEN</span><span class="s">Rad Ist/Soll · Haken erledigt/geplant</span></div>
        ${past.map(w => {
          const hs = Object.entries(w.habits).filter(([, c]) => c.plan && HEALTH.file)
                       .map(([k, c]) => `${habitLbl(k)} ${c.done}/${c.plan}`).join(' · ');
          return `<div class="w-past"><b>KW ${kwOf(w.mon)}</b>
            <span>Rad <b>${hFmt(w.ist)}</b>${w.hasSoll ? ' / ' + hFmt(w.soll) : ''} h</span>
            <span class="muted">${w.hasSoll ? hs : ''}</span></div>`;
        }).join('')}
      </div>
    </div>`;
}
