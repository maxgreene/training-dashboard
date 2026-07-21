/* config.js — alle Parameter an einem Ort.
 *
 * Was hier steht, steht NUR hier. Wenn ein Wert im Code auftaucht, ist das ein
 * Fehler. Zwei Ausnahmen, die technisch notwendig sind und unten markiert sind:
 * FTP und HRMAX stehen zusaetzlich in scripts/analyze_activities.py, weil das
 * Backend TSS vorberechnet.
 */
const CFG = {

  // ── Athlet ────────────────────────────────────────────────────────────────
  athlete: {
    ftp: 250,          // ACHTUNG: auch in scripts/analyze_activities.py setzen
    hrmax: 172,        // ACHTUNG: auch in scripts/analyze_activities.py setzen
    weight: 81,
    ftpGoal: 300,      // Ziel des laufenden Aufbaus
    ftpGoalDate: '2026-11-15', // Wunschtermin fuer FTP 300
  },

  // ── Zonen ─────────────────────────────────────────────────────────────────
  // Grenzen als Anteil von FTP bzw. HRmax. Frei verstellbar: das Frontend
  // rechnet aus den Histogrammen in activities.json live neu, ohne Reprocess.
  zones: {
    power: {
      bounds: [0, 0.55, 0.75, 0.87, 1.05],
      names:  ['Z1 Recovery', 'Z2 Grundlage', 'Z3 Tempo', 'Z4 Schwelle', 'Z5 VO2max'],
      colors: ['#3f6b52', '#4a7fb5', '#d4a03c', '#d9673c', '#c0392b'],
    },
    hr: {
      bounds: [0, 0.68, 0.83, 0.88, 0.95],
      names:  ['Z1 Recovery', 'Z2 Grundlage', 'Z3 Tempo', 'Z4 Schwelle', 'Z5 VO2max'],
      colors: ['#3f6b52', '#4a7fb5', '#d4a03c', '#d9673c', '#c0392b'],
    },
    // Coasting (0 W) zaehlt als Z1? true = Anteil an der Fahrtzeit,
    // false = Anteil an der Tretzeit. Beides vertretbar, siehe README.
    countCoasting: true,
  },

  // ── Histogramm-Raster (muss zu analyze_activities.py passen) ─────────────
  hist: {
    pStep: 10,      // Watt je Eimer
    pMax: 1000,
    hrMin: 40,      // bpm, erster Eimer
    hrStep: 2,
    hrMax: 200,
  },

  // ── Plan ──────────────────────────────────────────────────────────────────
  plan: {
    start: '2026-07-13',      // Beginn des FTP-300-Blocks
    futureWeeks: 2,           // wie weit nach vorn gezeigt wird
    showKW: true,             // Kalenderwoche neben der Woche

    // Wochen-Template. Der Plan entsteht daraus, nichts wird von Hand getippt.
    // commutes: Anzahl Arbeitswege an dem Tag (0 am Wochenende — Wolf arbeitet
    // nie am Wochenende, deshalb kann hier kein Pflicht-Commute entstehen).
    template: {
      Mo: { commutes: 2, slot: null },
      Di: { commutes: 2, slot: null },
      Mi: { commutes: 2, slot: 'hard' },     // Rolle, die harte Einheit
      Do: { commutes: 2, slot: null },
      Fr: { commutes: 2, slot: null },
      Sa: { commutes: 0, slot: 'long' },     // lang & ruhig …
      So: { commutes: 0, slot: 'long_alt' }, // … Sa ODER So, je nach Kumpels
    },

    // Blockstruktur: nach buildWeeks Aufbauwochen eine Entlastungswoche.
    blockLen: 4,
    deloadEvery: 4,

    // Bausteine, auf die das Template zeigt.
    units: {
      commute:  { title: 'Commute ×2', desc: 'je ~20 min · Z1–Z2 · nichts über Z2', ifMax: 0.65 },
      long:     { title: 'Lange Ausfahrt', desc: 'ruhig · IF < 0.68 · Sa oder So', ifMax: 0.68 },
      long_alt: { title: 'Lange Ausfahrt (Alternative)', desc: 'falls nicht Sa · sonst frei', ifMax: 0.68 },
      rest:     { title: 'Frei', desc: 'kein Rad' },
      deload:   { title: 'Rolle locker', desc: '45 min Z2 · keine Intervalle' },
    },

    // Progression der Mittwochs-Einheit. Index = Aufbauwoche im Block.
    hardProgression: [
      { title: '3×10 min Schwelle', desc: '95–100 % FTP · 5 min Pause' },
      { title: '4×10 min Schwelle', desc: '95–100 % FTP · 5 min Pause' },
      { title: '3×12 min Schwelle', desc: '98–102 % FTP · 6 min Pause' },
      { title: '2×20 min Schwelle', desc: '95–98 % FTP · 8 min Pause' },
      { title: '3×15 min Schwelle', desc: '96–100 % FTP · 6 min Pause' },
    ],

    // Termine, die das Template ueberschreiben. Datum ISO, damit kein Jahr
    // irgendwo hartcodiert werden muss.
    events: [
      { date: '2026-07-22', type: 'test', title: 'Rampentest',
        desc: 'Rolle · Nullpunkt für den FTP-300-Block · Rampe bis zum Abbruch',
        protected: true },
      { date: '2026-09-16', type: 'test', title: '20-Min-Retest',
        desc: 'Rolle · gleiche Bedingungen wie der Nullpunkt',
        protected: true },
    ],
  },

  // ── Gemessene Rollentests (von Hand gepflegt) ────────────────────────────
  // id optional: ist sie gesetzt und ftp fehlt, wird FTP aus power_curve['1200']
  // × 0.95 abgeleitet.
  tests: [
    { date: '2026-05-21', kind: 'ramp', id: '18599770325', ftp: 237, map: 313 },
    // 23.06.: früh abgebrochen (müde Beine), Peak 307 W. MAP = 60s-Bestwert.
    { date: '2026-06-23', kind: 'ramp', id: '19040836155', ftp: 229, map: 305 },
  ],

  // ── Darstellung ───────────────────────────────────────────────────────────
  ui: {
    easyTarget: [75, 80],        // Zielfenster Easy-Anteil in %
    easyWindowDays: 14,          // Fenster fuer den Easy-Anteil
    p20Goal: null,               // wird aus ftpGoal abgeleitet, s. shared.js
    // 4DP-Benchmarks als Vielfaches der FTP (bei FTP 250: 1200/800/400/250 W)
    dp4: [
      { key: '5',    label: 'NM',  full: 'Sprint 5 s',       mult: 4.8, color: '#a855f7' },
      { key: '60',   label: 'AC',  full: 'Anaerob 1 min',    mult: 3.2, color: '#ef4444' },
      { key: '300',  label: 'MAP', full: 'Max. aerob 5 min', mult: 1.6, color: '#f59e0b' },
      { key: '1200', label: 'FTP', full: 'Schwelle 20 min',  mult: 1.0, color: '#3b82f6' },
    ],
    // Gemeinsame Zeitachse fuer ALLE Zeitreihen-Charts (EF, Belastung,
    // Erholung). Ohne die haette jeder Chart seinen eigenen Nullpunkt und
    // man koennte sie nicht uebereinander lesen.
    timeAxis: {
      start: null,        // null = erste Aktivitaet; sonst 'YYYY-MM-DD'
      padDays: 0,         // Achse endet exakt bei Trainingsstart / heute
      tickStepDays: 14,   // fester Abstand. Ohne den waehlt Chart.js die Ticks
                          // selbst und jeder Chart bekommt ein anderes Raster.
    },

    // Detailplots einer Fahrt: feste Achsen, damit Fahrten vergleichbar sind.
    detail: {
      // MMP: beide Achsen logarithmisch. yMin kann NICHT 0 sein - log(0) ist
      // nicht definiert. 50 W liegt weit unter jedem realen Bestwert.
      mmp: { xMin: 5, xMax: 7200, yMin: 50, yMax: 1000,
             xTicks: [5, 15, 30, 60, 300, 1200, 3600, 7200],
             yTicks: [50, 100, 200, 300, 500, 750, 1000] },
      // HF gegen Leistung, linear. yMax null = HRmax aus athlete.
      scatter: { xMin: 80, xMax: 500, yMin: 80, yMax: null },
    },

    // Belastungsmodell
    load: {
      ctlTau: 42, atlTau: 7,   // Zeitkonstanten (Konvention, keine Messung)
      seedCtl: 40, seedAtl: 40, // Startwerte: bei 0 waere TSB wochenlang
                                // rechnerisch negativ, egal wie erholt man ist.
      settleDays: 42,           // solange gilt das Modell als nicht eingeschwungen
    },

    // EF-Trend (Chart.js-Bubble, wie frueher)
    efTrend: {
      height: 340,
      minDurMin: 30,   // kuerzere Fahrten raus: dort hinkt die HF der Leistung
                       // 30-60 s hinterher und taeuscht einen hohen EF vor.
                       // Auf 10 setzen, um wieder alles zu sehen.
      // null = automatisch aus den Daten (mit yPad Luft). Feste Zahlen
      // schneiden Punkte ab, sobald minDurMin sich aendert: bei 60 min liegt
      // der EF zwischen 1.25 und 1.79, bei 15 min zwischen 0.95 und 2.32.
      yMin: 0.9, yMax: 2.3, yPad: 0.06,
      padRight: 16,   // px Luft am rechten Rand, damit die Blase von "heute"
                      // nicht halb abgeschnitten wird
      dotMinR: 3, dotMaxR: 12,      // Punktgroesse nach Fahrtdauer
      dotMinDur: 30, dotMaxDur: 500,
      alpha: 0.5,
      showTrend: true,
    },

    // Status-Ampel
    status: {
      healthWarnDays: 2,   // Health-Daten aelter -> gelb
      healthErrDays: 3,    // -> rot
      fetchWarnH: 2,       // letzter Fetch aelter -> gelb
      fetchErrH: 6,        // -> rot
    },
  },
};
