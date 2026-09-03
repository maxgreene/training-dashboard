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

**Diese CLAUDE.md immer mitpflegen.** Bei jeder relevanten Änderung (neue
Skripte, geänderte Pipeline, neue Kennzahlen, geänderte Konventionen) die
betroffene Stelle hier direkt mit aktualisieren, im selben Zug wie die Änderung.

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
- **Coach-Rolle (auf Wolfs Wunsch, 12.08.2026).** Claude gibt Einschätzung und
  konkrete Empfehlungen zum Training, nicht nur Beobachtungen. Trainingsziel,
  Datenlage und Constraints (Wolf kann max 2x/Woche lang fahren, Rest über
  Commutes) ernst nehmen und darin steuern. Argumente auf echten Daten prüfen,
  nicht dogmatisch: Wolf korrigiert falsche Physiologie (z. B. Mitochondrien vs
  MAP), und das gehört so. Claude ist **kein Arzt**: medizinische Grenzen
  benennen, bei Schmerz, Infekt oder anhaltendem HRV-Absturz gilt der Körper vor
  dem Plan.

---

## Struktur

```
index.html                        Struktur, CSS, Nav, Status-Ampel, Lazy-Render, Boot
js/config.js                      ALLE Parameter. Einziger Ort für Zahlen.
js/shared.js                      Datum, Zonen-Engine, timeAxis, DATA, CSSVAR,
                                  FTP/HRmax-Auflösung, Tests, tssOf, Leistungsprofil
js/plan.js                        Plan-Generator, Heute-Feld, FTP-Widget,
                                  Ride-vs-Decke-Widget, Test-Timeline
js/rides.js                       Leistungsprofil-Karte + Wochen-Plot,
                                  EF-Chart, Fahrtenliste (mit Strecken-Thumbnail),
                                  3 Detailplots + Detail-Streckenkarte (routeSvg)
js/form.js                        CTL/ATL/TSB, HRV/RHR mit EWMA-Bändern
js/vault.js                       Tresor aufschliessen: WebAuthn-PRF, PBKDF2,
                                  AES-GCM. Gegenstück zu nutri_crypto.py
js/food.js                        Food-Seite: Tag/Woche/Monat, Ziel-Balken,
                                  Passkey anlegen
scripts/nutri.py                  Ernährungs-CLI: init, add, undo, today,
                                  goals, search, add-wrap, import-key
scripts/nutri_crypto.py           AES-256-GCM, DEK-Wrapping, Schlüsseldatei
scripts/build_foods.py            BLS 4.0 nach foods.json
.githooks/pre-commit              blockt Klartext-Log und rohe Schlüssel
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
data/nutrition/foods.json         Lebensmitteltabelle, erzeugt aus BLS 4.0
data/nutrition/foods_extra.json   Kurznamen, Portionen, eigene Einträge
data/nutrition/keys.json          eingewickelte DEKs (Passphrase + je Gerät)
data/nutrition/log.enc.json       der Tresor, AES-256-GCM
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

**Wichtig: Der App-Name steht in `workout_summary.name`, nicht im Top-Level
`name`.** Der Top-Level `name` ist der beim Upload eingefrorene Geräte-Name
(z. B. `Radfahren`) und ändert sich bei einer App-Umbenennung nie. Die
Umbenennung landet in `workout_summary.name` (mit eigenem `updated_at`).
`_wahoo_name(w)` bevorzugt deshalb `workout_summary.name`, Fallback Top-Level.
Verifiziert am rohen Workout-Objekt (Top `Radfahren`, Summary `Sprintründchen`).

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

**Rampentests werden automatisch erkannt:** Name enthält "ramp" (expliziter
Override) ODER das Datum ist ein geplanter Test (`CFG.plan.events`, type:'test')
UND die Fahrt ist plausibel eine Rolle-Rampe: indoor plus lang genug
(`CFG.plan.rampDetect`, `indoorOnly`/`minMovingMin`). Der zweite Teil ist
wichtig, sonst wird die Morgen-Commute AM Testtag fälschlich als Rampe in den
FTP-Plot gesetzt (am 02.09.2026 genau so passiert: Commute vor der Abend-Rolle).
Die Rampe läuft immer auf der Rolle (Garmin, `indoor:true`), der Commute ist
Wahoo-Outdoor (`indoor` falsy), das trennt sauber. FTP = 0.75 x MAP (bester
60-s-Wert). Kein Handeintrag mehr nötig, der Test erscheint nach der Analyse von
selbst. `CFG.tests` bleibt für Altfahrten ohne Daten hier, 20-Min-Tests und
Overrides: ein Handeintrag mit gesetztem `ftp` gewinnt gegen den automatischen
Wert. Die Erkennung ist eng genug, dass harte Einheiten (z. B. 3x10 min) nicht
fälschlich als Test zählen.

**Leistungsprofil (Rides-Seite):** je Anker NM (5 s), AC (60 s), MAP (300 s),
Schwelle (1200 s) der Bestwert seit Trainingsstart (`CFG.profile.since`), mit
W/kg, Alter, frisch/veraltet. Dazu ein CP/W'-Modell (2-Parameter Work-Time-Fit
aus 2/5/10/20-min-Bestwerten) als Gegenprobe zum Rampen-FTP, plus ein
Wochen-Verlaufsplot der Anker-Bestwerte (1-Wochen-Bins). Rechnung zentral in
`shared.js`: `bestSince`, `powerProfile`, `cpModel`, `weeklyBest`, `attemptBest`.

**Der Verlaufsplot zeigt nur ECHTE Versuche, nicht das Wochen-Max über alle
Fahrten** (`attemptBest`, `drawProfileTrend`). Sonst setzt eine lockere Woche
einen niedrigen Punkt und die Linie fällt, als wäre die Form eingebrochen,
obwohl an der Dauer nur nicht getestet wurde. Eine Woche zählt als Versuch, wenn
ihr Bestwert an der Dauer >= `CFG.profile.attemptPct` (0.90) des jüngsten
Bestwerts im gleitenden Fenster (`attemptWindowDays`, 56 d) liegt. Referenz ist
gleitend, nicht der Saison-Bestwert, damit frühe echte Versuche erhalten bleiben
und der Aufwärtstrend sichtbar ist. Lockere Wochen fallen als Lücke raus
("nicht getestet = nicht auswertbar"). `weeklyBest` bleibt die Rohbasis, die
Kacheln (`powerProfile`/`bestSince`) sind unberührt.

**Beobachtung zur Gegenprobe:** Die Rampe (0.75 x MAP) überschätzt bei starkem
anaeroben Profil, weil die letzte Rampen-Minute viel Anaerobes trägt. CP aus den
Daten ist eher eine Untergrenze, solange kein maximaler 20-min- oder
12-min-Effort im Fenster liegt (Wolfs harte Einheiten sind Intervalle, kein
Dauertest). Die realistische Schwelle liegt zwischen beiden. Das ist eine
Beobachtung, keine Vorschrift.

---

## Datenmodell (ANALYSIS_VERSION = 17)

Quelle der Wahrheit ist immer `data/streams/{id}.json`. Daraus genau zwei
Artefakte, ohne Überschneidung:

**`data/activities.json`** pro Fahrt: `np`, `power_curve`, `hist_p` (10 W-Eimer),
`hist_hr` (2 bpm ab 40), `avg_power`, `avg_power_moving`, `max_power`, `avg_hr`,
`max_hr`, `avg/max_cadence`, `tss`, `ef`, `decoupling_pct`, `moving_sec`,
`elapsed_sec`, `pause_sec`, `frozen_hr_sec`, `has_power`, `has_hr`, `route`
(grobe Streckenlinie ~24 Punkte fürs Listen-Thumbnail, fehlt ohne GPS).
Garmin-Fahrten zusätzlich `source: 'garmin'`, `indoor: true`. Global:
`wahoo_skipped`. `tss` ist nur noch Fallback, die Anzeige rechnet live (`tssOf`).

**`data/analysis/{id}.json`** eine Serie:
`{id, v, step:5, n, w, hr, cad, gaps, route}`. `gaps` = `[[serien_index,
sekunden]]` für die echte Zeitachse. `route` = feinere Streckenlinie (~200
`[lat,lng]`-Punkte, 5 Nachkommastellen) für die Detailkarte, `null` ohne GPS.

**Zwei Darstellungen:** Das **Listen-Thumbnail** ist agnostisch, nur die
GPS-Punktfolge als SVG-Pfad (`rides.js:routeSvg`), KEINE Kartenkacheln, offline-
fest, klein und schnell für viele Zeilen. Die **Detailsicht** zeigt eine echte
Karte (`rides.js:drawMap`, Leaflet 1.9 per CDN, dunkle CARTO-Tiles), Route als
Polyline, Start grün / Ende rot. Die Karte braucht externe Tiles (bewusst, auf
Wolfs Wunsch), lohnt aber erst beim Aufklappen. Fällt Leaflet aus, rendert das
Detail den SVG-Pfad als Fallback. `analyze:route_line` dünnt `streams.latlng`
aus (grob für die Liste, fein fürs Detail).

**GPS-Verlust bei Altfahrten und die Recovery:** Der alte `fit_streams` verwarf
die Spur, sobald nicht jeder Record eine Position hatte (`len(latlng) ==
len(time)`), das trifft lange Fahrten (Tunnel, Pausen, GPS-Aussetzer) oft. Der
Fix behält die Route bei spätem/lückenhaftem Fix (`len(latlng) >= 4`), aber nur
für KÜNFTIGE Fetches; ein Reprocess liest nur den gespeicherten Stream.
`fetch_activities:recover_gps` holt daher für bekannte Wahoo-Fahrten ohne
gespeichertes `latlng` das FIT neu und schreibt den Stream mit GPS (löscht das
analysis-File für die Reanalyse). Fenster `GPS_RECHECK_DAYS` (200, ganze
Historie), aber **selbstbegrenzt**: der Vorabcheck `not route and not no_gps`
überspringt geheilte Fahrten (kein Stream-Read), also nach dem Heilen praktisch
kostenlos. Tri-State: True geholt, False = FIT ohne GPS (`no_gps`-Flag, nicht
erneut), None = Download-Blip (transient, nicht markieren). Grenzen: nur
Wahoo-Fahrten >= `WAHOO_START_DATE` (der Loop überspringt ältere), alte
Strava-Importe (numerische IDs) und Indoor bleiben ohne GPS.

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

**`DAY_CUTOFF_H` existiert zwangsläufig doppelt.** `CFG.food.dayCutoffH` in
`js/config.js` und `DAY_CUTOFF_H` in `scripts/nutri.py`. Python und JS können
einander nicht lesen, das ist dieselbe Lage wie FTP/HRmax zwischen `config.js`
und `analyze_activities.py`: dokumentierte Ausnahme zur Ein-Ort-Regel, kein
Fehler. Beim Ändern **beide** Stellen anfassen, sonst landet ein Eintrag im
Browser auf einem anderen Tag als in der CLI. An beiden Stellen steht ein
Sync-Kommentar. Die Zeitzone in `nutri.py` ist fest UTC+2 verdrahtet, vor Ende
Oktober auf `zoneinfo.ZoneInfo("Europe/Berlin")` umstellen.

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

**EF-Trend braucht einen ZEIT-gewichteten EWMA.** Ein festes Alpha pro Fahrt,
auf die Zeitachse gezeichnet, zackt: dichte Wochen laufen steiler als dünne,
Fahrten am selben Tag geben senkrechte Ecken. `ewmaBand(pts, alpha, tau)` nutzt
mit `tau` (Tage, `CFG.ui.efTrend.trendTau` = 12) `alpha = 1 - exp(-dt/tau)` je
Abstand zur Vorfahrt. Gleiches Prinzip wie CTL/ATL. Die tägliche HRV/RHR-Nutzung
ruft `ewmaBand` ohne `tau` auf (festes Alpha, gleichmäßige Tage).
**Zwei Trend-Bänder, nicht eins** (`renderEF`, `catOf`): je ein EWMA-Band für
die blauen (kurz/mittel) und die orangenen (lange, >=90 min) Fahrten. Beide
Kategorien haben eigene EF-Lage und Streuung, ein gemeinsamer Trend vermischt
sie. Grau (Bonn/Saar) und Test bleiben nur Punkte. Ein Band braucht >=3 Fahrten,
sonst faellt es weg.
**Rampen werden per ID erkannt, nicht am Namen** (`isTest` in `renderEF` gegen
`testPoints()`): die alte Namensheuristik `/ftp|rampe|test/` verpasste die
abgebrochene Rampe vom 23.06 ("Night Ride") und alles ohne passenden Titel, so
fehlten Punkte im lila-Cluster. Test-Fahrten umgehen zusaetzlich die
`minDurMin`-Grenze, sonst faellt eine kurze/abgebrochene Rampe (23.06 war 24.8
min < 25) ganz raus. Die Namensheuristik bleibt nur noch als Fallback.

**`log(0)` existiert nicht.** Die MMP-y-Achse beginnt deshalb bei 50 W, nicht 0.

**Feste Achsen brauchen Clipping und einen Zähler.** Sonst malt etwas über die
Achse hinaus oder Punkte verschwinden unbemerkt. Der Scatter zeigt
`n=241 · 78% drin · 3 außerhalb`.

**Chart.js löst auf dem Canvas keine CSS-Variablen auf.** `borderColor:
'var(--ok)'` sieht richtig aus, wird aber still ignoriert und der Datensatz
bekommt Chart.js-Grau. Immer `CSSVAR('--ok')` aus `shared.js` benutzen. Einmal
in `food.js` reingefallen (die Ziellinie war unsichtbar grau).

**Scatter-Zielzone.** Der HF-gegen-Leistung-Scatter (`drawScatter`) legt einen
blau hinterlegten Kasten unter die beiden Z2/Z3-Decken (Leistung `bounds[2]`
0.66 x FTP, HF `bounds[2]` 0.75 x HRmax). Obere rechte Ecke = Kreuzung der
Z2/Z3-Grenzen. Der ganze aerobe Bereich darunter, nicht nur das Z2-Band, weil
das polarisierte ~80 % Easy alles unter der Z2/Z3-Decke meint (Z1-Rekom
eingeschlossen). `% drin` = Anteil der stabilen Punkte im Kasten. HF-Zonen als
gestrichelte Waagerechte (Labels rechts), Leistungszonen als Senkrechte (Labels
oben), wie bei der MMP-Kurve. Beide Achsen ziehen aus `CFG.athlete.ftp/hrmax`
(Config-Basis), nicht aus dem live aufgelösten FTP, gleich wie `zoneTable`.

**Zwei Schichten, nie mehr leer.** Der Scatter zeichnet immer erst die
**Rohwolke** (jedes `(Watt, HF)`-Paar der Serie, blass, klein) und darüber die
**stabilen Phasen** als deutliche Punkte. Trendlinie + R² + `% drin` erscheinen
erst ab `CFG.ui.detail.scatter.minStable` (12) stabilen Punkten, darunter steht
`n stabil (zu wenig für Trend) · m roh` und man sieht nur die Wolke. Grund (auf
Wolfs Wunsch): eine zerhackte Commute hat kaum Steady-State, soll aber trotzdem
ihre Punktwolke zeigen statt „zu wenige stabile Phasen". Die alte
Leer-Meldung mit frühem `return` ist raus. Die Stabilitätsfilter (W≥60, HF≥90,
Leistungs-CV≤12 % über ~35 s, HF-Drift≤6 bpm) gelten weiter, aber nur noch für
die Auswahl der deutlichen Punkte, nicht mehr als Alles-oder-nichts.

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

**Stiller Killer (bestätigt am 17.08.):** Der rotierte Token muss jeden Lauf ins
Secret zurück (`gh secret set`). Genau das ist am 17.08. 17:30 an einem
**GitHub-503 auf die Secrets-API** (`failed to fetch public key: HTTP 503`)
gescheitert: der neue Token ging verloren, der alte war beim Refresh schon
verbraucht, nächster Lauf `invalid_grant`, Wahoo tot für ~2,5 Tage. Also kein
Wahoo-Ablauf, kein PAT-Scope, sondern ein einzelner API-Blip. Fix: `gh secret
set` läuft jetzt in einer **Retry-Schleife (5x mit Backoff)**, ein transienter
503 killt die Kette nicht mehr. Erst wenn alle 5 scheitern, kommt die
`::warning::` "nach 5 Versuchen NICHT gespeichert" ins Log. Bei Dauerproblem den
GH_PAT-Scope (`secrets:write`) prüfen.

**Neu autorisieren (bevorzugt, per Workflow):** Der `AUTHORIZE`-Klick bleibt
Handarbeit (OAuth-Consent, braucht Wolfs Wahoo-Login), der Rest läuft im
Workflow `wahoo-reauth.yml`:
1. `developers.wahooligan.com`, App "Wolf Training-Dashboard", Details, grüner
   AUTHORIZE-Knopf. Browser landet auf
   `https://maxgreene.github.io/training-dashboard/callback?code=XXX` (404 egal,
   nur der Code zählt, gilt wenige Minuten).
