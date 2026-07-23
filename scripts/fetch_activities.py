#!/usr/bin/env python3
"""fetch_activities.py — neue Fahrten von Wahoo holen.

LOGIK (bewusst einfach)
-----------------------
  1. Bestand laden          data/activities.json ist die Wahrheit.
  2. Wahoo fragen           Welche Fahrten gibt es seit dem Stichtag?
  3. Fuer jede: bekannt?    ID schon im Bestand  -> ueberspringen.
                            Neu                   -> FIT laden, verarbeiten,
                                                     hinzufuegen.
  4. Speichern              Nur wenn wirklich etwas Neues dazukam.

Die Vergangenheit wird nie neu berechnet. Kennzahlen (NP, Power-Kurve, TSS, EF)
setzt ausschliesslich analyze_activities.py, das direkt danach im selben
Workflow-Schritt laeuft. fetch schreibt nur Rohdaten und Metadaten.

Strava ist seit 30.06.2026 gesperrt und wurde entfernt. Wahoo ist die Quelle.
"""
import os, json, urllib.request
from datetime import datetime, timezone, timedelta

from fit_streams import streams_from_fit_url

DATA_FILE        = 'data/activities.json'
STREAMS_DIR      = 'data/streams'
ANALYSIS_VERSION = 16
PLAN_START_DATE  = '2026-05-04'
WAHOO_START_DATE = '2026-07-01'      # ab hier ist Wahoo die Quelle
RENAME_RECHECK_DAYS = 2              # bekannte Fahrten so lange auf Umbenennung pruefen
FTP, HRMAX       = 250, 172

WAHOO_BASE = 'https://api.wahooligan.com'

# Fahrten, deren Wahoo-Auto-Titel einen frueheren, spezifischen Namen
# ueberschrieben hat. id -> korrekter Name.
NAME_FIXES = {'19093792211': 'ClassicCrew ™ 😎🙌'}

# True, sobald der Wahoo-Abruf uebersprungen/abgebrochen wurde. Landet als
# 'wahoo_skipped' in activities.json, damit die Status-Ampel einen stillen
# Ausfall zeigt statt gruen zu bleiben.
WAHOO_SKIPPED = False


# ── FIT-Datei -> Streams ─────────────────────────────────────────────────────
def parse_fit_streams(fit_url):
    """Laedt eine FIT-Datei von einer URL und macht daraus Sekunden-Streams.

    Die eigentliche Umwandlung liegt in fit_streams.py, damit Wahoo (URL) und
    Garmin (Bytes/ZIP) exakt dieselbe Aufbereitung nutzen.
    """
    return streams_from_fit_url(fit_url)


# ── Wahoo ────────────────────────────────────────────────────────────────────
def wahoo_api(path, token):
    req = urllib.request.Request(f'{WAHOO_BASE}{path}',
                                 headers={'Authorization': f'Bearer {token}'})
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read())
    except Exception as e:
        print(f'    Wahoo API {path}: {e}')
        return None


def _parse_local(ts_raw, fallback_date):
    """Wahoo-UTC-Zeitstempel -> (lokales Datum, 'HH:MM') in Europe/Berlin.
    Grobe DST-Naeherung (Sommerzeit Apr-Okt): fuer die Anzeige ausreichend."""
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


def is_cycling(w):
    tid = w.get('workout_type_id', -1)
    n = (w.get('name') or '').lower()
    return (tid in {0, 1, 2}
            or any(k in n for k in ('radfahren', 'cycling', 'commute', 'ride',
                                     'morning', 'afternoon', 'interval', 'rolle', 'tour')))


def _wahoo_name(w):
    """Der in der Wahoo-App sichtbare Name. Wolf benennt oft erst am Handy um.
    Diese Umbenennung landet in workout_summary.name, waehrend der Top-Level-
    'name' der beim Upload eingefrorene Geraetename bleibt (z. B. 'Radfahren').
    Deshalb den Summary-Namen bevorzugen, sonst Top-Level, sonst Platzhalter."""
    s = w.get('workout_summary') or {}
    return s.get('name') or w.get('name') or 'Wahoo Ride'


