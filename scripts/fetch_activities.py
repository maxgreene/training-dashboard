#!/usr/bin/env python3
"""Fetch recent Strava activities and save as JSON for the dashboard."""

import os, json, math, urllib.request, urllib.error
from datetime import datetime, timezone

TOKEN = os.environ["STRAVA_ACCESS_TOKEN"]
HEADERS = {"Authorization": f"Bearer {TOKEN}"}
DATA_FILE = "data/activities.json"

# Only import activities from this date onwards (plan start date)
PLAN_START_DATE = "2026-05-06"
PLAN_START_EPOCH = int(datetime(2026, 5, 6, 0, 0, 0, tzinfo=timezone.utc).timestamp())

def api(path):
    req = urllib.request.Request(f"https://www.strava.com/api/v3{path}", headers=HEADERS)
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())

def normalized_power(watts):
    if len(watts) < 30:
        return None
    window = 30
    rolling = []
    for i in range(len(watts) - window):
        avg = sum(watts[i:i+window]) / window
        rolling.append(avg ** 4)
    return round((sum(rolling) / len(rolling)) ** 0.25)

def power_curve(watts):
    durations = [5, 10, 30, 60, 120, 300, 600, 1200]
    result = {}
    for d in durations:
        if len(watts) >= d:
            best = max(sum(watts[i:i+d]) / d for i in range(len(watts) - d))
            result[str(d)] = round(best)
    return result

def hr_zones(hr_list, hrmax=175):
    bounds = [0, 0.68, 0.83, 0.88, 0.95, 1.0]
    zones = [0] * 5
    for h in hr_list:
        for z in range(4, -1, -1):
            if h >= bounds[z] * hrmax:
                zones[z] += 1
                break
    total = len(hr_list) or 1
    return [round(z / total * 100, 1) for z in zones]

def power_zones(pw_list, ftp=240):
    bounds = [0, 0.55, 0.75, 0.87, 1.05, 999]
    zones = [0] * 5
    for p in pw_list:
        for z in range(4, -1, -1):
            if p >= bounds[z] * ftp:
                zones[z] += 1
                break
    total = len(pw_list) or 1
    return [round(z / total * 100, 1) for z in zones]

def fetch_streams(activity_id, keys):
    try:
        data = api(f"/activities/{activity_id}/streams?keys={','.join(keys)}&key_by_type=true")
        return {k: data[k]["data"] for k in keys if k in data}
    except Exception as e:
        print(f"  Stream error for {activity_id}: {e}")
        return {}

