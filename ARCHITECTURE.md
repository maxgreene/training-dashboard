# Training Dashboard — Architektur & kritische Fakten

> Dieses Dokument hält die Fakten fest, die man beim Arbeiten am Projekt leicht
> übersieht oder vergisst. Vor jeder Änderung an Workflows, Triggern oder dem
> Datenfluss hier zuerst nachlesen.

Repo: github.com/maxgreene/training-dashboard
Live: maxgreene.github.io/training-dashboard

---

## 1. TRIGGER — wie der Workflow gestartet wird (WICHTIG!)

Der Fetch-Workflow wird auf DREI Wegen ausgelöst:

1. **Externer Dienst cron-job.org** (der eigentliche regelmäßige Takt, ~alle 15 Min).
   Ruft die GitHub-API auf:
   `POST https://api.github.com/repos/maxgreene/training-dashboard/actions/workflows/fetch-training-data.yml/dispatches`
   Header: `Authorization: Bearer <GH_PAT>`, `Accept: application/vnd.github+json`
   Body: `{"ref":"main"}`
   Erfolg = HTTP 204.
   **ACHTUNG: Beim Umbenennen der Workflow-Datei muss diese URL bei cron-job.org
   angepasst werden!** Sonst 404 → alle Trigger schlagen fehl → nichts läuft mehr.

2. **GitHub-eigener Cron** (`schedule: cron '0 * * * *'` in der yml) — Backup, stündlich.

3. **Manuell** über GitHub: Actions → Fetch Training Data → Run workflow
   (`workflow_dispatch`). So triggert Wolf nach Code-Updates.

---

## 2. DEPLOYMENT — wie die Seite aktualisiert wird

`deploy.yml` triggert auf ZWEI Events, BEIDE werden gebraucht:

- `push` auf main — für manuelle Code-Uploads durch Wolf.
- `workflow_run` (nach "Fetch Training Data") — **essenziell**, weil der Fetch-
  Workflow mit dem Standard-GITHUB_TOKEN committet. GitHub unterdrückt bei
  solchen Bot-Commits absichtlich den `push`-Trigger (Endlosschleifen-Schutz).
  Ohne `workflow_run` würde nach Daten-Updates NIE deployt.

`concurrency: cancel-in-progress: false` — Deployments warten in Reihe, statt
sich abzuwürgen. (Bei `true` verklemmt sich die Pages-Queue wenn mehrere Commits
schnell kommen → deployment_queued hängt endlos.)

deploy.yml hängt am Workflow-**Namen** ("Fetch Training Data"), NICHT am Dateinamen.
Also: Dateiname darf sich ändern, aber `name:` in fetch-training-data.yml muss
"Fetch Training Data" bleiben, sonst bricht das Deployment.

---

## 3. DATENFLUSS (Single Source of Truth)

```
fetch_activities.py:
  - erkennt neue Aktivitäten (Wahoo ab 2026-07-01, davor Strava-Streams)
  - lädt FIT-Datei je Aktivität, parst Streams -> data/streams/{id}.json
  - schreibt REGISTER + Rohdaten/Metadaten -> data/activities.json
  - berechnet KEINE Kennzahlen (np/zones/decoupling bleiben Platzhalter: null/[])

analyze_activities.py (läuft IMMER direkt nach fetch):
  - liest data/streams/{id}.json + data/activities.json
  - berechnet ALLE Kennzahlen (NP, power_curve, zones, decoupling, EF, scatter, climbs)
  - schreibt Detail -> data/analysis/{id}.json
  - schreibt Kennzahlen ZURÜCK ins data/activities.json (für schnelle Übersicht)
  - WICHTIG: schreibt Werte auch dann zurück, wenn analysis/{id}.json schon
    aktuell ist (sonst bleibt activities.json leer wenn fetch die Werte geleert hat)

fetch_garmin.py:
  - lädt Garmin Health -> data/health.json

index.html:
  - liest data/activities.json (Übersichtsliste + Kennzahlen)
  - liest data/analysis/{id}.json nur beim Aufklappen einer Detailansicht
  - liest data/health.json (Form-Seite)
```

