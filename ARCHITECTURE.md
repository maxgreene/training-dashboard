# Training Dashboard — Vollständige Architektur & Projekt-Historie

> Aufgebaut aus der gesamten Transcript-Historie (11 Sessions, Mai–Juli 2026).
> Lebendes Dokument. Fakten sind aus den Transcripts belegt oder gegen das
> Live-Repo verifiziert. Vor Änderungen an Triggern, Deployment oder Datenfluss
> hier zuerst lesen.

Repo: github.com/maxgreene/training-dashboard
Live: maxgreene.github.io/training-dashboard
Athlet: Wolf Harmening

Status der Doku: **IN ARBEIT** — Sessions durchgearbeitet: 11/11 (vollständig).

---

## Teil A — Projektursprung & Zielsetzung (aus Session 2026-05-08 früh)

**Ausgangslage:** Rennrad- und Gravelfahrer seit ~2015.
Nach Verletzungsjahr zurückgefallen. FTP anfangs auf ~220W geschätzt (2.72 W/kg).
Arbeitet 8:00–18:00, kann den Arbeitsweg (Commute, beidseitig Rad, 4–25 km
flexibel) als Trainingseinheit nutzen. Rolle (Tacx) im Keller für gezielte
Einheiten. Zeichnet mit Wahoo ELEMNT Bolt/ROAM v3 auf, synct zu Strava.

**Ziel:** Bis 10. Juli topfit für ein langes Rad-Wochenende. Zielleistung ~240–250W (~3.0 W/kg).

**Trainingsplan-Grundstruktur (3 Phasen + Taper):**
- Phase 1 Reaktivierung (Wo 1–3, bis ~25.5.): aerobe Basis, KEINE harten
  Intervalle, Verletzungsrisiko minimieren, FTP-Schätzung verfeinern.
- Phase 2 Aufbau (Wo 4–6, bis ~15.6.): Volumen leicht hoch, Schwellenarbeit,
  Sweetspot, Commutes gezielt nutzen.
- Phase 3 Form & Peak (Wo 7–9, bis ~4.7.): höhere Intensität, kürzere Einheiten
  mit Punch, VO2max-Reize, Volumen runter/Qualität rauf.
- Taper (Wo 10, 5.–10.7.): locker, frisch ankommen.

**Volumen:** Phase 1: 5–6h, Phase 2: 6–8h, Phase 3: 7–8h. (10h/Woche war früher
zu viel.)

**Adaptiver Ansatz (Kern-Idee von Anfang an):** Plan wird nicht starr getippt,
sondern über Feedback-Checkpoints laufend verfeinert (FTP-Updates, Gefühl,
Wochenstunden). Drei Checkpoints geplant: ~25.5., ~15.6., ~1.7. Das ist die
Keimzelle der späteren adaptiven Plan-Logik im Dashboard.

**Diagnostik-Ansatz (dreistufig):**
1. Sofort: .fit-Analyse vorhandener Rides -> Power-Curve, HR/Watt-Drift.
2. Ende Phase 1 (~25.5.): Rampentest (~20–25 Min) für MAP/FTP.
3. Mitte Phase 2 (~10.6.): voller 4DP-Test (Sufferfest-Modell: NM 5s / AC 1min /
   MAP 5min / FTP 20min).

**Frühe Erkenntnis:** Anfangs nur Rides ohne Powermeter (Gravel-Bike hatte noch
keinen PM). Wolf rüstete 4iiii-PM nach. Damit beginnt die Watt-basierte Analyse.

**.fit-Bezug:** Anfangs Unsicherheit über USB-Export vom Bolt. Lösung: Strava-
Export ("Original exportieren"). Das ist der Startpunkt der späteren Strava-API-
Integration.


---

## Teil B — Infrastruktur-Geburt & Metrik-Formeln (Session 2026-05-08 spät)

**Erste Infrastruktur:** Strava-API-Anbindung (`scripts/fetch_activities.py`),
GitHub Actions Workflow, erstes HTML-Dashboard, GitHub Pages Deployment.
Anfangs FTP 240, HRmax 175 (in den Metadaten).
PLAN_START war zunächst 2026-05-06 (später auf 05-04 korrigiert).

