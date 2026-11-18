/* health.js — Health-Seite: Morgen-Check und Verläufe.
 *
 * Einzige Stelle für Gewicht, Nacht-Gänge, Rücken (0-10, Vortag) und Routine
 * (Vortag). Ersetzt den Food-Tab.
 *
 * DATEN LIEGEN NICHT HIER. Dieses Repo ist öffentlich. Gelesen und geschrieben
 * wird eine JSON-Datei im PRIVATEN Repo CFG.health.repo über die GitHub-API,
 * mit einem Fine-grained Token, der nur auf dem Gerät liegt (localStorage).
 * Ohne Token zeigt die Seite nur die Einrichtung. Format:
 *   { version, goals: { kg }, entries: { "JJJJ-MM-TT": { weight, nights,
 *     back, habits: { meditation, physio, training, yoga }, note } } }
 */
const HCFG = CFG.health;
const HEALTH = { file: null, sha: null, form: null, date: null, charts: {}, busy: false, msg: '' };

// ── Token und GitHub-API ────────────────────────────────────────────────────
function hToken() { try { return localStorage.getItem(HCFG.tokenKey) || ''; } catch (e) { return ''; } }
function hSetToken(t) {
  try { t ? localStorage.setItem(HCFG.tokenKey, t) : localStorage.removeItem(HCFG.tokenKey); } catch (e) {}
}

function b64enc(s) {
  const b = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(bin);
}
const b64dec = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, '')), c => c.charCodeAt(0)));
const ghUrl = () => `https://api.github.com/repos/${HCFG.repo}/contents/${HCFG.path}`;
const ghHead = () => ({ Authorization: 'Bearer ' + hToken(), Accept: 'application/vnd.github+json' });

async function ghFile() {
  const r = await fetch(ghUrl() + '?ref=' + HCFG.branch, { headers: ghHead(), cache: 'no-store' });
  // Ein privates Repo ohne Zugriff meldet GitHub als 404, nicht als 403.
  if (r.status === 401) throw new Error('Token ungültig oder abgelaufen.');
  if (r.status === 404 || r.status === 403) throw new Error('Kein Zugriff: der Token braucht Zugriff auf ' + HCFG.repo + ' (Contents: Read and write).');
  if (!r.ok) throw new Error('GitHub antwortet ' + r.status + '.');
  const j = await r.json();
  const data = JSON.parse(b64dec(j.content));
  data.entries = data.entries || {};
  data.goals = data.goals || {};
  return { data, sha: j.sha };
}

async function ghPut(data, msg) {
  const r = await fetch(ghUrl(), {
    method: 'PUT', headers: { ...ghHead(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: msg, content: b64enc(JSON.stringify(data, null, 1) + '\n'),
                           sha: HEALTH.sha, branch: HCFG.branch }),
  });
  if (r.status === 409 || r.status === 422) return null;      // Datei wurde inzwischen geändert
  if (r.status === 401) throw new Error('Token ungültig oder abgelaufen.');
  if (r.status === 403 || r.status === 404) throw new Error('Token darf nicht schreiben (Contents: Read and write).');
  if (!r.ok) throw new Error('Speichern fehlgeschlagen (' + r.status + ').');
  return (await r.json()).content.sha;
}

// Änderung anwenden und speichern. Bei veralteter Datei einmal neu laden und
// die Änderung auf den frischen Stand legen, nie fremde Einträge überschreiben.
async function hCommit(change, msg) {
  for (let i = 0; i < 2; i++) {
    const data = JSON.parse(JSON.stringify(HEALTH.file));
    change(data);
    const sha = await ghPut(data, msg);
    if (sha) { HEALTH.file = data; HEALTH.sha = sha; return; }
    const f = await ghFile();
    HEALTH.file = f.data; HEALTH.sha = f.sha;
  }
  throw new Error('Gleichzeitige Änderung, bitte nochmal speichern.');
}