def fetch_new_wahoo(token, known_ids, by_id=None, recheck_from=None):
    """Wahoo-Fahrten seit Stichtag holen.

    Neue Fahrten kommen dazu. Zusaetzlich wird bei bereits bekannten, kuerzlich
    geholten Fahrten (Datum >= recheck_from) der Name aktualisiert, falls Wolf
    ihn in der Wahoo-App nachtraeglich geaendert hat (Fetch laeuft oft, bevor er
    am Handy umbenennt). NAME_FIXES bleibt unberuehrt, die haben Vorrang.
    """
    new = []
    renamed = 0
    page = 1
    while True:
        data = wahoo_api(f'/v1/workouts?page={page}&per_page=100', token)
        if not data:
            break
        items = data.get('workouts', []) if isinstance(data, dict) else data
        if not items:
            break
        for w in items:
            starts = (w.get('starts') or '')[:10]
            if starts < WAHOO_START_DATE or not is_cycling(w):
                continue
            aid = f"wahoo_{w['id']}"
            if aid in known_ids:
                # Namens-Nachpruefung fuer kuerzlich geholte Fahrten
                if (by_id is not None and recheck_from and starts >= recheck_from
                        and str(w['id']) not in NAME_FIXES and aid not in NAME_FIXES):
                    act = by_id.get(aid)
                    nm = _wahoo_name(w)
                    if act and nm and act.get('name') != nm:
                        print(f"  {aid}: Name '{act.get('name')}' -> '{nm}'")
                        act['name'] = nm
                        renamed += 1
                continue                      # bekannt -> nur Name evtl. aktualisiert
            s = w.get('workout_summary') or {}
            date, hm = _parse_local(w.get('starts') or s.get('started_at', ''), starts)
            new.append({
                'id':          aid,
                'name':        _wahoo_name(w),
                'date':        date,
                'start_time':  hm,
                'type':        'Ride',
                'duration_sec': int(float(s.get('duration_active_accum') or w.get('minutes', 0) * 60 or 0)),
                'elapsed_sec':  int(float(s.get('duration_total_accum')  or w.get('minutes', 0) * 60 or 0)),
                'distance_m':   round(float(s.get('distance_accum') or 0)),
                'elevation_m':  round(float(s.get('ascent_accum')   or 0)),
                'kilojoules':   round(float(s.get('work_accum') or 0) / 1000, 1) if s.get('work_accum') else None,
                '_fit_url':     (s.get('file') or {}).get('url'),
            })
        # Wahoo liefert neueste zuerst: ganze Seite vor Stichtag -> fertig
        if max((w.get('starts') or '')[:10] for w in items) < WAHOO_START_DATE:
            break
        if len(items) < 100:
            break
        page += 1
    return new, renamed


def process_new(act):
    """FIT einer neuen Fahrt laden, Stream speichern, Detailwerte ableiten."""
    spath = os.path.join(STREAMS_DIR, act['id'] + '.json')
    if os.path.exists(spath):
        # Sollte bei einer neuen Fahrt nicht vorkommen, aber sicher ist sicher:
        # vorhandene Streams werden NIE ueberschrieben.
        with open(spath) as f:
            streams = json.load(f).get('streams', {})
    else:
        if not act.get('_fit_url'):
            print(f"  {act['id']}: keine FIT-URL, nur Summary")
            act.pop('_fit_url', None)
            return act
        print(f"  {act['id']}: {act['name']} (NEU, lade FIT...)")
        streams = parse_fit_streams(act['_fit_url'])
        if not streams or not streams.get('time'):
            print('    keine Streams, nur Summary')
            act.pop('_fit_url', None)
            return act
        os.makedirs(STREAMS_DIR, exist_ok=True)
        with open(spath, 'w') as f:
            json.dump({'streams': streams}, f)

    pw, hr, ll = streams.get('watts', []), streams.get('heartrate', []), streams.get('latlng', [])
    if pw:
        act['max_power'] = max(pw) or None
        act['has_power'] = any(w > 0 for w in pw)
    if hr:
        act['max_hr'] = max(hr) or None
        act['has_hr'] = any(h > 0 for h in hr)
    if ll:
        act['has_latlng'] = True
    act.pop('_fit_url', None)
    return act


