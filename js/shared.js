/* shared.js — Werkzeuge, die alle Seiten brauchen.
 *
 * Genau ein Datums-Parser, genau eine Zonen-Engine, genau ein Ladepfad.
 * Kein Jahr ist irgendwo fest verdrahtet.
 */

// ── Daten (einmal geladen, von allen Seiten genutzt) ────────────────────────
const DATA = { acts: [], health: [], updatedAt: null, loaded: false };

async function loadAll() {
  const bust = '?_=' + Date.now();
  const a = await fetch('data/activities.json' + bust).then(r => r.json());
  DATA.acts = (a.activities || []).filter(x => !x.hidden)
    .sort((x, y) => (y.date + (y.start_time || '')).localeCompare(x.date + (x.start_time || '')));
  DATA.updatedAt = a.updated_at;
  try {
    const h = await fetch('data/health.json' + bust).then(r => r.json());
    DATA.health = (h.days || []).sort((x, y) => y.date.localeCompare(x.date));
  } catch (e) { DATA.health = []; }
  DATA.loaded = true;
}

// Serie einer Fahrt nachladen (nur fuer die Detailansicht).
const _seriesCache = {};
async function loadSeries(id) {
  if (_seriesCache[id]) return _seriesCache[id];
  const s = await fetch('data/analysis/' + id + '.json?_=' + Date.now()).then(r => r.json());
  _seriesCache[id] = s;
  return s;
}

// ── Datum ───────────────────────────────────────────────────────────────────
// Alle Daten sind ISO 'YYYY-MM-DD'. Ein Parser, kein hartes Jahr.
function d(iso) {
  const [y, m, dd] = String(iso).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, dd);
}
function iso(dt) {
  return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0')
       + '-' + String(dt.getDate()).padStart(2, '0');
}
function today() { const n = new Date(); n.setHours(0, 0, 0, 0); return n; }
function addDays(dt, n) { const x = new Date(dt); x.setDate(x.getDate() + n); return x; }
function dayDiff(a, b) { return Math.round((a - b) / 86400000); }

const DOW = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
function dowOf(dt) { return DOW[dt.getDay()]; }

/* ISO-Kalenderwoche. Donnerstag-Regel: die Woche gehoert zu dem Jahr, in dem
 * ihr Donnerstag liegt. */
function kwOf(dt) {
  const t = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
  t.setDate(t.getDate() + 3 - ((t.getDay() + 6) % 7));
  const first = new Date(t.getFullYear(), 0, 4);
  return 1 + Math.round(((t - first) / 86400000 - 3 + ((first.getDay() + 6) % 7)) / 7);
}
function mondayOf(dt) {
  const x = new Date(dt);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  x.setHours(0, 0, 0, 0);
  return x;
}

function fmtDay(dt) {
  return String(dt.getDate()).padStart(2, '0') + '.' + String(dt.getMonth() + 1).padStart(2, '0') + '.';
}
function fmtDur(sec) {
  if (!sec) return '—';
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return h ? `${h}:${String(m).padStart(2, '0')} h` : `${m} min`;
}

// ── Zonen-Engine ────────────────────────────────────────────────────────────
/* Rechnet Zonenzeiten aus einem Histogramm. Weil das Histogramm in ABSOLUTEN
 * Einheiten vorliegt (Watt, bpm), koennen Grenzen und FTP jederzeit geaendert
 * werden, ohne dass das Backend neu rechnen muss.
 *
 * Eimer, in die eine Grenze faellt, werden linear aufgeteilt — sonst haette
 * eine Zonengrenze die Aufloesung des Rasters (10 W bzw. 2 bpm).
 */
function zoneTimes(hist, step, offset, bounds, absMax) {
  const out = new Array(bounds.length).fill(0);
  if (!hist) return out;
  // Absolute Grenzen, plus Obergrenze
  const edges = bounds.map(b => b * absMax).concat([Infinity]);
  for (let i = 0; i < hist.length; i++) {
    const sec = hist[i];
    if (!sec) continue;
    const lo = offset + i * step, hi = lo + step;
    for (let z = 0; z < bounds.length; z++) {
      const zl = Math.max(lo, edges[z]), zh = Math.min(hi, edges[z + 1]);
      if (zh > zl) out[z] += sec * (zh - zl) / step;
    }
  }
  return out;
}

function powerZoneTimes(act) {
  if (!act.hist_p) return null;
  const h = CFG.zones.countCoasting ? act.hist_p : [0, ...act.hist_p.slice(1)];
  return zoneTimes(h, CFG.hist.pStep, 0, CFG.zones.power.bounds, CFG.athlete.ftp);
}
function hrZoneTimes(act) {
  if (!act.hist_hr) return null;
  return zoneTimes(act.hist_hr, CFG.hist.hrStep, CFG.hist.hrMin,
                   CFG.zones.hr.bounds, CFG.athlete.hrmax);
}
function pct(arr) {
  const t = arr.reduce((a, b) => a + b, 0) || 1;
  return arr.map(x => 100 * x / t);
}

/* Easy-Anteil = Zeit in Z1+Z2 am Gesamtvolumen, ueber ein Zeitfenster.
 * Wird fuer Leistung UND HF gerechnet: die beiden Zahlen sagen Verschiedenes.
 * Kurze Antritte am Berg schlagen in der Leistung durch, waehrend die HF gar
 * nicht reagiert — die Differenz ist selbst die Information. */
function easyShare(days, offsetDays) {
  const hi = addDays(today(), -(offsetDays || 0));
  const lo = addDays(hi, -days);
  let ez = { p: 0, hr: 0 }, tot = { p: 0, hr: 0 }, n = 0, sec = 0;
  DATA.acts.forEach(a => {
    const dt = d(a.date);
    if (dt <= lo || dt > hi) return;
    const pz = powerZoneTimes(a), hz = hrZoneTimes(a);
    if (pz) { ez.p += pz[0] + pz[1]; tot.p += pz.reduce((x, y) => x + y, 0); }
    if (hz) { ez.hr += hz[0] + hz[1]; tot.hr += hz.reduce((x, y) => x + y, 0); }
    if (pz || hz) { n++; sec += a.moving_sec || 0; }
  });
  return {
    power: tot.p ? 100 * ez.p / tot.p : null,
    hr: tot.hr ? 100 * ez.hr / tot.hr : null,
    hours: sec / 3600, rides: n,
  };
}

// ── Kennzahlen ──────────────────────────────────────────────────────────────
const IF = a => (a.np && CFG.athlete.ftp) ? a.np / CFG.athlete.ftp : null;

function best(key, days) {
  const lo = addDays(today(), -days);
  let b = null;
  DATA.acts.forEach(a => {
    const v = a.power_curve && a.power_curve[key];
    if (!v || d(a.date) < lo) return;
    if (!b || v > b.w) b = { w: v, date: a.date, id: a.id };
  });
  return b;
}

// ── DOM ─────────────────────────────────────────────────────────────────────
/* Farben kommen aus den CSS-Tokens, nicht aus dem JS. Wer eine Farbe braucht,
 * holt sie hier - so gibt es sie genau einmal. */
const CSSVAR = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};
const $ = s => document.querySelector(s);