2. In GitHub Actions den Workflow **Wahoo Reauth** mit dem Code als Input
   starten (oder Claude den Code geben, der stößt ihn an). Er tauscht Code gegen
   `refresh_token`, schreibt das Secret `WAHOO_REFRESH_TOKEN` und triggert den
   Fetch. Kein PowerShell mehr nötig.

**Fallback (lokal, PowerShell):** falls der Workflow mal nicht geht, Code selbst
tauschen und den `refresh_token` ins Secret `WAHOO_REFRESH_TOKEN`:

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

Der Build kopiert eine **Namensliste, kein Verzeichnis**. Neue Datenordner
müssen dort ausdrücklich rein, sonst fehlen sie live. `data/nutrition` steht
seit dem Food-Tab drin. Fällt die Zeile weg, liefert die Seite 404 auf
`foods.json` und der Deploy bleibt trotzdem grün.

**Wahoo Reauth** (`wahoo-reauth.yml`): manueller `workflow_dispatch`, nimmt den
Wahoo-`code` als Input, tauscht ihn gegen einen frischen `refresh_token`, setzt
das Secret und stößt den Fetch an. Nur nötig, wenn die Token-Kette tot ist
(`wahoo_skipped`). Details oben unter Token-Ketten.

---

## Ernährungs-Logbuch (Food-Tab)

