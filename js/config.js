/* config.js — alle Parameter an einem Ort.
 *
 * Was hier steht, steht NUR hier. Wenn ein Wert im Code auftaucht, ist das ein
 * Fehler.
 *
 * FTP und HRmax sind hier nur noch BASISWERTE (Fallback). Beim Start leitet
 * resolveAthlete() in shared.js die AKTUELLEN Werte aus den Daten ab — FTP aus
 * dem juengsten Rampentest (0.75 x MAP), HRmax aus der hoechsten gemessenen HF —
 * und ueberschreibt athlete.ftp/hrmax damit. Ab dann ziehen Zonen, IF, TSS,
 * dp4 und alle Schaetzungen aus dieser EINEN Quelle. Das Backend
 * (scripts/analyze_activities.py) rechnet eine TSS mit seinem eigenen FTP nur
 * noch als Fallback vor; die Anzeige rechnet TSS live aus NP + aktuellem FTP.
 */
const CFG = {

  // ── Athlet ────────────────────────────────────────────────────────────────
  athlete: {
    ftp: 250,          // Basiswert/Fallback — real: juengster Rampentest (s.o.)
    hrmax: 172,        // Basiswert/Fallback — real: hoechste gemessene max_hr
    weight: 81,
    ftpGoal: 300,      // Ziel des laufenden Aufbaus
    ftpGoalDate: '2026-11-15', // Wunschtermin fuer FTP 300
  },

  // ── Zonen ─────────────────────────────────────────────────────────────────
  // Grenzen als Anteil von FTP bzw. HRmax. Frei verstellbar: das Frontend
  // rechnet aus den Histogrammen in activities.json live neu, ohne Reprocess.
  //
  // INDIVIDUALISIERT nach Laktat-Stufentest (mha-sport, 16.10.2020, MLSS 290 W,
  // HRmax ~174). Wolfs HF laeuft niedrig fuer die Leistung: die Labor-Bereiche
  // liegen deutlich unter den Standard-Modellen (Coggan/%HRmax). Gemessen:
  // REKOM 86-106 · GA1 106-129 · GA2 129-146 · EB/Schwelle 146-163 bpm;
  // GA1-Obergrenze Leistung 190 W (= 0.66 x MLSS). Deshalb HF-Z2 endet bei
  // ~0.75 HRmax (nicht 0.83) und Leistungs-Z2 bei ~0.66 FTP (nicht 0.75).
  zones: {
    power: {
      bounds: [0, 0.55, 0.66, 0.87, 1.05],   // Z2-Top 0.66 (Labor GA1 = 190/290)
      names:  ['Z1 Recovery', 'Z2 Grundlage', 'Z3 Tempo', 'Z4 Schwelle', 'Z5 VO2max'],
      colors: ['#3f6b52', '#4a7fb5', '#d4a03c', '#d9673c', '#c0392b'],
    },
    hr: {
      bounds: [0, 0.62, 0.75, 0.85, 0.95],   // Labor: 106 / 129 / 146 / 163 bpm bei HRmax 171
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
      Di: { commutes: 2, slot: null, commuteQuality: 'ss' }, // 1 Weg als SS-Block
      Mi: { commutes: 2, slot: 'hard' },     // Rolle, die harte Einheit
      Do: { commutes: 2, slot: null, commuteQuality: 'ss' }, // 1 Weg als SS-Block
      Fr: { commutes: 2, slot: null },
      Sa: { commutes: 0, slot: 'long' },     // lang & ruhig …
      So: { commutes: 0, slot: 'long_alt' }, // … Sa ODER So, je nach Kumpels
    },

    // Blockstruktur: nach buildWeeks Aufbauwochen eine Entlastungswoche.
    blockLen: 4,
    deloadEvery: 4,

    // Intensitaets-Anteile vom AKTUELLEN FTP. Watt wird live gerechnet
    // (Anteil x CFG.athlete.ftp), zieht also nach jedem Rampentest mit.
    // Grund (zeitgeknappt): Dauer ist gedeckelt, also holt Wolf den Reiz ueber
    // Intensitaet in den kurzen Commute-Fenstern. SS = Sweet Spot.
    intensity: {
      ss:  [0.88, 0.94],   // Sweet Spot
      thr: [0.95, 1.05],   // Schwelle
    },

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
      { date: '2026-09-02', type: 'test', title: 'Rampen-Retest',
        desc: 'Rolle · gleiche Bedingungen wie der Nullpunkt · Rampe bis zum Abbruch',
        protected: true },
      { date: '2026-10-14', type: 'test', title: 'Rampen-Retest',
        desc: 'Rolle · letzter steuerbarer Check vor dem Ziel · gleiche Bedingungen',
        protected: true },

      // Petersberg-Challenge mit Ingo (Sub-8 auf 2,1 km / 178 Hm / 8,7 %).
      // Ziel-Watt aus Physik: ~371 W (81 kg, leichtes Bergrad), unabhaengig vom
      // FTP. 8 min all-out = VO2max/MAP, deshalb die Mittwoche davor auf
      // VO2/race-spezifisch statt Schwelle. WICHTIG: der Termin ist ein FENSTER
      // 19.-24.09 (Wetter/Ingo), kein fixer Tag. Deshalb: letzte harte Einheit
      // 16.09, ab 17.09 nur Taper, echter Baseline-Effort am Berg auf 13.09
      // vorgezogen (der 19.09 kann schon Versuchstag sein). Der Rampentest lag
      // urspruenglich 23.09, mitten im Fenster: nach 30.09 geschoben (oben).
      { date: '2026-09-09', type: 'vo2', title: 'Rolle: 5×3 min VO2max',
        desc: '110 % FTP · 3 min Trab · MAP heben fuers 8-min-Ceiling',
        protected: true },
      { date: '2026-09-13', type: 'sim', title: 'Petersberg Baseline',
        desc: 'Anstieg ~8 min zuegig, Zeit + Pacing nehmen · kontrolliert hart, NICHT ganz Vollgas · dein echter Ausgangswert',
        protected: true },
      { date: '2026-09-16', type: 'vo2', title: 'Rolle: 3×6 min race-spezifisch',
        desc: '355–375 W (Sub-8-Pace) · LETZTE harte Einheit vor dem Fenster',
        protected: true },
      { date: '2026-09-17', type: 'sim', title: 'Taper: locker',
        desc: '45 min Z2 · keine Intervalle · Beine frisch machen',
        protected: true },
      { date: '2026-09-19', type: 'challenge', title: 'Petersberg-Challenge – Fenster 19.–24.09',
        desc: 'Versuchstag nach Wetter/Ingo · Oeffner 3×1 min, dann gleichmaessig Vollgas ~371 W (leichtes Rad, ~15,8 km/h) · NICHT mit Antritt starten · Sub-8',
        protected: true },
      { date: '2026-09-20', type: 'sim', title: 'Challenge-Fenster: Öffner + locker',
        desc: 'Versuch moeglich · an Nicht-Versuchstagen kurz oeffnen (3×1 min) + locker · Glykogen voll halten · Fenster bis Do 24.09',
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
    // 22.07.: Nullpunkt fuer den FTP-300-Block. FTP = 0.75 x MAP (361 W 60s-Best).
    { date: '2026-07-22', kind: 'ramp', id: 'garmin_23694693519', ftp: 271, map: 361 },
  ],

  // ── Leistungsprofil / Trainingsstatus ────────────────────────────────────
  // Kennzahlen aus ALLEN Fahrten seit Trainingsstart: je Anker der Bestwert
  // der Mean-Maximal-Power-Kurve. CP/W' als Gegenprobe zum Rampen-FTP.
  profile: {
    since:     '2026-05-04',   // Fenster: ab Trainingsstart (wie PLAN_START)
    freshDays: 21,             // bis hier gilt ein Bestwert als frisch
    anchors: [                 // Dauer-Anker (Schluessel = Sekunde in power_curve)
      { key: '5',    label: 'NM',       full: 'Neuromuskulaer · Sprint 5 s',  col: '#a855f7' },
      { key: '60',   label: 'AC',       full: 'Anaerobe Kapazitaet · 1 min',  col: '#ef4444' },
      { key: '300',  label: 'MAP',      full: 'Max. aerobe Leistung · 5 min', col: '#f59e0b' },
      { key: '1200', label: 'Schwelle', full: 'Schwelle · 20 min',            col: '#3b82f6' },
    ],
    cpDurations: [120, 300, 600, 1200], // Bestwerte fuer den CP/W'-Fit (2-20 min)
  },

  // ── Ernaehrung ────────────────────────────────────────────────────────────
  // NUR Darstellung und Mechanik. Die ZIELE (kcal, Protein, Ballaststoffe,
  // Fluessigkeit) stehen NICHT hier: dieses Repo ist oeffentlich. Sie liegen
  // im verschluesselten Tresor (vault.goals in data/nutrition/log.enc.json),
  // gesetzt per `nutri.py goals --kcal 1800`. food.js liest sie erst nach dem
  // Entsperren. Ein nicht gesetztes Ziel (null) zeichnet keine Linie und
  // keinen Balken-Rest, genau wie ein EF-Band ohne genug Fahrten wegfaellt.
  food: {
    // Chiffretext direkt von raw.githubusercontent, nicht aus dem
    // Pages-Artefakt: Pages braucht nach einem Push Minuten, raw ist sofort
    // aktuell. Deshalb haengt an jedem Abruf ein Zeitstempel (max-age=300).
    rawBase: 'https://raw.githubusercontent.com/maxgreene/training-dashboard/main/data/nutrition/',

    // Tagesgrenze in Stunden. 0 = Mitternacht. Auf 4 setzen, wenn ein Snack
    // um 01:00 noch zum Vortag zaehlen soll.
    // SYNC-PFLICHT: muss mit DAY_CUTOFF_H in scripts/nutri.py uebereinstimmen.
    // Dokumentierte Ausnahme zur Ein-Ort-Regel: Python und JS koennen einander
    // nicht lesen, gleiche Lage wie FTP/HRmax zwischen config.js und
    // analyze_activities.py. Beim Aendern BEIDE Stellen anfassen.
    dayCutoffH: 0,

    rangeDays: { week: 7, month: 30 },   // Fenster der beiden Verlaufsansichten
    chartH: { kcal: 220, macro: 200 },   // px. Hoehe gehoert ins JS, nicht ins CSS.

    // Naehrwerte: Anzeigename, Einheit, Farbe, Nachkommastellen.
    // kcal/ml ganzzahlig, Makros auf 0.1 g.
    macros: {
      kcal: { lbl: 'Energie',       unit: 'kcal', col: '#60a5fa', dec: 0 },
      p:    { lbl: 'Protein',       unit: 'g',    col: '#34d399', dec: 1 },
      k:    { lbl: 'Kohlenhydrate', unit: 'g',    col: '#fbbf24', dec: 1 },
      f:    { lbl: 'Fett',          unit: 'g',    col: '#f472b6', dec: 1 },
      b:    { lbl: 'Ballaststoffe', unit: 'g',    col: '#a78bfa', dec: 1 },
      ml:   { lbl: 'Flüssigkeit',  unit: 'ml',   col: '#38bdf8', dec: 0 },
    },

    // Lueckenfueller fuer die Karte REST DES TAGES. Werte je 100 g, direkt
    // aus dem BLS 4.0 (Code in Klammern), damit die Vorschlaege auf denselben
    // Zahlen stehen wie die Eintraege. 'fills' = wofuer der Posten gedacht ist.
    // Kurz halten: drei Vorschlaege je Luecke reichen, das ist eine Kachel,
    // kein Kochbuch.
    fillers: [
      { name: 'Kartoffeln gekocht', fills: 'k', kcal: 76,  p: 2.0,   k: 15.83, f: 0.1,  b: 2.05 },  // k110132
      { name: 'Reis trocken',       fills: 'k', kcal: 351, p: 7.93,  k: 77.1,  f: 0.62, b: 2.5  },  // c352000
      { name: 'Nudeln trocken',     fills: 'k', kcal: 346, p: 12.4,  k: 68.83, f: 1.6,  b: 3.41 },  // e401000
      { name: 'Banane',             fills: 'k', kcal: 79,  p: 1.32,  k: 15.89, f: 0.4,  b: 2.0  },  // f503100
      { name: 'Magerquark',         fills: 'p', kcal: 66,  p: 11.85, k: 3.68,  f: 0.18, b: 0    },  // m713100
      { name: 'Hähnchenbrust',     fills: 'p', kcal: 128, p: 23.3,  k: 0,     f: 3.9,  b: 0    },  // v413132
      { name: 'Haferflocken',       fills: 'b', kcal: 348, p: 13.22, k: 53.3,  f: 6.65, b: 10.98 }, // c133000
    ],

    // Ab dieser Luecke lohnt ein Vorschlag. Darunter ist die Sache gegessen.
    restMin: { p: 10, k: 20, b: 8, ml: 300 },

    // Atwater-Faktoren fuer die Makro-Verteilung nach Energie (kcal je g).
    atwater: { p: 4, k: 4, f: 9 },
  },

  // ── Darstellung ───────────────────────────────────────────────────────────
  ui: {
    easyWindowDays: 14,          // Fenster fuer den Ride-Plot
    // Ride vs Z2/Z3-Decke: je Fahrt Ø ± 1sd von Leistung und HF, relativ zur
    // aeroben Decke (1.0). Letzte easyWindowDays Tage.
    easyPlot: {
      height: 200,
      dotMinR: 3, dotMaxR: 9,    // Punktgroesse nach Dauer
      dotMinMin: 10, dotMaxMin: 300,
      colP: '#60a5fa',           // Leistung (blau)
      colHr: '#7ec8a0',          // HF (gruen)
      bandAlpha: 0.10,           // Deckkraft des aeroben Bereichs (< 1.0)
      relMax: 2.0,               // y-Achse: Vielfaches der Decke
      violinW: 0.13,             // halbe Violin-Breite als Anteil eines Tages
      violinTrim: 0.05,          // Zeitanteil je Ende abschneiden (Sprint-Schwanz)
      dx: 0.15,                  // x-Versatz, damit Leistung/HF nicht ueberlappen
    },
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
      minDurMin: 25,   // kuerzere Fahrten raus: dort hinkt die HF der Leistung
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
      trendTau: 12,       // Tage: Zeit-Konstante des zeit-gewichteten EWMA der
                          // Trendlinie. Groesser = glatter/traeger. Behebt das
                          // Zacken durch ungleich verteilte Fahrten.
      trendAlpha: 0.15,   // Fallback, falls trendTau mal null gesetzt wird
      bandAlpha: 0.1,     // Deckkraft der +-1sigma-Flaeche
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