**Die Original-Metrik-Formeln (in Session 2 entstanden, bis heute stabil):**

- **Normalized Power (Coggan-Standard):** 30s-Rolling-Average der Watt, jeder
  Wert hoch 4, Mittel, dann 4. Wurzel. `round((mean(rolling_avg^4))^0.25)`.
  Braucht >= 30 Datenpunkte. WICHTIG: inkl. Nullen im Rolling-Average.
- **Power-Kurve (MMP):** bestes Mittel über Fenster [5,10,30,60,120,300,600,1200]
  Sekunden (später erweitert um 1800, 3600). `max(mean(watts[i:i+d]))`.
- **HR-Zonen:** bounds [0, 0.68, 0.83, 0.88, 0.95, 1.0] × HRmax. 5 Zonen,
  Anteil in % der Zeit.
- **Power-Zonen:** bounds [0, 0.55, 0.75, 0.87, 1.05, 999] × FTP. 5 Zonen.
- **Decoupling (erste Version):** EF erste Hälfte vs zweite Hälfte,
  `(r2-r1)/r1*100`.

**WICHTIG — Ursprung der späteren Redundanz:** Diese Formeln wurden ZUERST in
fetch_activities.py angelegt (damals gab es analyze noch nicht). Später kam
analyze_activities.py dazu und dupliziert sie. Am 1.7.2026 (Session 11) wurde
die Redundanz bereinigt: fetch berechnet keine Kennzahlen mehr, nur noch analyze.

**Cron-Historie (WICHTIG für Trigger-Verständnis):**
- Start: GitHub-eigener Cron `*/15 * * * *`, aber GitHub DROSSELT Cron auf
  "inaktiven" Repos (wenig Push/Besuch).
- 1. Workaround: `keepalive.yml` — täglicher Leer-Commit hält Repo "aktiv"
  (mit Zufalls-sleep 0–30min, damit es organisch aussieht).
- Später (spätere Session): externer Dienst **cron-job.org** ruft die GitHub-API
  direkt auf (workflow dispatch) — die robuste Lösung, die bis heute läuft.
  DAS ist der eigentliche Takt, nicht GitHubs Cron.

## Teil C — Aerobe Metriken & HR-Kinetik (Session 2026-05-14)

**Die drei aeroben Kernmetriken (hier sauber definiert):**
1. **Efficiency Factor (EF) = NP / Ø HR** (W pro bpm). Höher = effizienter.
2. **Aerobic Decoupling (Pw:Hr):** vergleicht EF erste vs zweite Hälfte.
   `(EF1 - EF2) / EF1`. Unter 5% = gute aerobe Ausdauer.
3. **Cardiovascular Drift:** HR steigt bei konstanter Leistung über Zeit
   (Dehydration, Wärmeumverteilung, sinkendes Schlagvolumen). Korreliert mit
   Decoupling.

**Zentrale Erkenntnis (Wurzel des späteren Scatter-Cleanups):** HR reagiert
VERZÖGERT auf Leistungsänderungen — Watt sofort, HR mit Latenz. Deshalb ist der
HR-Watt-Scatter bei variablen Einheiten wenig aussagekräftig; Decoupling nur bei
gleichmäßigen Ausdauereinheiten sinnvoll. (Führte später zum quasi-stationären
Filter mit powerCoV + hrDriftMax.)

**Drift-Filterung:** Warmup (erste ~3min) und Cooldown (letzte ~5min) müssen
rausgeschnitten werden, sonst verfälscht der Cooldown den Drift (Beispiel: 9.2%
roh vs 3.3% sauber). Führte zu trim_core (später 8% Trim je Seite).

**Rolling EF Visualisierung:** Statt reinem Scatter besser der EF über Zeit als
Rolling-Linie (60s, 120s) — zeigt klarer ob Effizienz über die Einheit sinkt.
Dies wurde zur EF-Chart mit instant/60s/120s Glättungsstufen.