Vierter Tab. **Geschrieben wird nur über die CLI, gelesen nur im Browser.**
GitHub Pages ist statisch, die Seite kann nicht ins Repo zurückschreiben (siehe
Offene Punkte). Ausführliche Übergabe: `FOOD.md`.

**Das Repo ist öffentlich, das Logbuch liegt deshalb verschlüsselt darin.**
Ein DEK (32 Byte, AES-256-GCM) verschlüsselt `log.enc.json`. Der DEK selbst
steht nie im Repo, sondern mehrfach eingewickelt in `keys.json`: einmal per
Passphrase (PBKDF2-SHA256, 600 000 Runden) als Wiederherstellung, und **ein
Wrap pro Gerät** per WebAuthn-PRF nach HKDF. Apples PRF funktioniert nur im
Flow auf demselben Gerät zuverlässig, über den QR-Code auf ein zweites Gerät
kommt teils ein leeres Ergebnis zurück. Also: iPhone-Passkey am iPhone anlegen,
Laptop-Passkey am Laptop, per `nutri.py add-wrap` nachtragen.

Der Passkey meldet niemanden an. Es gibt keinen Server, an dem man sich anmelden
könnte. Er ist ein Schlüsselableiter, den Face ID bewacht. **Ohne
Passphrase-Wrap ist ein verlorener Passkey ein verlorenes Logbuch.**

