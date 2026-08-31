/* food.js — Ernaehrungs-Seite.
 *
 * Passiver Leser. Geschrieben wird ausschliesslich per scripts/nutri.py
 * ueber Claude Code. Diese Seite entschluesselt und zeichnet, mehr nicht.
 *
 * Der Chiffretext kommt direkt von raw.githubusercontent, nicht aus dem
 * Pages-Artefakt: Pages braucht nach einem Push bis zu ein paar Minuten,
 * raw ist sofort aktuell (dort steht cache-control: max-age=300, deshalb
 * der Zeitstempel-Parameter).
 */

/* Parameter kommen aus CFG.food (js/config.js). Die ZIELE nicht: die stehen
 * im Tresor (vault.goals), weil dieses Repo oeffentlich ist. */
const FCFG = CFG.food;
const MACRO = FCFG.macros;

const FOOD = { keys: null, vault: null, dek: null, view: 'day', charts: {} };

function foodBust() { return '?t=' + Date.now(); }

async function foodFetch(name) {
  const r = await fetch(FCFG.rawBase + name + foodBust(), { cache: 'no-store' });
  if (!r.ok) throw new Error(name + ': HTTP ' + r.status);
  return r.json();
}

function dayKey(isoTs) {
  const t = new Date(isoTs);
  t.setHours(t.getHours() - FCFG.dayCutoffH);
  return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0')
       + '-' + String(t.getDate()).padStart(2, '0');
}

function sumOf(entries) {
  const s = { kcal: 0, p: 0, k: 0, f: 0, b: 0, ml: 0 };
  entries.forEach(e => Object.keys(s).forEach(m => s[m] += e[m] || 0));
  return s;
}

function byDay(entries) {
  const m = new Map();
  entries.forEach(e => {
    const k = dayKey(e.ts);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(e);
  });
  return m;
}

// ── Entsperren ─────────────────────────────────────────────────────────────

function renderFood() {
  if (FOOD.vault) return drawFood();
  $('#page-food').innerHTML = `
    <div class="card" style="max-width:420px;margin:40px auto">
      <div class="card-hd"><span class="t">ERNÄHRUNG</span><span class="s">verschlüsselt</span></div>
      <div id="food-lock-msg" class="ez-hint" style="margin-bottom:14px">
        Das Logbuch liegt verschlüsselt im öffentlichen Repo. Zum Lesen wird
        der Schlüssel auf diesem Gerät abgeleitet.</div>
      <button class="tab on" id="food-btn-passkey" style="width:100%;padding:11px;margin-bottom:8px">
        Mit Passkey entsperren</button>
      <details style="margin-top:6px">
        <summary class="muted" style="cursor:pointer">Passphrase stattdessen</summary>
        <input type="password" id="food-pw" autocomplete="off"
               style="width:100%;margin-top:8px;padding:9px;background:var(--bg3);
                      border:1px solid var(--border2);border-radius:4px;color:var(--t1);font:inherit">
        <button class="tab" id="food-btn-pw" style="width:100%;padding:9px;margin-top:6px">Entsperren</button>
      </details>
      <div id="food-err" style="color:var(--err);font-size:11px;margin-top:10px"></div>
    </div>`;

  $('#food-btn-passkey').onclick = () => foodUnlock(k => Vault.unlockWithPasskey(k));
  $('#food-btn-pw').onclick = () => {
    const pw = $('#food-pw').value;
    if (!pw) return ($('#food-err').textContent = 'Passphrase eingeben.');
    foodUnlock(k => Vault.unlockWithPassphrase(k, pw));
  };
}

async function foodUnlock(deriver) {
  const err = $('#food-err');
  err.textContent = '';
  try {
    // Nur keys.json. Die Lebensmitteltabelle (BLS 4.0, 1,2 MB) braucht die
    // CLI beim Schreiben, nicht der Browser: in den Eintraegen stehen die
    // Naehrwerte schon ausgerechnet.
    if (!FOOD.keys) FOOD.keys = await foodFetch('keys.json');
    const dek = await deriver(FOOD.keys);
    const blob = await foodFetch('log.enc.json');
    FOOD.vault = await Vault.open(blob, dek);
    FOOD.dek = dek;
    drawFood();
  } catch (e) {
    err.textContent = e.message || String(e);
  }
}

