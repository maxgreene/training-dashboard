#!/usr/bin/env python3
“””
Fetch Strava activities and save raw streams + slim activity metadata.

Output:
data/streams/{id}.json  — full-resolution raw streams, all keys
data/activities.json    — slim metadata + precomputed stats (no streams)
“””

import os, json, math, urllib.request, urllib.error
from datetime import datetime, timezone

TOKEN  = os.environ[“STRAVA_ACCESS_TOKEN”]
HEADERS = {“Authorization”: f”Bearer {TOKEN}”}
DATA_FILE    = “data/activities.json”
STREAMS_DIR  = “data/streams”

# Bump to force reprocessing of all activities

ANALYSIS_VERSION = 9

# Import activities from plan start date onwards

PLAN_START_DATE  = “2026-05-04”
PLAN_START_EPOCH = int(datetime(2026, 5, 4, 0, 0, 0, tzinfo=timezone.utc).timestamp())

# All stream keys Strava supports for activities

ALL_STREAM_KEYS = [
“time”,
“latlng”,
“distance”,
“altitude”,
“heartrate”,
“cadence”,
“watts”,
“velocity_smooth”,
“grade_smooth”,
“moving”,
]

FTP   = 240
HRMAX = 175

# ── API ──────────────────────────────────────────────────────────────────────

def api(path):
req = urllib.request.Request(
f”https://www.strava.com/api/v3{path}”, headers=HEADERS
)
with urllib.request.urlopen(req) as r:
return json.loads(r.read())

def fetch_streams(activity_id):
“”“Fetch all available streams at full resolution.”””
keys = “,”.join(ALL_STREAM_KEYS)
try:
data = api(
f”/activities/{activity_id}/streams”
f”?keys={keys}&key_by_type=true&resolution=high&series_type=time”
)
return {k: data[k][“data”] for k in ALL_STREAM_KEYS if k in data}
except Exception as e:
print(f”  Stream error for {activity_id}: {e}”)
return {}

# ── ANALYSIS HELPERS ─────────────────────────────────────────────────────────

def normalized_power(watts):
“”“30-second rolling NP from 1-Hz power stream.”””
if len(watts) < 30:
return None
rolling = []
for i in range(len(watts) - 30):
avg = sum(watts[i:i+30]) / 30
rolling.append(avg ** 4)
return round((sum(rolling) / len(rolling)) ** 0.25)

def power_curve(watts):
“”“Best mean maximal power for key durations.”””
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
“”“HR/W decoupling over full activity (excluding zeros).”””
pairs = [(w, h) for w, h in zip(pw, hr) if w > 20 and h > 60]
if len(pairs) < 60:
return None
half = len(pairs) // 2
p1, h1 = zip(*pairs[:half])
p2, h2 = zip(*pairs[half:])
r1 = (sum(h1)/len(h1)) / (sum(p1)/len(p1))
r2 = (sum(h2)/len(h2)) / (sum(p2)/len(p2))
return round((r2 - r1) / r1 * 100, 1)