**Konsequenz:** NP/Zonen etc. NUR in analyze berechnen. fetch nie wieder
Kennzahlen berechnen lassen (führte zu HRMAX-Inkonsistenz).

---

## 4. KRITISCHE KONSTANTEN (müssen synchron sein!)

| Konstante         | Wert       | Wo                                    |
|-------------------|------------|---------------------------------------|
| ANALYSIS_VERSION  | 11         | fetch UND analyze (müssen GLEICH sein)|
| FTP               | 237        | fetch, analyze, index.html            |
| HRMAX             | 173        | fetch, analyze, index.html            |
| PLAN_START        | 2026-05-04 | fetch, fetch_garmin                   |
| WAHOO_START_DATE  | 2026-07-01 | fetch (Wahoo-Stichtag)                |
| REFRESH_TAIL      | 3          | fetch_garmin (Tage neu holen)         |

**ANALYSIS_VERSION-Bump** erzwingt Neuanalyse aller Aktivitäten. fetch und analyze
müssen denselben Wert haben, sonst schreibt fetch activities.json mit einer Version,
die analyze nicht als "zu tun" erkennt (oder umgekehrt).

**FREEZE-Regel:** Bestehende data/streams/{id}.json werden NIEMALS überschrieben.
Vergangenheit (Strava-Streams) ist eingefroren. Nur wirklich neue Fahrten laden FIT.

---

## 5. DATENQUELLEN

- **Wahoo** (ab 1.7.2026, Hauptquelle): user_id 1989354. FIT-Dateien identisch mit
  dem was das ELEMNT aufzeichnet. Validiert: NP/avgW/HR aufs Watt identisch mit Strava.
  Refresh-Token ROTIERT bei jedem Refresh — Workflow schreibt neuen ins Secret zurück.
  Token-Limit-Problem: www.wahooligan.com/profile → "Revoke Access".
- **Strava** (TOT seit 30.6.2026, Abo-Pflicht): Standard-Tier bekommt HTTP 403.
  Wolf kann nicht hochstufen. fetch fängt 403 ab und läuft mit Wahoo weiter.
  STRAVA_ACCESS_TOKEN ist optional (kein Crash wenn fehlt).
- **Garmin** (Health): garth-Lib (deprecated, läuft). Login-Server drosselt
  aggressiv (HTTP 429 bei zu vielen Logins). App zeigt Werte oft früher als die
  API sie rausgibt — der laufende Tag kann in der API verzögert erscheinen.

---

## 6. SPEZIALFÄLLE / FIXES (nicht versehentlich entfernen!)

- **4iiii-Kalibrierung**: Aktivitäten 18719827047 + 18717251723 (30.5.2026) hatten
  ~20% zu niedrige Wattwerte. analyze skaliert watts × 1.247. Verifiziert vs Ingos
  Stages + EF-Methode.
- **NAME_FIXES** in fetch: Wahoo-Auto-Titel ("Radfahren"/"Cycling") dürfen bestehende
  spezifische Namen (z.B. "ClassicCrew") nie überschreiben. Korrektur-Map am Ende
  von fetch angewandt, greift über alle Pfade (Fetch/Recovery/Cache).
- **Dauer**: bewegte Zeit (duration_sec, aus moving-Stream) vs Gesamtzeit (elapsed_sec).
  Strava cappt Streams bei ~10000 Punkten → Dauer aus Zeitstempeln, nicht aus len().

---

## 7. SECRETS (GitHub Actions)

- WAHOO_CLIENT_ID, WAHOO_CLIENT_SECRET, WAHOO_REFRESH_TOKEN (rotiert!)
- GARMIN_TOKENS (base64-JSON, wird bei Refresh zurückgeschrieben)
- GH_PAT (gültig bis 2027-05-05, hat actions=write) — auch von cron-job.org genutzt
- STRAVA_* (können gelöscht werden, nicht mehr genutzt)
