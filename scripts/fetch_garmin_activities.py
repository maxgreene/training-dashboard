#!/usr/bin/env python3
"""fetch_garmin_activities.py — Indoor-/Rollen-Fahrten von Garmin holen.

WARUM
-----
Rolleneinheiten werden von der Tacx-App aufgezeichnet und nach Garmin Connect
synchronisiert. Frueher liefen sie von dort ueber Strava ins Dashboard; seit
Strava gesperrt ist (30.06.2026), fehlten sie ganz. Wahoo kennt nur die
Outdoor-Fahrten. Dieses Skript schliesst die Luecke: es holt die Indoor-Rad-
Aktivitaeten aus Garmin und speist sie in DENSELBEN Pfad wie Wahoo ein.

LOGIK (analog zu fetch_activities.py)
-------------------------------------
  1. Bestand laden      data/activities.json ist die Wahrheit.
  2. Garmin fragen       Welche Indoor-Rad-Aktivitaeten gibt es seit Stichtag?
  3. Fuer jede: bekannt? id 'garmin_<id>' schon im Bestand -> ueberspringen.
                         Neu -> FIT laden, Streams speichern, Eintrag anlegen.
  4. Speichern          Nur wenn wirklich etwas Neues dazukam.

Kennzahlen (NP, TSS, Power-Kurve, EF ...) rechnet - wie bei Wahoo - danach
analyze_activities.py aus den gespeicherten Streams. Dieses Skript schreibt
nur Rohdaten und Metadaten und MUSS deshalb VOR analyze_activities.py laufen.

Nur Indoor: Outdoor-Fahrten kommen weiterhin ausschliesslich von Wahoo, sonst
tauchten sie doppelt auf. Der Typ-Filter unten ist die einzige Stellschraube.
"""
import os
import json
from datetime import datetime, timezone

from fit_streams import streams_from_fit_bytes
from fetch_garmin import setup_tokens          # gemeinsame Token-Entpackung

DATA_FILE       = 'data/activities.json'
STREAMS_DIR     = 'data/streams'
GARMIN_START    = '2026-07-01'    # ab hier ist Garmin die Quelle fuer Indoor
LIST_PAGE       = 20              # Aktivitaeten je Listen-Abruf

# Garmin-typeKeys, die als Indoor-/Rollen-Rad zaehlen. Tacx synct i.d.R. als
# 'virtual_ride' oder 'indoor_cycling'. Zur Sicherheit greift zusaetzlich jeder
# Rad-Typ, dessen Key 'indoor' oder 'virtual' enthaelt (siehe is_indoor_ride).
GARMIN_INDOOR_TYPES = {'indoor_cycling', 'virtual_ride', 'trainer'}


def is_indoor_ride(act):
    """True, wenn die Garmin-Aktivitaet eine Indoor-/Rollen-Radfahrt ist."""
    t = act.get('activityType') or {}
    key = (t.get('typeKey') or '').lower()
    if key in GARMIN_INDOOR_TYPES:
        return True
    # Fallback: unbekannter Rad-Key, der klar auf Indoor/Virtual deutet.
    return ('cycl' in key or 'bike' in key or 'ride' in key) and \
           ('indoor' in key or 'virtual' in key or 'trainer' in key)


def list_new_indoor(known_ids):
    """Indoor-Rad-Aktivitaeten seit Stichtag, die noch nicht im Bestand sind."""
    import garth
    new = []
    start = 0
    while True:
        path = (f'/activitylist-service/activities/search/activities'
                f'?start={start}&limit={LIST_PAGE}')
        items = garth.client.connectapi(path)
        if not items:
            break
        reached_cutoff = False
        for a in items:
            local = (a.get('startTimeLocal') or a.get('startTimeGMT') or '')
            day = local[:10]
            if day and day < GARMIN_START:
                reached_cutoff = True     # Liste ist chronologisch -> fertig
                continue
            tkey = ((a.get('activityType') or {}).get('typeKey') or '?')
            if not is_indoor_ride(a):
                continue
            aid = f"garmin_{a.get('activityId')}"
            print(f"    Kandidat {aid} [{tkey}] {day} {a.get('activityName') or ''}")
            if aid in known_ids:
                continue
            new.append(a)
        if reached_cutoff or len(items) < LIST_PAGE:
            break
        start += LIST_PAGE
    return new