**Ziele stehen NICHT in `config.js`.** kcal, Protein, Ballaststoffe und
Flüssigkeit sind persönliche Zahlen und liegen im Tresor (`vault.goals`),
gesetzt per `nutri.py goals --kcal 1800`. Das ist die Ausnahme zur Regel "alle
Zahlen in der Config": die Config ist öffentlich, der Tresor nicht. `CFG.food`
hält nur Darstellung und Mechanik (Farben, `dayCutoffH`, Fenster, Chart-Höhen,
Atwater-Faktoren). Ein Ziel auf `null` zeichnet weder Linie noch Balken-Rest,
gleiche Logik wie ein EF-Band ohne genug Fahrten. Gelöscht wird eines mit
`nutri.py goals --fluid none` (`none`/`off`/`aus`/`-`), nicht mit `0`: die 0
wäre ein erreichtes Nullziel, `none` lässt die Zeile ganz weg.

**Die CLI liest den Tresor über git, der Browser über raw.** Nicht
verwechseln. `raw` ist nach einem Push Sekunden bis Minuten hinterher, und der
`?t=`-Parameter hilft dagegen nicht: das ist Verbreitungs-Latenz, kein
Cache-Treffer. `nutri.py` holte den Tresor anfangs von raw, dadurch meldete
`undo` direkt nach `add` "Nichts zu widerrufen", und der nächste Schreibvorgang
hätte den frischen Eintrag still überschrieben. `read_vault` macht jetzt
`git fetch` plus `--ff-only`-Merge und liest die lokale Datei. Der Browser hat
kein git, für den bleibt raw richtig.

