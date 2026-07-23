# Cycling Training Dashboard

Persönliches Trainings-Dashboard von Wolf Harmening. Statische Seite auf GitHub
Pages, Daten aus Wahoo (Outdoor-Fahrten), Garmin (Indoor/Rolle-Fahrten und
Health), Aufbereitung per Python in GitHub Actions.

**Live:** https://maxgreene.github.io/training-dashboard

---

## Arbeitsweise

**Immer `git pull` vor der ersten Änderung einer Sitzung.** Wolf editiert
gelegentlich direkt in der GitHub-Weboberfläche. Ohne Pull baust du auf einem
veralteten Stand und überschreibst seine Änderungen. Das ist mehrfach passiert.

Beispiele für Wolf-Änderungen, die so verlorengingen: `minDurMin` 60 auf 15 auf
30, EF-Achsen von `null` auf feste `0.9`/`2.3`. Wenn ein Wert anders aussieht
als erwartet, ist das eher eine bewusste Entscheidung von Wolf als ein Fehler.
Nachfragen statt zurücksetzen.

**Commit-Regel:**
- Kleine, risikoarme Änderungen dürfen direkt auf `main` (nach `git pull`):
  Doku, Kommentare, Tippfehler, kleine Konfig-Anpassungen, einzeilige oder klar
  überschaubare Fixes.
- Größere oder riskante Änderungen laufen über einen Feature-Branch und PR zur
  Freigabe, insbesondere alles an der Daten-Pipeline (`scripts/fetch_*.py`,
  `scripts/analyze_activities.py`, die Workflows), wo ein Fehler das Dashboard
  oder die stündliche Automatik lahmlegt.
- Im Zweifel kurz fragen, statt blind auf `main` zu pushen.

**Nie raten.** Nachschauen, nachrechnen, an echten Daten prüfen. Wolf hat
mehrfach falsche Diagnosen korrigiert, die aus Vermutungen entstanden. Wenn
etwas unklar ist: Daten laden und messen.

---

## Ton

- Direkt, knapp, technisch präzise. Deutsch, Englisch gemischt ist normal.
- **Keine Em-Dashes.** Komma, Doppelpunkt oder Klammer stattdessen.
- Keine Vorreden, keine Meta-Bestätigungen, keine Formulierungen, die frühere
  Zurückhaltung implizieren.
- **Hinweistexte in der UI: nur kurze Formeln**, Muster `X ↑ = besser`.
  Fließtext-Absätze unter Charts wurden explizit als bevormundend
  zurückgewiesen. Beispiel für den richtigen Ton:
  `CTL 42 d = Fitness · ATL 7 d = Ermüdung · TSB = CTL − ATL · TSB ↑ = frisch`
- Claude ist **nicht** Wolfs Coach oder Arzt. Trainingsbeobachtungen flaggen,
  keine Vorschriften machen.

---

## Struktur

```
index.html                        Struktur, CSS, Nav, Status-Ampel, Lazy-Render, Boot
js/config.js                      ALLE Parameter. Einziger Ort für Zahlen.
js/shared.js                      Datum, Zonen-Engine, timeAxis, DATA, CSSVAR,
                                  FTP/HRmax-Auflösung, Tests, tssOf, Leistungsprofil
js/plan.js                        Plan-Generator, FTP-Widget, Test-Timeline,
                                  Leistungsprofil-Karte + Wochen-Plot
js/rides.js                       EF-Chart, Fahrtenliste, 3 Detailplots
js/form.js                        CTL/ATL/TSB, HRV/RHR mit EWMA-Bändern
scripts/fetch_activities.py       Wahoo (Outdoor) nach activities.json + streams/
scripts/fetch_garmin_activities.py Garmin Indoor/Rolle nach activities.json + streams/
scripts/fit_streams.py            gemeinsame FIT-nach-Streams-Umwandlung (Wahoo + Garmin)
scripts/analyze_activities.py     streams nach Kennzahlen + analysis/{id}.json
scripts/fetch_garmin.py           Garmin Health nach health.json
.github/workflows/fetch-training-data.yml
.github/workflows/deploy.yml
data/streams/{id}.json            ROH, 1 Hz. NIE anfassen.
data/activities.json              Index mit allen Kennzahlen
data/analysis/{id}.json           Eine Serie pro Fahrt
data/health.json                  Garmin: HRV, RHR, Schlaf, Stress
```