// ── Zeichnen ───────────────────────────────────────────────────────────────

function drawFood() {
  const v = FOOD.view;
  $('#page-food').innerHTML = `
    <div class="card-hd" style="margin-bottom:10px">
      <span class="t">ERNÄHRUNG</span>
      <div class="tabs" style="margin-left:auto">
        ${['day', 'week', 'month'].map(x => `
          <button class="tab ${x === v ? 'on' : ''}" onclick="foodView('${x}')">
            ${{ day: 'Tag', week: 'Woche', month: 'Monat' }[x]}</button>`).join('')}
      </div>
    </div>
    <div id="food-body"></div>
    <div id="food-enroll"></div>`;
  ({ day: drawDay, week: drawWeek, month: drawMonth })[v]();
  enrollUI();
}

/* Passkey fuer DIESES Geraet anlegen. Apples PRF ist nur im Flow auf
 * demselben Geraet zuverlaessig, deshalb ein Wrap pro Geraet: iPhone am
 * iPhone, Laptop am Laptop. Der Browser kann nicht committen, also faellt
 * hier nur ein Block heraus, den `nutri.py add-wrap` ins Repo traegt. */
function enrollUI() {
  const box = $('#food-enroll');
  if (!box || !Vault.prfAvailable()) return;
  box.innerHTML = `
    <details class="card" style="margin-top:14px">
      <summary class="muted" style="cursor:pointer">Passkey für dieses Gerät</summary>
      <div class="ez-hint" style="margin:10px 0">
        1 Wrap pro Gerät · Face ID leitet den Schlüssel ab, meldet nirgends an</div>
      <input id="food-pk-label" placeholder="Gerätename, z. B. iPhone" autocomplete="off"
             style="width:100%;padding:9px;background:var(--bg3);border:1px solid var(--border2);
                    border-radius:4px;color:var(--t1);font:inherit">
      <button class="tab" id="food-pk-go" style="width:100%;padding:9px;margin-top:6px">
        Passkey anlegen</button>
      <div id="food-pk-err" style="color:var(--err);font-size:11px;margin-top:8px"></div>
      <div id="food-pk-done" style="display:none;margin-top:10px">
        <div class="ez-hint">wrap.json speichern, dann:
          <code>python scripts/nutri.py add-wrap wrap.json</code></div>
        <textarea id="food-pk-out" readonly rows="6"
                  style="width:100%;margin-top:6px;padding:8px;background:var(--bg3);
                         border:1px solid var(--border2);border-radius:4px;color:var(--t2);
                         font-family:var(--mono);font-size:10px"></textarea>
        <button class="tab" id="food-pk-copy" style="width:100%;padding:8px;margin-top:4px">
          Kopieren</button>
      </div>
    </details>`;

  $('#food-pk-go').onclick = async () => {
    const err = $('#food-pk-err');
    const label = ($('#food-pk-label').value || '').trim();
    err.textContent = '';
    if (!label) return (err.textContent = 'Gerätename fehlt.');
    try {
      const w = await Vault.enrollPasskey(FOOD.keys, FOOD.dek, label);
      $('#food-pk-out').value = JSON.stringify(w, null, 1);
      $('#food-pk-done').style.display = 'block';
    } catch (e) { err.textContent = e.message || String(e); }
  };
  $('#food-pk-copy').onclick = () => {
    const t = $('#food-pk-out');
    t.select();
    navigator.clipboard.writeText(t.value)
      .then(() => ($('#food-pk-copy').textContent = 'kopiert'))
      .catch(() => ($('#food-pk-err').textContent = 'Zwischenablage gesperrt, von Hand markieren.'));
  };
}

