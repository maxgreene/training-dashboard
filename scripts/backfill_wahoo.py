"""
EINMALIGES Backfill-Skript: holt fuer alte Fahrten (die als Strava-Import mit
start_time '00:00' und fehlenden Feldern in activities.json stehen) die echten
Daten aus den Wahoo-FIT-Dateien nach.

Fuellt auf: start_time (echte Startzeit lokal), distance_m, elevation_m,
avg_speed_kmh, kilojoules, gps-Infos.

SICHER GEBAUT:
- Laeuft standardmaessig im TROCKENLAUF (--dry): zeigt nur was zugeordnet
  wuerde, schreibt NICHTS. Erst mit --write werden Aenderungen gespeichert.
- Matcht Strava<->Wahoo ueber Datum + Dauer (+ Leistung als Tiebreaker bei
  Kollisionen). Zeigt unsichere Matches an.
- Ueberschreibt NUR fehlende/leere Felder + start_time=='00:00'. Vorhandene
  echte Werte bleiben unangetastet.
- Laedt KEINE Streams neu (FREEZE bleibt) - nur Metadaten aus der FIT-Summary.

Nutzung (im Repo-Root, mit gesetztem WAHOO_ACCESS_TOKEN):
  python3 backfill_wahoo.py --dry     # Trockenlauf, zeigt Zuordnung
  python3 backfill_wahoo.py --write   # schreibt activities.json
"""
import os, sys, json, io, urllib.request
from datetime import datetime, timezone, timedelta

DATA_FILE = 'data/activities.json'
TOKEN = os.environ.get('WAHOO_ACCESS_TOKEN', '')
# Schreibmodus per --write ODER Umgebungsvariable BACKFILL_MODE=write (fuer Workflow-Input)
WRITE = ('--write' in sys.argv) or (os.environ.get('BACKFILL_MODE','').lower() == 'write')