Frontend ist Vanilla JS ohne Build-Schritt. Chart.js per CDN. Keine Frameworks,
kein npm, kein Bundler. So soll es bleiben.

---

## Datenquellen

- **Wahoo = Outdoor.** `fetch_activities.py`, id-Präfix `wahoo_`.
- **Garmin = Indoor/Rolle.** Die Tacx-App zeichnet die Rolle auf und synct nach
  Garmin Connect. Seit Strava gesperrt ist (30.06.2026), kommen die Rollen von
  dort. `fetch_garmin_activities.py`, id-Präfix `garmin_`. Nur Indoor-Typen
  (`indoor_cycling`, `virtual_ride`), damit Outdoor nicht doppelt (Wahoo plus
  Garmin) erscheint. Läuft VOR `analyze_activities.py`, `continue-on-error`.
- **Garmin Health.** `fetch_garmin.py`, unverändert.

Beide FIT-Quellen münden über `fit_streams.py` in dieselbe Stream-Struktur, also
identische Aufbereitung und Kennzahlen.

**Namens-Nachzug:** Wolf benennt Fahrten oft erst später in der Wahoo-App um, da
hat der Fetch sie meist schon geholt. `fetch_activities.py` gleicht deshalb bei
Fahrten der letzten `RENAME_RECHECK_DAYS` (2) Tage den Wahoo-Namen ab und zieht
Änderungen nach. `NAME_FIXES` (manuelle Korrekturen) bleiben geschützt.

---

## Grundregeln der Architektur

**Jede Größe hat genau einen Ort.** Wenn ein Wert an zwei Stellen berechnet
wird, ist das ein Fehler. Der große Umbau (2276 auf 1475 Zeilen) diente genau
dem.

**Alle Zahlen stehen in `js/config.js`.** Farben, Achsen, Grenzen, Zeitfenster,
Zonen, Testtermine, Profil-Parameter. Wenn im Code eine Zahl auftaucht, gehört
sie in die Config.

**FTP und HRmax werden beim Laden aus den Daten aufgelöst** (`resolveAthlete` in
`shared.js`): FTP = jüngster Rampentest (0.75 x MAP, 60-s-Bestwert), HRmax =
`max_hr` desselben Tests. Die Werte in `config.js` (`athlete.ftp`/`hrmax`) sind
nur noch Basis und Fallback. Ab der Auflösung ziehen Zonen (W und HF), IF, TSS,
dp4, W/kg und alle Kacheln aus dieser einen Quelle. TSS wird im Frontend live
aus NP und aktuellem FTP gerechnet (`tssOf`); der im Backend vorberechnete `tss`
ist nur Fallback für Fahrten ohne NP. Da TSS ~ NP^2/FTP^2, skaliert ein neuer
FTP jede Fahrt um denselben Faktor: die Form-Kurve behält ihre Gestalt, nur das
Niveau verschiebt sich.

**`config.js` ist "was", die JS-Module sind "wie".** Ein Testtermin ist eine
Tatsache über Wolfs Training und gehört in die Config. Die Logik, die daraus
eine Tageskachel macht, gehört in `plan.js`.

**`fetch` setzt keine Kennzahlen, die `analyze` besitzt.** Wahoos `avg_power`
rechnet ohne Nullen, Wahoos `tss` nutzt den FTP aus der Wahoo-App. Beides falsch.

**Zonen werden im Frontend live aus Histogrammen gerechnet.** Deshalb sind FTP
und Zonengrenzen ohne Reprocess verstellbar. Histogramme in absoluten Einheiten
speichern, nie in Prozent vom FTP.

---

## Tests, FTP und Leistungsprofil

**Rampentests werden automatisch erkannt:** Name enthält "ramp" ODER das Datum
ist ein geplanter Test (`CFG.plan.events`, type:'test'). FTP = 0.75 x MAP (bester
60-s-Wert). Kein Handeintrag mehr nötig, der Test erscheint nach der Analyse von
selbst. `CFG.tests` bleibt für Altfahrten ohne Daten hier, 20-Min-Tests und
Overrides: ein Handeintrag mit gesetztem `ftp` gewinnt gegen den automatischen
Wert. Die Erkennung ist eng genug, dass harte Einheiten (z. B. 3x10 min) nicht
fälschlich als Test zählen.