function foodView(v) {
  Object.values(FOOD.charts).forEach(c => c && c.destroy());
  FOOD.charts = {};
  FOOD.view = v;
  drawFood();
}

function goalBar(m, val, goal) {
  const cfg = MACRO[m];
  const pctv = goal ? Math.min(100, val / goal * 100) : 0;
  const rest = goal ? goal - val : null;
  const over = goal && val > goal;
  return `
    <div class="ez-item">
      <div class="ez-head">
        <span class="ez-name">${cfg.lbl}</span>
        <span class="ez-val" style="color:${over ? 'var(--warn)' : 'var(--t1)'}">
          ${val.toFixed(cfg.dec)}<small> ${cfg.unit}</small></span>
      </div>
      <div class="ez-bar"><div class="ez-fill" style="width:${pctv}%;background:${cfg.col}"></div></div>
      <div class="ez-hint">${goal
        ? (over ? `${(-rest).toFixed(0)} ${cfg.unit} über dem Ziel`
                : `noch ${rest.toFixed(0)} von ${goal} ${cfg.unit}`)
        : 'kein Ziel gesetzt'}</div>
    </div>`;
}

/* Fahrt-Energie eines Tages, in kcal.
 *
 * Quelle ist `kilojoules` aus dem Fahrtenregister (Arbeitsintegral des
 * Geraets), NICHT avg_power_moving x moving_sec: der Schnitt laesst das Rollen
 * ohne Tritt aussen vor und liefert mal 7, mal 23 Prozent zu viel.
 * Der Ruheumsatz waehrend der Fahrt wird abgezogen, er steckt schon im Sockel.
 *
 * DATA.acts ist beim Rendern schon geladen (shared.js:loadAll laeuft im Boot).
 * Fehlt es doch, gibt die Funktion 0 und das Ziel faellt auf den Sockel.
 */
function rideKcal(key) {
  const acts = (typeof DATA !== 'undefined' && DATA.acts) || [];
  let arbeit = 0, bewegt = 0;
  acts.forEach(a => {
    if (String(a.date || '').slice(0, 10) !== key) return;
    const kj = a.kilojoules ||
      ((a.avg_power_moving || a.avg_power || 0) * (a.moving_sec || 0) / 1000);
    arbeit += kj;
    bewegt += a.moving_sec || 0;
  });
  return Math.max(0, arbeit - bewegt / 60 * FCFG.energy.restPerMin);
}

/* Ziele fuer EINEN Tag. Mit gesetztem kcalBase wandert das kcal-Ziel mit dem
 * Training mit. Protein, Fett und Ballaststoffe bleiben fest, die haengen am
 * Koerpergewicht, nicht am Umsatz. Die Kohlenhydrate nehmen die Differenz auf.
 * Gegenstueck: goals_for() in scripts/nutri.py. */
function dayGoals(g, key) {
  if (!g || !g.kcalBase) return g || {};
  const out = Object.assign({}, g);
  out.kcal = Math.round(g.kcalBase + rideKcal(key));
  if (g.p && g.f != null && g.b != null) {
    // An einem Ruhetag deckt der Sockel Protein und Fett unter Umstaenden
    // schon nicht mehr. Dann waere das KH-Ziel negativ: auf 0 klemmen.
    out.k = Math.max(0, Math.round((out.kcal - g.p * 4 - g.f * 9 - g.b * 2) / 4));
  }
  return out;
}

/* REST DES TAGES.
 *
 * Rechnet die offene Luecke zu den Zielen aus und uebersetzt sie in Mengen.
 * Rein aus Zielen und Tagessumme: die Seite kann niemanden fragen, sie liest.
 *
 * Die Uhrzeit steht bewusst dabei. Um 17 Uhr ist ein offenes kcal-Budget das
 * Abendessen, um 23 Uhr ein Defizit. Die Karte zeigt die Zeit und ueberlaesst
 * den Schluss dem Leser.
 *
 * Jeder Vorschlag schliesst SEINE Luecke allein, und das passt oft nicht ins
 * kcal-Budget: 99 g Kohlenhydrate sind 625 g Kartoffeln, also 476 kcal, bei
 * 459 offenen. Solche Posten werden markiert, statt sie zu verschweigen.
 */
