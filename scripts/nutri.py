#!/usr/bin/env python3
"""nutri - Ernaehrungs-Logbuch fuer das Training-Dashboard.

Wird von Claude Code aufgerufen, nicht von Hand. Der Ablauf ist immer gleich:

  1. aktuellen Chiffretext von raw.githubusercontent holen  (NICHT lokal raten)
  2. mit dem lokalen DEK entschluesseln
  3. Eintraege anhaengen / aendern
  4. neu verschluesseln, nach data/nutrition/log.enc.json schreiben
  5. committen und pushen

Schritt 1 ist wichtig: es kann sein, dass von einem anderen Rechner aus
geloggt wurde. Eine lokale Arbeitskopie ist nie die Wahrheit.

Beispiele
---------
  nutri.py init
  nutri.py add "100 g Proteinbrot" "2 Ei" "500 ml Wasser"
  nutri.py today
  nutri.py undo
  nutri.py weight 80.4
  nutri.py goals --kcal 1800 --protein 145 --carbs 170 --fat 60 --fibre 30 --fluid 3000
  nutri.py add-wrap wrap.json      # Passkey vom Handy nachtragen
"""

import argparse
import json
import re
import subprocess
import sys
import unicodedata
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import nutri_crypto as nc  # noqa: E402

# Die CLI spricht ueber git mit dem Repo, nicht ueber raw (siehe
# sync_from_remote). Die raw-Basis braucht nur der Browser, sie steht in
# CFG.food.rawBase in js/config.js.
BRANCH = "main"

ROOT = Path(__file__).resolve().parent.parent
DIR = ROOT / "data" / "nutrition"
LOG = DIR / "log.enc.json"
KEYS = DIR / "keys.json"
FOODS = DIR / "foods.json"

# Tagesgrenze. 0 = Mitternacht. Auf 4 setzen, wenn ein Snack um 01:00 noch
# zum Vortag zaehlen soll.
# SYNC-PFLICHT: muss mit CFG.food.dayCutoffH in js/config.js uebereinstimmen.
# Dokumentierte Ausnahme zur Ein-Ort-Regel (Python und JS lesen einander nicht),
# analog FTP/HRmax zwischen config.js und analyze_activities.py. Siehe CLAUDE.md.
DAY_CUTOFF_H = 0

TZ = timezone(timedelta(hours=2))  # Europe/Berlin, Sommerzeit


# ── Hilfen ────────────────────────────────────────────────────────────────

def norm(s: str) -> str:
    """Fuer den Namensabgleich: Kleinschreibung, Umlaute weg, nur a-z0-9."""
    s = unicodedata.normalize("NFKD", s.lower())
    s = s.replace("ß", "ss")
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]", "", s)


def load_foods() -> dict:
    if not FOODS.exists():
        raise SystemExit(f"{FOODS} fehlt. Erst scripts/build_foods.py laufen lassen.")
    return {f["id"]: f for f in json.loads(FOODS.read_text(encoding="utf-8"))["foods"]}


def sync_from_remote() -> None:
    """Arbeitskopie auf den Stand von origin bringen.

    Der Tresor wird ueber GIT abgeglichen, nicht ueber raw.githubusercontent.
    raw ist nach einem Push Sekunden bis Minuten hinterher, und der
    Zeitstempel-Parameter hilft nicht: das ist Verbreitungs-Latenz, kein
    Cache-Treffer. Gemessen am 31.08.: `add` pushte, `undo` 20 s spaeter las
    von raw noch den leeren Tresor und meldete "Nichts zu widerrufen". Beim
    naechsten Schreiben haette dieser alte Stand den neuen ueberschrieben,
    still. Die CLI hat git, also nimmt sie git. Der Browser hat kein git,
    fuer den bleibt raw richtig.

    Schlaegt der Abgleich fehl (kein Netz, divergierte Historie), wird mit der
    lokalen Kopie weitergearbeitet. Ein dann nicht mehr passender Push
    scheitert laut (non-fast-forward) statt still zu ueberschreiben.
    """
    if git("fetch", "--quiet", "origin", BRANCH, check=False).returncode:
        print("Hinweis: git fetch ging nicht, arbeite mit der lokalen Kopie.")
        return
    if git("merge", "--ff-only", "--quiet", f"origin/{BRANCH}", check=False).returncode:
        print("Hinweis: kein Fast-Forward, arbeite mit der lokalen Kopie.")