**Leistungsprofil (Plan-Seite):** je Anker NM (5 s), AC (60 s), MAP (300 s),
Schwelle (1200 s) der Bestwert seit Trainingsstart (`CFG.profile.since`), mit
W/kg, Alter, frisch/veraltet. Dazu ein CP/W'-Modell (2-Parameter Work-Time-Fit
aus 2/5/10/20-min-Bestwerten) als Gegenprobe zum Rampen-FTP, plus ein
Wochen-Verlaufsplot der Anker-Bestwerte (1-Wochen-Bins). Rechnung zentral in
`shared.js`: `bestSince`, `powerProfile`, `cpModel`, `weeklyBest`.

**Beobachtung zur Gegenprobe:** Die Rampe (0.75 x MAP) überschätzt bei starkem
anaeroben Profil, weil die letzte Rampen-Minute viel Anaerobes trägt. CP aus den
Daten ist eher eine Untergrenze, solange kein maximaler 20-min- oder
12-min-Effort im Fenster liegt (Wolfs harte Einheiten sind Intervalle, kein
Dauertest). Die realistische Schwelle liegt zwischen beiden. Das ist eine
Beobachtung, keine Vorschrift.

---

## Datenmodell (ANALYSIS_VERSION = 16)

Quelle der Wahrheit ist immer `data/streams/{id}.json`. Daraus genau zwei
Artefakte, ohne Überschneidung:

**`data/activities.json`** pro Fahrt: `np`, `power_curve`, `hist_p` (10 W-Eimer),
`hist_hr` (2 bpm ab 40), `avg_power`, `avg_power_moving`, `max_power`, `avg_hr`,
`max_hr`, `avg/max_cadence`, `tss`, `ef`, `decoupling_pct`, `moving_sec`,
`elapsed_sec`, `pause_sec`, `frozen_hr_sec`, `has_power`, `has_hr`. Garmin-Fahrten
zusätzlich `source: 'garmin'`, `indoor: true`. Global: `wahoo_skipped`.
`tss` ist nur noch Fallback, die Anzeige rechnet live (siehe `tssOf`).

**`data/analysis/{id}.json`** eine Serie:
`{id, v, step:5, n, w, hr, cad, gaps}`. `gaps` = `[[serien_index, sekunden]]`
für die echte Zeitachse.

Wenn sich die Datenberechnung ändert: **`ANALYSIS_VERSION` in beiden Skripten
hochzählen** (ungefragt, das ist erwartet) und Wolf sagen, dass er einmal
"Fetch Training Data" in GitHub Actions anstoßen muss.

---

## Fallstricke (alle schon einmal reingefallen)

### Daten

**Streams haben Lücken.** Eine 8-Stunden-Fahrt: 29080 s Spanne, aber nur 20577
Punkte, also 2,4 h Pause in 36 Lücken. `duration_sec` aus dem Wahoo-Summary ist
die Gesamtspanne. TSS war dadurch 40 % zu hoch (537 statt 380). Immer
`moving_sec` verwenden, nie `elapsed_sec`.

**Power-Kurve muss lückenbewusst sein.** Ein Schiebefenster über das rohe Array
klebt über Pausen hinweg. Der 20-Minuten-Bestwert war 258 W statt echter 224 W.
Toleranz skaliert mit dem Fenster: `max(GAP_MIN=30, GAP_FRAC=0.05 * Dauer)`.
Ohne die Skalierung verschwinden alle 60-Minuten-Werte, weil niemand eine
Stunde ohne Ampel fährt.

**Nullen im Watt-Stream bleiben drin.** Sie sind echtes Coasting. Rausfiltern
klebt Leistungsphasen zusammen und überschätzt jeden Bestwert.

**EF = NP / Ø-HF** (TrainingPeaks-Standard). Nicht Durchschnitt, nicht getrimmt.

**Eingefrorene HF erkennen.** Ein abgerutschter Gurt wiederholt den letzten
Wert. Regel: >= 180 s exakt konstant und >= 50 bpm, dann auf `None`. Am 10.07.
waren 57 Minuten bei konstant 114 bpm eingefroren.

