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

function drawDay() {
  const days = byDay(FOOD.vault.entries);
  const key = dayKey(new Date().toISOString());
  const ents = days.get(key) || [];
  const s = sumOf(ents);
  const g = FOOD.vault.goals || {};

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
  const g = FOOD.vault.goals || {};
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
