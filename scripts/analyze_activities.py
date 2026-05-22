#!/usr/bin/env python3
# analyze_activities.py -- v3, all activities including short commutes
import os, json
from datetime import datetime, timezone

DATA_FILE    = 'data/activities.json'
STREAMS_DIR  = 'data/streams'
ANALYSIS_DIR = 'data/analysis'
ANALYSIS_VERSION = 3
FTP   = 237
HRMAX = 175

def normalized_power(watts, window=30):
    valid = [w for w in watts if w and w > 0]
    if len(valid) < window: return None
    rolling = [(sum(valid[i:i+window])/window)**4 for i in range(len(valid)-window)]
    return round((sum(rolling)/len(rolling))**0.25)

def power_curve(watts):
    valid = [w for w in watts if w and w > 0]
    result = {}
    for d in [5, 10, 30, 60, 120, 300, 600, 1200, 1800, 3600]:
        if len(valid) >= d:
            best = max(sum(valid[i:i+d])/d for i in range(len(valid)-d))
            result[str(d)] = round(best)
    return result

def power_zones(watts):
    bounds = [0, 0.55, 0.75, 0.87, 1.05, 999]
    zones = [0]*5
    valid = [w for w in watts if w and w > 0]
    for w in valid:
        for z in range(4,-1,-1):
            if w >= bounds[z]*FTP: zones[z]+=1; break
    total = len(valid) or 1
    return [round(z/total*100,1) for z in zones]

def hr_zones(hr_list):
    bounds = [0, 0.68, 0.83, 0.88, 0.95, 1.0]
    zones = [0]*5
    valid = [h for h in hr_list if h and h >= 50]
    for h in valid:
        for z in range(4,-1,-1):
            if h >= bounds[z]*HRMAX: zones[z]+=1; break
    total = len(valid) or 1
    return [round(z/total*100,1) for z in zones]

def rolling_ef(ts, watts, hr, window=60):
    result = []
    for i in range(len(ts)):
        t_end = ts[i]
        ws, hs = [], []
        for j in range(i-1,-1,-1):
            if ts[j] < t_end-window: break
            if watts[j] and watts[j] > 10: ws.append(watts[j])
            if hr[j] and hr[j] > 50: hs.append(hr[j])
        if len(ws) < 3 or len(hs) < 3: continue
        avg_w = sum(ws)/len(ws)
        if avg_w < 30: continue
        result.append({'t': ts[i], 'ef': round(avg_w/(sum(hs)/len(hs)), 4)})
    return result

def trim_core(ts, watts, hr, trim_pct=0.08):
    if not ts: return [], [], []
    total = ts[-1]
    t0 = total*trim_pct
    t1 = total*(1.0-trim_pct)
    tc,pc,hc = [],[],[]
    for i,t in enumerate(ts):
        if t < t0 or t > t1: continue
        w = watts[i] if i < len(watts) else None
        h = hr[i] if i < len(hr) else None
        if (w is None or w < 20) and watts: continue
        if h is None or h < 60: continue
        tc.append(t); pc.append(w or 0); hc.append(h)
    return tc, pc, hc

def decoupling_stats(ts_c, pw_c, hr_c):
    n = len(ts_c)
    if n < 10: return None
    half = n//2
    p1,h1 = pw_c[:half],hr_c[:half]
    p2,h2 = pw_c[half:],hr_c[half:]
    if not p1 or not h1 or not p2 or not h2: return None
    aw1=sum(p1)/len(p1); ah1=sum(h1)/len(h1)
    aw2=sum(p2)/len(p2); ah2=sum(h2)/len(h2)
    if ah1==0 or ah2==0 or aw1==0 or aw2==0: return None
    ef1=aw1/ah1; ef2=aw2/ah2
    if ef1==0: return None
    np_c = normalized_power(pw_c)
    avg_hr_c = sum(hr_c)/len(hr_c)
    ef_g = round((np_c/avg_hr_c) if np_c else (sum(pw_c)/len(pw_c)/avg_hr_c),4)
    return {'ef_gesamt':ef_g,'ef1':round(ef1,4),'ef2':round(ef2,4),
            'drift_pct':round((ef2-ef1)/ef1*100,2),'half_t':ts_c[half],
            'avg_w1':round(aw1,1),'avg_h1':round(ah1,1),
            'avg_w2':round(aw2,1),'avg_h2':round(ah2,1),'n_core':n}

def detect_climbs(ts, alt, grd, min_grade=3.0, min_dur=30):
    climbs=[]; in_c=False; si=0
    for i,g in enumerate(grd):
        if g is None: continue
        if not in_c and g>=min_grade: in_c=True; si=i
        elif in_c and g<min_grade:
            dur=ts[i]-ts[si]
            if dur>=min_dur:
                gain=max(0,alt[i]-alt[si])
                avg_g=sum(x for x in grd[si:i] if x)/max(1,i-si)
                climbs.append({'t_start':ts[si],'t_end':ts[i],
                               'duration_sec':round(dur),'elevation_gain':round(gain,1),
                               'avg_grade':round(avg_g,1)})
            in_c=False
    return climbs