def process_activity(act):
    aid = act["id"]
    print(f"  Processing {aid}: {act['name']}")

    moving_time = act.get("moving_time", 0)
    elapsed_time = act.get("elapsed_time", 0)
    gps_distance = act.get("distance", 0)
    avg_power = act.get("average_watts")
    kj = act.get("kilojoules")

    # GPS plausibility: compare GPS tracking duration vs device elapsed time
    gps_ok = True
    gps_coverage_pct = None
    try:
        latlng = fetch_streams(aid, ["latlng", "time"])
        if "latlng" in latlng and "time" in latlng:
            positions = latlng["latlng"]
            times = latlng["time"]
            valid = [(t, p) for t, p in zip(times, positions) if p and p[0] and p[1]]
            if valid and elapsed_time:
                gps_duration = valid[-1][0] - valid[0][0]
                gps_coverage_pct = round(gps_duration / elapsed_time * 100)
                if gps_coverage_pct < 80:
                    gps_ok = False
                    print(f"  GPS incomplete: {gps_coverage_pct}% coverage ({gps_duration}s of {elapsed_time}s elapsed)")
    except Exception as e:
        print(f"  Could not check GPS coverage: {e}")

    result = {
        "id": aid,
        "name": act["name"],
        "date": act["start_date_local"][:10],
        "start_time": act["start_date_local"][11:16],
        "type": act.get("sport_type", act.get("type", "Ride")),
        "duration_sec": moving_time,
        "elapsed_sec": elapsed_time,
        "distance_m": round(gps_distance) if gps_ok else None,
        "elevation_m": round(act.get("total_elevation_gain", 0)) if gps_ok else None,
        "avg_speed_kmh": round(gps_distance / max(moving_time, 1) * 3.6, 1) if gps_ok else None,
        "avg_power": avg_power,
        "max_power": act.get("max_watts"),
        "avg_hr": act.get("average_heartrate"),
        "max_hr": act.get("max_heartrate"),
        "avg_cadence": act.get("average_cadence"),
        "kilojoules": kj,
        "gps_ok": gps_ok,
        "gps_coverage_pct": gps_coverage_pct,
        "has_power": act.get("device_watts", False),
        "has_hr": act.get("average_heartrate") is not None,
        "np": None,
        "power_curve": {},
        "hr_zones": [],
        "power_zones": [],
        "streams": {}
    }

    if result["has_power"] or result["has_hr"]:
        keys = ["time", "watts", "heartrate", "cadence", "altitude", "velocity_smooth"]
        streams = fetch_streams(aid, keys)

        pw = streams.get("watts", [])
        hr = streams.get("heartrate", [])
        ts = streams.get("time", [])
        alt = streams.get("altitude", [])
        spd = [round(v * 3.6, 1) for v in streams.get("velocity_smooth", [])]

        step = max(1, len(ts) // 300)
        result["streams"] = {
            "time": ts[::step],
            "watts": pw[::step] if pw else [],
            "hr": hr[::step] if hr else [],
            "altitude": alt[::step] if alt else [],
            "speed": spd[::step] if spd else [],
        }

        if pw:
            result["np"] = normalized_power(pw)
            result["power_curve"] = power_curve(pw)
            result["power_zones"] = power_zones(pw)

        if hr:
            result["hr_zones"] = hr_zones(hr)

        if pw and hr and len(pw) > 60:
            half = len(pw) // 2
            p1, p2 = pw[:half], pw[half:]
            h1, h2 = hr[:half], hr[half:]
            if all([p1, p2, h1, h2]):
                r1 = (sum(h1)/len(h1)) / (sum(p1)/len(p1))
                r2 = (sum(h2)/len(h2)) / (sum(p2)/len(p2))
                result["decoupling_pct"] = round((r2 - r1) / r1 * 100, 1)

    return result

def main():
    existing = {}
    if os.path.exists(DATA_FILE):
        with open(DATA_FILE) as f:
            data = json.load(f)
            existing = {a["id"]: a for a in data.get("activities", [])}

    print(f"Existing activities: {len(existing)}")
    print(f"Fetching activities since {PLAN_START_DATE}...")
    strava_acts = api(f"/athlete/activities?per_page=60&after={PLAN_START_EPOCH}")
    cycling = [a for a in strava_acts if a.get("sport_type") in
               ("Ride", "GravelRide", "MountainBikeRide", "VirtualRide") or
               a.get("type") in ("Ride",)]

    print(f"Found {len(cycling)} cycling activities")

    activities = []
    for act in cycling:
        aid = act["id"]
        if aid in existing:
            activities.append(existing[aid])
        else:
            processed = process_activity(act)
            activities.append(processed)

    activities.sort(key=lambda a: a["date"] + a["start_time"], reverse=True)

    recent = [a for a in activities if a["date"] >= "2026-05-05"]
    output = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "athlete": {
            "id": 13589996,
            "name": "Wolf Harmening",
            "ftp_estimate": 240,
            "hrmax_estimate": 175,
            "weight_kg": 81
        },
        "summary": {
            "total_activities": len(activities),
            "recent_count": len(recent),
            "recent_hours": round(sum(a["duration_sec"] for a in recent) / 3600, 1),
        },
        "activities": activities
    }

    os.makedirs("data", exist_ok=True)
    with open(DATA_FILE, "w") as f:
        json.dump(output, f, indent=2)

    print(f"Saved {len(activities)} activities to {DATA_FILE}")

if __name__ == "__main__":
    main()            best = max(sum(watts[i:i+d]) / d for i in range(len(watts) - d))
            result[str(d)] = round(best)
    return result

def hr_zones(hr_list, hrmax=175):
    """Distribution across 5 HR zones."""
    bounds = [0, 0.68, 0.83, 0.88, 0.95, 1.0]
    zones = [0] * 5
    for h in hr_list:
        for z in range(4, -1, -1):
            if h >= bounds[z] * hrmax:
                zones[z] += 1
                break
    total = len(hr_list) or 1
    return [round(z / total * 100, 1) for z in zones]

def power_zones(pw_list, ftp=240):
    """Distribution across 5 power zones."""
    bounds = [0, 0.55, 0.75, 0.87, 1.05, 999]
    zones = [0] * 5
    for p in pw_list:
        for z in range(4, -1, -1):
            if p >= bounds[z] * ftp:
                zones[z] += 1
                break
    total = len(pw_list) or 1
    return [round(z / total * 100, 1) for z in zones]

def fetch_streams(activity_id, keys):
    """Fetch power/HR/time streams for an activity."""
    try:
        data = api(f"/activities/{activity_id}/streams?keys={','.join(keys)}&key_by_type=true")
        return {k: data[k]["data"] for k in keys if k in data}
    except Exception as e:
        print(f"  Stream error for {activity_id}: {e}")
        return {}

