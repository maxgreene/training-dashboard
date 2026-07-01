# Verifizierte Fakten (Stand 2026-07-01, direkt gegen Live-Repo geprüft)

> Diese Fakten wurden am 1.7.2026 direkt gegen das Live-Repo verifiziert
> (via curl auf raw.githubusercontent.com). Sie sind der harte Grundstock für
> die ARCHITECTURE.md — NICHT neu erarbeiten, nur einordnen und mit Details/
> Begründungen aus den Transcripts anreichern.

Repo: github.com/maxgreene/training-dashboard
Live: maxgreene.github.io/training-dashboard

---

## Trigger (3 Wege) — VERIFIZIERT

1. **cron-job.org** (extern, eigentlicher Takt ~alle 15 Min):
   `POST https://api.github.com/repos/maxgreene/training-dashboard/actions/workflows/fetch-training-data.yml/dispatches`
   Header: `Authorization: Bearer <GH_PAT>`, `Accept: application/vnd.github+json`
   Body: `{"ref":"main"}` — Erfolg = HTTP 204.
   ⚠ Bei Umbenennung der Workflow-Datei MUSS diese URL angepasst werden (sonst 404).
2. GitHub-Cron: `schedule: cron '0 * * * *'` in fetch-training-data.yml (Backup).
3. Manuell: Actions → Fetch Training Data → Run workflow (workflow_dispatch).

Die Workflow-Datei heißt aktuell `fetch-training-data.yml` (früher `fetch-strava.yml`).

## Deployment — VERIFIZIERT

`deploy.yml` triggert auf BEIDE (beide nötig):
- `push` auf main (für manuelle Uploads)
- `workflow_run` nach "Fetch Training Data" (nötig, weil Bot-Commits mit
  GITHUB_TOKEN den push-Trigger unterdrücken → sonst kein Deploy nach Datenupdate)
- `concurrency: cancel-in-progress: false` (sonst verklemmt Pages-Queue → deployment_queued)
- Hängt am Workflow-NAMEN "Fetch Training Data", nicht am Dateinamen.

## Datenfluss — VERIFIZIERT

- fetch_activities.py: erkennt neue Aktivitäten, lädt FIT → streams/{id}.json,
  schreibt Register+Rohdaten → activities.json. Berechnet KEINE Kennzahlen
  (np/zones bleiben null/[] als Platzhalter).
- analyze_activities.py (läuft direkt nach fetch): liest streams+activities,
  berechnet ALLE Kennzahlen → analysis/{id}.json UND zurück ins activities.json.
  WICHTIG: schreibt Werte auch dann zurück wenn analysis/{id}.json schon aktuell
  ist (via _writeback-Helper) — sonst bleibt Übersicht leer nach Version-Bump.
- fetch_garmin.py: Garmin Health → health.json.
- index.html: liest activities.json (Liste) + analysis/{id}.json (Details) + health.json.

## Kritische Konstanten — VERIFIZIERT (Live-Stand)

| Konstante        | Wert       | Dateien                          |
|------------------|------------|----------------------------------|
| ANALYSIS_VERSION | 11         | fetch UND analyze (müssen gleich)|
| FTP              | 237        | fetch, analyze, index.html       |
| HRMAX            | 173        | fetch, analyze, index.html       |
| PLAN_START       | 2026-05-04 | fetch, fetch_garmin              |
| WAHOO_START_DATE | 2026-07-01 | fetch                            |
| REFRESH_TAIL     | 3          | fetch_garmin                     |

## Datenquellen — VERIFIZIERT

- **Wahoo** (Hauptquelle ab 1.7.2026): user_id 1989354. FIT-Parsing via fitparse.
  Validiert gegen Strava: NP/avgW/HR aufs Watt identisch (10 Fahrten verglichen,
  max Δ: NP 0W, avgW 0.2W, HR 0.1bpm). Refresh-Token ROTIERT bei jedem Refresh.
  Token-Limit lösen: www.wahooligan.com/profile → "Revoke Access".
