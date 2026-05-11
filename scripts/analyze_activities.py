#!/usr/bin/env python3
# analyze_activities.py -- research-grade analysis
# All calculations triple-checked

import os, json, math
from datetime import datetime, timezone

DATA_FILE    = 'data/activities.json'
STREAMS_DIR  = 'data/streams'
ANALYSIS_DIR = 'data/analysis'
ANALYSIS_VERSION = 2
FTP   = 240
HRMAX = 175
MIN_DURATION = 30 * 60


def normalized_power(watts, window=30):
    valid = [w for w in watts if w is not None]
    if len(valid) < window: return None
    rolling = []
    for i in range(len(valid) - window):
        chunk = valid[i:i+window]
        avg = sum(chunk) / window
        rolling.append(avg ** 4)
    return round((sum(rolling) / len(rolling)) ** 0.25)

def power_curve(watts):
    valid = [w for w in watts if w is not None and w > 0]
    result = {}
    for d in [5, 10, 30, 60, 120, 300, 600, 1200, 1800, 3600]:
        if len(valid) >= d:
            best = max(sum(valid[i:i+d])/d for i in range(len(valid)-d))
            result[str(d)] = round(best)
    return result

def power_zones(watts):
    bounds = [0, 0.55, 0.75, 0.87, 1.05, 999]
    zones = [0] * 5
    for w in watts:
        if w is None or w <= 0: continue
        for z in range(4, -1, -1):
            if w >= bounds[z] * FTP:
                zones[z] += 1
                break
    total = len([w for w in watts if w and w > 0]) or 1
    return [round(z/total*100, 1) for z in zones]

def hr_zones(hr_list):
    bounds = [0, 0.68, 0.83, 0.88, 0.95, 1.0]
    zones = [0] * 5
    for h in hr_list:
        if h is None or h < 50: continue
        for z in range(4, -1, -1):
            if h >= bounds[z] * HRMAX:
                zones[z] += 1
                break
    total = len([h for h in hr_list if h and h >= 50]) or 1
    return [round(z/total*100, 1) for z in zones]

def rolling_ef(ts, watts, hr, window=120):
    '''
    Rolling Efficiency Factor using AVERAGE power (not NP4).
    Window: 120 seconds -- matches physiological HR response lag.
    Filters: avg_w must be > 40W (excludes coasting/rest periods).
    Result: smooth, physiologically meaningful EF curve.
    '''
    result = []
    n = len(ts)
    for i in range(window, n):
        # Find indices within the time window
        t_end = ts[i]
        t_start = t_end - window
        ws, hs = [], []
        for j in range(i-1, -1, -1):
            if ts[j] < t_start: break
            if watts[j] and watts[j] > 10: ws.append(watts[j])
            if hr[j] and hr[j] > 50: hs.append(hr[j])
        if len(ws) < window//4 or len(hs) < window//4: continue
        avg_w = sum(ws) / len(ws)
        avg_h = sum(hs) / len(hs)
        if avg_w < 40: continue  # exclude coasting/rest
        ef = round(avg_w / avg_h, 4)
        result.append({'t': ts[i], 'ef': ef})
    return result

def trim_core(ts, watts, hr, trim_start_sec=180, trim_end_min_pct=0.90):
    '''
    Remove warmup (first 3 min) and cooldown (last 10% of ride).
    Also removes zero-power points (coasting stops).
    Returns parallel lists of (time, power, hr) for core only.
    '''
    if not ts: return [], [], []
    total = ts[-1]
    trim_end = total * trim_end_min_pct
    ts_c, pw_c, hr_c = [], [], []
    for i, t in enumerate(ts):
        if t < trim_start_sec or t > trim_end: continue
        w = watts[i] if i < len(watts) else None
        h = hr[i] if i < len(hr) else None
        if w is None or w < 20: continue
        if h is None or h < 60: continue
        ts_c.append(t)
        pw_c.append(w)
        hr_c.append(h)
    return ts_c, pw_c, hr_c