const fmt = (v, dec) => v.toFixed(dec).replace('.', ',');

function restCard(s, g) {
  const order = ['kcal', 'p', 'k', 'f', 'b', 'ml'];
  if (!order.some(m => g[m])) return '';

  const rest = m => g[m] ? g[m] - (s[m] || 0) : null;
  const restKcal = rest('kcal');
  const einheit = m => (m === 'kcal' ? 'kcal' : MACRO[m].unit);
  const zeig = m => `<b>${fmt(rest(m), MACRO[m].dec)} ${einheit(m)}</b>` +
                    (m === 'kcal' ? '' : ` ${MACRO[m].lbl}`);

  const offen = order.filter(m => rest(m) > 0).map(zeig).join(' · ');
  const drueber = order.filter(m => rest(m) !== null && rest(m) < 0)
    .map(m => `${MACRO[m].lbl} ${fmt(-rest(m), MACRO[m].dec)} ${einheit(m)} über`)
    .join(' · ');

  const zeilen = ['k', 'p', 'b'].filter(m => rest(m) > (FCFG.restMin[m] || 0))
    .map(m => {
      const opt = FCFG.fillers.filter(x => x.fills === m)
        .map(x => {
          const gramm = rest(m) / x[m] * 100;
          return { txt: `${Math.round(gramm / 5) * 5} g ${x.name}`,
                   kcal: Math.round(gramm * x.kcal / 100) };
        })
        .sort((a, b) => a.kcal - b.kcal)
        .slice(0, 3)
        .map(o => {
          const eng = restKcal !== null && o.kcal > restKcal;
          return `${o.txt} <span style="color:var(--${eng ? 'warn' : 't5'})">` +
                 `${o.kcal} kcal</span>`;
        });
      return `<div class="ez-hint" style="margin-top:7px">` +
             `<b>${fmt(rest(m), MACRO[m].dec)} ${einheit(m)} ${MACRO[m].lbl}</b> = ` +
             opt.join(' &nbsp;·&nbsp; ') + `</div>`;
    });

  if (rest('ml') > (FCFG.restMin.ml || 0)) {
    zeilen.push(`<div class="ez-hint" style="margin-top:7px">` +
      `<b>${fmt(rest('ml'), 0)} ml ${MACRO.ml.lbl}</b> = ` +
      `${Math.ceil(rest('ml') / 250)} Glas à 250 ml</div>`);
  }

  return `
    <div class="card">
      <div class="card-hd"><span class="t">REST DES TAGES</span>
        <span class="s">Stand ${new Date().toLocaleTimeString('de-DE',
          { hour: '2-digit', minute: '2-digit' })}</span></div>
      <div class="ez-hint">${offen ? 'offen: ' + offen : 'alle Ziele erreicht'}
        ${drueber ? `<br><span style="color:var(--warn)">${drueber}</span>` : ''}</div>
      ${zeilen.join('')}
      ${zeilen.length ? `<div class="muted" style="margin-top:9px">` +
        `jede Zeile schließt ihre Lücke allein · gelb = passt nicht mehr ins` +
        ` kcal-Budget</div>` : ''}
    </div>`;
}

/* Gewichtsverlauf bis zum Zieltag.
 *
 * Die Reihe liegt im Tresor (vault.weights), ein Wert je Tag. Eingetragen
 * wird ueber die CLI: die Seite kann nicht ins Repo zurueckschreiben, sie ist
 * statisch und hat keinen Token.
 *
 * Gezeichnet werden Messpunkte und ein zeit-gewichteter EWMA. Ein festes
 * Alpha je Messung wuerde zacken, sobald mal eine Woche fehlt: derselbe
 * Grund wie beim EF-Trend in rides.js. alpha = 1 - exp(-dt/tau).
 */
