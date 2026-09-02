# Ernährungs-Logbuch — Übergabe an Claude Code

Vierter Tab im bestehenden Dashboard. Kein neues Repo, kein Server.
Geschrieben wird nur über die CLI, gelesen nur im Browser.

## Grundprinzip

Das Repo ist öffentlich. Deshalb liegt das Logbuch **verschlüsselt** darin.

```
Claude Code                          Handy
    │                                  │
    │ nutri.py add "2 Ei"              │ Face ID
    │                                  │
    ├─ raw.githubusercontent lesen     ├─ keys.json + log.enc.json von raw
    ├─ mit lokalem DEK entschlüsseln   ├─ Passkey → PRF → HKDF → DEK
    ├─ Eintrag anhängen                ├─ AES-GCM entschlüsseln
    ├─ neu verschlüsseln               └─ zeichnen (Chart.js)
    └─ commit + push
```

Ein Datenschlüssel (DEK, 32 Byte, AES-256-GCM) verschlüsselt `log.enc.json`.
Der DEK liegt nie im Repo. Er ist mehrfach eingewickelt in `keys.json`:

| Wrap | Ableitung | Zweck |
|---|---|---|
| `passphrase` | PBKDF2-SHA256, 600 000 Iterationen | Wiederherstellung, Erstzugang |
| `prf` | WebAuthn-PRF → HKDF-SHA256 | Face ID, ein Wrap **pro Gerät** |

Der Passkey meldet niemanden an. Es gibt keinen Server, an dem man sich
anmelden könnte. Er ist ein Schlüsselableiter, den Face ID bewacht.

## Warum ein Wrap pro Gerät

