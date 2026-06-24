"""
Holt taegliche Gesundheitsdaten von Garmin Connect (HRV, Ruhe-HR, Schlaf,
Body Battery, Stress) und schreibt sie nach data/health.json.
Nutzt gespeicherte Tokens aus dem GitHub Secret GARMIN_TOKENS (base64).
"""
import os, json, base64, sys
from datetime import date, timedelta

DAYS_BACK = 30          # wie viele Tage rueckwirkend holen
HEALTH_FILE = 'data/health.json'

def setup_tokens():
    blob = os.environ.get('GARMIN_TOKENS', '')
    if not blob:
        print('Kein GARMIN_TOKENS Secret gesetzt - ueberspringe Garmin')
        return False
    try:
        # Whitespace entfernen + fehlendes Base64-Padding ergaenzen
        blob = blob.strip().replace('\n', '').replace('\r', '').replace(' ', '')
        missing = len(blob) % 4
        if missing:
            blob += '=' * (4 - missing)
        decoded = base64.b64decode(blob).decode()
        tokens = json.loads(decoded)
        tdir = os.path.expanduser('~/.garth')
        os.makedirs(tdir, exist_ok=True)
        for fname, fcontent in tokens.items():
            with open(os.path.join(tdir, fname), 'w') as fh:
                fh.write(fcontent)
        print(f'Tokens entpackt: {list(tokens.keys())}')
        return True
    except Exception as e:
        print(f'Token-Setup fehlgeschlagen: {e}')
        print(f'  blob-Laenge: {len(blob)} Zeichen')
        return False

def main():
    if not setup_tokens():
        return
    try:
        import garth
    except ImportError:
        print('garth nicht installiert')
        return

    try:
        garth.resume(os.path.expanduser('~/.garth'))
        print('Garmin-Tokens geladen')
    except Exception as e:
        print(f'Token-Resume fehlgeschlagen: {e}')
        return

    # Bestehende Daten laden (merge)
    existing = {}
    if os.path.exists(HEALTH_FILE):
        try:
            with open(HEALTH_FILE) as f:
                data = json.load(f)
                existing = {d['date']: d for d in data.get('days', [])}
        except Exception:
            pass

    today = date.today()
    fetched = 0
    for i in range(DAYS_BACK):
        d = today - timedelta(days=i)
        ds = d.isoformat()
        day = existing.get(ds, {'date': ds})
        try:
            # HRV (nightly)
            hrv = garth.client.connectapi(f'/hrv-service/hrv/{ds}')
            if hrv and hrv.get('hrvSummary'):
                day['hrv'] = hrv['hrvSummary'].get('lastNightAvg')
                day['hrv_status'] = hrv['hrvSummary'].get('status')
        except Exception:
            pass
        try:
            # Sleep
            sleep = garth.client.connectapi(
                f'/wellness-service/wellness/dailySleepData?date={ds}')
            if sleep and sleep.get('dailySleepDTO'):
                dto = sleep['dailySleepDTO']
                secs = dto.get('sleepTimeSeconds')
                if secs:
                    day['sleep_h'] = round(secs/3600, 1)
                day['sleep_score'] = (dto.get('sleepScores') or {}).get('overall', {}).get('value')
        except Exception:
            pass
        try:
            # Ruhe-HR + Body Battery + Stress (alles aus daily summary)
            stats = garth.client.connectapi(
                f'/usersummary-service/usersummary/daily?calendarDate={ds}')
            if stats:
                day['resting_hr'] = stats.get('restingHeartRate')
                day['resting_hr_7d'] = stats.get('lastSevenDaysAvgRestingHeartRate')
                day['stress_avg'] = stats.get('averageStressLevel')
                day['bb_high'] = stats.get('bodyBatteryHighestValue')
                day['bb_low'] = stats.get('bodyBatteryLowestValue')
        except Exception:
            pass

        # Nur speichern wenn mind. ein Wert da ist
        if any(k in day for k in ('resting_hr','hrv','sleep_h','stress_avg')):
            existing[ds] = day
            fetched += 1

    days = sorted(existing.values(), key=lambda x: x['date'], reverse=True)
    out = {
        'updated_at': __import__('datetime').datetime.now(
            __import__('datetime').timezone.utc).isoformat(),
        'days': days,
    }
    os.makedirs('data', exist_ok=True)
    with open(HEALTH_FILE, 'w') as f:
        json.dump(out, f, indent=2)
    print(f'Garmin: {fetched} Tage aktualisiert, {len(days)} gesamt')

    # Letzte 5 Tage zur Kontrolle
    for d in days[:5]:
        print(f"  {d['date']}: HRV={d.get('hrv','-')} RestHR={d.get('resting_hr','-')} "
              f"Schlaf={d.get('sleep_h','-')}h Stress={d.get('stress_avg','-')}")

if __name__ == '__main__':
    main()