def process_activity(act):
    """Turn a Strava activity into our enriched format."""
    aid = act["id"]
    print(f"  Processing {aid}: {act['name']}")

    result = {
        "id": aid,
        "name": act["name"],
        "date": act["start_date_local"][:10],
        "start_time": act["start_date_local"][11:16],
        "type": act.get("sport_type", act.get("type", "Ride")),
        "duration_sec": act.get("moving_time", 0),
        "elapsed_sec": act.get("elapsed_time", 0),
        "distance_m": round(act.get("distance", 0)),
        "elevation_m": round(act.get("total_elevation_gain", 0)),
        "avg_speed_kmh": round(act.get("average_speed", 0) * 3.6, 1),
        "avg_power": act.get("average_watts"),
        "max_power": act.get("max_watts"),
        "avg_hr": act.get("average_heartrate"),
        "max_hr": act.get("max_heartrate"),
        "avg_cadence": act.get("average_cadence"),
        "kilojoules": act.get("kilojoules"),
        "has_power": act.get("device_watts", False),
        "has_hr": act.get("average_heartrate") is not None,
        "np": None,
        "power_curve": {},
        "hr_zones": [],
        "power_zones": [],
        "streams": {}
    }

    # Fetch streams if activity has power or HR
    if result["has_power"] or result["has_hr"]:
        keys = ["time", "watts", "heartrate", "cadence", "altitude", "velocity_smooth"]
        streams = fetch_streams(aid, keys)

        pw = streams.get("watts", [])
        hr = streams.get("heartrate", [])
        ts = streams.get("time", [])
        alt = streams.get("altitude", [])
        spd = [round(v * 3.6, 1) for v in streams.get("velocity_smooth", [])]

        # Downsample to ~300 pts for dashboard
        step = max(1, len(ts) // 300)
        result["streams"] = {
            "time": ts[::step],
            "watts": pw[::step] if pw else [],
            "hr": hr[::step] if hr else [],
            "altitude": alt[::step] if alt else [],
            "speed": spd[::step] if spd else [],
        }

        if pw:
            result["np"] = normalized_power(pw)
            result["power_curve"] = power_curve(pw)
            result["power_zones"] = power_zones(pw)

        if hr:
            result["hr_zones"] = hr_zones(hr)

        # HR/Power decoupling
        if pw and hr and len(pw) > 60:
            half = len(pw) // 2
            p1, p2 = pw[:half], pw[half:]
            h1, h2 = hr[:half], hr[half:]
            if all([p1, p2, h1, h2]):
                r1 = (sum(h1)/len(h1)) / (sum(p1)/len(p1))
                r2 = (sum(h2)/len(h2)) / (sum(p2)/len(p2))
                result["decoupling_pct"] = round((r2 - r1) / r1 * 100, 1)

    return result

def main():
    # Load existing data
    existing = {}
    if os.path.exists(DATA_FILE):
        with open(DATA_FILE) as f:
            data = json.load(f)
            existing = {a["id"]: a for a in data.get("activities", [])}

    print(f"Existing activities: {len(existing)}")

    # Only fetch activities since plan start — nothing older
    print(f"Fetching activities since {PLAN_START_DATE}...")
    strava_acts = api(f"/athlete/activities?per_page=60&after={PLAN_START_EPOCH}")
    cycling = [a for a in strava_acts if a.get("sport_type") in
               ("Ride", "GravelRide", "MountainBikeRide", "VirtualRide") or
               a.get("type") in ("Ride",)]

    print(f"Found {len(cycling)} cycling activities")

    activities = []
    for act in cycling:
        aid = act["id"]
        if aid in existing:
            # Already processed — reuse
            activities.append(existing[aid])
        else:
            # New activity — fetch streams
            processed = process_activity(act)
            activities.append(processed)

    # Sort by date descending
    activities.sort(key=lambda a: a["date"] + a["start_time"], reverse=True)

    # Build summary stats
    recent = [a for a in activities if a["date"] >= "2026-05-05"]
    output = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "athlete": {
            "id": 13589996,
            "name": "Wolf Harmening",
            "ftp_estimate": 240,
            "hrmax_estimate": 175,
            "weight_kg": 81
        },
        "summary": {
            "total_activities": len(activities),
            "recent_count": len(recent),
            "recent_hours": round(sum(a["duration_sec"] for a in recent) / 3600, 1),
        },
        "activities": activities
    }

    os.makedirs("data", exist_ok=True)
    with open(DATA_FILE, "w") as f:
        json.dump(output, f, indent=2)

    print(f"Saved {len(activities)} activities to {DATA_FILE}")

if __name__ == "__main__":
    main()