**Zonen-Farbschema (durchgängig):** z1 #34d399 (grün), z2 #60a5fa (blau),
z3 #fbbf24 (gelb), z4 #f97316 (orange), z5 #ef4444 (rot).


---

## Teil D — Drei-Dateien-Architektur (Session 2026-05-25)

**Die zentrale Architektur-Entscheidung (von Wolf selbst entworfen!):** Trennung
in drei Dateitypen und zwei Skripte. WICHTIG: Die saubere Trennung fetch=holen /
analyze=analysieren war von ANFANG AN Wolfs Absicht — genau das, was am 1.7.
(Session 11) nach zwischenzeitlicher Redundanz wiederhergestellt wurde.

**Drei Dateitypen, drei Aufgaben:**
- `data/streams/{id}.json` — Rohdaten, sekündlich, UNVERÄNDERLICH (time, watts,
  hr, altitude, cadence, speed roh).
- `data/activities.json` — schlank, für schnellen Dashboard-Start (Metadaten +
  vorberechnete Kachel-Werte + Mini-Chart ~60-80 Punkte, KEINE Roh-Streams).
- `data/analysis/{id}.json` — vorberechnete Detail-Analyse, on-demand geladen
  (Dual-Chart ~200 Punkte downsampled, Rolling EF, Scatter, Trim-Stats
  [EF1, EF2, Drift, Halbzeit], Power-Curve-Detail). Nur für Rides >30min mit HR+Power.

**Zwei Skripte:**
- `fetch_activities.py` — holt Metadaten + Streams (resolution=high).
- `analyze_activities.py` — nur Analyse, Detail-Vorberechnung.
- Pipeline: fetch -> analyze -> deploy.

**ANALYSIS_VERSION-Mechanik:** Bump (damals 8->9) erzwingt Neuabruf/Neuanalyse
aller Aktivitäten. Lag früher in GitHub Secrets, später als Konstante im Code.

**Detail-Panel-Struktur (buildDetail):** Power-Sektion (Ø/Max Watt, Kadenz,
Chart, Power-Curve mit %FTP, Zonen mit ZEIT pro Zone), HR-Sektion (Ø/Max HR,
Chart, Zonen mit Wahoo-Labels Easy/Fat Burn/Cardio/Hard/Peak + Zeit).

**Adaptive Plan-Anpassung in Aktion:** Wolf gibt Verfügbarkeiten durch
(z.B. "Mi Besuch, Fr-So unterwegs"), Plan wird ohne Trainingseinbußen umgebaut.
Alle Wochen starten Montag.

## Teil E — Metrik-Bugfixes & Research-Grade-Anspruch (Session 2026-05-31)

**Wolfs Leitprinzip (wörtlich):** "research-grade Analyse, nicht nur was fürs
Auge. Alle Berechnungen müssen stimmen. Triple-Check!" — gilt für das ganze Projekt.

**Kritische Metrik-Fixes hier etabliert:**
- **EF gesamt = NP_core / Ø HR_core** — NICHT das Mittel der Rolling-EF-Werte
  (das ist mathematisch Unsinn). War Frontend-Bug (1.536 statt korrekt 1.355).
- **Rolling EF: 120s-Fenster + avg Power** (nicht NP4, nicht 30s) — sonst Spikes
  bis 3.44 an Null-Watt-Momenten (Kurven, Bremsen). Pausen werden gefiltert.
- **`or {}` statt Default-Argument:** `res.get('decoupling', {})` gibt None
  zurück wenn Key existiert aber None ist (Ride zu kurz). Fix: `... or {}`.
- **Null-Watt-Punkte raus** aus EF-Berechnung.
- **Scatter: square axis ratio**, X-Achse auf Bereich wo 90%+ der Punkte liegen.

**Detail-Panel-Layout (Wolfs Vorgabe):** Plots oben, Zahlen unten. Zeitreihe
HR+Watt zusammen, darunter Rolling EF. Datenpunkte transparent einzeln + Linie
(Rolling-Mittel) durch. Achsen müssen sauber passen, nichts Redundantes.

## Teil F — 4iiii-Kalibrierung & UI-Cleanup (Session 2026-06-19)