**4iiii-Kalibrierung** x1.247 für IDs `18719827047` und `18717251723`. Der
Powermeter las am 30.05. rund 20 % zu niedrig.

### Chart.js

**Ein `bar`-Datensatz ändert stillschweigend die Achsen-Voreinstellungen.**
Dreimal reingefallen, alle drei Fixes stehen in `shared.js` bei `timeScale()`:

1. `type` wird zur Kategorie-Achse, alle Punkte kollabieren auf x=0.
   Gegenmittel: `type: 'linear'` explizit setzen.
2. TSS-Balken (bis 381) dominieren die y-Achse, CTL/ATL werden platt gedrückt.
   Gegenmittel: eigene versteckte Achse `yTss` mit `max = 3 * maxTSS`.
3. `offset: true` ist bei Balken der Default, der Chart wird schmaler als die
   anderen. Gegenmittel: `offset: false`.

### Canvas und Layout

**Canvas-Größe gehört ins JS, nicht ins CSS.** `aspect-ratio` plus `max-height`
plus `width:100%!important` gegen `box.clientWidth` als Höhe ergibt Achsen, die
unten herausragen und die nächste Kachel überdecken. Regel:
`side = min(clientWidth, 340)`, CSS mischt sich nicht ein. Volle-Breite-Zeitreihen
(Form, Wochen-Plot) setzen stattdessen feste `box.style.height` und
`maintainAspectRatio: false`.

**Lazy-Render.** Bei `display:none` ist `clientWidth` = 0, der Canvas-Puffer
wird 0 px breit und CSS zerrt ihn auf. Seiten werden erst beim Anzeigen
gezeichnet, siehe `RENDER`/`drawn` in `index.html`.

**iOS Safari feuert `resize` beim Scrollen**, weil die Adressleiste ein- und
ausfährt. Ein Neuaufbau wirft die Scroll-Position weg, die Seite springt nach
oben. Der Handler reagiert nur auf **Breiten**-Änderungen.

**Flexbox:** `align-items: flex-start` steuert bei `flex-direction: column` die
HORIZONTALE Achse, die Kinder schrumpfen auf Inhaltsbreite. Im Mobile-Block
`align-items: stretch` setzen.

**Kein `overflow-x: hidden` auf `body`.** Zerschießt `position: sticky` in Safari.

### Rechnen

**CTL/ATL brauchen Seed 40.** Bei Start 0 ist TSB über 74 Tage nie positiv, das
ist ein Kaltstart-Artefakt. Abklingkonstante ist `1 - exp(-1/tau)`, nicht
`1/tau`. Die ersten 42 Tage sind im Chart als Einschwingphase grau markiert.

**`log(0)` existiert nicht.** Die MMP-y-Achse beginnt deshalb bei 50 W, nicht 0.

**Feste Achsen brauchen Clipping und einen Zähler.** Sonst malt etwas über die
Achse hinaus oder Punkte verschwinden unbemerkt. Der Scatter zeigt
`n=241 · 3 außerhalb`.

---

## Token-Ketten

### Garmin (Health und Rolle-Fahrten)
Refresh läuft per Cron auf Wolfs Lab-Server **ukb457**, alle 4 Stunden, schreibt
verschlüsselt ins GitHub-Secret `GARMIN_TOKENS`. GitHub liest nur. Dasselbe
Secret nutzen Health- und Rolle-Fetch.
Log: `tail -20 ~/garmin-refresh/refresh.log`.

Der entscheidende Bug war: `garth.client.refresh_oauth2()` aktualisiert nur den
Speicher. Ohne `garth.client.dump(TOKDIR)` schiebt das Skript den alten, toten
Token ins Secret, und HTTP 204 sieht dabei nach Erfolg aus.

Sollbruchstellen: OAuth1-Master-Token hält etwa ein Jahr, GitHub-PAT läuft nach
gewählter Frist ab.

### Wahoo (Outdoor-Fahrten)
Wahoo rotiert den `refresh_token` bei jedem Lauf **und** befristet ihn. Läuft er
ab, kommt `invalid_grant`, der Fetch überspringt Wahoo, und der Workflow bleibt
trotzdem grün.

