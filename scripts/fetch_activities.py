#!/usr/bin/env python3
# fetch_activities.py
import os, json, urllib.request
from datetime import datetime, timezone

TOKEN = os.environ['STRAVA_ACCESS_TOKEN']
HEADERS = {'Authorization': 'Bearer ' + TOKEN}
DATA_FILE   = 'data/activities.json'
STREAMS_DIR = 'data/streams'
ANALYSIS_VERSION = 9
PLAN_START_DATE  = '2026-05-04'
PLAN_START_EPOCH = int(datetime(2026, 5, 4, 0, 0, 0, tzinfo=timezone.utc).timestamp())
STREAM_KEYS = ['time','latlng','distance','altitude','heartrate','cadence','watts','velocity_smooth','grade_smooth','moving']
FTP   = 237
HRMAX = 175

def api(path):
    req = urllib.request.Request('https://www.strava.com/api/v3' + path, headers=HEADERS)
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())

def fetch_streams(aid):
    keys = ','.join(STREAM_KEYS)
    url = '/activities/' + str(aid) + '/streams?keys=' + keys + '&key_by_type=true&resolution=high&series_type=time'
    try:
        data = api(url)
        return {k: data[k]['data'] for k in STREAM_KEYS if k in data}
    except Exception as e:
        print('  Stream error: ' + str(e))
        return {}

def normalized_power(watts):
    if len(watts) < 30: return None
    rolling = []
    for i in range(len(watts) - 30):
        avg = sum(watts[i:i+30]) / 30
        rolling.append(avg ** 4)
    return round((sum(rolling) / len(rolling)) ** 0.25)

def power_curve(watts):
    result = {}
    for d in [5, 10, 30, 60, 120, 300, 600, 1200]:
        if len(watts) >= d:
            best = max(sum(watts[i:i+d]) / d for i in range(len(watts) - d))
            result[str(d)] = round(best)
    return result

def hr_zones(hr_list):
    bounds = [0, 0.68, 0.83, 0.88, 0.95, 1.0]
    zones = [0] * 5
    for h in hr_list:
        for z in range(4, -1, -1):
            if h >= bounds[z] * HRMAX:
                zones[z] += 1
                break
    total = len(hr_list) or 1
    return [round(z / total * 100, 1) for z in zones]

def power_zones(pw_list):
    bounds = [0, 0.55, 0.75, 0.87, 1.05, 999]
    zones = [0] * 5
    for p in pw_list:
        for z in range(4, -1, -1):
            if p >= bounds[z] * FTP:
                zones[z] += 1
                break
    total = len(pw_list) or 1
    return [round(z / total * 100, 1) for z in zones]

def decoupling(pw, hr):
    pairs = [(w, h) for w, h in zip(pw, hr) if w > 20 and h > 60]
    if len(pairs) < 60: return None
    half = len(pairs) // 2
    p1, h1 = zip(*pairs[:half])
    p2, h2 = zip(*pairs[half:])
    r1 = (sum(h1)/len(h1)) / (sum(p1)/len(p1))
    r2 = (sum(h2)/len(h2)) / (sum(p2)/len(p2))
    return round((r2 - r1) / r1 * 100, 1)

