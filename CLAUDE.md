# CLAUDE.md

Hinweise für Claude bei der Arbeit an diesem Repository.

## Entwicklungs-Workflow

- **Kleine, risikoarme Änderungen** dürfen **direkt auf `main`** committet und
  gepusht werden: Doku/Kommentare, Tippfehler, kleine Konfig-Anpassungen,
  einzeilige oder klar überschaubare Fixes.
- **Größere oder riskante Änderungen** laufen weiter über einen **Feature-Branch
  + Pull Request** zur Freigabe — insbesondere alles an der Daten-Pipeline
  (`scripts/fetch_*.py`, `scripts/analyze_activities.py`, der GitHub-Workflow),
  wo ein Fehler das Dashboard oder die stündliche Automatik lahmlegen kann.
- Im Zweifel lieber kurz nachfragen, statt blind auf `main` zu pushen.

## Kurzorientierung

Statische Website ohne Server. GitHub Actions holt stündlich die Fahrten
(Wahoo = Outdoor, Garmin = Indoor/Rolle) und Gesundheitsdaten (Garmin), rechnet
Kennzahlen und legt JSON unter `data/` ab; GitHub Pages zeigt es an.

- `scripts/fetch_activities.py` — Wahoo-Fahrten (Outdoor)
- `scripts/fetch_garmin_activities.py` — Garmin-Indoor-/Rollen-Fahrten
- `scripts/fit_streams.py` — gemeinsame FIT→Streams-Umwandlung beider Quellen
- `scripts/analyze_activities.py` — Kennzahlen (NP, TSS, Power-Kurve, EF) aus den Streams
- `scripts/fetch_garmin.py` — Gesundheitsdaten (HRV, Ruhepuls, Schlaf, Stress)

Details siehe `ARCHITECTURE.md` und `README.md`.