**Die Seite liest von `raw.githubusercontent`, nicht aus dem Pages-Artefakt.**
Pages braucht nach einem Push Minuten, raw ist sofort aktuell, liefert
`access-control-allow-origin: *` und `cache-control: max-age=300`, deshalb hängt
an jedem Abruf ein `?t=<timestamp>`. Pages liefert nur die statische Hülle plus
`foods.json`.

**Die Lebensmitteltabelle kommt aus dem BLS 4.0**, der nationalen
Nährstoffdatenbank des Max Rubner-Instituts, seit Dezember 2025 Open Data unter
CC BY 4.0. 7140 Lebensmittel aus Laboranalysen. `scripts/build_foods.py`
erzeugt daraus `foods.json` (`--download` holt die ZIP selbst, sonst Pfad
angeben). Die 14-MB-Quelldatei bleibt draußen.

**Zwei Schichten, `foods.json` ist erzeugt und wird nie von Hand editiert.**
Kurznamen (`alias`), Portionsgrößen und eigene Einträge für Markenprodukte
stehen in `foods_extra.json` und überleben jeden Neubau. Wer einen Wert
korrigieren will, trägt ihn dort unter `overrides` ein.

`resolve()` in `nutri.py` sucht in vier Stufen: Kurzname, exakter Name, id,
Teilstring. Bei 7149 Einträgen liefert eine reine Teilstring-Suche für "Kaffee"
40 Treffer, also nur noch Fehlermeldungen. Der Kurzname gewinnt deshalb vor
jedem BLS-Namen.