**4iiii Power-Meter Untersuchung (Vorgeschichte des 1.247-Faktors):**
Auslöser: Wolf fuhr neben Partner Ingo (Stages PM), dessen Werte bei gleichem
Gewicht 50-70W HÖHER. GPX-Vergleich durchgeführt.

**Drei kombinierte Ursachen für 4iiii-Underreading:**
1. **Einseitige Messung + Bein-Asymmetrie:** linker 4iiii verdoppelt nur das
   linke Bein. Bei 48:52-Asymmetrie (linkes Bein schwächer) systematisch zu wenig.
2. **Temperatur-Drift ohne Kalibrierung:** Zero-Offset setzt Temperatur-Baseline;
   bei Anstiegen/Abfahrten wechselt Temperatur stark.
3. **Bekanntes 4iiii-Low-Reading** nach Batteriewechsel/langer Pause. Fix:
   Batterie umgekehrt einlegen, 10s, dann korrekt (entfernt Restladung).

**Lösungsschritte:** Zero-Offset vor jeder Fahrt (Wahoo: Sensor -> Kalibrieren,
Kurbel 6-Uhr, 10s), Batterie-Reset, Scale Factor in 4iiii-App, Firmware-Update,
Rollenvergleich 4iiii vs Tacx für echten Offset. (Führte später zum fixen
Faktor 1.247 für die betroffenen Aktivitäten vom 30.5.)

**UI-Cleanup:** Alle Yoga-Einheiten entfernt. Alle Emojis raus, ersetzt durch
farbige Typkürzel (statt Emoji-Icons klare Text-Tags mit Farbe/Font).


---

## Teil G — Duration-Fixes, TSS, Garmin-Anbindung (Sessions 2026-06-24)

**Duration-Fixes (kritisch):** Strava cappt High-Res-Streams bei ~10000 Punkten.
Daher ist die Sample-Anzahl NICHT die Sekundenzahl. Dauer aus echten Zeitstempeln
(time[-1]-time[0]), nicht aus len(). Bewegte Zeit (duration_sec, aus moving-Stream
summiert) vs Gesamtzeit (elapsed_sec). Detail-Panel zeigt bewegte Zeit groß,
"gesamt X" als Sub bei >15% Differenz. Beispiel Saarbrücken 231km: moving ~9.6h,
elapsed ~12h (2.5h Pausen) — 167min-Bug war len()-basiert.

**TSS:** Wahoo liefert TSS direkt in der Workout-Summary (power_bike_tss_last).
Für Rides ohne diesen Wert kJ-basierte Schätzung. Große Rides: 230km/3700hm
~550-650 TSS auf einen Schlag (mehr als W1-W3 zusammen). Die moving-vs-elapsed-
Debatte betraf auch TSS (moving gab zu niedrige Werte bei langen Fahrten mit Pausen).

**Wahoo-Migration Beginn:** Wahoo API (user_id in PRIVAT.md). Workout-Summary-Felder:
power_bike_np_last, power_bike_tss_last, power_avg, heart_rate_avg, distance_accum,
duration_active/paused/total_accum, file.url (FIT-Datei). OAuth-Flow mit
rotierendem Refresh-Token. Alternativen erwogen: Intervals.icu (aggregiert Strava/
Wahoo/Garmin), Garmin Connect API — verworfen zugunsten direkter Wahoo-Anbindung.

**Garmin-Integration Beginn:** garth-Lib. Health-Daten (HRV, Ruhe-HR, Schlaf,
Stress, Body Battery) für die Form-Seite.

## Teil H — Form-Seite, adaptive Logik, Scatter-Cleanup (Sessions 2026-07-01)

**Form-/Fitness-Modell (CTL/ATL/TSB) — computeLoadModel():**
- Tägliche TSS-Serie ab Plan-Start, exponentiell gewichtet.
- CTL (Chronic Training Load = Fitness): tau=42 Tage.
- ATL (Acute Training Load = Müdigkeit): tau=7 Tage.
- TSB (Training Stress Balance = Form) = CTL − ATL.
- **Seed CTL=ATL=40** (LOAD_SEED): Wolf war Anfang Mai schon trainiert, ohne Seed
  wäre TSB überzeichnet (-29 statt realistisch -19).