// ── Zahlen ──────────────────────────────────────────────────────────────────
const hDay = s => Math.round(new Date(s + 'T12:00:00').getTime() / 86400000);
const hLbl = n => new Date(n * 86400000).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
const h1 = v => v.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// Zeit-gewichteter EWMA, gleicher Grund wie beim EF-Trend: alpha = 1 - exp(-dt/tau).
function hTrend(pts, tau) {
  let v = null, t0 = null;
  return pts.map(p => {
    v = v === null ? p.y : v + (1 - Math.exp(-(p.x - t0) / tau)) * (p.y - v);
    t0 = p.x;
    return { x: p.x, y: v };
  });
}

function hStats(entries) {
  const keys = Object.keys(entries).sort();
  const has = new Set(keys.map(hDay));
  let d = hDay(iso(today())), streak = 0;
  if (!has.has(d)) d--;
  while (has.has(d)) { streak++; d--; }
  const avg = (arr, f) => { const v = arr.map(f).filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const last = keys.slice(-7).map(k => entries[k]), prev = keys.slice(-14, -7).map(k => entries[k]);
  const wpts = keys.filter(k => entries[k].weight != null).map(k => ({ x: hDay(k), y: entries[k].weight }));
  return { keys, streak, last, wpts, trend: hTrend(wpts, HCFG.weight.tau),
           back7: avg(last, e => e.back), backPrev: avg(prev, e => e.back), nights7: avg(last, e => e.nights) };
}

// ── Seite ───────────────────────────────────────────────────────────────────
function renderHealth() {
  const page = $('#page-health');
  if (!hToken()) return hSetup(page, '');
  if (!HEALTH.file) {
    page.innerHTML = '<div class="card"><div class="ez-hint">lade Health …</div></div>';
    // Nur Ladefehler hier abfangen; ein Fehler beim Zeichnen ist kein Token-Problem.
    ghFile().then(f => { HEALTH.file = f.data; HEALTH.sha = f.sha; drawHealth(); }, e => {
      page.innerHTML = `<div class="card"><div class="card-hd"><span class="t">HEALTH</span></div>
        <div style="color:var(--err);font-size:12px;margin-bottom:12px">${e.message}</div>
        <button class="h-btn" id="h-reset">Token neu eingeben</button></div>`;
      $('#h-reset').onclick = () => { hSetToken(''); renderHealth(); };
    });
    return;
  }
  drawHealth();
}

function hSetup(page, err) {
  page.innerHTML = `
    <div class="card" style="max-width:520px;margin:20px auto">
      <div class="card-hd"><span class="t">HEALTH</span><span class="s">einmal pro Gerät einrichten</span></div>
      <div class="ez-hint" style="margin-bottom:12px">Die Daten liegen im privaten Repo
        <code>${HCFG.repo}</code>. Dieses Gerät braucht dafür einen GitHub-Token, der nur auf
        diesem Gerät gespeichert wird.</div>
      <ol class="h-steps">
        <li><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">Neuen Fine-grained Token anlegen</a></li>
        <li>Name: <code>Health ${navigator.platform.includes('iPhone') ? 'iPhone' : 'Gerät'}</code>, Ablauf: 1 Jahr</li>
        <li>Repository access: <b>Only select repositories</b> → <code>health-notes</code></li>
        <li>Permissions → Repository → <b>Contents: Read and write</b></li>
        <li>Generate token, kopieren, hier einfügen</li>
      </ol>
      <input type="password" id="h-token" class="h-input" placeholder="github_pat_…" autocomplete="off">
      <button class="h-btn" id="h-token-save" style="width:100%;margin-top:8px">Speichern und verbinden</button>
      <div style="color:var(--err);font-size:11px;margin-top:10px">${err}</div>
    </div>`;
  $('#h-token-save').onclick = async () => {
    const t = $('#h-token').value.trim();
    if (!t) return;
    hSetToken(t);
    try { const f = await ghFile(); HEALTH.file = f.data; HEALTH.sha = f.sha; drawHealth(); }
    catch (e) { hSetToken(''); hSetup(page, e.message); }
  };
}

function hLoadForm() {
  const e = HEALTH.file.entries[HEALTH.date];
  HEALTH.form = e
    ? { weight: e.weight != null ? String(e.weight) : '', nights: e.nights ?? null, back: e.back ?? null,
        habits: { ...(e.habits || {}) }, note: e.note || '' }
    : { weight: '', nights: null, back: null, habits: {}, note: '' };
}

function drawHealth() {
  if (!HEALTH.date) HEALTH.date = iso(today());
  if (!HEALTH.form) hLoadForm();
  const f = HEALTH.form, E = HEALTH.file.entries, S = hStats(E);
  const lastW = [...S.keys].reverse().find(k => E[k].weight != null);
  const seg = (id, labels, cur) => `<div class="h-seg" id="${id}" style="grid-template-columns:repeat(${labels.length},1fr)">
      ${labels.map((l, i) => `<button type="button" data-i="${i}" aria-pressed="${cur === i}">${l}</button>`).join('')}</div>`;
  const tLast = S.trend.length ? S.trend[S.trend.length - 1] : null;
  const t14 = tLast ? S.trend.filter(p => p.x <= tLast.x - 14).pop() : null;
  const backCls = v => v == null ? '' : v >= HCFG.back.bad ? 'var(--err)' : v >= HCFG.back.warn ? 'var(--warn)' : 'var(--ok)';
  const goal = HEALTH.file.goals.kg;

  $('#page-health').innerHTML = `
    <div class="grid2">
      <div class="card">
        <div class="card-hd"><span class="t">MORGEN-CHECK</span>
          <input type="date" id="h-date" class="h-input h-date" value="${HEALTH.date}" max="${iso(today())}"></div>
        <div class="h-field"><span class="lbl">Gewicht · nüchtern</span>
          <input type="number" inputmode="decimal" step="0.1" id="h-weight" class="h-input h-w"
                 value="${f.weight}" placeholder="${lastW ? h1(E[lastW].weight) : 'kg'}"> <span class="muted">kg · leer = nicht gewogen</span></div>
        <div class="h-field"><span class="lbl">Nachts raus</span>${seg('h-nights', ['0', '1', '2', '3+'], f.nights)}</div>
        <div class="h-field"><span class="lbl">Rücken gestern · 0 nichts, 10 unerträglich</span>${seg('h-back', [...Array(11).keys()].map(String), f.back)}</div>
        <div class="h-field"><span class="lbl">Gestern geschafft</span>
          <div class="h-chips" id="h-habits">${HCFG.habits.map(h =>
            `<button type="button" data-k="${h.key}" aria-pressed="${!!f.habits[h.key]}">${h.lbl}</button>`).join('')}</div></div>
        <div class="h-field"><span class="lbl">Notiz</span>
          <textarea id="h-note" class="h-input" rows="2" placeholder="z. B. lange gesessen, Rose gefahren">${f.note.replace(/</g, '&lt;')}</textarea></div>
        <div style="display:flex;align-items:center;gap:12px">
          <button class="h-btn" id="h-save">${E[HEALTH.date] ? 'Aktualisieren' : 'Speichern'}</button>
          <span class="muted" id="h-msg">${HEALTH.msg}</span></div>
      </div>
      <div>
        <div class="stats" style="grid-template-columns:1fr 1fr">
          <div class="stat"><div class="stat-l">Serie</div><div class="stat-v">${S.keys.length ? S.streak : '–'}</div><div class="stat-s">Tage am Stück</div></div>
          <div class="stat"><div class="stat-l">Gewicht Trend</div><div class="stat-v">${tLast ? h1(tLast.y) : '–'}</div>
            <div class="stat-s">${t14 ? (tLast.y - t14.y >= 0 ? '+' : '') + h1(tLast.y - t14.y) + ' kg / 14 d' : 'kg'}${goal ? ' · Ziel ' + h1(goal) : ''}</div></div>
          <div class="stat"><div class="stat-l">Rücken Ø 7</div><div class="stat-v" style="color:${backCls(S.back7)}">${S.back7 == null ? '–' : h1(S.back7)}</div>
            <div class="stat-s">${S.backPrev == null ? '0–10' : 'Vorwoche ' + h1(S.backPrev)}</div></div>
          <div class="stat"><div class="stat-l">Nächte Ø 7</div><div class="stat-v">${S.nights7 == null ? '–' : h1(S.nights7)}</div><div class="stat-s">Gänge pro Nacht</div></div>
        </div>
        <div class="card">
          <div class="card-hd"><span class="t">ROUTINE</span><span class="s">letzte 7 Einträge</span></div>
          <div class="h-habits7">${HCFG.habits.map(h =>
            `<div><b>${S.last.filter(e => e.habits && e.habits[h.key]).length}/${S.last.length || 7}</b>${h.lbl}</div>`).join('')}</div>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-hd"><span class="t">GEWICHT</span><span class="s">${S.wpts.length} Messungen</span></div>
      ${S.wpts.length ? `<div style="height:${HCFG.weight.height}px"><canvas id="h-c-kg"></canvas></div>` : '<div class="ez-hint">Noch keine Messung. Erster Eintrag oben startet die Kurve.</div>'}
      <div class="muted" style="margin-top:7px">Trend ${HCFG.weight.tau} d · Tagesschwankung = Wasser</div>
    </div>
    <div class="card">
      <div class="card-hd"><span class="t">RÜCKEN</span><span class="s">${HCFG.back.days} Tage</span></div>
      ${S.keys.some(k => E[k].back != null) ? `<div style="height:${HCFG.back.height}px"><canvas id="h-c-back"></canvas></div>` : '<div class="ez-hint">Noch keine Einträge.</div>'}
      <div class="muted" style="margin-top:7px">0–10 am Vortag · ↓ = besser</div>
    </div>
    ${hLegacyCard()}`;

  hWire();
  hCharts(S, goal);
}

function hWire() {
  const f = HEALTH.form, redraw = () => { HEALTH.msg = ''; drawHealth(); };
  $('#h-date').onchange = e => { HEALTH.date = e.target.value || iso(today()); HEALTH.msg = ''; hLoadForm(); drawHealth(); };
  $('#h-weight').oninput = e => { f.weight = e.target.value; };
  $('#h-note').oninput = e => { f.note = e.target.value; };
  document.querySelectorAll('#h-nights button').forEach(b => b.onclick = () => { const i = +b.dataset.i; f.nights = f.nights === i ? null : i; redraw(); });
  document.querySelectorAll('#h-back button').forEach(b => b.onclick = () => { const i = +b.dataset.i; f.back = f.back === i ? null : i; redraw(); });
  document.querySelectorAll('#h-habits button').forEach(b => b.onclick = () => { f.habits[b.dataset.k] = !f.habits[b.dataset.k]; redraw(); });
  $('#h-save').onclick = hSave;
  const lb = $('#h-legacy');
  if (lb) lb.onclick = hImportLegacy;
}

async function hSave() {
  if (HEALTH.busy) return;
  const f = HEALTH.form, date = HEALTH.date;
  const w = parseFloat(String(f.weight).replace(',', '.'));
  if (f.weight !== '' && !(w >= HCFG.weight.min && w <= HCFG.weight.max)) { $('#h-msg').textContent = 'Gewicht prüfen.'; return; }
  const entry = { weight: f.weight === '' ? null : Math.round(w * 10) / 10, nights: f.nights, back: f.back,
                  habits: f.habits, note: f.note.trim() };
  HEALTH.busy = true; $('#h-save').disabled = true; $('#h-msg').textContent = 'speichert …';
  try { await hCommit(d => { d.entries[date] = entry; }, 'Morgen-Check ' + date); HEALTH.msg = 'Gespeichert.'; }
  catch (e) { HEALTH.msg = e.message; }
  HEALTH.busy = false;
  hLoadForm(); drawHealth();
}

function hCharts(S, goal) {
  Object.values(HEALTH.charts).forEach(c => c.destroy());
  HEALTH.charts = {};
  if (typeof Chart === 'undefined') return;     // CDN nicht erreichbar: Formular geht trotzdem
  const W = HCFG.weight, B = HCFG.back, now = hDay(iso(today()));
  const grid = { color: 'rgba(255,255,255,.05)' }, tk = { color: CSSVAR('--t4'), font: { size: 9 } };
  const xAxis = min => ({ type: 'linear', offset: false, min, max: now,
                          ticks: { ...tk, maxRotation: 0, callback: v => hLbl(v) }, grid });

  const kg = $('#h-c-kg');
  if (kg) {
    // Achse ab der ersten Messung im Fenster, nicht leer ab backDays.
    const xMin = Math.max(now - W.backDays, Math.min(...S.wpts.map(q => q.x)) - 3);
    const p = S.wpts.filter(q => q.x >= xMin), t = S.trend.filter(q => q.x >= xMin);
    const ys = p.map(q => q.y).concat(t.map(q => q.y), goal ? [goal] : []);
    HEALTH.charts.kg = new Chart(kg, {
      data: { datasets: [
        { type: 'line', data: t, borderColor: W.trendCol, borderWidth: 2, pointRadius: 0, tension: 0.25, fill: false },
        { type: 'scatter', data: p, backgroundColor: W.col, pointRadius: 3 },
        ...(goal ? [{ type: 'line', data: [{ x: xMin, y: goal }, { x: now, y: goal }], borderColor: CSSVAR('--ok'),
                      borderWidth: 1, borderDash: [4, 4], pointRadius: 0, fill: false }] : []),
      ] },
      options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { display: false } },
        scales: { x: xAxis(xMin),
                  y: { min: Math.floor((Math.min(...ys) - W.padKg) * 2) / 2,
                       max: Math.ceil((Math.max(...ys) + W.padKg) * 2) / 2,
                       ticks: { ...tk, callback: v => v.toFixed(1) }, grid } } },
    });
  }

  const bc = $('#h-c-back');
  if (bc) {
    const xMin = now - B.days;
    const pts = S.keys.filter(k => HEALTH.file.entries[k].back != null && hDay(k) >= xMin)
                      .map(k => ({ x: hDay(k), y: HEALTH.file.entries[k].back }));
    const col = v => v >= B.bad ? CSSVAR('--err') : v >= B.warn ? CSSVAR('--warn') : CSSVAR('--ok');
    // Balken: type linear + offset false explizit, sonst Kategorie-Achse (siehe timeScale-Fallstricke).
    HEALTH.charts.back = new Chart(bc, {
      type: 'bar',
      data: { datasets: [{ data: pts, backgroundColor: pts.map(q => col(q.y)), barThickness: B.barPx }] },
      options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { display: false } },
        scales: { x: xAxis(xMin), y: { min: 0, max: 10, ticks: { ...tk, stepSize: 5 }, grid } } },
    });
  }
}