def mini_chart(streams, n=80):
    ts  = streams.get('time', [])
    pw  = streams.get('watts', [])
    hr  = streams.get('heartrate', [])
    alt = streams.get('altitude', [])
    spd = [round(v * 3.6, 1) for v in streams.get('velocity_smooth', [])]
    if not ts: return {}
    step = max(1, len(ts) // n)
    return {'time': ts[::step], 'watts': pw[::step] if pw else [], 'hr': hr[::step] if hr else [], 'altitude': alt[::step] if alt else [], 'speed': spd[::step] if spd else []}

def stream_path(aid):
    return os.path.join(STREAMS_DIR, str(aid) + '.json')

def process_activity(act, force_fetch=False):
    aid = act['id']
    print('  Processing ' + str(aid) + ': ' + act['name'])
    spath = stream_path(aid)
    streams = {}
    if os.path.exists(spath) and not force_fetch:
        with open(spath) as f:
            streams = json.load(f).get('streams', {})
        print('    Cached: ' + str(len(streams.get('time', []))) + ' pts')
    else:
        print('    Fetching streams...')
        streams = fetch_streams(aid)
        if streams:
            os.makedirs(STREAMS_DIR, exist_ok=True)
            payload = {'activity_id': aid, 'date': act.get('start_date_local', '')[:10], 'name': act.get('name', ''), 'fetched_at': datetime.now(timezone.utc).isoformat(), 'resolution': 'high', 'keys_present': list(streams.keys()), 'streams': streams}
            with open(spath, 'w') as f:
                json.dump(payload, f)
            print('    Saved ' + str(len(streams.get('time', []))) + ' pts')
    pw     = streams.get('watts', [])
    hr     = streams.get('heartrate', [])
    latlng = streams.get('latlng', [])
    dist_s = streams.get('distance', [])
    moving_time  = act.get('moving_time', 0)
    gps_distance = act.get('distance', 0)
    has_gps = len(latlng) > 0
    gps_ok  = has_gps
    gps_coverage_pct = None
    if pw and dist_s:
        gps_coverage_pct = round(len(dist_s) / len(pw) * 100)
        if gps_coverage_pct < 85: gps_ok = False
    result = {
        'id': aid, 'name': act['name'],
        'date': act['start_date_local'][:10],
        'start_time': act['start_date_local'][11:16],
        'type': act.get('sport_type', act.get('type', 'Ride')),
        'duration_sec': moving_time,
        'elapsed_sec': act.get('elapsed_time', 0),
        'distance_m': round(gps_distance) if gps_ok else None,
        'elevation_m': round(act.get('total_elevation_gain', 0)) if gps_ok else None,
        'avg_speed_kmh': round(gps_distance / max(moving_time, 1) * 3.6, 1) if gps_ok else None,
        'avg_power': act.get('average_watts'),
        'max_power': act.get('max_watts'),
        'avg_hr': act.get('average_heartrate'),
        'max_hr': act.get('max_heartrate'),
        'avg_cadence': act.get('average_cadence'),
        'kilojoules': act.get('kilojoules'),
        'gps_ok': gps_ok, 'gps_coverage_pct': gps_coverage_pct,
        'has_power': act.get('device_watts', False),
        'has_hr': act.get('average_heartrate') is not None,
        'has_latlng': has_gps,
        'np': None, 'power_curve': {}, 'hr_zones': [], 'power_zones': [],
        'decoupling_pct': None,
        'power_duration_sec': len(pw) if pw else None,
        'streams': mini_chart(streams),
    }
    if pw:
        result['np'] = normalized_power(pw)
        result['power_curve'] = power_curve(pw)
        result['power_zones'] = power_zones(pw)
        result['duration_sec'] = len(pw)
    if hr:
        result['hr_zones'] = hr_zones(hr)
    if pw and hr:
        result['decoupling_pct'] = decoupling(pw, hr)
    return result

def main():
    existing = {}
    existing_version = 0
    if os.path.exists(DATA_FILE):
        with open(DATA_FILE) as f:
            data = json.load(f)
            existing = {a['id']: a for a in data.get('activities', [])}
            existing_version = data.get('analysis_version', 0)
    print('Existing: ' + str(len(existing)))
    force_reprocess = existing_version < ANALYSIS_VERSION
    if force_reprocess: print('Version bump: reprocessing all')
    strava_acts = api('/athlete/activities?per_page=60&after=' + str(PLAN_START_EPOCH))
    cycling = [a for a in strava_acts if a.get('sport_type') in ('Ride','GravelRide','MountainBikeRide','VirtualRide') or a.get('type') == 'Ride']
    print('Found ' + str(len(cycling)) + ' cycling activities')
    activities = []
    for act in cycling:
        aid = act['id']
        if aid in existing and os.path.exists(stream_path(aid)) and not force_reprocess:
            cached = existing[aid]
            # Always update mutable fields from fresh Strava data
            cached['name'] = act['name']
            cached['start_time'] = act.get('start_date_local', '')[ 11:16]
            activities.append(cached)
        else:
            activities.append(process_activity(act, force_fetch=force_reprocess))
    activities.sort(key=lambda a: a['date'] + a['start_time'], reverse=True)
    recent = [a for a in activities if a['date'] >= PLAN_START_DATE]
    output = {
        'updated_at': datetime.now(timezone.utc).isoformat(),
        'analysis_version': ANALYSIS_VERSION,
        'athlete': {'id': 13589996, 'name': 'Wolf Harmening', 'ftp_estimate': FTP, 'hrmax_estimate': HRMAX, 'weight_kg': 81},
        'summary': {'total_activities': len(activities), 'recent_count': len(recent), 'recent_hours': round(sum(a['duration_sec'] for a in recent) / 3600, 1)},
        'activities': activities,
    }
    os.makedirs('data', exist_ok=True)
    with open(DATA_FILE, 'w') as f:
        json.dump(output, f, indent=2)
    n_streams = sum(1 for a in activities if os.path.exists(stream_path(a['id'])))
    print('Done: ' + str(len(activities)) + ' activities, ' + str(n_streams) + ' stream files')

if __name__ == '__main__':
    main()