def empty_vault() -> dict:
    return {
        "version": 1,
        "goals": {"kcal": None, "p": None, "k": None, "f": None,
                  "b": None, "ml": None},
        "entries": [],
        # [{"date": "2026-08-31", "kg": 80.4}], je Tag hoechstens einer
        "weights": [],
    }


def read_vault(dek: bytes, offline: bool = False) -> dict:
    if not offline:
        sync_from_remote()
    if LOG.exists():
        return nc.decrypt_vault(json.loads(LOG.read_text()), dek)
    return empty_vault()


def write_vault(vault: dict, dek: bytes) -> None:
    DIR.mkdir(parents=True, exist_ok=True)
    blob = nc.encrypt_vault(vault, dek)
    LOG.write_text(json.dumps(blob, indent=1) + "\n")


def git(*args, check=True):
    return subprocess.run(["git", "-C", str(ROOT), *args], check=check,
                          capture_output=True, text=True)


def commit_push(msg: str, *paths: Path) -> None:
    """Committen und pushen, mit einem Rebase-Versuch.

    In dieses Repo pusht stuendlich (real alle 15 Minuten) der
    Trainingsdaten-Workflow. Zwischen `git fetch` in sync_from_remote und dem
    Push liegen Sekunden, in denen genau das passieren kann: der Push wird als
    non-fast-forward abgelehnt. Passiert am 31.08. beim ersten `add-wrap`, und
    zwar als roher CalledProcessError-Traceback.

    Einmal rebasen und erneut pushen reicht. Konflikte kann es dabei nicht
    geben: der Workflow fasst nur data/activities.json und data/health.json an,
    diese CLI nur data/nutrition. Bleibt es trotzdem haengen, laut abbrechen.
    """
    for p in (paths or (LOG,)):
        git("add", str(p.relative_to(ROOT)))
    if not git("diff", "--cached", "--quiet", check=False).returncode:
        print("nichts geaendert")
        return
    git("commit", "-m", msg)
    if git("push", "origin", BRANCH, check=False).returncode:
        print("Push abgelehnt (Repo war weiter), rebase und nochmal.")
        if git("pull", "--rebase", "--quiet", "origin", BRANCH, check=False).returncode:
            git("rebase", "--abort", check=False)
            raise SystemExit(
                "Rebase fehlgeschlagen. Der Commit liegt lokal, nichts ist "
                "verloren. Von Hand aufloesen, dann `git push origin main`.")
        if git("push", "origin", BRANCH, check=False).returncode:
            raise SystemExit(
                "Push auch nach dem Rebase abgelehnt. Der Commit liegt lokal, "
                "nichts ist verloren.")
    print(f"gepusht: {msg}")


def day_of(ts: datetime) -> str:
    return (ts - timedelta(hours=DAY_CUTOFF_H)).astimezone(TZ).date().isoformat()


# ── Mengen-Parser ─────────────────────────────────────────────────────────
# Versteht: "100 g Proteinbrot" | "2 Ei" | "500 ml Wasser" | "Gouda"
QTY = re.compile(r"^\s*(?P<n>[\d.,]+)?\s*(?P<u>g|gramm|ml|stk|stueck|x)?\s*(?P<name>.+?)\s*$", re.I)