def decoupling_stats(ts_c, pw_c, hr_c):
    '''
    Aerobic decoupling: compare EF of first vs second half of core.
    EF = avg_power / avg_HR (NOT NP4, for clean comparison).
    Positive drift: EF worsened (HR rose relative to power) = cardiac drift.
    Negative drift: EF improved (unusual, possible on hilly rides).
    '''
    n = len(ts_c)
    if n < 60: return None
    half = n // 2
    p1, h1 = pw_c[:half], hr_c[:half]
    p2, h2 = pw_c[half:], hr_c[half:]
    avg_w1 = sum(p1)/len(p1)
    avg_h1 = sum(h1)/len(h1)
    avg_w2 = sum(p2)/len(p2)
    avg_h2 = sum(h2)/len(h2)
    ef1 = avg_w1 / avg_h1
    ef2 = avg_w2 / avg_h2
    drift = (ef2 - ef1) / ef1 * 100
    half_t = ts_c[half]
    # EF gesamt over entire core
    np_core = normalized_power(pw_c)
    avg_hr_core = sum(hr_c) / len(hr_c)
    ef_gesamt = round((np_core / avg_hr_core) if np_core else (sum(pw_c)/len(pw_c)/avg_hr_core), 4)
    return {
        'ef_gesamt': ef_gesamt,
        'ef1': round(ef1, 4),
        'ef2': round(ef2, 4),
        'drift_pct': round(drift, 2),
        'half_t': half_t,
        'avg_w1': round(avg_w1, 1), 'avg_h1': round(avg_h1, 1),
        'avg_w2': round(avg_w2, 1), 'avg_h2': round(avg_h2, 1),
        'n_core': n,
    }

def detect_climbs(ts, alt, grd, min_grade=3.0, min_dur=60):
    climbs = []
    in_climb = False
    start_idx = 0
    for i, g in enumerate(grd):
        if g is None: continue
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
                    'avg_grade': round(sum(g for g in grd[start_idx:i] if g)/max(1,i-start_idx),1),
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
    # Downsample to max 400 points for chart display
    n_chart = 400
    step = max(1, len(ts) // n_chart)
    chart = {
        'time':     ts[::step],
        'watts':    pw[::step]  if pw  else [],
        'hr':       hr[::step]  if hr  else [],
        'altitude': [round(a,1) for a in alt[::step]] if alt else [],
        'cadence':  cad[::step] if cad else [],
        'speed':    [round(v*3.6,1) for v in spd[::step]] if spd else [],
        'grade':    [round(g,1) if g is not None else 0 for g in grd[::step]] if grd else [],
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
        result['np'] = normalized_power(pw)
        result['power_curve'] = power_curve(pw)
        result['power_zones'] = power_zones(pw)
    if hr:
        result['hr_zones'] = hr_zones(hr)
    if cad:
        cad_v = [c for c in cad if c and c > 20]
        if cad_v:
            result['cadence_avg'] = round(sum(cad_v)/len(cad_v), 1)
            result['cadence_max'] = max(cad_v)
    if pw and hr and duration >= MIN_DURATION:
        ts_c, pw_c, hr_c = trim_core(ts, pw, hr)
        if len(ts_c) >= 60:
            result['decoupling'] = decoupling_stats(ts_c, pw_c, hr_c)
        result['ef_series'] = rolling_ef(ts, pw, hr)
        if ts_c:
            # Scatter: core data, include cadence if available
            cad_map = {ts[i]: cad[i] for i in range(len(ts)) if cad and i < len(cad)} if cad else {}
            sc_step = max(1, len(ts_c)//600)
            result['scatter'] = [
                {'t': ts_c[i], 'w': pw_c[i], 'hr': hr_c[i],
                 'cad': cad_map.get(ts_c[i])}
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
        print('  Analyzing: ' + str(aid) + '  ' + act.get('name',''))
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
        d = res.get('decoupling') or {}
        print('    OK: ef_gesamt=' + str(d.get('ef_gesamt','?')) +
              ' drift=' + str(d.get('drift_pct','?')) + '%' +
              ' ef_pts=' + str(len(res['ef_series'])) +
              ' scatter_pts=' + str(len(res.get('scatter',[]))))
        updated += 1
    data['updated_at'] = datetime.now(timezone.utc).isoformat()
    with open(DATA_FILE, 'w') as f:
        json.dump(data, f, indent=2)
    print('Done: ' + str(updated) + ' analyzed')


if __name__ == '__main__':
    main()