- **Strava** (TOT seit 30.6.2026, HTTP 403, Abo-Pflicht Standard-Tier): fetch
  fängt 403 ab, STRAVA_ACCESS_TOKEN ist optional (kein Crash wenn fehlt).
- **Garmin**: garth-Lib (deprecated). Login drosselt aggressiv (429). App zeigt
  Werte oft früher als die API. REFRESH_TAIL=3 holt letzte 3 Tage neu.

## Spezialfälle / Fixes — VERIFIZIERT (nicht entfernen!)

- **4iiii-Kalibrierung**: aid in (18719827047, 18717251723) → watts × 1.247
  (30.5.2026, 4iiii las ~20% zu niedrig, verifiziert vs Ingos Stages + EF-Methode).
- **NAME_FIXES** in fetch: Wahoo-Auto-Titel dürfen spezifische Namen nie
  überschreiben (z.B. ClassicCrew, id 19093792211). Am Ende von fetch angewandt.
- **FREEZE-Regel**: bestehende streams/{id}.json werden NIE überschrieben.
- **Dauer**: duration_sec (bewegt, aus moving-Stream) vs elapsed_sec (gesamt).
  Streams bei ~10000 Punkten gecappt → Dauer aus Zeitstempeln, nicht len().
- **power_curve Bug gefixt**: `> d` statt `>= d` (leere range bei Gleichheit).

## Secrets

WAHOO_CLIENT_ID, WAHOO_CLIENT_SECRET, WAHOO_REFRESH_TOKEN (rotiert),
GARMIN_TOKENS (base64, rotiert), GH_PAT (bis 2027-05-05, actions=write,
auch von cron-job.org genutzt), STRAVA_* (ungenutzt, löschbar).

## Athletenprofil

Wolf Harmening, 48J, 81kg, 181cm. FTP-Anzeige 237W (real ~250-260 laut
HR-Power-Scatter, Anhebung ausstehend). HRmax 173 (war 175; einziger echter
Max-Test 174 am 21.5.). Ruhe-HR 42-43, HRV ~38-40. Prädiabetes, FreeStyle
Libre 3 CGM. Geräte: Wahoo ELEMNT Bolt/ROAM, Tacx Trainer, 4iiii PM (links),
Garmin Forerunner 245. Ziele: BB2026 (Bergwochenende 10.-12.7.), EyeCyle 2026
(90km Charity, 14.7.).

## NOCH ZU DOKUMENTIEREN (aus Transcripts holen — hier fehlt Detail!)

Diese Themen sind aus den Transcripts vollständig zu erarbeiten, die Formeln
und Begründungen stehen dort:
- EF-Definition + die 3 Glättungsstufen (instant/60s/120s Rolling)
- Decoupling-Formel (temporal midpoint split, trim_core 8%)
- TSS-Berechnung (kJ-basiert; moving vs elapsed Debatte, Saarbrücken-Fall)
- Power-Kurve / MMP (welche Dauern, wie berechnet)
- CTL/ATL/TSB-Modell: tau=42/tau=7, Seed CTL=ATL=40, SETTLE_DAYS=42
- readinessFor() Ampel-Logik (Garmin-Score + TSB-Score)
- HRV/RHR-Chart: EWMA α=0.1 (warum EWMA statt linear/Median)
- Adaptive Plan-Logik (adaptDay, Taper-Schutz-Keywords, asymmetrisch)
- HR-Watt-Scatter-Cleanup (CONFIG.scatter Parameter, powerCoV, hrDriftMax)
- Zonen-Modelle (HR-Zonen 0.68/0.83/0.88/0.95; Power-Zonen 0.55/0.75/0.87/1.05)
- Trainingsplan-Struktur (PLAN_WEEKS, Wochen-Phasen, TSS-Ziele)
- UI-Seiten (Rides / Plan / Form) und ihre Charts im Detail
- Die ganze Migrations-Historie Strava → Wahoo
- HR-Kinetik bei Phasenübergängen (Mai-Session)
- GPX-Partner-Vergleich (Ingos Stages, Juni-Session)