Neu autorisieren: `developers.wahooligan.com`, App "Wolf Training-Dashboard",
Details, grüner AUTHORIZE-Knopf. Browser landet auf
`https://maxgreene.github.io/training-dashboard/callback?code=XXX` (404 ist
egal, nur der Code zählt, gilt wenige Minuten). Dann lokal in PowerShell:

```powershell
$body = @{
    client_id     = "<WAHOO_CLIENT_ID>"
    client_secret = "<WAHOO_CLIENT_SECRET>"
    code          = "<CODE aus der URL>"
    grant_type    = "authorization_code"
    redirect_uri  = "https://maxgreene.github.io/training-dashboard/callback"
}
$r = Invoke-RestMethod -Uri "https://api.wahooligan.com/oauth/token" -Method Post -Body $body
$r | ConvertTo-Json
```

Den `refresh_token` ins GitHub-Secret `WAHOO_REFRESH_TOKEN`.

Schutz: `fetch` setzt `wahoo_skipped: true`, die Status-Ampel wird gelb und
nennt die Ursache.

---

## Workflows

**Fetch** (`fetch-training-data.yml`): stündlich per `schedule`, zusätzlich
alle 15 Minuten von cron-job.org über die API. GitHub zeigt letzteres als
"Manually run by maxgreene" an, obwohl Wolf nichts drückt. `cache: 'pip'` aktiv.
Schritt-Reihenfolge: Fetch Activities (Wahoo), Fetch Garmin Rides (Indoor),
Analyze Activities, Fetch Garmin Health, Commit. Die beiden Garmin-Schritte sind
`continue-on-error`, damit sie die Pipeline nie blockieren.

**Deploy** (`deploy.yml`): kopiert `js/` ins `_site` und ersetzt `?v=BUILD` in
`index.html` per `sed` durch die Commit-SHA. Damit ist Cache-Busting
automatisch, niemand zählt etwas hoch. Ohne das liefert iOS Safari tagelang
alte Module aus.

Push auf `main` löst den Deploy aus.

---

## Trainingskontext

- FTP wird aus dem jüngsten Rampentest abgeleitet, aktuell **271 W** (22.07.,
  0.75 x MAP 361). Ziel **300 bis 15.11.2026**, 81 kg. HRmax aus demselben Test,
  aktuell 171.
- Hatte 300 bereits 2021 und 2023/24.
- Rampentests in `CFG.tests`: 21.05. FTP 237 / MAP 313, 23.06. FTP 229 / MAP 305
  (früh abgebrochen, müde Beine), 22.07. FTP 271 / MAP 361 (Nullpunkt
  FTP-300-Block). Neue kommen automatisch dazu (siehe Test-Erkennung oben).
- Eine Rampe erkennt man an der Treppe bei **30-Sekunden-Auflösung**. Bei
  2-Minuten-Blöcken verwischt sie und sieht aus wie ein Intervalltraining.
- Easy-Anteil nach Leistung ~59 %, nach HF ~85 bis 95 % bei denselben Fahrten.
  Die Differenz ist selbst die Information: Berg-Antritte spiken die Watt,
  die HF folgt nicht.
- Wochenrhythmus: Mo bis Fr zwei Commutes, Mi Rolle (hart), Sa oder So lange
  Ausfahrt. Blockstruktur vier Wochen, jede vierte ist Entlastung.

---

## Offene Punkte

1. Zonen-Editor auf der Seite: CSS `.zed` existiert, Engine läuft, UI fehlt.
2. `plan.template` reicht nur für den aktuellen Block, weitere später.
3. Online-Editieren (Fahrten löschen, Tests zuweisen) wurde geprüft und
   verworfen: GitHub Pages ist statisch und kann nicht ins Repo zurückschreiben.
4. CP-Gewichtung nach Datenlage: aktuell fließt jeder Anker-Bestwert gleich in
   den CP-Fit. Verfeinerung wäre, nur nahe-maximale Efforts zu zählen (HF nahe
   Max oder Wert passt zur Kurve), damit ein lockeres 20-min CP nicht verzerrt.

---

## Rollback

Anker-Commit vor dem großen Umbau: `e1c8fd28`. Zurückrollen heißt: alten Code
wiederherstellen, aber mit **höherer** `ANALYSIS_VERSION`, nie niedrigerer.
Sonst rechnet der alte Code die neuen Daten nicht neu und liest ein Format, das
er nicht kennt.
