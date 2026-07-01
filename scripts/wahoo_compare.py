"""
VERGLEICHS-TEST (schreibt nur data/wahoo_compare.json, faesst nichts anderes an).
Laedt die letzten Juni-Fahrten via Wahoo, parst die FIT-Streams, berechnet
NP/avgW/avgHR/Dauer und stellt sie den bestehenden Strava-Werten gegenueber.
"""
import os, json, io, urllib.request, urllib.parse, urllib.error
from datetime import datetime

WAHOO_CLIENT_ID     = 'Dyxm-b7rOkV4VZtxrba512mnIhx70WqlzW4xSoEadQQ'
WAHOO_CLIENT_SECRET = 'eCwM2BdsNZxhoXzHzzobQv8T0BiaGEk9x1jw8rl0krY'
WAHOO_BASE          = 'https://api.wahooligan.com'
COMPARE_FROM        = '2026-06-20'   # Fahrten ab hier vergleichen
ACTIVITIES_FILE     = 'data/activities.json'
OUT_FILE            = 'data/wahoo_compare.json'

def normalized_power(watts):
    if len(watts) < 30: return None
    roll = []
    for i in range(len(watts) - 30):
        roll.append((sum(watts[i:i+30]) / 30) ** 4)
    if not roll: return None
    return round((sum(roll) / len(roll)) ** 0.25)

def parse_fit(fit_url):
    import fitparse
    raw = urllib.request.urlopen(fit_url, timeout=60).read()
    fit = fitparse.FitFile(io.BytesIO(raw))
    recs = list(fit.get_messages('record'))
    watts, hrs, times = [], [], []
    t0 = None
    for r in recs:
        v = {d.name: d.value for d in r}
        ts = v.get('timestamp')
        if ts is None: continue
        if t0 is None: t0 = ts
        times.append(int((ts - t0).total_seconds()))
        if v.get('power') is not None: watts.append(int(v['power']))
        if v.get('heart_rate') is not None: hrs.append(int(v['heart_rate']))
    dur = times[-1] if times else 0
    return {
        'np': normalized_power(watts) if watts else None,
        'avgW': round(sum(watts)/len(watts), 1) if watts else None,
        'avgHR': round(sum(hrs)/len(hrs), 1) if hrs else None,
        'dur_min': round(dur/60),
        'points': len(recs),
    }

def main():
    # Wahoo Token
    at = os.environ.get('WAHOO_ACCESS_TOKEN', '')
    if not at:
        print('Kein WAHOO_ACCESS_TOKEN'); return

    # Strava-Referenz laden
    with open(ACTIVITIES_FILE) as f:
        acts = json.load(f).get('activities', [])
    strava = {}
    for a in acts:
        if a.get('hidden'): continue
        if a['date'] < COMPARE_FROM: continue
        if a.get('_wahoo'): continue
        # key: datum + startzeit-nah
        strava.setdefault(a['date'], []).append({
            'name': a.get('name'), 'np': a.get('np'),
            'avgW': a.get('avg_power'), 'avgHR': a.get('avg_hr'),
            'dur_min': round((a.get('duration_sec') or 0)/60),
        })

    # Wahoo Workouts holen
    req = urllib.request.Request(f'{WAHOO_BASE}/v1/workouts?page=1&per_page=50',
                                 headers={'Authorization': f'Bearer {at}'})
    items = json.loads(urllib.request.urlopen(req).read()).get('workouts', [])

    results = []
    for w in items:
        date = w.get('starts', '')[:10]
        if date < COMPARE_FROM: continue
        s = w.get('workout_summary') or {}
        fit_url = (s.get('file') or {}).get('url')
        if not fit_url: continue
        print(f'Parse Wahoo {date} {w.get("name","")}...')
        try:
            wv = parse_fit(fit_url)
        except Exception as e:
            print(f'  Fehler: {e}'); continue
        # Wahoo-Summary-Werte (ohne Stream)
        wsum = {
            'np_summary': s.get('power_bike_np_last'),
            'avgW_summary': s.get('power_avg'),
            'avgHR_summary': s.get('heart_rate_avg'),
        }
        results.append({
            'date': date, 'name': w.get('name'),
            'wahoo_fit': wv, 'wahoo_summary': wsum,
            'strava_same_day': strava.get(date, []),
        })

    out = {'generated': datetime.utcnow().isoformat(), 'compare_from': COMPARE_FROM,
           'results': results}
    os.makedirs('data', exist_ok=True)
    with open(OUT_FILE, 'w') as f:
        json.dump(out, f, indent=1)
    print(f'\n{len(results)} Wahoo-Fahrten verglichen -> {OUT_FILE}')
    # Kurzvergleich in Konsole
    print(f"\n{'Datum':11} {'NP W/S':>10} {'avgW W/S':>12} {'HR W/S':>10}")
    for r in results:
        wf = r['wahoo_fit']
        sd = r['strava_same_day']
        # bester Strava-Match nach Dauer
        best = min(sd, key=lambda x: abs((x['dur_min'] or 0)-(wf['dur_min'] or 0))) if sd else None
        snp = best['np'] if best else '-'
        savg = best['avgW'] if best else '-'
        shr = best['avgHR'] if best else '-'
        print(f"{r['date']:11} {str(wf['np'])+'/'+str(snp):>10} "
              f"{str(wf['avgW'])+'/'+str(savg):>12} {str(wf['avgHR'])+'/'+str(shr):>10}")

if __name__ == '__main__':
    main()
