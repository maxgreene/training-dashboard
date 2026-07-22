#!/usr/bin/env python3
"""fit_streams.py — FIT-Datei -> Sekunden-Streams (gemeinsame Quelle).

Genau eine Implementierung fuer beide Fahrten-Quellen:
  * Wahoo  liefert eine FIT-URL       -> streams_from_fit_url()
  * Garmin liefert FIT-Bytes (ggf.    -> streams_from_fit_bytes()
           in ein ZIP verpackt)

Beide muenden in dieselbe Stream-Struktur, damit analyze_activities.py
Wahoo- und Garmin-Fahrten identisch auswertet (NP, TSS, Power-Kurve, EF ...).
"""
import io
import zipfile
import urllib.request


def _fit_bytes_from_container(raw):
    """Rohe Bytes -> FIT-Bytes. Garmins Download-Endpunkt verpackt die
    Original-Datei oft in ein ZIP; Wahoo liefert die FIT direkt. Beides
    wird hier auf reine FIT-Bytes gebracht."""
    if not raw:
        return None
    # ZIP? (Signatur 'PK\x03\x04') -> erstes .fit-Mitglied entpacken
    if raw[:2] == b'PK':
        try:
            zf = zipfile.ZipFile(io.BytesIO(raw))
            fit_names = [n for n in zf.namelist() if n.lower().endswith('.fit')]
            if not fit_names:
                print('    ZIP enthaelt keine .fit-Datei')
                return None
            return zf.read(fit_names[0])
        except Exception as e:
            print(f'    ZIP-Entpacken fehlgeschlagen: {e}')
            return None
    return raw


def streams_from_fit_bytes(raw):
    """FIT-Bytes (roh oder als ZIP) -> Sekunden-Streams.

    GPS, Hoehe, Tempo und Gefaelle werden mitgenommen, auch wenn analyze sie
    aktuell nicht nutzt - falls sie spaeter ins Dashboard sollen.
    """
    try:
        import fitparse
    except ImportError:
        print('    fitparse nicht installiert')
        return None
    fit = _fit_bytes_from_container(raw)
    if not fit:
        return None
    try:
        recs = list(fitparse.FitFile(io.BytesIO(fit)).get_messages('record'))
    except Exception as e:
        print(f'    FIT-Parsen fehlgeschlagen: {e}')
        return None
    if not recs:
        return None

    time, latlng, distance, altitude = [], [], [], []
    heartrate, cadence, watts, velocity, grade = [], [], [], [], []
    t0 = None
    for r in recs:
        v = {d.name: d.value for d in r}
        ts = v.get('timestamp')
        if ts is None:
            continue
        if t0 is None:
            t0 = ts
        time.append(int((ts - t0).total_seconds()))
        lat, lon = v.get('position_lat'), v.get('position_long')
        latlng.append([lat * (180 / 2**31), lon * (180 / 2**31)]
                      if lat is not None and lon is not None else None)
        dist = v.get('distance')
        distance.append(round(float(dist), 1) if dist is not None else (distance[-1] if distance else 0.0))
        alt = v.get('enhanced_altitude', v.get('altitude'))
        altitude.append(round(float(alt), 1) if alt is not None else (altitude[-1] if altitude else 0.0))
        hr = v.get('heart_rate')
        heartrate.append(int(hr) if hr is not None else (heartrate[-1] if heartrate else 0))
        watts.append(int(v['power']) if v.get('power') is not None else 0)
        cadence.append(int(v['cadence']) if v.get('cadence') is not None else 0)
        spd = v.get('enhanced_speed', v.get('speed'))
        velocity.append(round(float(spd), 3) if spd is not None else 0.0)
        grade.append(round(float(v['grade']), 1) if v.get('grade') is not None else 0.0)

    # latlng-Luecken mit letzter gueltiger Position fuellen
    last = None
    for i in range(len(latlng)):
        if latlng[i] is None:
            latlng[i] = last
        else:
            last = latlng[i]
    latlng = [ll for ll in latlng if ll is not None] if any(latlng) else []

    streams = {
        'time': time, 'distance': distance, 'altitude': altitude,
        'heartrate': heartrate, 'cadence': cadence, 'watts': watts,
        'velocity_smooth': velocity, 'grade_smooth': grade,
        'moving': [bool(s and s > 0.5) for s in velocity],
    }
    if latlng and len(latlng) == len(time):
        streams['latlng'] = latlng
    print(f'    FIT: {len(time)} Punkte, Power={any(w>0 for w in watts)}, HR={any(h>0 for h in heartrate)}')
    return streams


def streams_from_fit_url(fit_url, timeout=60):
    """FIT von einer URL laden und in Streams umwandeln (Wahoo-Weg)."""
    try:
        raw = urllib.request.urlopen(fit_url, timeout=timeout).read()
    except Exception as e:
        print(f'    FIT-Download fehlgeschlagen: {e}')
        return None
    return streams_from_fit_bytes(raw)