- SETTLE_DAYS=42: erste 42 Tage als "settling" markiert (grau im Chart,
  "Einschwing-Phase, Werte noch ungenau").

**readinessFor(date) — Ampel:** Kombi-Score aus garminScore (HRV vs 30-Tage-
Baseline: >+5%->+1, <-8%->-1; Schlaf >=7.5h->+1, <6h->-1) + tsbScore (TSB>5->+1,
<-20->-1). Ampel grün/gelb/rot mit 1 Satz Begründung.

**FF-Chart:** CTL blau (fill) / ATL orange auf linker Achse, TSB grün gestrichelt
auf RECHTER y1-Achse (±40, sonst plattgedrückt). Grauer settling-Bereich.

**HRV/RHR-Chart:** Streupunkte + EWMA-Trendlinien (α=0.1) statt linear + Band
(±1 exp. gewichtete SD). HRV lila (links), RHR rot (rechts). Wolf wählte bewusst
EWMA statt linearem Trend oder 9-Tage-Median.

**Adaptive Plan-Logik — adaptDay(d, weekIdx, week):** Passt zukünftige harte
Einheiten der nächsten 7 Tage an die Form an. ASYMMETRISCH — nur hart->leicht,
nie umgekehrt. Rot->"Z2 locker (angepasst)" (Badge rot, Original durchgestrichen).
Gelb->Dosis-Hinweis (-5-10%, ein Intervall weniger). Grün->"oberes Ende möglich".
**Taper-Schutz:** Phasen mit Keyword /TAPER|ZIEL|EVENT|BB2026|EYECYLE/i kriegen
Badge GESCHÜTZT (lila), werden NIE abgeschwächt. Reine Anzeigeschicht, ändert
PLAN_WEEKS nicht.

**adaptDay Bug-Historie (Lehrstück):** adaptDay ist global, nutzte aber dateObj/
isDone/now die LOKAL in renderPlan definiert sind -> ReferenceError (temporal dead
zone / scope) -> renderPlan bricht -> Seite hängt bei "Lade Daten". Fix: adaptDay
autark gemacht mit eigenen Helfern _dateObj/_isDone/_now.

**HR-Watt-Scatter-Cleanup (CONFIG.scatter):** Lehrbuch-Filter für quasi-stationäre
Phasen (Wurzel: HR-Latenz aus Session 3). Parameter: minRideMin=45, minWatt=60,
minCad=40, windowSec=30, powerCoV=0.12 (max Leistungsschwankung), hrDriftMax=6
(max HR-Drift im Fenster). Entfernt Coasting, Antritte, nicht-eingeschwungene HR.
R² springt ~0.08->0.47. Toggle "● stabil/○ roh" (nur ab 45min). Wichtigste
Stellschrauben: powerCoV + hrDriftMax.

**HRMAX-Änderung:** 175 -> 173 (Wolf erreicht selbst hart nur 167; einziger
174-Wert = Mai-Rampentest 21.5.). Muss in fetch, analyze, index.html synchron sein.

## Teil I — Strava→Wahoo-Migration & Audit (Session 2026-07-01 spät)

**Strava-Tod:** Ab 30.6.2026 Abo-Pflicht für Standard-Tier -> HTTP 403. Wolf kann
nicht hochstufen. Migration zu Wahoo als Hauptquelle.

**Wahoo-Validierung:** 10 Juni-Fahrten Strava vs Wahoo verglichen — NP/avgW/HR
aufs Watt identisch (max Δ: NP 0W, avgW 0.2W, HR 0.1bpm). Beide bekommen dieselbe
ELEMNT-FIT-Datei. FIT-Parsing via fitparse, Streams im exakten Strava-Format.

**Stichtag WAHOO_START_DATE=2026-07-01:** Vergangenheit (Strava-Streams) bleibt
eingefroren, nur neue Fahrten ab 1.7. via Wahoo. FREEZE-Schutz: bestehende
streams/{id}.json werden NIE überschrieben.

