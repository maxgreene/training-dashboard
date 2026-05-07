# Training Dashboard · Wolf

Automatisches Cycling-Dashboard mit Strava-Integration.

## Setup

### 1. GitHub Repo erstellen
- Geh auf github.com → "New repository"
- Name: `training-dashboard`
- **Public** (nötig für GitHub Pages)
- Ohne README erstellen

### 2. Diese Dateien hochladen
```bash
git clone https://github.com/maxgreene/training-dashboard
cd training-dashboard
# Alle Dateien aus dem ZIP hier reinkopieren
git add .
git commit -m "initial setup"
git push
```

### 3. GitHub Secrets eintragen
Geh zu: Settings → Secrets and variables → Actions → New repository secret

| Secret Name | Wert |
|---|---|
| `STRAVA_CLIENT_ID` | `131423` |
| `STRAVA_CLIENT_SECRET` | `81bf5c1c368ccef38477160b7791c95f84f625dc` |
| `STRAVA_REFRESH_TOKEN` | `68bf44332d396d8153358a8c749c43cd38ccc355` |
| `GH_PAT` | → siehe Schritt 4 |

### 4. GitHub Personal Access Token erstellen
- github.com → Settings → Developer settings → Personal access tokens → Fine-grained tokens
- "Generate new token"
- Repository: `training-dashboard`
- Permissions: **Secrets: Read and write**, **Contents: Read and write**, **Actions: Read and write**
- Token kopieren → als `GH_PAT` Secret speichern

### 5. GitHub Pages aktivieren
- Repo → Settings → Pages
- Source: **GitHub Actions** (nicht "Deploy from branch")

### 6. Trainingsplan einbinden
- Die `trainingsplan.html` Datei umbenennen zu `plan.html`
- In den Repo-Root legen

### 7. Ersten Fetch manuell starten
- Actions → "Fetch Strava Activities" → "Run workflow"
- Nach ~1 Minute: https://maxgreene.github.io/training-dashboard

## Danach läuft alles automatisch
- Strava sync: stündlich
- Dashboard: https://maxgreene.github.io/training-dashboard
- Trainingsplan: Tab "Plan" im Dashboard

## Dateien
```
training-dashboard/
├── index.html              # Dashboard
├── plan.html               # Trainingsplan (von Claude generiert)
├── data/
│   └── activities.json     # Auto-generiert von GitHub Action
├── scripts/
│   └── fetch_activities.py # Strava API Fetcher
└── .github/
    └── workflows/
        └── fetch-strava.yml # GitHub Action
```
