#!/usr/bin/env python3
"""BLS 4.0 nach data/nutrition/foods.json.

Der Bundeslebensmittelschluessel ist Deutschlands nationale Naehrstoffdatenbank
(Max Rubner-Institut). Version 4.0 steht seit Dezember 2025 als Open Data unter
CC BY 4.0 zur Verfuegung: 7140 Lebensmittel, 138 Naehrstoffe, aus Laboranalysen
statt aus einem abgetippten Screenshot.

    python scripts/build_foods.py --download
    python scripts/build_foods.py ~/Downloads/BLS_4_0_2025_DE.zip

Die Quelldatei (14 MB) landet NICHT im Repo, nur das erzeugte foods.json.

Zwei Schichten, damit ein Neubau nichts wegwirft:

  BLS         die 7140 Lebensmittel, unveraendert uebernommen
  foods_extra Kurznamen (alias), Portionsgroessen und eigene Eintraege fuer
              Markenprodukte, die im BLS nicht vorkommen

foods_extra gewinnt. Wer einen Wert von Hand korrigiert, traegt ihn dort ein,
nicht in foods.json: das wird bei jedem Lauf ueberschrieben.

Zitierpflicht (CC BY 4.0): Max Rubner-Institut (2025): Bundeslebensmittel-
schluessel (BLS), Version 4.0 - Deutsche Naehrstoffdatenbank. Karlsruhe.
DOI: 10.25826/Data20251217-134202-0
"""

import argparse
import json
import re
import sys
import tempfile
import unicodedata
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "nutrition" / "foods.json"
EXTRA = ROOT / "data" / "nutrition" / "foods_extra.json"

# Der Token in der URL haengt an der Sitzung auf blsdb.de und laeuft irgendwann
# ab. Dann die ZIP von Hand holen (blsdb.de, "BLS-Daten", "Download BLS-Daten")
# und den Pfad als Argument uebergeben.
URL = ("https://www.blsdb.de/assets/uploads/BLS_4_0_2025_DE.zip"
       "?token=DQRI-HA5K-O0XS-L1IM-S242-KR3C-5SDX-LQ8J")

CITE = ("Max Rubner-Institut (2025): Bundeslebensmittelschluessel (BLS), "
        "Version 4.0 - Deutsche Naehrstoffdatenbank. Karlsruhe. "
        "DOI: 10.25826/Data20251217-134202-0. Lizenz CC BY 4.0.")

# BLS-Spaltenkuerzel -> unser Feld. Jede Groesse steht im BLS als Dreiergruppe
# (Wert, Datenherkunft, Referenz), uns interessiert nur der Wert.
COLS = {
    "ENERCC": "kcal",    # Energie in kcal/100 g
    "PROT625": "p",      # Protein (N x 6,25)
    "FAT": "f",
    "CHO": "k",          # Kohlenhydrate, verfuegbar
    "FIBT": "b",         # Ballaststoffe gesamt
    "WATER": "water",
}

# "unterhalb der Nachweisgrenze" und "keine Angabe" sind im BLS Text, kein Wert.
# Fuer die Bilanz eines Tages ist beides 0.
BLANK = {"-", "<LOD", "<LOQ", "<LOD or <LOQ", "TR", "n.b.", ""}

# Getraenke: Hauptgruppe N (alkoholfrei) und P (alkoholisch). Nur dort ist
# "500 ml" eine sinnvolle Angabe, und nur dort zaehlt etwas als Fluessigkeit.
DRINK_GROUPS = ("N", "P")
DRINK_MIN_WATER = 85.0


def num(v):
    if v is None:
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip()
    if s in BLANK:
        return 0.0
    try:
        return float(s.replace(",", "."))
    except ValueError:
        return 0.0


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s.lower()).replace("ß", "ss")
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]", "", s)