# ── Hauptlauf ────────────────────────────────────────────────────────────────
def main():
    global WAHOO_SKIPPED

    # 1. Bestand laden
    activities, existing_version = [], 0
    if os.path.exists(DATA_FILE):
        with open(DATA_FILE) as f:
            data = json.load(f)
        activities = data.get('activities', [])
        existing_version = data.get('analysis_version', 0)
    known_ids = {str(a['id']) for a in activities}
    by_id = {str(a['id']): a for a in activities}
    recheck_from = (datetime.now(timezone.utc)
                    - timedelta(days=RENAME_RECHECK_DAYS)).strftime('%Y-%m-%d')
    print(f'Bestand: {len(activities)} Fahrten (v{existing_version})')

    # 2.+3. Neue Wahoo-Fahrten holen + Namen kuerzlicher Fahrten aktualisieren
    token = os.environ.get('WAHOO_ACCESS_TOKEN', '')
    added = 0
    if not token:
        print('  Kein WAHOO_ACCESS_TOKEN — Wahoo uebersprungen')
        WAHOO_SKIPPED = True
    else:
        try:
            new, renamed = fetch_new_wahoo(token, known_ids, by_id, recheck_from)
            print(f'  Wahoo: {len(new)} neue Fahrt(en), {renamed} umbenannt')
            for act in new:
                activities.append(process_new(act))
                added += 1
        except Exception as e:
            print(f'  Wahoo abgebrochen: {e}')
            WAHOO_SKIPPED = True

    # Namens-Korrekturen
    for a in activities:
        fix = NAME_FIXES.get(str(a.get('id')))
        if fix and a.get('name') != fix:
            a['name'] = fix

    activities.sort(key=lambda a: (a.get('date', ''), a.get('start_time', '')), reverse=True)

    # 4. Ausgabe bauen. Version-Bump erzwingt einen Durchlauf von analyze
    #    (dieses Skript selbst berechnet keine Kennzahlen).
    visible = [a for a in activities if not a.get('hidden')]
    recent = [a for a in visible if a.get('date', '') >= PLAN_START_DATE]
    output = {
        'updated_at': datetime.now(timezone.utc).isoformat(),
        'analysis_version': existing_version if existing_version >= ANALYSIS_VERSION else ANALYSIS_VERSION,
        'athlete': {'id': 13589996, 'name': 'Wolf Harmening',
                    'ftp_estimate': FTP, 'hrmax_estimate': HRMAX, 'weight_kg': 81},
        'summary': {'total_activities': len(visible), 'recent_count': len(recent),
                    'recent_hours': round(sum(a.get('duration_sec', 0) for a in recent) / 3600, 1)},
        'wahoo_skipped': WAHOO_SKIPPED,
        'activities': activities,
    }

    # Nur schreiben, wenn sich inhaltlich etwas geaendert hat. Sonst bleibt die
    # Datei bit-identisch -> kein Commit -> kein Deploy. (updated_at und
    # wahoo_skipped aendern sich staendig und zaehlen nicht als Inhalt.)
    if os.path.exists(DATA_FILE):
        try:
            with open(DATA_FILE) as f:
                prev = json.load(f)
            skip = ('updated_at', 'wahoo_skipped')
            a = {k: v for k, v in prev.items()  if k not in skip}
            b = {k: v for k, v in output.items() if k not in skip}
            if json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True):
                output['updated_at'] = prev.get('updated_at', output['updated_at'])
                print('Keine Aenderung -> kein Deploy')
        except Exception as e:
            print(f'  (Vergleich fehlgeschlagen: {e})')

    os.makedirs('data', exist_ok=True)
    with open(DATA_FILE, 'w') as f:
        json.dump(output, f, indent=2)
    print(f'Fertig: {len(activities)} Fahrten, {added} neu')


if __name__ == '__main__':
    main()
