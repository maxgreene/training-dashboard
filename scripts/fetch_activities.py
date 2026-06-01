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

# ── WAHOO API ──────────────────────────────────────────────────────────────
WAHOO_CLIENT_ID     = 'Dyxm-b7rOkV4VZtxrba512mnIhx70WqlzW4xSoEadQQ'
WAHOO_CLIENT_SECRET = 'eCwM2BdsNZxhoXzHzzobQv8T0BiaGEk9x1jw8rl0krY'
WAHOO_BASE          = 'https://api.wahooligan.com'

def wahoo_refresh_token():
    rt = os.environ.get('WAHOO_REFRESH_TOKEN', '')
    if not rt:
        print('  No WAHOO_REFRESH_TOKEN — skipping Wahoo fetch')
        return None, None
    import urllib.parse
    payload = urllib.parse.urlencode({
        'client_id':     WAHOO_CLIENT_ID,
        'client_secret': WAHOO_CLIENT_SECRET,
        'refresh_token': rt,
        'grant_type':    'refresh_token',
    }).encode()
    req = urllib.request.Request(f'{WAHOO_BASE}/oauth/token', data=payload, method='POST')
    req.add_header('Content-Type', 'application/x-www-form-urlencoded')
    try:
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', errors='replace')
        print(f'  Wahoo token refresh failed: {e.code} {body}')
        return None, rt
    except Exception as e:
        print(f'  Wahoo token refresh failed: {e}')
        return None, rt
    new_rt = data.get('refresh_token', rt)
    at     = data.get('access_token', '')
    if not at:
        print(f'  Wahoo token error: {data}')
        return None, rt
    # Write new refresh token to file so workflow can save it as secret
    if new_rt != rt:
        with open('wahoo_new_refresh_token.txt', 'w') as f:
            f.write(new_rt)
        print(f'  Wahoo: new refresh token saved to file')
    return at, new_rt

def wahoo_api(path, token):
    req = urllib.request.Request(f'{WAHOO_BASE}{path}',
                                 headers={'Authorization': f'Bearer {token}'})
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except Exception as e:
        print(f'    Wahoo API error {path}: {e}')
        return None