def find_source(arg: str | None) -> Path:
    if arg:
        p = Path(arg).expanduser()
        if not p.exists():
            sys.exit(f"{p} gibt es nicht.")
        return p
    for cand in (Path.cwd(), Path.home() / "Downloads", ROOT):
        for pat in ("BLS_4_0_2025_DE.zip", "BLS_4_0_Daten_2025_DE.xlsx"):
            hit = cand / pat
            if hit.exists():
                return hit
    sys.exit("Keine BLS-Datei gefunden. --download benutzen oder Pfad angeben.\n"
             "  Von Hand: blsdb.de -> BLS-Daten -> Download BLS-Daten")


def download(to: Path) -> Path:
    print("Lade BLS 4.0 von blsdb.de ...")
    req = urllib.request.Request(URL, headers={"User-Agent": "nutri457"})
    with urllib.request.urlopen(req, timeout=300) as r, open(to, "wb") as fh:
        fh.write(r.read())
    print(f"  {to.stat().st_size / 1e6:.1f} MB")
    return to


def open_sheet(src: Path):
    try:
        import openpyxl
    except ImportError:
        sys.exit("openpyxl fehlt:  pip install openpyxl")

    tmp = None
    if src.suffix.lower() == ".zip":
        tmp = Path(tempfile.mkdtemp())
        with zipfile.ZipFile(src) as z:
            name = next(n for n in z.namelist() if n.endswith("_Daten_2025_DE.xlsx"))
            z.extract(name, tmp)
            src = tmp / name
    wb = openpyxl.load_workbook(src, read_only=True, data_only=True)
    return wb.active


def read_bls(src: Path) -> list[dict]:
    ws = open_sheet(src)
    rows = ws.iter_rows(values_only=True)
    hdr = next(rows)

    idx = {}
    for i, h in enumerate(hdr):
        if not h:
            continue
        parts = str(h).split()
        if len(parts) > 1 and parts[1] in ("Datenherkunft", "Referenz"):
            continue
        if parts[0] in COLS:
            idx.setdefault(COLS[parts[0]], i)
    missing = set(COLS.values()) - set(idx)
    if missing:
        sys.exit(f"Spalten fehlen im BLS: {missing}")

    foods = []
    for r in rows:
        code, name = r[0], r[1]
        if not code or not name:
            continue
        water = num(r[idx["water"]])
        drink = str(code)[0] in DRINK_GROUPS and water >= DRINK_MIN_WATER
        foods.append({
            "id": str(code).lower(),
            "name": str(name),
            "f": round(num(r[idx["f"]]), 2),
            "k": round(num(r[idx["k"]]), 2),
            "p": round(num(r[idx["p"]]), 2),
            "b": round(num(r[idx["b"]]), 2),
            "kcal": round(num(r[idx["kcal"]]), 1),
            # ml je 100 g: bei Getraenken zaehlt die Menge als Fluessigkeit.
            # 100 g Wasser sind 100 ml, die Dichte anderer Getraenke weicht so
            # wenig ab, dass sie neben der Schaetzung der Menge verschwindet.
            "ml": 100 if drink else 0,
        })
    return foods


def apply_extra(foods: list[dict]) -> list[dict]:
    if not EXTRA.exists():
        print(f"  {EXTRA.name} fehlt, nur BLS uebernommen.")
        return foods

    ex = json.loads(EXTRA.read_text(encoding="utf-8"))
    # Schluessel mit _ sind Kommentare in der JSON-Datei, kein BLS-Code.
    def entries(section):
        return {k: v for k, v in (ex.get(section) or {}).items()
                if not k.startswith("_")}

    by_id = {f["id"]: f for f in foods}

    for code, aliases in entries("aliases").items():
        f = by_id.get(code.lower())
        if f is None:
            sys.exit(f"alias zeigt auf unbekannten BLS-Code {code!r}")
        f["alias"] = sorted(set(f.get("alias", []) + list(aliases)))

    for code, portion in entries("portions").items():
        f = by_id.get(code.lower())
        if f is None:
            sys.exit(f"portion zeigt auf unbekannten BLS-Code {code!r}")
        f["portion"] = portion

    for code, patch in entries("overrides").items():
        f = by_id.get(code.lower())
        if f is None:
            sys.exit(f"override zeigt auf unbekannten BLS-Code {code!r}")
        f.update(patch)

    own = ex.get("foods") or []
    for f in own:
        if f["id"] in by_id:
            sys.exit(f"eigener Eintrag {f['id']!r} kollidiert mit einem BLS-Code")
        f.setdefault("ml", 0)
        foods.append(f)

    print(f"  extra: {len(entries('aliases'))} Kurznamen, "
          f"{len(entries('portions'))} Portionen, "
          f"{len(entries('overrides'))} Korrekturen, "
          f"{len(own)} eigene Eintraege")
    return foods