def analyze(aid, streams, act):
    ts  = streams.get('time',[])
    pw  = streams.get('watts',[])
    hr  = streams.get('heartrate',[])
    alt = streams.get('altitude',[])
    cad = streams.get('cadence',[])
    spd = streams.get('velocity_smooth',[])
    grd = streams.get('grade_smooth',[])
    lat = streams.get('latlng',[])
    if not ts: return None
    dur = ts[-1]
    step = max(1, len(ts)//300)
    chart = {
        'time':ts[::step],
        'watts':pw[::step] if pw else [],
        'hr':hr[::step] if hr else [],
        'altitude':[round(a,1) for a in alt[::step]] if alt else [],
        'cadence':cad[::step] if cad else [],
        'speed':[round(v*3.6,1) for v in spd[::step]] if spd else [],
        'grade':[round(g,1) if g else 0 for g in grd[::step]] if grd else [],
    }
    res = {
        'activity_id':aid,'analyzed_at':datetime.now(timezone.utc).isoformat(),
        'analysis_version':ANALYSIS_VERSION,'duration_sec':dur,
        'has_power':bool(pw),'has_hr':bool(hr),'has_gps':bool(lat),
        'chart':chart,'power_curve':{},'power_zones':[],'hr_zones':[],
        'np':None,'cadence_avg':None,'cadence_max':None,
        'decoupling':None,'ef_series':[],'scatter':[],'climbs':[],
    }
    if pw:
        res['np']=normalized_power(pw)
        res['power_curve']=power_curve(pw)
        res['power_zones']=power_zones(pw)
    if hr:
        res['hr_zones']=hr_zones(hr)
    if cad:
        cv=[c for c in cad if c and c>20]
        if cv: res['cadence_avg']=round(sum(cv)/len(cv),1); res['cadence_max']=max(cv)
    # Aerobic analysis for all rides >= 60 seconds with HR
    if hr and dur >= 60:
        has_pw = bool(pw)
        pw_for_trim = pw if pw else []
        ts_c,pw_c,hr_c = trim_core(ts, pw_for_trim, hr)
        if len(ts_c) >= 6:
            res['decoupling'] = decoupling_stats(ts_c, pw_c, hr_c)
        if has_pw and len(ts_c) >= 6:
            res['ef_series'] = rolling_ef(ts, pw, hr)
            sc_step = max(1, len(ts_c)//300)
            cad_map = {ts[i]:cad[i] for i in range(len(ts)) if cad and i<len(cad)} if cad else {}
            res['scatter'] = [{'t':ts_c[i],'w':pw_c[i],'hr':hr_c[i],'cad':cad_map.get(ts_c[i])}
                              for i in range(0,len(ts_c),sc_step)]
    if alt and grd and len(alt)>5:
        res['climbs']=detect_climbs(ts,alt,grd)
    return res


def main():
    if not os.path.exists(DATA_FILE):
        print('No activities.json'); return
    with open(DATA_FILE) as f: data=json.load(f)
    acts=data.get('activities',[])
    os.makedirs(ANALYSIS_DIR, exist_ok=True)
    updated=0
    for act in acts:
        aid=act['id']
        sf=os.path.join(STREAMS_DIR, str(aid)+'.json')
        af=os.path.join(ANALYSIS_DIR, str(aid)+'.json')
        if not os.path.exists(sf): continue
        if os.path.exists(af):
            with open(af) as f: ex=json.load(f)
            if ex.get('analysis_version')==ANALYSIS_VERSION: continue
        name=act.get('name',''); dur=round(act.get('duration_sec',0)/60)
        print('  ' + name + ' ' + act.get('date','') + ' ' + str(dur) + 'min')
        with open(sf) as f: streams=json.load(f).get('streams',{})
        res=analyze(aid, streams, act)
        if not res: continue
        with open(af,'w') as f: json.dump(res,f)
        if res.get('np'):          act['np']=res['np']
        if res.get('power_curve'): act['power_curve']=res['power_curve']
        if res.get('power_zones'): act['power_zones']=res['power_zones']
        if res.get('hr_zones'):    act['hr_zones']=res['hr_zones']
        if res.get('cadence_avg'): act['avg_cadence']=res['cadence_avg']
        d=res.get('decoupling') or {}
        if d: act['decoupling_pct']=d['drift_pct']
        nc=len(res['chart'].get('time',[]))
        ne=len(res.get('ef_series',[]))
        nclimb=len(res.get('climbs',[]))
        print('    ' + str(nc) + 'pts ef=' + str(ne) +
              (' drift=' + str(d.get('drift_pct','')) + '%' if d else '') +
              (' ' + str(nclimb) + 'climbs' if nclimb else ''))
        updated+=1
    data['updated_at']=datetime.now(timezone.utc).isoformat()
    with open(DATA_FILE,'w') as f: json.dump(data,f,indent=2)
    print('Done: ' + str(updated) + ' analyzed')

if __name__ == '__main__':
    main()