**NAME_FIXES:** Wahoo-Auto-Titel ("Radfahren"/"Cycling") dürfen spezifische Namen
nicht überschreiben (z.B. ClassicCrew id 19093792211).

**Cron-Trigger-Diagnose (der große Aha-Moment):** Trigger läuft über EXTERNEN
Dienst cron-job.org, der die GitHub-API aufruft (workflow dispatch). Beim
Umbenennen fetch-strava.yml -> fetch-training-data.yml zeigte die cron-job.org-URL
noch auf die tote alte Datei (404) -> alle Trigger schlugen fehl. Gelöst durch
URL-Update. deploy.yml hängt am Workflow-NAMEN, nicht am Dateinamen — blieb daher
funktionsfähig.

**Redundanz-Cleanup:** fetch berechnete Kennzahlen doppelt (Altlast aus Session 2).
Entfernt — fetch schreibt nur Register+Rohdaten, analyze ist einzige Quelle der
Kennzahlen. Dabei _writeback-Fix: analyze schreibt Werte auch dann ins
activities.json zurück wenn analysis/{id}.json schon aktuell ist (sonst leere
Übersicht nach Version-Bump).

**Workflow-Härtung:** setup-python + continue-on-error an unkritischen Steps
(Garmin-429 killt nicht mehr den Job). deploy.yml: cancel-in-progress:false
(sonst Pages-Queue-Stau). deploy.yml braucht BEIDE Trigger (push + workflow_run),
weil Bot-Commits mit GITHUB_TOKEN den push-Trigger unterdrücken.

---

---

# TECHNISCHE REFERENZ (konsolidiert, Stand 2026-07-06)

Diese Referenz führt die früher separate `FAKTEN_verifiziert.md` zusammen und
ergänzt die Erkenntnisse vom 06.07.2026. Direkt gegen das Live-Repo geprüft.

## System in einem Satz

Ein statisches Dashboard auf GitHub Pages, das seine Trainings- und Gesundheits-
daten über GitHub-Actions-Workflows selbst aus Wahoo (Rad) und Garmin (Health)
holt, aufbereitet und als JSON ins Repo committet — die Website liest diese JSONs
im Browser.

## Datenfluss

```
cron-job.org (alle 20 Min)
   └─> triggert Workflow "Fetch Training Data" (dispatch-API)
        ├─ fetch_activities.py : Wahoo-FITs -> data/streams/{id}.json (Rohdaten)
        │                        + Register -> data/activities.json (ohne Kennzahlen)
        ├─ analyze_activities.py: streams+activities -> data/analysis/{id}.json
        │                        + Kennzahlen zurück in activities.json
        ├─ fetch_garmin.py      : Garmin Health -> data/health.json
        └─ commit nach main (nur wenn sich etwas geändert hat)
             └─> triggert Workflow "Deploy to GitHub Pages"
                  └─ baut _site/ (nur Website-Dateien) -> deploy-pages
                       └─> Live: maxgreene.github.io/training-dashboard
```

Die Website (`index.html`) lädt im Browser: `data/activities.json` (Liste),
`data/analysis/{id}.json` (Details beim Klick auf eine Fahrt), `data/health.json`
(Form-Seite). **`data/streams/` wird von der Website NIE geladen** — nur intern
vom Fetch für die Recovery gebraucht.

## Trigger (3 Wege)

1. **cron-job.org** (extern, eigentlicher Takt, alle 20 Min):
   `POST api.github.com/repos/maxgreene/training-dashboard/actions/workflows/fetch-training-data.yml/dispatches`
   Header `Authorization: Bearer <GH_PAT>`, Body `{"ref":"main"}`, Erfolg = HTTP 204.
   ⚠ Bei Umbenennung der Workflow-Datei MUSS diese URL angepasst werden.
   ⚠ cron-job.org deaktiviert den Job dauerhaft nach zu vielen Fehlern und
   reaktiviert NICHT von selbst — nach URL-/PAT-Änderung prüfen ob "enabled"
   und "Next Runs" gefüllt; Test-Run muss 204 geben.