def fetch_wahoo_workouts(token):
    """Fetch all workouts since plan start, return list of processed activities."""
    CYCLING_TYPES = {
        'cycling', 'indoor_cycling', 'mountain_biking', 'gravel_cycling',
        'virtual_cycling', 'road_cycling'
    }
    acts = []
    page = 1
    while True:
        data = wahoo_api(f'/v1/workouts?page={page}&per_page=100', token)
        if not data:
            print('  Wahoo API returned no data')
            break
        items = data.get('workouts', []) if isinstance(data, dict) else data
        if not items:
            print(f'  Wahoo page {page}: empty')
            break
        print(f'  Wahoo page {page}: {len(items)} workouts')
        # Show first few to diagnose types and dates
        for w in items[:3]:
            wt = (w.get('workout_type') or {}).get('name', 'unknown')
            print(f'    sample: {w.get("starts","")[:10]} type={wt!r} name={w.get("name","")!r}')
        for w in items:
            wt = (w.get('workout_type') or {}).get('name', '').lower().replace(' ', '_')
            starts = w.get('starts', '')[:10]
            # Filter by date (don't early-return — Wahoo order may vary)
            if starts < PLAN_START_DATE:
                continue
            # Filter: name-based since workout_type is unreliable
            name_lower = w.get('name','').lower()
            is_cycling = (wt in CYCLING_TYPES or 'cycl' in wt or 'bik' in wt
                         or 'radfahren' in name_lower or 'cycling' in name_lower
                         or 'commute' in name_lower or 'ride' in name_lower
                         or 'morning' in name_lower or 'afternoon' in name_lower
                         or 'interval' in name_lower or 'rolle' in name_lower)
            if not is_cycling:
                continue
            # Download FIT file for streams
            fit_url = w.get('workout_summary', {}).get('file', {}).get('url')
            acts.append({
                '_wahoo': True,
                'id':           f"wahoo_{w['id']}",
                'wahoo_id':     w['id'],
                'name':         w.get('name') or 'Wahoo Ride',
                'date':         starts,
                'start_time':   w.get('starts', '')[11:16],
                'type':         'Ride',
                'duration_sec': int(w.get('minutes', 0) or 0) * 60,
                'elapsed_sec':  int(w.get('minutes', 0) or 0) * 60,
                'distance_m':   round(float(w.get('workout_summary', {}).get('distance_accum', 0) or 0)),
                'elevation_m':  round(float(w.get('workout_summary', {}).get('ascent_accum', 0) or 0)),
                'avg_power':    w.get('workout_summary', {}).get('power_avg'),
                'max_power':    w.get('workout_summary', {}).get('power_max'),
                'avg_hr':       w.get('workout_summary', {}).get('heart_rate_avg'),
                'max_hr':       w.get('workout_summary', {}).get('heart_rate_max'),
                'avg_cadence':  w.get('workout_summary', {}).get('cadence_avg'),
                'kilojoules':   None,
                'gps_ok':       False,
                'has_power':    bool(w.get('workout_summary', {}).get('power_avg')),
                'has_hr':       bool(w.get('workout_summary', {}).get('heart_rate_avg')),
                'has_latlng':   False,
                'np': None, 'power_curve': {}, 'hr_zones': [], 'power_zones': [],
                'decoupling_pct': None,
                'streams': {},
                '_fit_url': fit_url,
            })
        if len(items) < 100:
            break
        page += 1
    return acts

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
    # Paginate through all activities since plan start (Strava returns oldest-first with 'after')
    CYCLING_TYPES = {'Ride','GravelRide','MountainBikeRide','VirtualRide','EBikeRide','Cycling','Handcycle','Velomobile','BMX'}
    strava_acts = []
    page = 1
    while True:
        batch = api(f'/athlete/activities?per_page=100&after={PLAN_START_EPOCH}&page={page}')
        if not batch:
            break
        strava_acts.extend(batch)
        print(f"  Page {page}: {len(batch)} activities (total so far: {len(strava_acts)})")
        if len(batch) < 100:
            break
        page += 1
    cycling = [a for a in strava_acts if a.get('sport_type') in CYCLING_TYPES or a.get('type') == 'Ride']
    print(f"Fetched {len(strava_acts)} total, {len(cycling)} cycling")

    # Recover activities whose stream files exist but are missing from API response
    # Reconstruct directly from stream files — no Strava API needed
    import glob
    api_ids = {a['id'] for a in cycling}
    stream_files = glob.glob(os.path.join(STREAMS_DIR, '*.json'))
    stream_ids = {int(os.path.basename(f).replace('.json','')) for f in stream_files}
    missing_ids = stream_ids - api_ids
    if missing_ids:
        print(f"Recovering {len(missing_ids)} activities from stream files (no API needed)...")
        for sf in stream_files:
            aid = int(os.path.basename(sf).replace('.json',''))
            if aid not in missing_ids:
                continue
            try:
                with open(sf) as f2:
                    sd = json.load(f2)
                streams = sd.get('streams', {})
                t_arr  = streams.get('time', [])
                w_arr  = streams.get('watts', [])
                h_arr  = streams.get('heartrate', [])
                d_arr  = streams.get('distance', [])
                alt    = streams.get('altitude', [])
                ll     = streams.get('latlng', [])
                dur    = t_arr[-1] if t_arr else 0
                dist   = d_arr[-1] if d_arr else 0
                # Elevation gain from altitude stream
                elev = 0
                for i in range(1, len(alt)):
                    diff = alt[i] - alt[i-1]
                    if diff > 0:
                        elev += diff
                w_pos = [w for w in w_arr if w and w > 0]
                h_pos = [h for h in h_arr if h and h > 50]
                avg_w = round(sum(w_pos)/len(w_pos), 1) if w_pos else None
                max_w = max(w_pos) if w_pos else None
                avg_h = round(sum(h_pos)/len(h_pos), 1) if h_pos else None
                max_h = max(h_pos) if h_pos else None
                date_str = sd.get('date', '')
                name     = sd.get('name', 'Ride')
                fake_act = {
                    'id':             aid,
                    'name':           name,
                    'start_date_local': date_str + 'T00:00:00Z',
                    'sport_type':     'Ride',
                    'type':           'Ride',
                    'moving_time':    dur,
                    'elapsed_time':   dur,
                    'distance':       dist,
                    'total_elevation_gain': round(elev, 1),
                    'average_watts':  avg_w,
                    'max_watts':      max_w,
                    'average_heartrate': avg_h,
                    'max_heartrate':  max_h,
                    'has_heartrate':  bool(h_pos),
                    'device_watts':   bool(w_pos),
                }
                cycling.append(fake_act)
                print(f"  + {date_str} {name} ({dur//60}min)")
            except Exception as e:
                print(f"  ! skip {aid}: {e}")
    cycling.sort(key=lambda a: a.get('start_date_local',''), reverse=True)

    # ── WAHOO fetch (prepared, activates once credentials are set) ──
    try:
        wahoo_token, _ = wahoo_refresh_token()
        wahoo_acts = []
        if wahoo_token:
            wahoo_acts = fetch_wahoo_workouts(wahoo_token)
            print(f'Wahoo: {len(wahoo_acts)} cycling workouts since plan start')
            strava_dates = {a.get('start_date_local','')[:10] for a in cycling}
            for wa in wahoo_acts:
                if wa['date'] not in strava_dates:
                    cycling.append({**wa,
                        'start_date_local': wa['date'] + 'T' + wa['start_time'] + ':00',
                    })
                    print(f"  + Wahoo-only: {wa['date']} {wa['name']}")
    except Exception as e:
        print(f'  Wahoo skipped: {e}')

    print('Found ' + str(len(cycling)) + ' cycling activities total')
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

    # Add back any existing activities not covered by the Strava fetch or stream recovery
    # This ensures old activities are NEVER lost — merge, don't rebuild
    processed_ids = {a['id'] for a in activities}
    recovered = 0
    for aid, old_act in existing.items():
        if aid not in processed_ids:
            activities.append(old_act)
            recovered += 1
    if recovered:
        print(f'Kept {recovered} existing activities not in current fetch')
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