def resolve(text: str, foods: dict) -> dict:
    m = QTY.match(text)
    if not m:
        raise SystemExit(f"Nicht verstanden: {text!r}")
    n = float(m.group("n").replace(",", ".")) if m.group("n") else None
    unit = (m.group("u") or "").lower()
    name = m.group("name").strip()

    # Vier Stufen, absteigend eindeutig. Seit die Tabelle aus dem BLS kommt,
    # sind es 7149 Lebensmittel: eine reine Teilstring-Suche liefert bei
    # "Kaffee" 40 Treffer und damit nur noch Fehlermeldungen. Deshalb gewinnt
    # der Kurzname (foods_extra.json) vor jedem BLS-Namen.
    key = norm(name)
    if not key:
        raise SystemExit(f"Nicht verstanden: {text!r}")

    for stufe in ("alias", "name", "id", "teil"):
        if stufe == "alias":
            hits = [f for f in foods.values()
                    if any(norm(a) == key for a in f.get("alias", []))]
        elif stufe == "name":
            hits = [f for f in foods.values() if norm(f["name"]) == key]
        elif stufe == "id":
            hits = [f for f in foods.values() if f["id"].lower() == name.lower()]
        else:
            hits = [f for f in foods.values() if key in norm(f["name"])]
        if hits:
            break

    if not hits:
        raise SystemExit(
            f"Unbekanntes Lebensmittel: {name!r}\n"
            f"  nutri.py search {name!r}  fuer die BLS-Suche, oder einen"
            f" Kurznamen in data/nutrition/foods_extra.json eintragen"
        )
    if len(hits) > 1:
        zeilen = "\n".join(f"    {h['id']:<10} {h['name']}" for h in hits[:8])
        mehr = f"\n    ... und {len(hits) - 8} weitere" if len(hits) > 8 else ""
        raise SystemExit(
            f"{name!r} ist mehrdeutig ({len(hits)} Treffer):\n{zeilen}{mehr}\n"
            f"  Genauer schreiben, die id benutzen, oder einen Kurznamen in"
            f" foods_extra.json eintragen und build_foods.py laufen lassen."
        )
    food = hits[0]

    # Menge in Gramm bzw. Milliliter aufloesen
    if unit in ("g", "gramm", "ml"):
        grams = n
    elif n is not None and (unit in ("stk", "stueck", "x") or food.get("portion")):
        per = (food.get("portion") or {}).get("g")
        if per is None:
            raise SystemExit(f"{food['name']} hat keine Portionsgroesse. Menge in g angeben.")
        grams = n * per
    elif n is None:
        per = (food.get("portion") or {}).get("g")
        if per is None:
            raise SystemExit(f"Menge fehlt bei {food['name']}.")
        grams = per
    else:
        grams = n

    q = grams / 100.0
    return {
        "food": food["id"],
        "label": food["name"],
        "g": round(grams, 1),
        "f": round(food["f"] * q, 1),
        "k": round(food["k"] * q, 1),
        "p": round(food["p"] * q, 1),
        "b": round(food["b"] * q, 1),
        "kcal": round(food["kcal"] * q, 1),
        "ml": round(food.get("ml", 0) * q, 1),
    }


def totals(entries: list) -> dict:
    out = {k: 0.0 for k in ("f", "k", "p", "b", "kcal", "ml")}
    for e in entries:
        for k in out:
            out[k] += e.get(k, 0)
    return {k: round(v, 1) for k, v in out.items()}


def show_day(vault: dict, day: str) -> None:
    ents = [e for e in vault["entries"] if day_of(datetime.fromisoformat(e["ts"])) == day]
    if not ents:
        print(f"{day}: nichts geloggt")
        return
    print(f"\n{day}")
    for e in ents:
        t = datetime.fromisoformat(e["ts"]).astimezone(TZ).strftime("%H:%M")
        print(f"  {t}  {e['label']:<26} {e['g']:>6.0f} g   {e['kcal']:>6.0f} kcal  P {e['p']:>5.1f}")
    t = totals(ents)
    g = vault.get("goals") or {}
    print(f"  {'':>7}{'SUMME':<26} {'':>8}   {t['kcal']:>6.0f} kcal  "
          f"P {t['p']:>5.1f}  K {t['k']:>5.1f}  F {t['f']:>5.1f}  "
          f"B {t['b']:>5.1f}  Fl {t['ml']:>5.0f}")
    for key, lbl in (("kcal", "kcal"), ("p", "Protein"), ("k", "Kohlenhydr"),
                     ("f", "Fett"), ("b", "Ballast"), ("ml", "Fluessig")):
        if g.get(key):
            rest = g[key] - t[key]
            print(f"  Rest {lbl:<10} {rest:>8.1f} von {g[key]}")


# ── Befehle ───────────────────────────────────────────────────────────────