2. GitHub-Cron `schedule: '0 * * * *'` in fetch-training-data.yml (stündliches Backup).
3. Manuell: Actions → Fetch Training Data → Run workflow (workflow_dispatch).

## Deployment

- `deploy.yml` triggert auf `push` (main), `workflow_run` (nach "Fetch Training
  Data") und `workflow_dispatch` (manueller Button).
- Hängt am Workflow-NAMEN "Fetch Training Data", nicht am Dateinamen.
- `concurrency: group "pages", cancel-in-progress: true` (offizielles Pages-Muster).
- **Baut ein `_site/`-Verzeichnis mit NUR den Website-Dateien** (index.html,
  plan.html falls vorhanden, data/activities.json, data/health.json, data/analysis/)
  und deployt das — NICHT `path: '.'` (siehe Deploy-Timeout-Erkenntnis unten).

## Kritische Konstanten (müssen synchron sein)

| Konstante        | Wert       | Dateien                              |
|------------------|------------|--------------------------------------|
| ANALYSIS_VERSION | 11         | fetch UND analyze (müssen gleich!)   |
| FTP              | 237        | fetch, analyze, index.html           |
| HRMAX            | 173        | fetch, analyze, index.html           |
| PLAN_START       | 2026-05-04 | fetch, fetch_garmin                  |
| WAHOO_START_DATE | 2026-07-01 | fetch (davor eingefrorene Strava-Streams) |
| REFRESH_TAIL     | 5          | fetch_garmin                         |

## Datenquellen

- **Wahoo** (Hauptquelle ab 1.7.2026): FIT-Parsing via fitparse. Gegen Strava
  validiert (NP/avgW/HR aufs Watt identisch). Refresh-Token ROTIERT bei jedem
  Refresh → Workflow schreibt ihn zurück ins Secret.
- **Strava** (TOT seit 30.6.2026, HTTP 403 mangels Abo): fetch fängt 403 ab,
  STRAVA_* Secrets ungenutzt/löschbar. Alte Strava-Fahrten liegen als
  eingefrorene Streams vor (FREEZE-Regel).
- **Garmin**: garth-Lib (deprecated). Zwei-Token-System (siehe Garmin-Sektion).

## Secrets

WAHOO_CLIENT_ID, WAHOO_CLIENT_SECRET, WAHOO_REFRESH_TOKEN (rotiert),
GARMIN_TOKENS (base64, rotiert), GH_PAT (classic, kein Ablauf, scope=repo;
auch von cron-job.org genutzt). STRAVA_* ungenutzt.

## Spezialfälle / Fixes (nicht entfernen!)

- **4iiii-Kalibrierung**: bestimmte aid → watts × 1.247 (4iiii las ~20% zu
  niedrig, verifiziert). IDs siehe PRIVAT.md.
- **NAME_FIXES**: Wahoo-Auto-Titel ("Cycling"/"Radfahren") dürfen spezifische
  Namen nie überschreiben. Am Ende von fetch angewandt.
- **FREEZE-Regel**: bestehende streams/{id}.json werden NIE überschrieben.
- **Gemischte IDs**: alte Strava-IDs sind int, Wahoo-IDs sind Strings
  ("wahoo_..."). ALLE ID-Vergleiche über str() normalisieren — sonst Crashes
  (int('wahoo_...')) oder Duplikate (int-Key ≠ str-Key). dedup_by_id() entfernt
  exakte ID-Duplikate.
- **start_time-Schutz**: der Recovery-/cached-Pfad darf eine echte Startzeit nie
  mit '00:00' überschreiben (sonst gehen Backfill-Startzeiten verloren).
- **Dauer**: duration_sec (bewegt) vs elapsed_sec (gesamt); Streams bei ~10000
  Punkten gecappt → Dauer aus Zeitstempeln, nicht len().

---

## ERKENNTNISSE 06.07.2026 (Debugging-Session)

### Deploy-Timeouts — URSACHE: Artefaktgröße (belegt)
Symptom: `deploy-pages@v4` hängt in `deployment_queued`, läuft in 10-Min-Timeout.
- Der Log zeigt durchgehend `deployment_queued` (nie `syncing_files`) → das
  Deployment kommt nie in die Verarbeitung.
- Belegt über echte Daten (2000 Deploy-Läufe): Die Fehlerrate STEIGT MIT DER
  ARTEFAKTGRÖSSE. 0 Fails bei 12 MB (15.06.), ~14 Fails/Tag bei 25 MB (04.07.).
- Ursache: `path: '.'` deployte das GANZE Repo (~26 MB), inkl. data/streams
  (~15 MB), die die Website nie lädt.
- FIX: deploy.yml baut ein `_site/` nur mit Website-Dateien → ~11 MB. Erster
  Deploy danach wieder 18s (statt 10 Min).
- WIDERLEGT als Ursache (per Daten/Test): checkout v4-vs-v6, concurrency-Setting,
  Deploy-Frequenz, Pages-Source-Einstellung, github-pages-Environment-Regeln,
  PAT-Ablauf (cron lief mit 204 durch). Alles einzeln ausgeschlossen.

### Fetch ist gesund — nicht mit Deploy verwechseln
Echte Daten: Fetch 207/209 erfolgreich (0 Fails am Wochenende), median 27s. Die
"vielen Fails" in der Actions-Übersicht waren die DEPLOY-Läufe, nicht der Fetch.
Bei Fehlerdiagnose immer trennen welcher Workflow rot ist.

### Garmin-Token — Zwei-Token-System & Teufelskreis (behoben)
- Garmin nutzt OAuth1 (Master, hält ~1 Jahr) + OAuth2 (Access, hält nur ~1h,
  wird per exchange-Endpunkt aus OAuth1 erneuert).
- Problem: In der Actions-VM refreshte garth den OAuth2-Token, aber der frische
  Token landete nicht zuverlässig zurück im Secret — jeder Lauf startete mit dem
  alten (abgelaufenen) Token, versuchte Refresh über exchange, der bei Drosselung
  429 gab. Mit totem Token liefert Garmin nur Vortage, keine neuen Tage.
- FIX in fetch_garmin.py: (1) Token NUR ins Secret zurückschreiben wenn er
  wirklich gültig ist (schützt den langlebigen OAuth1). (2) 429-Cooldown: nach
  einem 429 für 6h keinen weiteren Refresh (Marker data/.garmin_cooldown, wird
  mit-committet) — stoppt das Hämmern, das die Sperre wachhält.
- Manueller Notfall-Fix falls der Token doch stirbt: garmin_login.py LOKAL
  ausführen (von Heim-IP, NICHT GitHub — GitHub-IPs sind bei Garmin gedrosselt),
  erzeugt base64-Blob → Secret GARMIN_TOKENS ersetzen.
- Die frühere Notiz "Garmin gibt laufenden Tag erst am Folgetag frei" war eine
  Fehldiagnose — die eigentliche Ursache war stets der Token.

### Deploy-Last gesenkt (updated_at-Fix)
fetch_activities.py und fetch_garmin.py setzen `updated_at` nur noch neu, wenn
sich inhaltlich etwas geändert hat. Sonst bleibt die JSON bit-identisch → kein
Commit → kein Deploy. Verhindert ~96 leere Deploys/Tag. Keepalive-Workflow
gelöscht (war überflüssig, da der Fetch das Repo ohnehin permanent aktiv hält).

---

## Bekannte Fragilitäten / offene Punkte

- **garth (Garmin-Lib) ist deprecated** — läuft, aber langfristig Alternative
  nötig. Token-Handling ist der fragilste Teil des Systems.
- Deploy-Fehlerrate nach dem Artefakt-Fix (06.07.) über einige Tage beobachten
  (holen_alle.py) — sollte gegen 0 gehen. Falls nicht, ist es doch GitHub-seitig.
- FTP-Anhebung 237 → ~250-260 steht aus (HR-Power-Verhältnis deutet drauf).
- Refresh-Tokens (Wahoo, Garmin) rotieren — Workflow schreibt sie zurück; bei
  Störung Token manuell erneuern.