const DAY_MS = 86400000;
const dnum = iso => Math.round(new Date(iso + 'T12:00:00').getTime() / DAY_MS);
const dlbl = n => new Date(n * DAY_MS).toLocaleDateString('de-DE',
                    { day: '2-digit', month: '2-digit' });

function weightTrend(pts, tau) {
  let v = null, t0 = null;
  return pts.map(pt => {
    v = v === null ? pt.y : v + (1 - Math.exp(-(pt.x - t0) / tau)) * (pt.y - v);
    t0 = pt.x;
    return { x: pt.x, y: v };
  });
}

function weightCard(vault) {
  const W = FCFG.weight;
  const reihe = (vault.weights || []).slice().sort((a, b) => a.date < b.date ? -1 : 1);
  const ziel = (vault.goals || {}).kg || null;
  // Das Gewichtsziel hat seinen eigenen Termin (Petersberg), nicht den des
  // FTP-Ziels im November. Ohne Angabe faellt es auf den FTP-Termin zurueck.
  const zielTag = dnum((vault.goals || {}).kgDate || CFG.athlete.ftpGoalDate);
  const heute = dnum(dayKey(new Date().toISOString()));

  if (!reihe.length) {
    // Auch ohne Messung schon zeigen, worauf es hinausläuft.
    return `
      <div class="card">
        <div class="card-hd"><span class="t">GEWICHT</span>
          <span class="s">noch keine Messung</span></div>
        <div class="ez-hint">${ziel
          ? `Ziel <b>${fmt(ziel, 1)} kg</b> bis ${dlbl(zielTag)}` +
            ` · noch ${zielTag - heute} Tage`
          : 'kein Zielgewicht gesetzt'}</div>
        <div class="muted" style="margin-top:7px">Eintrag
          <code>nutri.py weight 80.4</code></div>
      </div>`;
  }

  const pts = reihe.map(w => ({ x: dnum(w.date), y: w.kg }));
  const letzt = pts[pts.length - 1];
  const erst = pts[0];
  const trend = weightTrend(pts, W.tau);
  const tLetzt = trend[trend.length - 1].y;

  const alle = pts.map(p => p.y).concat(ziel ? [ziel] : []);
  const yMin = Math.min(...alle) - W.padKg;
  const yMax = Math.max(...alle) + W.padKg;
  const xMin = Math.min(erst.x, heute - W.backDays);

  // Was noch zu tun ist: Rest auf Tage bis zum Ziel, in kg je Woche.
  const tage = zielTag - heute;
  const proWoche = ziel && tage > 0 ? (tLetzt - ziel) / tage * 7 : null;

  const kopf = [
    `<b>${fmt(letzt.y, 1)} kg</b>`,
    `Trend ${fmt(tLetzt, 1)}`,
    pts.length > 1 ? `seit ${dlbl(erst.x)} ${fmt(letzt.y - erst.y, 1)} kg` : null,
    ziel ? `Ziel ${fmt(ziel, 1)} bis ${dlbl(zielTag)}` : null,
    proWoche !== null ? `nötig ${fmt(-proWoche, 2)} kg/Woche` : null,
  ].filter(Boolean).join(' · ');

  setTimeout(() => {
    const el = $('#food-c-kg');
    if (!el) return;
    FOOD.charts.kg = new Chart(el, {
      data: {
        datasets: [
          { type: 'line', label: 'Trend', data: trend, borderColor: W.trendCol,
            borderWidth: 2, pointRadius: 0, tension: 0.25, fill: false },
          { type: 'scatter', label: 'gemessen', data: pts,
            backgroundColor: W.col, pointRadius: 3 },
          ...(ziel ? [{ type: 'line', label: 'Ziel', borderColor: CSSVAR('--ok'),
            data: [{ x: xMin, y: ziel }, { x: zielTag, y: ziel }],
            borderWidth: 1, borderDash: [4, 4], pointRadius: 0, fill: false }] : []),
          { type: 'line', label: 'heute', borderColor: CSSVAR('--t5'),
            data: [{ x: heute, y: yMin }, { x: heute, y: yMax }],
            borderWidth: 1, pointRadius: 0, fill: false },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { type: 'linear', offset: false, min: xMin, max: zielTag,
               ticks: { color: CSSVAR('--t4'), font: { size: 9 }, maxRotation: 0,
                        callback: v => dlbl(v) },
               grid: { color: 'rgba(255,255,255,.05)' } },
          y: { min: yMin, max: yMax,
               ticks: { color: CSSVAR('--t4'), font: { size: 9 },
                        callback: v => v.toFixed(1) },
               grid: { color: 'rgba(255,255,255,.05)' } },
        },
      },
    });
  }, 0);

  return `
    <div class="card">
      <div class="card-hd"><span class="t">GEWICHT</span>
        <span class="s">${pts.length} Messung${pts.length === 1 ? '' : 'en'}</span></div>
      <div class="ez-hint" style="margin-bottom:8px">${kopf}</div>
      <div style="height:${W.height}px"><canvas id="food-c-kg"></canvas></div>
      <div class="muted" style="margin-top:7px">Trend ${W.tau} d ·
        Tagesschwankung ist Wasser ·
        Eintrag <code>nutri.py weight 80.4</code></div>
    </div>`;
}