**Der Browser lädt aus `data/nutrition` nur `keys.json` und `log.enc.json`.**
`foods.json` (1,2 MB) braucht allein die CLI, in den Einträgen im Tresor stehen
die Nährwerte schon ausgerechnet. Deshalb kommt `data/nutrition` **nicht** ins
Pages-Artefakt. Wer es doch hineinkopiert, wiederholt den Fehler, der die
Deploy-Timeouts verursacht hat (siehe ARCHITECTURE.md).

**Körpergewicht** liegt ebenfalls im Tresor (`vault.weights`, ein Wert je Tag,
`nutri.py weight 80.4`), Zielgewicht unter `goals.kg`. Folge davon, bewusst in
Kauf genommen: die Rides-Seite kann es für W/kg **nicht** benutzen, die liest
keinen Tresor. `CFG.athlete.weight` bleibt dafür der Handwert und muss bei
größeren Änderungen nachgezogen werden. Wer W/kg live haben will, müsste das
Gewicht öffentlich ablegen, dann steht es aber im offenen Repo.

Die Karte GEWICHT auf der Food-Seite zeichnet Messpunkte, einen
zeit-gewichteten EWMA (`CFG.food.weight.tau`, 10 d) und die Achse bis
`CFG.athlete.ftpGoalDate`. Zeit-gewichtet aus demselben Grund wie der EF-Trend:
ein festes Alpha je Messung zackt, sobald eine Woche fehlt.

**Die Karte REST DES TAGES** rechnet die Lücke zu den Zielen in Mengen um,
Füller und ihre Nährwerte stehen in `CFG.food.fillers` (BLS-Codes im
Kommentar). Vorschläge, die allein schon über dem kcal-Rest liegen, werden gelb
markiert statt verschwiegen. Die Uhrzeit steht in der Karte, weil ein offenes
Budget um 17 Uhr das Abendessen ist und um 23 Uhr ein Defizit.

`.githooks/pre-commit` blockt Klartext-Log und rohe Schlüssel. Aktiv erst nach
`git config core.hooksPath .githooks`, das ist lokale Konfiguration und wandert
nicht mit dem Klon mit.

## Trainingskontext

- FTP wird aus dem jüngsten Rampentest abgeleitet, aktuell **283 W** (02.09.,
  0.75 x MAP 377, Rolle, auto-erkannt). Ziel **300 bis 15.11.2026**, 81 kg (80,9
  am 02.09.). HRmax aus demselben Test, jetzt **173** (Peak in der 02.09-Rampe,
  vorher 171). Vorherige Rampe 22.07.: 271 / MAP 361. Die 02.09-Rampe war ein
  sauberer Maximaltest (HF bis 173 = neue Max, Leistung glatt bis 387 W Peak,
  Trittfrequenz 101-108 bis zum Abbruch stabil): Beine und Lunge kohärent am
  Limit, kein früher Bein- oder Lungeneinbruch. Drei-Wege-Schätzung: Rampe
  0.75xMAP = 283 (oberes Ende, MAP überschätzt bei anaerobem Profil), CP-Fit
  256-282 je nach Dauern, 20-min x0.95 = 265 (aus altem 279er 20-min). Realistische
  Schwelle daher eher ~270, die Seite trägt konventionsgemäß 283.
- Hatte 300 bereits 2021 und 2023/24.
- Rampentests in `CFG.tests`: 21.05. FTP 237 / MAP 313, 23.06. FTP 229 / MAP 305
  (früh abgebrochen, müde Beine), 22.07. FTP 271 / MAP 361 (Nullpunkt
  FTP-300-Block). Neue kommen automatisch dazu (siehe Test-Erkennung oben).
- **Geplante Retests** (`CFG.plan.events`, type:'test'): 02.09. und 14.10. (der
  23.09 lag im Challenge-Fenster und wurde gestrichen, waren eh zu viele).
  Letzter am 14.10., danach kein Test mehr: so nah am Ziel 15.11. lässt sich eh
  nicht mehr steuern. Der
  "Weg zu 300"-Plot (`plan.js:testTimeline`)
  zeigt sie als hohle Dreiecke auf der Achse mit Datum, dazu eine senkrechte
  "heute"-Linie, und je gemessenem Test den FTP-Wert am Marker und das Datum an
  der Achse.
