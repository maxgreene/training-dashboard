/* shared.js — Werkzeuge, die alle Seiten brauchen.
 *
 * Genau ein Datums-Parser, genau eine Zonen-Engine, genau ein Ladepfad.
 * Kein Jahr ist irgendwo fest verdrahtet.
 */

// ── Daten (einmal geladen, von allen Seiten genutzt) ────────────────────────
const DATA = { acts: [], health: [], updatedAt: null, wahooSkipped: false, loaded: false };

async function loadAll() {
  const bust = '?_=' + Date.now();
  const a = await fetch('data/activities.json' + bust).then(r => r.json());
  DATA.acts = (a.activities || []).filter(x => !x.hidden)
    .sort((x, y) => (y.date + (y.start_time || '')).localeCompare(x.date + (x.start_time || '')));
  DATA.updatedAt = a.updated_at;
  DATA.wahooSkipped = !!a.wahoo_skipped;
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

/* EWMA mit exponentiell gewichteter Streuung -> Trendlinie plus Band.
 * Das Band zeigt, was normale Schwankung ist: nur was daraus ausbricht,
 * ist ein Signal. pts muessen chronologisch sortiert sein (aeltester zuerst).
 * Genutzt von der Form-Seite (HRV/RHR, taeglich) und dem EF-Trend (je Fahrt). */
function ewmaBand(pts, alpha) {
  if (!pts.length) return { line: [], upper: [], lower: [] };
  let e = pts[0].y, v = 0;
  const line = [], upper = [], lower = [];
  pts.forEach(p => {
    const prev = e;
    e = e + alpha * (p.y - e);
    const dev = p.y - prev;
    v = (1 - alpha) * (v + alpha * dev * dev);
    const sd = Math.sqrt(v);
    line.push({ x: p.x, y: +e.toFixed(2) });
    upper.push({ x: p.x, y: +(e + sd).toFixed(2) });
    lower.push({ x: p.x, y: +(e - sd).toFixed(2) });
  });
  return { line, upper, lower };
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

/* Gemeinsame Zeitachse: Trainingsstart bis heute, fuer jeden Zeitreihen-Chart
 * identisch. t0 ist der Nullpunkt, x-Werte sind Tage seit t0. "heute" waechst
 * mit, ohne dass irgendwo ein Datum haengenbleibt. */
function timeAxis() {
  const C = CFG.ui.timeAxis;
  const first = C.start ? d(C.start)
    : (DATA.acts.length ? d(DATA.acts[DATA.acts.length - 1].date) : today());
  return {
    t0: first.getTime(),
    min: -C.padDays,
    max: dayDiff(today(), first) + C.padDays,
    dayOf: ds => dayDiff(d(ds), first),
  };
}

/* Chart.js-x-Achse aus timeAxis(). Zwei Optionen MUESSEN explizit gesetzt sein,
 * weil ein bar-Datensatz (die TSS-Balken) die Voreinstellungen der Achse
 * aendert:
 *   type:'linear'  - sonst nimmt Chart.js eine Kategorie-Achse an und alle
 *                    Punkte kollabieren auf dieselbe Stelle.
 *   offset:false   - bei Balken ist offset per Default true; Chart.js schiebt
 *                    dann an beiden Enden Platz dazu, damit Randbalken nicht
 *                    angeschnitten werden. Der Chart mit Balken waere dadurch
 *                    schmaler als die ohne - trotz identischer Achse. */
function timeScale(T) {
  return {
    type: 'linear', offset: false, min: T.min, max: T.max,
    ticks: { color: CSSVAR('--t4'), font: { size: 9 },
             stepSize: CFG.ui.timeAxis.tickStepDays, autoSkip: false,
             callback: v => fmtDay(addDays(new Date(T.t0), v)) },
    grid: { color: 'rgba(255,255,255,.05)' },
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

// ── FTP / HRmax: EINE Quelle, aus den Daten aufgeloest ──────────────────────
/* Rampentests automatisch aus den Fahrten ableiten. Eine Fahrt ist ein
 * Rampentest, wenn ihr Datum auf einen geplanten Test faellt (CFG.plan.events,
 * type:'test') ODER ihr Name "ramp" enthaelt. FTP = 0.75 x MAP (bester 60-s-
 * Wert) - die Rampen-Konvention dieses Projekts. Kein Handeintrag noetig. */
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

/* Alle Tests: automatisch erkannte Rampen + Handeintraege aus CFG.tests
 * (Altfahrten ohne Daten hier, 20-Min-Tests). Zusammenfuehrung nach Datum; ein
 * Handeintrag mit gesetztem ftp gewinnt (Override). 20-Min-Handeintraege ohne
 * ftp: aus der 20-Min-Bestleistung der verknuepften Fahrt (x0.95). */
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
  autoRampTests().forEach(t => byDate.set(t.date, t));       // Auto zuerst …
  manual.forEach(t => { if (t.ftp) byDate.set(t.date, t); });// … Handeintrag gewinnt
  return [...byDate.values()].filter(t => t.ftp)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/* Juengster Test = angezeigte Kerngroesse des Plans. */
function planFtp() {
  const tp = testPoints();
  return tp.length ? tp[tp.length - 1] : null;
}

/* Aktueller FTP: der des juengsten Tests, sonst der Basiswert aus config. */
function currentFtp() {
  const p = planFtp();
  return p ? p.ftp : CFG.athlete.ftpBase;
}

/* Aktueller HRmax: die max_hr aus dem JUENGSTEN Rampentest - dieselbe Quelle
 * wie der FTP, also der aktuelle maximale Effort. Fehlt sie (kein Test / kein
 * HF-Signal), Fallback auf die hoechste je gemessene max_hr, sonst den
 * Basiswert. Unter 150 gilt als unplausibel. */
function currentHrmax() {
  const p = planFtp();
  if (p && p.id) {
    const a = DATA.acts.find(x => String(x.id) === String(p.id));
    if (a && a.max_hr && a.max_hr >= 150) return a.max_hr;
  }
  let m = 0;
  DATA.acts.forEach(a => { if (a.max_hr && a.max_hr > m) m = a.max_hr; });
  return m >= 150 ? m : CFG.athlete.hrmaxBase;
}

/* EINE Aufloesung nach dem Laden: setzt CFG.athlete.ftp/hrmax auf die aus den
 * Daten abgeleiteten aktuellen Werte. Ab hier ziehen ALLE Verbraucher (Zonen,
 * IF, TSS, dp4, Schaetzungen, W/kg) automatisch nach - genau eine Quelle. Die
 * config-Werte bleiben als Basis/Fallback erhalten (ftpBase/hrmaxBase). */
function resolveAthlete() {
  if (CFG.athlete.ftpBase == null) CFG.athlete.ftpBase = CFG.athlete.ftp;
  if (CFG.athlete.hrmaxBase == null) CFG.athlete.hrmaxBase = CFG.athlete.hrmax;
  CFG.athlete.ftp = currentFtp();
  CFG.athlete.hrmax = currentHrmax();
}

/* TSS aus NP und AKTUELLEM FTP - live gerechnet, damit TSS derselben einen
 * Quelle folgt wie IF und die Zonen. Weil TSS ~ NP^2/FTP^2, skaliert ein
 * geaenderter FTP jede Fahrt um denselben Faktor: die Form-Kurve (CTL/ATL/TSB)
 * behaelt ihre Gestalt, nur das Niveau verschiebt sich. Fallback auf den im
 * Backend vorberechneten Wert, wenn keine NP vorliegt. */
function tssOf(a) {
  if (a.np && a.moving_sec) {
    const f = CFG.athlete.ftp;
    return Math.round(a.moving_sec * a.np * a.np / (f * f * 3600) * 100 * 10) / 10;
  }
  return a.tss || 0;
}

// ── Leistungsprofil / Trainingsstatus ───────────────────────────────────────
/* Bestwert eines Power-Kurven-Ankers seit dem Profil-Start (CFG.profile.since),
 * ueber ALLE Fahrten, mit Datum und Fahrt-id. */
function bestSince(key) {
  const since = d(CFG.profile.since);
  let b = null;
  DATA.acts.forEach(a => {
    const v = a.power_curve && a.power_curve[key];
    if (!v || d(a.date) < since) return;
    if (!b || v > b.w) b = { w: v, date: a.date, id: a.id };
  });
  return b;
}

/* Leistungsprofil: je Anker der Bestwert seit Start, mit W/kg, Alter in Tagen
 * und Frische-Flag. Ohne Bestwert -> w:null (ehrlich "kein Wert"). */
function powerProfile() {
  return CFG.profile.anchors.map(an => {
    const b = bestSince(an.key);
    if (!b) return { ...an, w: null };
    const age = dayDiff(today(), d(b.date));
    return { ...an, w: b.w, date: b.date, id: b.id, age,
             wkg: b.w / CFG.athlete.weight,
             fresh: age <= CFG.profile.freshDays };
  });
}

/* CP/W'-Modell (2 Parameter, lineares Work-Time-Modell: Arbeit = CP*t + W').
 * Bestwerte der cpDurations seit Start als Punkte (t, p*t), lineare Regression
 * -> Steigung = CP (W), Achsenabschnitt = W' (J). Braucht >= 2 Dauern. W' < 0
 * heisst: die langen Efforts liegen relativ zu hoch (kein echter Kurz-Effort im
 * Fenster) -> CP dann eher Obergrenze, wird im UI geflaggt. */
function cpModel() {
  const pts = CFG.profile.cpDurations
    .map(t => { const b = bestSince(String(t)); return b ? { t, p: b.w } : null; })
    .filter(Boolean);
  if (pts.length < 2) return null;
  let n = pts.length, st = 0, sw = 0, stt = 0, stw = 0;
  pts.forEach(({ t, p }) => { const w = p * t; st += t; sw += w; stt += t * t; stw += t * w; });
  const denom = n * stt - st * st;
  if (!denom) return null;
  const cp = (n * stw - st * sw) / denom;      // W
  const wPrime = (sw - cp * st) / n;           // J
  return { cp: Math.round(cp),
           wPrime: Math.round(wPrime / 100) / 10,   // kJ, 1 Dezimale
           durations: pts.map(p => p.t), n };
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