function drawDay() {
  const days = byDay(FOOD.vault.entries);
  const key = dayKey(new Date().toISOString());
  const ents = days.get(key) || [];
  const s = sumOf(ents);
  const g = dayGoals(FOOD.vault.goals, key);

  const rows = ents.length ? ents.map(e => `
    <div class="day">
      <div class="day-hd"><span class="dat">${new Date(e.ts).toLocaleTimeString('de-DE',
        { hour: '2-digit', minute: '2-digit' })}</span></div>
      <div class="day-body">
        <div class="p-title">${e.label} <span class="muted">${e.g.toFixed(0)} g</span></div>
        <div class="p-desc">${e.kcal.toFixed(0)} kcal · P ${e.p.toFixed(1)} · K ${e.k.toFixed(1)}
          · F ${e.f.toFixed(1)} · B ${e.b.toFixed(1)}</div>
      </div>
    </div>`).join('') : '<div class="day empty"><div class="day-body ez-none">noch nichts geloggt</div></div>';

  $('#food-body').innerHTML = `
    <div class="card">
      <div class="card-hd"><span class="t">HEUTE</span><span class="s">${key}</span></div>
      <div class="ftp3-grid">
        <div>${goalBar('kcal', s.kcal, g.kcal)}${goalBar('p', s.p, g.p)}${goalBar('k', s.k, g.k)}</div>
        <div>${goalBar('f', s.f, g.f)}${goalBar('b', s.b, g.b)}${goalBar('ml', s.ml, g.ml)}</div>
      </div>
      <div class="ez-meta">Makro-Verteilung nach Energie:
        ${['p', 'k', 'f'].map(m => {
          const aw = FCFG.atwater;
          const kc = s[m] * aw[m];
          const tot = s.p * aw.p + s.k * aw.k + s.f * aw.f;
          return `${MACRO[m].lbl} ${tot ? (kc / tot * 100).toFixed(0) : 0} %`;
        }).join(' · ')}</div>
    </div>
    ${restCard(s, g)}
    ${weightCard(FOOD.vault)}
    <div class="wcard">
      <div class="wcard-hd"><span class="wlbl">Einträge</span><span class="wvol">${ents.length}</span></div>
      <div class="days">${rows}</div>
    </div>`;
}

function lastNDays(n) {
  const out = [];
  const t = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(t); x.setDate(x.getDate() - i);
    out.push(x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0')
           + '-' + String(x.getDate()).padStart(2, '0'));
  }
  return out;
}