- **Petersberg-Challenge mit Ingo (Ende Sept 2026).** Sub-8 auf dem Strava-
  Segment "Petersberg 1" (752098): 2,1 km, 178 Hm, 8,7 %. Sub-8 = 8-min-Effort,
  also VO2max/MAP, nicht Schwelle. Ziel-Watt aus Physik (`P = m·g·Δh/t` plus
  Roll/Luft/Antrieb, ~91 kg System): **~375 W bei 81 kg**, mit leichtem Bergrad
  (−1 kg) **~371 W**, je Kilo Körpergewicht ~4 W weniger. Ist eine Physik-
  Konstante, hängt NICHT am FTP. Wolfs PR steht bei 8:16 (2018, ~362 W), er war
  also schon dran, damals fitter/leichter. Gemessenes 8-min-Power aktuell ~315 W
  (interpoliert 5-min 331 / 10-min 307), aber Untergrenze: keine maximalen
  8-min-Efforts in den Daten (Intervalle, kein Dauertest). Realistischer Weg:
  8:16-PR knacken (sicher), Sub-8 als Reach-Goal. **Termin ist ein FENSTER
  19.–24.09** (Wetter/Ingo), kein fixer Tag. Umsetzung im Plan als Events
  (`CFG.plan.events`, neue Typen `vo2`/`sim`/`challenge`, CSS `.ev-*` in
  index.html): letzte harte Einheit 16.09 (race-spez 3×6 @ 355-375 W), davor
  09.09 VO2 5×3; echter Baseline-Effort am Berg 13.09 (kontrolliert hart, Zeit
  nehmen, auf 13.09 vorgezogen weil der 19.09 schon Versuchstag sein kann); ab
  17.09 nur noch Taper (17.09 locker), 19.09 Challenge-Fenster offen, 20.09
  Öffner+locker bis Do 24.09. Der geplante Rampentest 23.09 lag mitten im
  Fenster und ist **ganz gestrichen** (waren eh zu viele), es bleiben Rampe
  02.09 (MAP-Baseline vor der Challenge) und 14.10.
  Watt-Ziel Sub-8 ist Physik-Konstante (~371 W leichtes Rad), der 02.09-MAP
  schärft nur die Einschätzung der Lücke.
- Eine Rampe erkennt man an der Treppe bei **30-Sekunden-Auflösung**. Bei
  2-Minuten-Blöcken verwischt sie und sieht aus wie ein Intervalltraining.
- **Zonen sind labor-individualisiert** (Laktat-Stufentest mha-sport 16.10.2020,
  MLSS 290 W, HRmax ~174), nicht Standard-Coggan/%HRmax. Wolfs HF laeuft niedrig
  fuer die Leistung: GA1/Z2 endet bei HF 129 und ~0.66 FTP, nicht bei 142/0.75.
  Grenzen in `CFG.zones` entsprechend gesetzt (`hr.bounds` 0.62/0.75/0.85/0.95,
  `power.bounds` Z2-Top 0.66). Verifiziert gegen die 2026er-Fahrten (bei 150 bis
  200 W steht die HF steady bei ~118).
- Easy-Anteil: nach Leistung war er mit den alten Zonen ~59 %, nach HF ~85 bis
  95 %. Mit den engeren Labor-Zonen faellt beides etwas, das ist richtiger.
  Die Differenz HF vs Leistung bleibt die Information: Antritte spiken die Watt,
  die HF folgt nicht.
- Wochenrhythmus: Mo bis Fr zwei Commutes, Mi Rolle (hart), Sa oder So lange
  Ausfahrt. Blockstruktur vier Wochen, jede vierte ist Entlastung.
- **Zeitgeknappt, deshalb Intensitaet statt Dauer (12.08.2026).** Wolf kann max
  2x/Woche lang fahren, der Rest sind kurze Commutes. Datenlage: 78 % der
  Fahrten unter 30 min, nur ~1.2 lange (>=90 min) pro Woche, CTL seit sechs
  Wochen flach (57 bis 63) trotz grüner Erholung (HRV balanced, RHP stabil). Der
  Volumen-/Mitochondrien-Weg ist richtig, wird aber über zerstückelte Commutes
  kaum ausgeliefert. Fix: Di und Do wird je 1 Commute-Weg ein Sweet-Spot-Block
  (`template.commuteQuality: 'ss'`), Mi bleibt die Schwellen-Progression, die
  langen Fahrten bleiben der Dauerreiz, die übrigen Commutes ehrlich locker.
  Intensitaet baut Mitochondrien auch (AMPK-Weg), nur potenter pro Minute, genau
  der Hebel wenn die Minuten fehlen. Nicht alles grau fahren, harte Tage hart,
  leichte leicht.
- **Watt-Ziele live aus FTP.** `CFG.plan.intensity` hält nur die Anteile
  (ss 0.88 bis 0.94, thr 0.95 bis 1.05). `plan.js:wRange()` rechnet daraus die
  Watt-Spanne x `CFG.athlete.ftp` (aufgelöst, aktuell 271), also SS ~238 bis 255,
  Schwelle ~257 bis 285. Nach jedem Rampentest ziehen die Ziele automatisch mit,
  kein Handeintrag.