def cmd_init(a):
    if KEYS.exists():
        raise SystemExit(f"{KEYS} existiert schon. init wuerde den Tresor unbrauchbar machen.")
    import getpass
    pw = getpass.getpass("Wiederherstellungs-Passphrase (lang, aufschreiben): ")
    if len(pw) < 16:
        raise SystemExit("Zu kurz. Mindestens 16 Zeichen.")
    if pw != getpass.getpass("Nochmal: "):
        raise SystemExit("Stimmt nicht ueberein.")

    dek = nc.new_dek()
    DIR.mkdir(parents=True, exist_ok=True)
    KEYS.write_text(json.dumps({
        "v": 1,
        "prfSalt": "nutri457-dek-v1",
        "wraps": [nc.wrap_dek_passphrase(dek, pw)],
    }, indent=1) + "\n")
    write_vault(empty_vault(), dek)
    p = nc.save_dek(dek)

    print(f"\nSchluessel: {p} (Modus 600, ausserhalb des Repos)")
    print(f"Tresor:     {LOG}")
    print(f"Wraps:      {KEYS}")
    print("\nNaechste Schritte:")
    print("  1. keys.json und log.enc.json committen und pushen")
    print("  2. Am Handy die Food-Seite oeffnen, mit der Passphrase entsperren,")
    print("     'Passkey hinzufuegen' tippen, den angezeigten Block kopieren")
    print("  3. nutri.py add-wrap <datei.json>")


def cmd_import_key(a):
    dek = nc.b64d(a.key.strip())
    if len(dek) != nc.DEK_LEN:
        raise SystemExit("Das ist kein 32-Byte-Schluessel.")
    print(f"gespeichert: {nc.save_dek(dek)}")


def cmd_add_wrap(a):
    # Erst abgleichen: sonst schreibt ein Geraet den Wrap eines anderen weg,
    # wenn beide in derselben Stunde eingetragen werden. Gleiche Begruendung
    # wie in read_vault, hier fuer keys.json.
    sync_from_remote()
    wrap = json.loads(Path(a.file).read_text())
    keys = json.loads(KEYS.read_text())
    labels = [w.get("label") for w in keys["wraps"]]
    if wrap.get("label") in labels:
        raise SystemExit(f"Wrap {wrap.get('label')!r} gibt es schon.")
    keys["wraps"].append(wrap)
    KEYS.write_text(json.dumps(keys, indent=1) + "\n")
    commit_push(f"food: Passkey {wrap.get('label')} hinzugefuegt", KEYS)


def when(spec: str | None):
    """Zeitpunkt eines Eintrags. Ohne Angabe: jetzt.

    Nimmt '18:30' (heute), '2026-08-30T18:30' und '2026-08-30 18:30'. Die
    kurze Form ist der Normalfall: eingetragen wird meist abends, gegessen
    ueber den Tag verteilt. Ohne sie haengt ein ganzer Tag auf einer Minute,
    und die Tagesansicht wird zur Liste statt zum Verlauf.
    """
    now = datetime.now(TZ)
    if not spec:
        return now
    spec = spec.strip().replace(" ", "T")
    if re.fullmatch(r"\d{1,2}:\d{2}", spec):
        h, m = (int(x) for x in spec.split(":"))
        return now.replace(hour=h, minute=m, second=0, microsecond=0)
    return datetime.fromisoformat(spec).replace(tzinfo=TZ)


def cmd_add(a):
    dek = nc.load_dek()
    foods = load_foods()
    vault = read_vault(dek)
    ts = when(a.at)
    added = []
    for item in a.items:
        e = resolve(item, foods)
        e["ts"] = ts.isoformat()
        vault["entries"].append(e)
        added.append(e)
    vault["entries"].sort(key=lambda e: e["ts"])
    write_vault(vault, dek)
    for e in added:
        print(f"+ {e['label']} {e['g']:.0f} g  {e['kcal']:.0f} kcal  P {e['p']:.1f}")
    show_day(vault, day_of(ts))
    if not a.no_push:
        commit_push("food: " + ", ".join(f"{e['label']} {e['g']:.0f}g" for e in added))


def cmd_undo(a):
    dek = nc.load_dek()
    vault = read_vault(dek)
    if not vault["entries"]:
        raise SystemExit("Nichts zu widerrufen.")
    gone = vault["entries"].pop()
    write_vault(vault, dek)
    print(f"- {gone['label']} {gone['g']:.0f} g")
    if not a.no_push:
        commit_push(f"food: {gone['label']} entfernt")


