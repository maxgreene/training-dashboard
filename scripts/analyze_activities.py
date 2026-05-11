#!/usr/bin/env python3
# analyze_activities.py
# Reads data/streams/{id}.json, computes analysis, writes data/analysis/{id}.json
# Also updates data/activities.json with precomputed fields

import os, json
from datetime import datetime, timezone

DATA_FILE    = 'data/activities.json'
STREAMS_DIR  = 'data/streams'
ANALYSIS_DIR = 'data/analysis'
ANALYSIS_VERSION = 1
FTP   = 240
HRMAX = 175
MIN_DURATION = 30 * 60


def downsample(arr, n):
    if not arr: return []
    step = max(1, len(arr) // n)
    return arr[::step]

def normalized_power(watts, w=30):
    if len(watts) < w: return None
    rolling = []
    for i in range(len(watts) - w):
        avg = sum(watts[i:i+w]) / w
        rolling.append(avg ** 4)
    return round((sum(rolling) / len(rolling)) ** 0.25)

def rolling_ef(ts, watts, hr, window=30):
    result = []
    for i in range(window, len(ts)):
        ws = [w for w in watts[i-window:i] if w > 10]
        hs = [h for h in hr[i-window:i] if h > 50]
        if len(ws) < window//2 or len(hs) < window//2: continue
        np4 = (sum(v**4 for v in ws) / len(ws)) ** 0.25
        ef = round(np4 / (sum(hs)/len(hs)), 3)
        result.append({'t': ts[i], 'ef': ef})
    return result

def trim_core(ts, watts, hr, trim_start=180, trim_end_pct=0.92):
    if not ts: return [], [], []
    total = ts[-1]
    trim_end = max(total * trim_end_pct, total - 300)
    ts_c, pw_c, hr_c = [], [], []
    for i, t in enumerate(ts):
        if t >= trim_start and t <= trim_end:
            w = watts[i] if i < len(watts) else 0
            h = hr[i] if i < len(hr) else 0
            if w > 20 and h > 60:
                ts_c.append(t)
                pw_c.append(w)
                hr_c.append(h)
    return ts_c, pw_c, hr_c

def decoupling_stats(ts_c, pw_c, hr_c):
    if len(ts_c) < 60: return None
    half = len(ts_c) // 2
    p1, h1 = pw_c[:half], hr_c[:half]
    p2, h2 = pw_c[half:], hr_c[half:]
    avg_w1 = sum(p1)/len(p1)
    avg_h1 = sum(h1)/len(h1)
    avg_w2 = sum(p2)/len(p2)
    avg_h2 = sum(h2)/len(h2)
    ef1 = avg_w1 / avg_h1
    ef2 = avg_w2 / avg_h2
    drift = (ef2 - ef1) / ef1 * 100
    return {
        'ef1': round(ef1, 3), 'ef2': round(ef2, 3),
        'drift_pct': round(drift, 1),
        'half_t': ts_c[half],
        'avg_w1': round(avg_w1), 'avg_h1': round(avg_h1),
        'avg_w2': round(avg_w2), 'avg_h2': round(avg_h2),
    }

def power_curve(watts):
    result = {}
    for d in [5, 10, 30, 60, 120, 300, 600, 1200, 1800, 3600]:
        if len(watts) >= d:
            best = max(sum(watts[i:i+d])/d for i in range(len(watts)-d))
            result[str(d)] = round(best)
    return result

def power_zones(watts):
    bounds = [0, 0.55, 0.75, 0.87, 1.05, 999]
    zones = [0] * 5
    for w in watts:
        for z in range(4, -1, -1):
            if w >= bounds[z] * FTP:
                zones[z] += 1
                break
    total = len(watts) or 1
    return [round(z/total*100, 1) for z in zones]

def hr_zones(hr_list):
    bounds = [0, 0.68, 0.83, 0.88, 0.95, 1.0]
    zones = [0] * 5
    for h in hr_list:
        for z in range(4, -1, -1):
            if h >= bounds[z] * HRMAX:
                zones[z] += 1
                break
    total = len(hr_list) or 1
    return [round(z/total*100, 1) for z in zones]

def detect_climbs(ts, alt, grd, min_grade=3.0, min_dur=60):
    climbs = []
    in_climb = False
    start_idx = 0
    for i, g in enumerate(grd):
        if not in_climb and g >= min_grade:
            in_climb = True
            start_idx = i
        elif in_climb and g < min_grade:
            dur = ts[i] - ts[start_idx]
            if dur >= min_dur:
                gain = max(0, alt[i] - alt[start_idx])
                climbs.append({
                    't_start': ts[start_idx], 't_end': ts[i],
                    'duration_sec': round(dur),
                    'elevation_gain': round(gain, 1),
                    'avg_grade': round(sum(grd[start_idx:i])/max(1,i-start_idx), 1),
                })
            in_climb = False
    return climbs


def analyze(activity_id, streams, act):
    ts  = streams.get('time', [])
    pw  = streams.get('watts', [])
    hr  = streams.get('heartrate', [])
    alt = streams.get('altitude', [])
    cad = streams.get('cadence', [])
    spd = streams.get('velocity_smooth', [])
    grd = streams.get('grade_smooth', [])
    lat = streams.get('latlng', [])
    if not ts: return None
    duration = ts[-1]
    n = 300
    step = max(1, len(ts) // n)
    chart = {
        'time':     ts[::step],
        'watts':    pw[::step]  if pw  else [],
        'hr':       hr[::step]  if hr  else [],
        'altitude': [round(a,1) for a in alt[::step]] if alt else [],
        'cadence':  cad[::step] if cad else [],
        'speed':    [round(v*3.6,1) for v in spd[::step]] if spd else [],
        'grade':    [round(g,1) for g in grd[::step]] if grd else [],
    }
    result = {
        'activity_id':      activity_id,
        'analyzed_at':      datetime.now(timezone.utc).isoformat(),
        'analysis_version': ANALYSIS_VERSION,
        'duration_sec':     duration,
        'has_power':        bool(pw),
        'has_hr':           bool(hr),
        'has_gps':          bool(lat),
        'chart':            chart,
        'power_curve':      {},
        'power_zones':      [],
        'hr_zones':         [],
        'np':               None,
        'cadence_avg':      None,
        'cadence_max':      None,
        'decoupling':       None,
        'ef_series':        [],
        'scatter':          [],
        'climbs':           [],
    }
    if pw:
        pw_nz = [w for w in pw if w > 0]
        result['np'] = normalized_power(pw)
        result['power_curve'] = power_curve(pw)
        result['power_zones'] = power_zones(pw_nz)
    if hr:
        hr_v = [h for h in hr if h > 50]
        result['hr_zones'] = hr_zones(hr_v)
    if cad:
        cad_v = [c for c in cad if c > 20]
        if cad_v:
            result['cadence_avg'] = round(sum(cad_v)/len(cad_v))
            result['cadence_max'] = max(cad_v)
    if pw and hr and duration >= MIN_DURATION:
        ts_c, pw_c, hr_c = trim_core(ts, pw, hr)
        if len(ts_c) >= 60:
            result['decoupling'] = decoupling_stats(ts_c, pw_c, hr_c)
        result['ef_series'] = rolling_ef(ts, pw, hr)
        if ts_c:
            sc_step = max(1, len(ts_c)//500)
            result['scatter'] = [
                {'t': ts_c[i], 'w': pw_c[i], 'hr': hr_c[i]}
                for i in range(0, len(ts_c), sc_step)
            ]
    if alt and grd and len(alt) > 60:
        result['climbs'] = detect_climbs(ts, alt, grd)
    return result


def main():
    if not os.path.exists(DATA_FILE):
        print('No activities.json, run fetch_activities.py first')
        return
    with open(DATA_FILE) as f:
        data = json.load(f)
    activities = data.get('activities', [])
    os.makedirs(ANALYSIS_DIR, exist_ok=True)
    updated = 0
    for act in activities:
        aid = act['id']
        sf  = os.path.join(STREAMS_DIR,  str(aid) + '.json')
        af  = os.path.join(ANALYSIS_DIR, str(aid) + '.json')
        if not os.path.exists(sf):
            print('  No stream: ' + str(aid))
            continue
        if os.path.exists(af):
            with open(af) as f:
                ex = json.load(f)
            if ex.get('analysis_version') == ANALYSIS_VERSION:
                print('  Cached: ' + str(aid))
                continue
        print('  Analyzing: ' + str(aid) + ' ' + act.get('name', ''))
        with open(sf) as f:
            streams = json.load(f).get('streams', {})
        res = analyze(aid, streams, act)
        if not res:
            print('    No data')
            continue
        with open(af, 'w') as f:
            json.dump(res, f)
        if res.get('np'):            act['np']             = res['np']
        if res.get('power_curve'):   act['power_curve']    = res['power_curve']
        if res.get('power_zones'):   act['power_zones']    = res['power_zones']
        if res.get('hr_zones'):      act['hr_zones']       = res['hr_zones']
        if res.get('cadence_avg'):   act['avg_cadence']    = res['cadence_avg']
        if res.get('decoupling'):    act['decoupling_pct'] = res['decoupling']['drift_pct']
        if res.get('duration_sec'):  act['duration_sec']   = res['duration_sec']
        print('    OK: ' + str(len(res['chart'].get('time',[]))) + ' pts, '
              + str(len(res['ef_series'])) + ' EF, '
              + str(len(res.get('climbs',[]))) + ' climbs')
        updated += 1
    data['updated_at'] = datetime.now(timezone.utc).isoformat()
    with open(DATA_FILE, 'w') as f:
        json.dump(data, f, indent=2)
    print('Done: ' + str(updated) + ' analyzed')


if __name__ == '__main__':
    main()