- **Heute-Feld (oben auf der Plan-Seite, `plan.js:todayCard`), zweispaltig.**
  Ampeln aus Health (HRV/RHP/Schlaf gegen 42-Tage-Median via `form.js:baseline`),
  Form (CTL/ATL/TSB aus `loadModel`) und Plan (`plannedFor`). Flags: HRV <
  Basis−5, RHP > Basis+3, Schlaf < 6.5 h, HRV-Status LOW/POOR/UNBALANCED. 0
  Flags = grün, 1 = gelb, >=2 oder Status LOW/POOR = rot.
  - **Links HEUTE:** adaptiv. Sind schon Fahrten von heute da (`DATA.acts` mit
    heutigem Datum), zeigt es die **Analyse** (Anzahl, Min, +TSS, Ø-Leistung/HF
    relativ zur Z2/Z3-Decke via `histMeanSd`, plus Verdict gegen den Plan). Wenn
    noch nichts gefahren (z. B. morgens), die **Empfehlung** wie bisher.
  - **Rechts MORGEN:** projizierte Ampel für den Folgetag aus heutiger Last
    (`todayWasHard` = TSS>=80 oder >=90 min, sonst der geplante heutige Reiz)
    plus aktuellen Markern plus `tplan` (`plannedFor` morgen). Ist morgen Qualität
    und heute war hart, wird die Ampel eine Stufe hochgestuft. Echte Marker gibt
    es morgen früh, daher als Projektion gekennzeichnet.
- **Ride-vs-Decke-Widget (rechts im FTP-Widget, ersetzt das alte Easy-%).**
  `plan.js:drawRideTargets` + `shared.js:ridePoints`: je Fahrt der letzten
  `easyWindowDays` (14) Tage Ø-Punkt und ±1sd-Whisker von Leistung (blau) und HF
  (grün), RELATIV zur Z2/Z3-Decke (Leistung 0.66 x FTP, HF 0.75 x HRmax). Linie
  bei 1.0 = auf der Decke, darunter aerob (blau hinterlegt). Ø/sd kommen aus
  `histMeanSd` über die Histogramme, Leistung ohne Coasting-Eimer (0 W). Zeigt
  das Muster direkt: Leistung oft > 1.0 mit großem sd (Antritte spiken die Watt),
  HF meist <= 1.0 mit kleinem sd (folgt nicht). Zieht mit aufgelöstem FTP/HRmax.

---

## Offene Punkte

1. Zonen-Editor auf der Seite: CSS `.zed` existiert, Engine läuft, UI fehlt.
2. `plan.template` reicht nur für den aktuellen Block, weitere später.
3. Online-Editieren (Fahrten löschen, Tests zuweisen) wurde geprüft und
   verworfen: GitHub Pages ist statisch und kann nicht ins Repo zurückschreiben.
4. Neun Alteinträge in `foods_extra.json` sind als `unsicher` markiert
   (BasisMuesli, Haferhimmel, Energiebombe, Hafervoll, Kekse, ChickenNuggets,
   LinsenCurry, Porridge, Platzhalter Mittag/Abendessen). Die stammen weiter
   aus der abgetippten Tabelle. Bei Gelegenheit gegen die Verpackung prüfen.
5. Der Mengen-Parser kennt nur `g`, `ml`, `stk`, `x`. "eine Handvoll Cashews"
   versteht er nicht, obwohl die Portion `Handvoll` heißt. Portionslabels als
   Einheit zuzulassen wäre die naheliegende Erweiterung.
6. Kein Schreibweg vom Handy. Bewusst so, GitHub Pages ist statisch. Wer in der
   Bäckerei loggen will, bräuchte Cloudflare Pages plus Access.
7. Energieziel steht fix im Tresor. Offen, ob es später aus dem Tages-TSS
   skalieren soll, die Daten liegen im selben Repo.
8. CP-Gewichtung nach Datenlage: aktuell fließt jeder Anker-Bestwert gleich in
   den CP-Fit. Verfeinerung wäre, nur nahe-maximale Efforts zu zählen (HF nahe
   Max oder Wert passt zur Kurve), damit ein lockeres 20-min CP nicht verzerrt.

---

## Rollback

Anker-Commit vor dem großen Umbau: `e1c8fd28`. Zurückrollen heißt: alten Code
wiederherstellen, aber mit **höherer** `ANALYSIS_VERSION`, nie niedrigerer.
Sonst rechnet der alte Code die neuen Daten nicht neu und liest ein Format, das
er nicht kennt.
