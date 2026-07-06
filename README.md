# Training Dashboard

Ein selbstgehostetes Rennrad-Trainings-Dashboard: Es holt sich automatisch die
Fahrten (von Wahoo) und die Gesundheitsdaten (von Garmin), rechnet Trainings-
kennzahlen aus und zeigt sie als Website an — komplett kostenlos über GitHub,
ohne eigenen Server.

**Live-Beispiel:** https://maxgreene.github.io/training-dashboard

---

## Was es zeigt

- Aktivitätenliste mit Leistungskennzahlen (NP, TSS, Intensität, Zonen)
- Detailansicht pro Fahrt (Leistungs-/HF-Verlauf, Power-Kurve, Decoupling)
- Form-Seite: Fitness / Fatigue / Form (CTL/ATL/TSB) plus HRV, Ruhepuls,
  Schlaf und Stress aus Garmin

---

## Wie es funktioniert (das Grundprinzip)

Das Dashboard ist eine **statische Website** — es gibt keinen laufenden Server
und keine Datenbank. Stattdessen:

1. **Ein Zeitgeber** (der kostenlose Dienst cron-job.org) stößt alle 20 Minuten
   einen Ablauf auf GitHub an.
2. **GitHub Actions** (die eingebaute Automatisierung von GitHub) führt dann
   Python-Skripte aus, die die Daten von Wahoo und Garmin abholen, aufbereiten
   und als JSON-Dateien ins Repository speichern.
3. **GitHub Pages** stellt die Website bereit. Sobald neue Daten im Repository
   liegen, wird die Seite automatisch neu veröffentlicht.
4. **Dein Browser** lädt beim Öffnen der Seite die JSON-Dateien und zeichnet
   daraus die Diagramme und Listen.

Der Clou: Alles läuft in der kostenlosen Infrastruktur von GitHub. Du brauchst
keinen eigenen Server, keine Hosting-Kosten, keine Wartung.

```
cron-job.org  ──►  GitHub Actions  ──►  Daten als JSON im Repo  ──►  GitHub Pages  ──►  Browser
 (alle 20 Min)     (holt & rechnet)     (activities/health.json)    (Website)         (zeigt an)
```

---

## Woher die Daten kommen

| Quelle    | Was              | Wie                                             |
|-----------|------------------|-------------------------------------------------|
| **Wahoo** | Rad-Aktivitäten  | Über die Wahoo-API; die Original-FIT-Dateien werden gelesen |
| **Garmin**| HRV, Ruhepuls, Schlaf, Stress, Body Battery | Über die Bibliothek `garth` |

Hinweis: Strava wird nicht mehr genutzt (die kostenlose API-Stufe wurde
eingeschränkt). Wer möchte, kann die Wahoo-Quelle durch eine andere ersetzen —
entscheidend ist, dass am Ende FIT-Dateien oder gleichwertige Rohdaten vorliegen.

---

## Wo was liegt (Aufbau des Repositories)

```
├── index.html              Die Website selbst (Anzeige + Diagramme im Browser)
├── data/
│   ├── activities.json      Liste aller Fahrten mit Kennzahlen (lädt die Website)
│   ├── health.json          Garmin-Gesundheitsdaten (lädt die Website)
│   ├── analysis/{id}.json    Detail-Kennzahlen pro Fahrt (bei Klick geladen)
│   └── streams/{id}.json     Rohdaten pro Fahrt (nur intern, NICHT auf der Website)
├── scripts/
│   ├── fetch_activities.py   Holt Fahrten von Wahoo -> streams + activities.json
│   ├── analyze_activities.py Rechnet die Kennzahlen -> analysis + activities.json
│   └── fetch_garmin.py       Holt Garmin-Health -> health.json
├── .github/workflows/
│   ├── fetch-training-data.yml   Der Ablauf, der die drei Skripte ausführt
│   └── deploy.yml                Veröffentlicht die Website auf GitHub Pages
└── ARCHITECTURE.md          Technische Detail-Dokumentation
```

---

## Selbst einrichten (Grundgerüst)

Dies ist eine grobe Anleitung — die Details (eigene FTP, Zonen, Geräte) musst du
an dich anpassen.

### 1. Repository kopieren
Forke oder kopiere dieses Repository in deinen eigenen GitHub-Account.

### 2. GitHub Pages aktivieren
Settings → Pages → Source auf **"GitHub Actions"** stellen.

### 3. Zugänge als Secrets hinterlegen
Unter Settings → Secrets and variables → Actions folgende Secrets anlegen:

| Secret                | Wofür                                            |
|-----------------------|--------------------------------------------------|
| `WAHOO_CLIENT_ID`     | Deine Wahoo-App (auf developers.wahooligan.com)  |
| `WAHOO_CLIENT_SECRET` | dito                                             |
| `WAHOO_REFRESH_TOKEN` | Einmaliger OAuth-Login bei Wahoo                 |
| `GARMIN_TOKENS`       | Garmin-Login-Tokens (siehe unten)                |
| `GH_PAT`              | Ein GitHub Personal Access Token (scope: `repo`) |

Für Garmin: Das Login-Token wird einmalig **lokal** erzeugt (ein kleines
Python-Skript mit `garth` fragt Email/Passwort ab und gibt ein Token aus), dann
als `GARMIN_TOKENS` hinterlegt. Der Login sollte von zuhause laufen, nicht über
GitHub — Garmin drosselt fremde IP-Adressen.

### 4. Deine Werte eintragen
In den Skripten (`fetch_activities.py`, `analyze_activities.py`) oben die
Konstanten anpassen: **FTP**, **maximale Herzfrequenz**, **Trainingsbeginn-Datum**.
Diese müssen in den Dateien übereinstimmen.

### 5. Den Zeitgeber einrichten
Bei cron-job.org (kostenlos) einen Job anlegen, der alle 20 Minuten diese URL
per POST aufruft:
```
https://api.github.com/repos/DEIN-NAME/training-dashboard/actions/workflows/fetch-training-data.yml/dispatches
```
mit Header `Authorization: Bearer DEIN_GH_PAT` und Body `{"ref":"main"}`.
Erfolg ist ein HTTP-204. (Alternativ reicht der eingebaute GitHub-Stundencron —
dann aktualisiert die Seite nur stündlich.)

### 6. Fertig
Ab jetzt holt sich das Dashboard die Daten selbst und aktualisiert die Website.

---

## Gut zu wissen

- **Kosten:** keine. Alles läuft in den kostenlosen Kontingenten von GitHub und
  cron-job.org.
- **Wartung:** Die Garmin-Tokens laufen gelegentlich ab und müssen dann einmal
  neu erzeugt werden — das ist der einzige regelmäßige Handgriff.
- **Anpassbarkeit:** Die Kennzahlen-Berechnung steckt komplett in
  `analyze_activities.py` — dort lässt sich alles nach eigenen Vorstellungen
  ändern.
- **Technische Details:** siehe `ARCHITECTURE.md`.

---

*Dies ist ein privates Hobby-Projekt, kein offizielles Produkt. Keine Garantie,
keine Support-Zusage — aber Nachbauen ausdrücklich erwünscht.*