def build_entry(a):
    """Garmin-Listeneintrag -> Aktivitaets-Metadaten (ohne Kennzahlen)."""
    aid = f"garmin_{a.get('activityId')}"
    local = (a.get('startTimeLocal') or a.get('startTimeGMT') or '')
    date = local[:10] or ''
    hm = local[11:16] or '00:00'
    dur = a.get('duration') or 0
    return {
        'id':           aid,
        'name':         a.get('activityName') or 'Rolle',
        'date':         date,
        'start_time':   hm,
        'type':         'Ride',
        'source':       'garmin',
        'indoor':       True,
        'duration_sec': int(float(a.get('movingDuration') or dur or 0)),
        'elapsed_sec':  int(float(a.get('elapsedDuration') or dur or 0)),
        'distance_m':   round(float(a.get('distance') or 0)),
        'elevation_m':  round(float(a.get('elevationGain') or 0)),
        '_activity_id': a.get('activityId'),
    }


def download_fit(activity_id):
    """Original-FIT einer Garmin-Aktivitaet als Bytes (ggf. im ZIP)."""
    import garth
    try:
        return garth.client.download(
            f'/download-service/files/activity/{activity_id}')
    except Exception as e:
        print(f'    FIT-Download (Garmin) fehlgeschlagen: {e}')
        return None


def process_new(entry):
    """FIT laden, Streams speichern, Detailwerte ableiten. None -> nicht
    hinzufuegen (kein Stream = keine belastbaren Indoor-Kennzahlen)."""
    aid = entry['id']
    spath = os.path.join(STREAMS_DIR, aid + '.json')
    if os.path.exists(spath):
        with open(spath) as f:
            streams = json.load(f).get('streams', {})
    else:
        print(f"  {aid}: {entry['name']} (NEU, lade FIT...)")
        raw = download_fit(entry['_activity_id'])
        streams = streams_from_fit_bytes(raw) if raw else None
        if not streams or not streams.get('time'):
            print('    keine Streams -> uebersprungen (naechster Lauf erneut)')
            return None
        os.makedirs(STREAMS_DIR, exist_ok=True)
        with open(spath, 'w') as f:
            json.dump({'streams': streams}, f)

    pw, hr, ll = streams.get('watts', []), streams.get('heartrate', []), streams.get('latlng', [])
    if pw:
        entry['max_power'] = max(pw) or None
        entry['has_power'] = any(w > 0 for w in pw)
        # Arbeit in kJ = Summe der Sekunden-Watt / 1000 (analog Wahoo work_accum)
        entry['kilojoules'] = round(sum(w for w in pw if w > 0) / 1000, 1) or None
    if hr:
        entry['max_hr'] = max(hr) or None
        entry['has_hr'] = any(h > 0 for h in hr)
    if ll:
        entry['has_latlng'] = True
    entry.pop('_activity_id', None)
    return entry


def main():
    # 1. Bestand laden
    if not os.path.exists(DATA_FILE):
        print('Kein activities.json - Garmin-Rollen uebersprungen')
        return
    with open(DATA_FILE) as f:
        data = json.load(f)
    activities = data.get('activities', [])
    known_ids = {str(a['id']) for a in activities}
    print(f'Bestand: {len(activities)} Fahrten')

    # Garmin-Tokens (dasselbe Secret wie fetch_garmin.py)
    if not setup_tokens():
        return
    try:
        import garth
        garth.resume(os.path.expanduser('~/.garth'))
        print('Garmin-Tokens geladen')
    except Exception as e:
        print(f'Garmin-Resume fehlgeschlagen: {e}')
        return

    # 2.+3. Neue Indoor-Fahrten holen
    try:
        candidates = list_new_indoor(known_ids)
    except Exception as e:
        print(f'Garmin-Aktivitaetsliste fehlgeschlagen: {e}')
        return
    print(f'  Garmin: {len(candidates)} neue Indoor-Fahrt(en)')

    added = 0
    for a in candidates:
        entry = process_new(build_entry(a))
        if entry:
            activities.append(entry)
            added += 1

    if not added:
        print('Nichts Neues von Garmin -> activities.json unveraendert')
        return

    activities.sort(key=lambda a: (a.get('date', ''), a.get('start_time', '')), reverse=True)
    data['activities'] = activities
    with open(DATA_FILE, 'w') as f:
        json.dump(data, f, indent=2)
    print(f'Garmin: {added} Indoor-Fahrt(en) hinzugefuegt, {len(activities)} gesamt')
    # Kennzahlen rechnet analyze_activities.py im naechsten Workflow-Schritt.


if __name__ == '__main__':
    main()