Apples PRF funktioniert zuverlässig nur im Flow auf demselben Gerät. Über den
QR-Code auf ein zweites Gerät kommt teils ein leeres Ergebnis zurück
([Apple Developer Forum](https://developer.apple.com/forums/thread/774112)).
Also: iPhone-Passkey am iPhone anlegen, Laptop-Passkey am Laptop.

**Ohne Passphrase-Wrap ist ein verlorener Passkey ein verlorenes Logbuch.**
Die Passphrase gehört in den Passwortmanager, nicht ins Repo.

## Warum raw statt Pages

GitHub Pages braucht nach einem Push bis zu einige Minuten. `raw.github`
`usercontent.com` ist sofort aktuell, liefert `access-control-allow-origin: *`
(geprüft) und `cache-control: max-age=300`, deshalb hängt an jedem Abruf ein
`?t=<timestamp>`. Pages liefert nur die statische Hülle.

## Dateien

| Datei | Was |
|---|---|
| `scripts/nutri.py` | CLI: init, add, undo, today, goals, search, add-wrap |
| `scripts/nutri_crypto.py` | AES-GCM, DEK-Wrapping, Schlüsseldatei |
| `js/vault.js` | Browser: PRF, PBKDF2, entschlüsseln |
| `js/food.js` | Food-Seite: Entsperren, Tag/Woche/Monat |
| `scripts/build_foods.py` | BLS 4.0 nach `foods.json` |
| `data/nutrition/foods.json` | Lebensmitteltabelle, erzeugt (BLS 4.0, 7149 Eintraege) |
| `data/nutrition/foods_extra.json` | Kurznamen, Portionen, eigene Eintraege |
| `data/nutrition/keys.json` | entsteht bei `nutri.py init` |
| `data/nutrition/log.enc.json` | der Tresor |
| `.githooks/pre-commit` | verhindert Klartext- und Schlüssel-Commits |

## Vier Eingriffe ins bestehende Repo

Vorher wie immer alle betroffenen Dateien per curl von
`raw.githubusercontent.com` holen und gegen die Arbeitskopie diffen.

**1. `index.html`, Tab-Leiste (bei Zeile 231):**
```html
<button class="tab" data-p="food" onclick="showPage('food',this)">Food</button>
```

**2. `index.html`, Seiten-Container (bei Zeile 239):**
```html
<div class="page" id="page-food"></div>
```

**3. `index.html`, Skripte (nach `js/form.js`, Zeile 253):**
```html
<script src="js/vault.js?v=BUILD"></script>
<script src="js/food.js?v=BUILD"></script>
```
und im Bootstrap-Block `RENDER` ergänzen: `food: renderFood`.

**4. `.github/workflows/deploy.yml`** — das ist der, der still bricht.
Der Build kopiert eine Namensliste, kein ganzes Verzeichnis. Ohne diese Zeile
liefert die Seite in Produktion 404 auf die Nährstoffdaten:
```yaml
          mkdir -p _site/data/nutrition
          cp -r data/nutrition/. _site/data/nutrition/ 2>/dev/null || true
```
Nötig nur für `foods.json`; `keys.json` und `log.enc.json` holt die Seite von
raw. Mitkopieren schadet nicht.

## Einrichten

```bash
pip install cryptography
git config core.hooksPath .githooks

python scripts/nutri.py init          # fragt die Passphrase, legt DEK + keys.json an
git add data/nutrition && git commit -m "food: Tresor angelegt" && git push
```

Dann am Handy die Food-Seite öffnen, mit der Passphrase entsperren,
„Passkey hinzufügen“, den angezeigten Block kopieren, und:

```bash
python scripts/nutri.py add-wrap wrap.json
```

Auf einem zweiten Arbeitsrechner nur den Schlüssel nachziehen:
```bash
python scripts/nutri.py import-key "<base64 aus ~/.config/nutri457/key>"
```

## Täglicher Gebrauch

```bash
python scripts/nutri.py add "100 g Proteinbrot" "2 Ei" "500 ml Wasser"
python scripts/nutri.py today
python scripts/nutri.py undo
```

Der Parser versteht `100 g X`, `2 X` (Portionen), `500 ml X` und `X` allein
(eine Portion). Unbekannte Namen brechen ab, statt zu raten.

### Wo geloggt wird

Loggen geht **nur in einer Claude-Code-Sitzung im Arbeitsverzeichnis**
`training-dashboard`. Dort liegen `nutri.py`, der lokale DEK und git. Ein Chat
in der Claude-App (claude.ai) hat kein Dateisystem und keinen Schluessel, der
kann grundsaetzlich nichts eintragen, egal wie oft man fragt. Ebenso eine
Claude-Code-Sitzung in einem anderen Ordner.

Chats teilen **keinen** Verlauf. Gemeinsam ist ihnen nur, was auf der Platte
liegt: das Repo, der Tresor und das Memory-Verzeichnis. Deshalb geht beim
Wechsel der Sitzung nichts verloren, `nutri.py today` zeigt in jeder Sitzung
denselben Stand.

Probe fuer die richtige Sitzung: sie kann `git status` ausfuehren.

## Offene Punkte

1. ~~`foods.json` ist abgetippt~~ **Erledigt am 31.08.2026.** Die Tabelle kommt
   aus dem BLS 4.0 (Max Rubner-Institut, Open Data, CC BY 4.0), 7140
   Lebensmittel. `scripts/build_foods.py --download` baut sie neu. Das alte
   Ei-Problem (kcal je Portion, Makros je 100 g) erledigt sich damit: das BLS
   führt Hühnerei roh mit 135 kcal/100 g.

   Handgepflegtes steht in `foods_extra.json` und überlebt jeden Neubau:
   Kurznamen, Portionsgrößen, `overrides` für einzelne Werte und eigene
   Einträge für Markenprodukte. Neun Altposten sind dort als `unsicher`
   markiert, die stammen weiter aus der abgetippten Tabelle.

2. **Energieziel 1800 kcal**, gesetzt per `nutri.py goals --kcal 1800`, liegt
   im Tresor. Bei 81 kg und dem Trainingsumfang ist das eine Defizitvorgabe,
   kein Erhaltungswert. Offen, ob das Ziel fix bleibt oder aus dem TSS des
   Tages skaliert werden soll: die Garmin- und Wahoo-Daten liegen im selben
   Repo bereits vor.

4. **Tagesgrenze** steht auf Mitternacht (`DAY_CUTOFF_H = 0` in `nutri.py`
   *und* `food.js`, müssen übereinstimmen). Auf 4 setzen, wenn ein Snack um
   01:00 noch zum Vortag zählen soll.

5. **Zeitzone** ist in `nutri.py` als feste UTC+2 verdrahtet. Vor Ende Oktober
   auf `zoneinfo.ZoneInfo("Europe/Berlin")` umstellen.

6. **Kein Schreibweg vom Handy.** Bewusst so. Wer in der Bäckerei steht und
   loggen will, braucht Route A (Cloudflare Pages + Access).