function drawRange(n, title) {
  const days = byDay(FOOD.vault.entries);
  const keys = lastNDays(n);
  // Ziele wandern je Tag, fuer den Schnitt also mitteln.
  const tg = keys.map(k => dayGoals(FOOD.vault.goals, k));
  const g = Object.assign({}, FOOD.vault.goals, {
    kcal: tg.reduce((a, x) => a + (x.kcal || 0), 0) / keys.length || null,
    k:    tg.reduce((a, x) => a + (x.k || 0), 0) / keys.length || null,
  });
  const sums = keys.map(k => sumOf(days.get(k) || []));
  const logged = keys.filter(k => days.has(k)).length;
  const avg = m => logged ? sums.reduce((a, s) => a + s[m], 0) / logged : 0;

  $('#food-body').innerHTML = `
    <div class="card">
      <div class="card-hd"><span class="t">${title}</span>
        <span class="s">${logged} von ${n} Tagen geloggt</span></div>
      <div style="height:${FCFG.chartH.kcal}px"><canvas id="food-c-kcal"></canvas></div>
    </div>
    <div class="card">
      <div class="card-hd"><span class="t">PROTEIN &amp; BALLASTSTOFFE</span></div>
      <div style="height:${FCFG.chartH.macro}px"><canvas id="food-c-pb"></canvas></div>
    </div>
    <div class="card">
      <div class="card-hd"><span class="t">SCHNITT</span><span class="s">nur geloggte Tage</span></div>
      <div class="ftp3-grid">
        <div>${goalBar('kcal', avg('kcal'), g.kcal)}${goalBar('p', avg('p'), g.p)}${goalBar('k', avg('k'), g.k)}</div>
        <div>${goalBar('f', avg('f'), g.f)}${goalBar('b', avg('b'), g.b)}${goalBar('ml', avg('ml'), g.ml)}</div>
      </div>
    </div>`;

  const lbls = keys.map(k => k.slice(8) + '.' + k.slice(5, 7));
  // Ziel-Linie nur wenn im Tresor ein Ziel steht. Kein Ziel = keine Linie,
  // nicht 0. Chart.js zeichnet auf Canvas: var(--ok) versteht es NICHT,
  // also CSSVAR wie ueberall sonst im Projekt.
  const goalLine = val => val ? [{
    type: 'line', label: 'Ziel', data: keys.map(() => val), borderColor: CSSVAR('--ok'),
    borderWidth: 1, borderDash: [4, 4], pointRadius: 0, fill: false
  }] : [];

  const base = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: CSSVAR('--t2'), boxWidth: 10, font: { size: 10 } } } },
    scales: {
      x: { ticks: { color: CSSVAR('--t4'), font: { size: 9 }, maxRotation: 0, autoSkip: true },
           grid: { color: 'rgba(255,255,255,.05)' } },
      y: { beginAtZero: true, ticks: { color: CSSVAR('--t4'), font: { size: 9 } },
           grid: { color: 'rgba(255,255,255,.05)' } }
    }
  };

  FOOD.charts.kcal = new Chart($('#food-c-kcal'), {
    data: {
      labels: lbls,
      datasets: [
        { type: 'bar', label: 'kcal', data: sums.map(s => s.kcal),
          backgroundColor: MACRO.kcal.col + '99', borderRadius: 2 },
        ...goalLine(g.kcal)
      ]
    },
    options: base
  });

  FOOD.charts.pb = new Chart($('#food-c-pb'), {
    data: {
      labels: lbls,
      datasets: [
        { type: 'bar', label: 'Protein g', data: sums.map(s => s.p),
          backgroundColor: MACRO.p.col + '99', borderRadius: 2 },
        { type: 'bar', label: 'Ballast g', data: sums.map(s => s.b),
          backgroundColor: MACRO.b.col + '99', borderRadius: 2 },
        ...goalLine(g.p)
      ]
    },
    options: base
  });
}

function drawWeek()  { drawRange(FCFG.rangeDays.week,  `LETZTE ${FCFG.rangeDays.week} TAGE`); }
function drawMonth() { drawRange(FCFG.rangeDays.month, `LETZTE ${FCFG.rangeDays.month} TAGE`); }