def mini_chart(streams, n=80):
“”“Downsample key streams to ~n points for dashboard preview.”””
ts  = streams.get(“time”, [])
pw  = streams.get(“watts”, [])
hr  = streams.get(“heartrate”, [])
alt = streams.get(“altitude”, [])
if not ts:
return {}
step = max(1, len(ts) // n)
spd = [round(v * 3.6, 1) for v in streams.get(“velocity_smooth”, [])]
return {
“time”:     ts[::step],
“watts”:    pw[::step]  if pw  else [],
“hr”:       hr[::step]  if hr  else [],
“altitude”: alt[::step] if alt else [],
“speed”:    spd[::step] if spd else [],
}

# ── STREAM FILE ──────────────────────────────────────────────────────────────

def stream_path(activity_id):
return os.path.join(STREAMS_DIR, f”{activity_id}.json”)

def save_streams(activity_id, streams, activity_meta):
“”“Save raw streams to data/streams/{id}.json.”””
os.makedirs(STREAMS_DIR, exist_ok=True)
payload = {
“activity_id”:  activity_id,
“date”:         activity_meta.get(“start_date_local”, “”)[:10],
“name”:         activity_meta.get(“name”, “”),
“fetched_at”:   datetime.now(timezone.utc).isoformat(),
“resolution”:   “high”,
“keys_present”: list(streams.keys()),
“streams”:      streams,
}
with open(stream_path(activity_id), “w”) as f:
json.dump(payload, f)
print(f”    Saved streams/{activity_id}.json “
f”({len(streams.get(‘time’, []))} pts, “
f”keys: {’, ’.join(streams.keys())})”)

def load_streams(activity_id):
p = stream_path(activity_id)
if os.path.exists(p):
with open(p) as f:
return json.load(f).get(“streams”, {})
return None

# ── ACTIVITY PROCESSING ───────────────────────────────────────────────────────

def process_activity(act, force_fetch=False):
“”“Build slim activity record + ensure streams file exists.”””
aid = act[“id”]
print(f”  Processing {aid}: {act[‘name’]}”)

```
# ── Streams: load from cache or fetch ──
streams = load_streams(aid)
if streams is None or force_fetch:
    print(f"    Fetching streams...")
    streams = fetch_streams(aid)
    if streams:
        save_streams(aid, streams, act)
else:
    print(f"    Using cached streams ({len(streams.get('time', []))} pts)")

# ── Basic metadata from Strava activity ──
pw  = streams.get("watts", [])
hr  = streams.get("heartrate", [])
ts  = streams.get("time", [])
alt = streams.get("altitude", [])
dist_stream = streams.get("distance", [])
latlng = streams.get("latlng", [])

moving_time  = act.get("moving_time", 0)
elapsed_time = act.get("elapsed_time", 0)

# GPS quality: check if latlng stream present and distance coverage
has_gps = len(latlng) > 0
gps_coverage_pct = None
gps_ok = has_gps
if pw and dist_stream:
    gps_coverage_pct = round(len(dist_stream) / len(pw) * 100)
    if gps_coverage_pct < 85:
        gps_ok = False

gps_distance = act.get("distance", 0)

result = {
    "id":           aid,
    "name":         act["name"],
    "date":         act["start_date_local"][:10],
    "start_time":   act["start_date_local"][11:16],
    "type":         act.get("sport_type", act.get("type", "Ride")),
    "duration_sec": moving_time,
    "elapsed_sec":  elapsed_time,
    "distance_m":   round(gps_distance) if gps_ok else None,
    "elevation_m":  round(act.get("total_elevation_gain", 0)) if gps_ok else None,
    "avg_speed_kmh": round(gps_distance / max(moving_time, 1) * 3.6, 1) if gps_ok else None,
    "avg_power":    act.get("average_watts"),
    "max_power":    act.get("max_watts"),
    "avg_hr":       act.get("average_heartrate"),
    "max_hr":       act.get("max_heartrate"),
    "avg_cadence":  act.get("average_cadence"),
    "kilojoules":   act.get("kilojoules"),
    "gps_ok":       gps_ok,
    "gps_coverage_pct": gps_coverage_pct,
    "has_power":    act.get("device_watts", False),
    "has_hr":       act.get("average_heartrate") is not None,
    "has_latlng":   has_gps,
    # Precomputed from streams
    "np":           None,
    "power_curve":  {},
    "hr_zones":     [],
    "power_zones":  [],
    "decoupling_pct": None,
    "power_duration_sec": len(pw) if pw else None,
    "streams":      mini_chart(streams),  # slim preview; full data in data/streams/{id}.json
}

# ── Compute from power stream ──
if pw:
    result["np"]           = normalized_power(pw)
    result["power_curve"]  = power_curve(pw)
    result["power_zones"]  = power_zones(pw)
    result["duration_sec"] = len(pw)

if hr:
    result["hr_zones"] = hr_zones(hr)

if pw and hr:
    result["decoupling_pct"] = decoupling(pw, hr)

return result
```

# ── MAIN ─────────────────────────────────────────────────────────────────────

def main():
# Load existing processed activities
existing = {}
existing_version = 0
if os.path.exists(DATA_FILE):
with open(DATA_FILE) as f:
data = json.load(f)
existing = {a[“id”]: a for a in data.get(“activities”, [])}
existing_version = data.get(“analysis_version”, 0)

```
print(f"Existing activities: {len(existing)}")

force_reprocess = existing_version < ANALYSIS_VERSION
if force_reprocess:
    print(f"Version bump ({existing_version}→{ANALYSIS_VERSION}): reprocessing all")

# Fetch activity list from Strava
print(f"Fetching activities since {PLAN_START_DATE}...")
strava_acts = api(f"/athlete/activities?per_page=60&after={PLAN_START_EPOCH}")
cycling = [
    a for a in strava_acts
    if a.get("sport_type") in ("Ride","GravelRide","MountainBikeRide","VirtualRide")
    or a.get("type") == "Ride"
]
print(f"Found {len(cycling)} cycling activities")

activities = []
for act in cycling:
    aid = act["id"]
    stream_file_exists = os.path.exists(stream_path(aid))

    if aid in existing and not force_reprocess and stream_file_exists:
        # Use cached result — no Strava calls needed
        activities.append(existing[aid])
    else:
        # New activity, version bump, or missing stream file
        processed = process_activity(act, force_fetch=force_reprocess)
        activities.append(processed)

activities.sort(key=lambda a: a["date"] + a["start_time"], reverse=True)

recent = [a for a in activities if a["date"] >= PLAN_START_DATE]
output = {
    "updated_at":      datetime.now(timezone.utc).isoformat(),
    "analysis_version": ANALYSIS_VERSION,
    "athlete": {
        "id":             13589996,
        "name":           "Wolf Harmening",
        "ftp_estimate":   FTP,
        "hrmax_estimate": HRMAX,
        "weight_kg":      81,
    },
    "summary": {
        "total_activities": len(activities),
        "recent_count":     len(recent),
        "recent_hours":     round(sum(a["duration_sec"] for a in recent) / 3600, 1),
    },
    "activities": activities,
}

os.makedirs("data", exist_ok=True)
with open(DATA_FILE, "w") as f:
    json.dump(output, f, indent=2)

print(f"\nDone. {len(activities)} activities saved.")
print(f"  activities.json: slim metadata + mini_chart")
print(f"  data/streams/: {len([a for a in activities if os.path.exists(stream_path(a['id']))])} stream files")
```

if **name** == “**main**”:
main()