// ── Einmalig: Gewichte aus dem alten Food-Tresor übernehmen ─────────────────
function hLegacyCard() {
  if (HEALTH.file.legacyImported || typeof Vault === 'undefined') return '';
  return `<div class="card">
    <div class="card-hd"><span class="t">ALTE GEWICHTE</span><span class="s">einmalig</span></div>
    <div class="ez-hint" style="margin-bottom:10px">Die bisherigen Messungen liegen im verschlüsselten Food-Tresor.
      Mit Passkey entsperren und in den Morgen-Check übernehmen. Vorhandene Einträge bleiben unverändert.</div>
    <button class="h-btn" id="h-legacy">Mit Passkey übernehmen</button>
    <span class="muted" id="h-legacy-msg"></span></div>`;
}

async function hImportLegacy() {
  const msg = $('#h-legacy-msg');
  try {
    msg.textContent = ' entsperren …';
    const get = async n => { const r = await fetch(HCFG.legacyRaw + n + '?t=' + Date.now()); if (!r.ok) throw new Error(n + ': ' + r.status); return r.json(); };
    const keys = await get('keys.json');
    const dek = await Vault.unlockWithPasskey(keys);
    const vault = await Vault.open(await get('log.enc.json'), dek);
    const ws = (vault.weights || []).filter(w => w && w.date && w.kg != null);
    msg.textContent = ` übernehme ${ws.length} Messungen …`;
    await hCommit(d => {
      ws.forEach(w => {
        const e = d.entries[w.date];
        if (!e) d.entries[w.date] = { weight: w.kg, nights: null, back: null, habits: {}, note: '', imported: true };
        else if (e.weight == null) e.weight = w.kg;
      });
      d.legacyImported = true;
    }, `Alte Gewichte übernommen (${ws.length})`);
    HEALTH.msg = `${ws.length} alte Messungen übernommen.`;
    hLoadForm(); drawHealth();
  } catch (e) { msg.textContent = ' ' + (e.message || e); }
}