def check(foods: list[dict]) -> None:
    """Was hier durchrutscht, faellt spaeter beim Loggen auf die Fuesse."""
    seen = {}
    for f in foods:
        if f["id"] in seen:
            sys.exit(f"doppelte id: {f['id']}")
        seen[f["id"]] = f

    names = {}
    for f in foods:
        names.setdefault(norm(f["name"]), []).append(f["id"])
    dups = {n: ids for n, ids in names.items() if len(ids) > 1}
    if dups:
        print(f"  Hinweis: {len(dups)} Namen kommen mehrfach vor "
              f"(z. B. {list(dups)[0]}), Kurzname oder id benutzen.")

    alias = {}
    for f in foods:
        for a in f.get("alias", []):
            if norm(a) in alias:
                sys.exit(f"Kurzname {a!r} zeigt auf {alias[norm(a)]} und {f['id']}")
            alias[norm(a)] = f["id"]
        if norm(f["name"]) in alias and alias[norm(f["name"])] != f["id"]:
            sys.exit(f"Kurzname {f['name']!r} verdeckt ein Lebensmittel")

    # Atwater als Plausibilitaetsprobe: 4/4/9 kcal je g plus 2 fuer
    # Ballaststoffe. Wer stark abweicht, hat vermischte Bezugsgroessen
    # (genau der Fehler in der alten, abgetippten Tabelle: kcal je Portion,
    # Makros je 100 g).
    bad = []
    for f in foods:
        est = f["p"] * 4 + f["k"] * 4 + f["f"] * 9 + f["b"] * 2
        if f["kcal"] < 20 and est < 20:
            continue
        if est and abs(est - f["kcal"]) / max(est, f["kcal"]) > 0.35:
            bad.append((f["id"], f["name"], f["kcal"], round(est)))
    if bad:
        print(f"  Hinweis: {len(bad)} Eintraege weichen >35 % von Atwater ab "
              f"(Alkohol, Zuckeraustauschstoffe, organische Saeuren). "
              f"Beispiel: {bad[0][1][:40]} {bad[0][2]} vs {bad[0][3]} kcal")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("source", nargs="?", help="BLS-ZIP oder -XLSX")
    ap.add_argument("--download", action="store_true", help="ZIP von blsdb.de holen")
    a = ap.parse_args()

    if a.download:
        src = download(Path(tempfile.mkdtemp()) / "BLS_4_0_2025_DE.zip")
    else:
        src = find_source(a.source)
        print(f"Quelle: {src}")

    foods = read_bls(src)
    print(f"  BLS: {len(foods)} Lebensmittel")
    foods = apply_extra(foods)
    check(foods)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "version": 2,
        "source": "BLS 4.0",
        "cite": CITE,
        "license": "CC BY 4.0",
        "note": ("Erzeugt von scripts/build_foods.py. NICHT von Hand editieren, "
                 "der naechste Lauf ueberschreibt alles. Korrekturen, Kurznamen "
                 "und eigene Eintraege gehoeren in foods_extra.json."),
        "fields": "Werte je 100 g. kcal, p/k/f/b in g, ml je 100 g bei Getraenken.",
        "foods": sorted(foods, key=lambda f: f["id"]),
    }, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    print(f"\n{OUT.relative_to(ROOT)}: {len(foods)} Eintraege, "
          f"{OUT.stat().st_size / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