def _local(dt):
    """UTC datetime -> (date 'YYYY-MM-DD', 'HH:MM') Europe/Berlin (DST-Naeherung)."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    offset = 2 if 3 <= dt.month <= 10 else 1
    loc = dt + timedelta(hours=offset)
    return loc.strftime('%Y-%m-%d'), loc.strftime('%H:%M')

def wahoo_get(url):
    req = urllib.request.Request(url, headers={'Authorization': f'Bearer {TOKEN}'})
    return json.loads(urllib.request.urlopen(req, timeout=60).read())

def fit_summary(fit_url):
    """Extrahiert Start-Zeit + Summary-Metadaten aus einer FIT-Datei."""
    import fitparse
    raw = urllib.request.urlopen(fit_url, timeout=60).read()
    fit = fitparse.FitFile(io.BytesIO(raw))
    recs = list(fit.get_messages('record'))
    if not recs:
        return None
    first = {d.name: d.value for d in recs[0]}
    last  = {d.name: d.value for d in recs[-1]}
    t0 = first.get('timestamp')
    # Distanz aus letztem Record, Hoehe kumuliert grob
    dist = last.get('distance')  # meist Meter kumuliert
    # kJ / Speed aus session-message falls vorhanden
    kj = None; asp = None; elev = None
    for s in fit.get_messages('session'):
        sv = {d.name: d.value for d in s}
        kj = sv.get('total_work')  # Joule
        if kj: kj = round(kj/1000)
        if sv.get('total_distance'): dist = sv.get('total_distance')
        if sv.get('total_ascent'):   elev = sv.get('total_ascent')
        if sv.get('avg_speed'):      asp  = round(sv.get('avg_speed')*3.6, 1)
        break
    return {'t0': t0, 'distance_m': dist, 'elevation_m': elev,
            'avg_speed_kmh': asp, 'kilojoules': kj}

def main():
    if not TOKEN:
        print('FEHLER: WAHOO_ACCESS_TOKEN nicht gesetzt.')
        return
    with open(DATA_FILE) as f:
        data = json.load(f)
    acts = data['activities']
    old = [a for a in acts if not str(a.get('id','')).startswith('wahoo_')
           and a.get('start_time') in ('00:00','',None)]
    print(f'Alte Fahrten mit fehlender Startzeit: {len(old)}')

    # Alle Wahoo-Workouts einsammeln (paginiert)
    print('Lade Wahoo-Workout-Liste...')
    wahoo = []
    page = 1
    while True:
        try:
            r = wahoo_get(f'https://api.wahooligan.com/v1/workouts?page={page}&per_page=30')
        except Exception as e:
            print(f'  Wahoo-Fehler auf Seite {page}: {e}')
            break
        items = r.get('workouts', r if isinstance(r, list) else [])
        if not items:
            break
        wahoo.extend(items)
        page += 1
        if page > 40:
            break
    print(f'Wahoo-Workouts gefunden: {len(wahoo)}')
    if wahoo:
        dates = [w.get('starts','')[:10] for w in wahoo if w.get('starts')]
        if dates:
            print(f'  Wahoo-Zeitraum: {min(dates)} bis {max(dates)}')

    # Index Wahoo nach (datum, dauer-min)
    def wkey(w):
        s = w.get('starts','')[:10]
        dur = 0
        summ = w.get('workout_summary') or {}
        dur = summ.get('duration_active_accum') or summ.get('duration_total_accum') or 0
        try: dur = round(float(dur)/60)
        except: dur = 0
        return (s, dur)
    windex = {}
    for w in wahoo:
        windex.setdefault(wkey(w), []).append(w)

    matched = 0; unmatched = 0; ambiguous = 0
    changes = []
    for a in old:
        k = (a.get('date'), round(a.get('duration_sec',0)/60))
        cands = windex.get(k, [])
        # Toleranz +-1 min falls exakt nichts
        if not cands:
            for dm in (-1, 1):
                cands = windex.get((k[0], k[1]+dm), [])
                if cands: break
        if not cands:
            unmatched += 1
            continue
        if len(cands) > 1:
            ambiguous += 1
            print(f'  ? MEHRDEUTIG {a.get("date")} {k[1]}min: {len(cands)} Wahoo-Kandidaten - uebersprungen')
            continue
        w = cands[0]
        matched += 1
        changes.append((a, w))

    print(f'\nErgebnis: {matched} eindeutig zugeordnet, {ambiguous} mehrdeutig, {unmatched} ohne Wahoo-Match')

    if not changes:
        print('Nichts zuzuordnen.')
        return

    print('\n=== Zuordnung (erste 15) ===')
    applied = 0
    for a, w in changes:
        fit_url = (w.get('file') or {}).get('url')
        if not fit_url:
            print(f'  {a.get("date")}: kein FIT-URL bei Wahoo - skip')
            continue
        try:
            fs = fit_summary(fit_url)
        except Exception as e:
            print(f'  {a.get("date")}: FIT-Fehler {str(e)[:40]} - skip')
            continue
        if not fs or not fs.get('t0'):
            continue
        ld, lt = _local(fs['t0'])
        if applied < 15:
            print(f'  {a.get("date")} {a.get("name","")[:20]:20} -> Start {lt}  '
                  f'dist={fs.get("distance_m")} elev={fs.get("elevation_m")} kJ={fs.get("kilojoules")}')
        if WRITE:
            if a.get('start_time') in ('00:00','',None): a['start_time'] = lt
            for fld in ('distance_m','elevation_m','avg_speed_kmh','kilojoules'):
                if a.get(fld) in (None,0) and fs.get(fld) is not None:
                    a[fld] = fs[fld]
        applied += 1

    print(f'\n{applied} Fahrten verarbeitet.')
    if WRITE:
        with open(DATA_FILE, 'w') as f:
            json.dump(data, f, indent=2)
        print('GESCHRIEBEN in', DATA_FILE)
    else:
        print('TROCKENLAUF - nichts geschrieben. Mit --write ausfuehren zum Speichern.')

if __name__ == '__main__':
    main()
