"""
EINMALIGES Backfill: fuellt Startzeit + fehlende Metadaten alter Strava-Fahrten
aus den Wahoo-Workout-Summaries nach.

WICHTIG: Nutzt die workout_summary aus der Wahoo-Listen-Antwort (genau wie der
Haupt-Fetch) - KEINE FIT-Downloads noetig. Alle Werte (Startzeit, Distanz,
Hoehenmeter, kJ) stehen bereits in der Summary.

SICHER:
- Trockenlauf ist Default (--dry / BACKFILL_MODE=dry). --write / BACKFILL_MODE=write
  schreibt erst nach Kontrolle.
- Matcht Strava<->Wahoo ueber Datum + Dauer(min). Mehrdeutige (mehrere Fahrten
  mit gleichem Datum+Dauer) werden UEBERSPRUNGEN, nicht geraten.
- Ueberschreibt nur leere Felder + start_time=='00:00'. Echte Werte bleiben.

Nutzung: BACKFILL_MODE=dry|write python3 scripts/backfill_wahoo.py
"""
import os, sys, json, urllib.request
from datetime import datetime, timezone, timedelta

DATA_FILE = 'data/activities.json'
TOKEN = os.environ.get('WAHOO_ACCESS_TOKEN', '')
WRITE = ('--write' in sys.argv) or (os.environ.get('BACKFILL_MODE','').lower() == 'write')

def _parse_local(ts_raw, fallback_date):
    """Wahoo-Timestamp (UTC ISO) -> (lokales Datum, 'HH:MM') Europe/Berlin.
    Identisch zur Logik im Haupt-Fetch."""
    if not ts_raw:
        return fallback_date, '00:00'
    s = ts_raw.strip().replace('Z', '+00:00')
    if 'T' not in s and ':' not in s:
        return (ts_raw[:10] or fallback_date), '00:00'
    try:
        dt = datetime.fromisoformat(s)
    except Exception:
        return (ts_raw[:10] or fallback_date), '00:00'
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    offset = 2 if 3 <= dt.month <= 10 else 1
    local = dt + timedelta(hours=offset)
    return local.strftime('%Y-%m-%d'), local.strftime('%H:%M')

def wahoo_get(url):
    req = urllib.request.Request(url, headers={'Authorization': f'Bearer {TOKEN}'})
    return json.loads(urllib.request.urlopen(req, timeout=60).read())

def summary_metadata(w):
    """Zieht Startzeit + Metadaten aus einem Wahoo-Workout (wie der Haupt-Fetch)."""
    s = w.get('workout_summary') or {}
    starts_raw = w.get('starts','') or (s.get('started_at','') if isinstance(s, dict) else '')
    ld, lt = _parse_local(starts_raw, w.get('starts','')[:10])
    def num(v):
        try: return float(v)
        except: return None
    dist = num(s.get('distance_accum'))
    elev = num(s.get('ascent_accum'))
    work = num(s.get('work_accum'))
    return {
        'start_time':    lt,
        'distance_m':    round(dist) if dist else None,
        'elevation_m':   round(elev) if elev else None,
        'kilojoules':    round(work/1000, 1) if work else None,
    }

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

    # Wahoo-Workouts einsammeln (paginiert)
    print('Lade Wahoo-Workout-Liste...')
    wahoo, page = [], 1
    while True:
        try:
            r = wahoo_get(f'https://api.wahooligan.com/v1/workouts?page={page}&per_page=30')
        except Exception as e:
            print(f'  Wahoo-Fehler Seite {page}: {e}'); break
        items = r.get('workouts', r if isinstance(r, list) else [])
        if not items: break
        wahoo.extend(items); page += 1
        if page > 60: break
    print(f'Wahoo-Workouts gefunden: {len(wahoo)}')
    if wahoo:
        dates = [w.get('starts','')[:10] for w in wahoo if w.get('starts')]
        if dates: print(f'  Wahoo-Zeitraum: {min(dates)} bis {max(dates)}')

    # Index nach (datum, dauer-min) aus der Summary
    def wkey(w):
        s = w.get('workout_summary') or {}
        dur = s.get('duration_active_accum') or s.get('duration_total_accum') or (w.get('minutes',0)*60)
        try: dur = round(float(dur)/60)
        except: dur = 0
        return (w.get('starts','')[:10], dur)
    windex = {}
    for w in wahoo:
        windex.setdefault(wkey(w), []).append(w)

    matched = ambiguous = unmatched = 0
    changes = []
    for a in old:
        k = (a.get('date'), round(a.get('duration_sec',0)/60))
        cands = windex.get(k, [])
        if not cands:
            for dm in (-1, 1):
                cands = windex.get((k[0], k[1]+dm), [])
                if cands: break
        if not cands:
            unmatched += 1; continue
        if len(cands) > 1:
            ambiguous += 1
            print(f'  ? MEHRDEUTIG {a.get("date")} {k[1]}min: {len(cands)} Kandidaten - uebersprungen')
            continue
        matched += 1
        changes.append((a, cands[0]))

    print(f'\nErgebnis: {matched} eindeutig zugeordnet, {ambiguous} mehrdeutig, {unmatched} ohne Match')
    if not changes:
        print('Nichts zuzuordnen.'); return

    print('\n=== Zuordnung ===')
    applied = 0
    for a, w in changes:
        md = summary_metadata(w)
        applied += 1
        if applied <= 20:
            print(f'  {a.get("date")} {a.get("name","")[:22]:22} -> Start {md["start_time"]}  '
                  f'dist={md["distance_m"]} elev={md["elevation_m"]} kJ={md["kilojoules"]}')
        if WRITE:
            if a.get('start_time') in ('00:00','',None) and md['start_time'] not in ('00:00','',None):
                a['start_time'] = md['start_time']
            for fld in ('distance_m','elevation_m','kilojoules'):
                if a.get(fld) in (None,0) and md.get(fld) is not None:
                    a[fld] = md[fld]

    print(f'\n{applied} Fahrten verarbeitet.')
    if WRITE:
        with open(DATA_FILE, 'w') as f:
            json.dump(data, f, indent=2)
        print('GESCHRIEBEN in', DATA_FILE)
    else:
        print('TROCKENLAUF - nichts geschrieben. Mit write-Modus ausfuehren zum Speichern.')

if __name__ == '__main__':
    main()