def cmd_today(a):
    dek = nc.load_dek()
    vault = read_vault(dek)
    show_day(vault, a.day or day_of(datetime.now(TZ)))


def cmd_goals(a):
    dek = nc.load_dek()
    vault = read_vault(dek)
    g = vault.setdefault("goals", {})
    for arg, key in (("kcal", "kcal"), ("protein", "p"), ("carbs", "k"),
                     ("kg", "kg"),
                     ("fat", "f"), ("fibre", "b"), ("fluid", "ml")):
        v = getattr(a, arg)
        if v is not None:
            g[key] = v
    write_vault(vault, dek)
    print(json.dumps(g, indent=1))
    if not a.no_push:
        commit_push("food: Ziele angepasst")


def cmd_weight(a):
    """Koerpergewicht eintragen oder anzeigen.

    Liegt im Tresor, nicht in config.js: das Repo ist oeffentlich. Damit kann
    die Rides-Seite es allerdings NICHT fuer W/kg benutzen, die liest keinen
    Tresor. CFG.athlete.weight bleibt dafuer der Handwert.

    Ein Tag, ein Wert. Zweimal am selben Tag ersetzt, statt zu sammeln:
    Tagesschwankungen von 1 bis 2 kg sind Wasser, kein Signal.
    """
    dek = nc.load_dek()
    vault = read_vault(dek)
    reihe = vault.setdefault("weights", [])

    if a.kg is None:
        if not reihe:
            print("Noch kein Gewicht eingetragen.")
            return
        for w in sorted(reihe, key=lambda w: w["date"])[-14:]:
            print(f"  {w['date']}  {w['kg']:.1f} kg")
        return

    tag = when(a.date).date().isoformat() if a.date else day_of(datetime.now(TZ))
    reihe[:] = [w for w in reihe if w["date"] != tag]
    reihe.append({"date": tag, "kg": round(a.kg, 1)})
    reihe.sort(key=lambda w: w["date"])
    write_vault(vault, dek)

    print(f"{tag}: {a.kg:.1f} kg")
    if len(reihe) > 1:
        erst, letzt = reihe[0], reihe[-1]
        d = letzt["kg"] - erst["kg"]
        print(f"  seit {erst['date']}: {d:+.1f} kg ({len(reihe)} Messungen)")
    if not a.no_push:
        commit_push(f"food: Gewicht {tag} {a.kg:.1f} kg")


def cmd_search(a):
    foods = load_foods()
    key = norm(a.term)
    for f in foods.values():
        if key in norm(f["name"]):
            por = f.get("portion")
            ps = f"  1 {por['label']} = {por['g']} g" if por else ""
            print(f"{f['id']:<22} {f['name']:<28} {f['kcal']:>6.0f} kcal/100g  P {f['p']:>5.1f}{ps}")


def main():
    ap = argparse.ArgumentParser(prog="nutri", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--no-push", action="store_true", help="nur lokal schreiben")
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("init").set_defaults(fn=cmd_init)

    p = sub.add_parser("import-key"); p.add_argument("key"); p.set_defaults(fn=cmd_import_key)
    p = sub.add_parser("add-wrap"); p.add_argument("file"); p.set_defaults(fn=cmd_add_wrap)

    p = sub.add_parser("add")
    p.add_argument("items", nargs="+")
    p.add_argument("--at", help="Zeitpunkt: 18:30 (heute) oder 2026-08-30T18:30")
    p.set_defaults(fn=cmd_add)

    sub.add_parser("undo").set_defaults(fn=cmd_undo)

    p = sub.add_parser("today"); p.add_argument("--day"); p.set_defaults(fn=cmd_today)

    p = sub.add_parser("goals")
    for n in ("kcal", "protein", "carbs", "fat", "fibre", "fluid", "kg"):
        p.add_argument(f"--{n}", type=float)
    p.set_defaults(fn=cmd_goals)

    p = sub.add_parser("weight")
    p.add_argument("kg", nargs="?", type=float, help="ohne Wert: die letzten 14 zeigen")
    p.add_argument("--date", help="Tag, z.B. 2026-08-28. Vorgabe heute.")
    p.set_defaults(fn=cmd_weight)

    p = sub.add_parser("search"); p.add_argument("term"); p.set_defaults(fn=cmd_search)

    a = ap.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
