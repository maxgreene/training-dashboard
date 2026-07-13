"""
Holt taegliche Gesundheitsdaten von Garmin Connect (HRV, Ruhe-HR, Schlaf,
Body Battery, Stress) und schreibt sie nach data/health.json.
Nutzt gespeicherte Tokens aus dem GitHub Secret GARMIN_TOKENS (base64).
"""
import os
import time
import json, base64, sys
from datetime import datetime, timezone, date, timedelta

PLAN_START = '2026-05-04'   # ab hier wird (einmalig) alles geholt
REFRESH_TAIL = 5            # die letzten N Tage immer neu holen (Sync-Nachlauf)
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

        # HINWEIS: Der Token-Refresh (exchange) laeuft NICHT mehr hier.
        # Garmins exchange-Endpunkt blockt GitHub-Runner-IPs mit 429.
        # Ein Cron auf dem Lab-Server ukb457 (unverdaechtige IP) erneuert den
        # Token und schiebt ihn ins Secret GARMIN_TOKENS. Dieser Workflow LIEST
        # den Token nur noch und holt Daten. Kein Refresh, kein Backoff, kein
        # Zurueckschreiben - all das kann von GitHub-IPs aus nicht zuverlaessig.
        tok = getattr(garth.client, 'oauth2_token', None)
        try:
            exp = getattr(tok, 'expires_at', None) if tok else None
            if exp:
                rest_min = (float(exp) - time.time()) / 60
                exp_iso = datetime.fromtimestamp(float(exp), timezone.utc).strftime('%Y-%m-%d %H:%M UTC')
                if rest_min > 0:
                    print(f'OAuth2-Token laeuft ab: {exp_iso} (noch {rest_min:.0f} min) - vom Server gepflegt')
                else:
                    print(f'OAuth2-Token ABGELAUFEN seit {abs(rest_min):.0f} min ({exp_iso})')
                    print('  -> Server-Refresh (ukb457) haengt? Log dort pruefen: ~/garmin-refresh/refresh.log')
        except Exception as _e:
            print(f'  (Token-Restlaufzeit nicht lesbar: {_e})')
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
    # Welche Tage muessen geholt werden?
    # - Alle Tage von PLAN_START bis heute, die noch NICHT in existing sind
    # - PLUS die letzten REFRESH_TAIL Tage (immer neu, da Garmin spaet synct)
    plan_start = date.fromisoformat(PLAN_START)
    span_days = (today - plan_start).days + 1
    tail_dates = {(today - timedelta(days=i)).isoformat() for i in range(REFRESH_TAIL)}
    to_fetch = []
    for i in range(span_days):
        ds = (today - timedelta(days=i)).isoformat()
        if ds not in existing or ds in tail_dates:
            to_fetch.append(ds)
    print(f'Zu holen: {len(to_fetch)} Tage (von {len(existing)} bereits vorhanden, '
          f'Spanne seit {PLAN_START})')

    fetched = 0
    for ds in to_fetch:
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

        # DIAGNOSE-LOG: zeigt was die API pro Tag geliefert hat (fuer Debug)
        _got = [k for k in ('hrv','resting_hr','sleep_h','stress_avg','bb_high') if day.get(k) is not None]
        print(f'    {ds}: {_got if _got else "LEER (API gibt nichts zurueck)"}')

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
    # DEPLOY-LAST SENKEN: updated_at nur neu setzen wenn sich die Health-Daten
    # geaendert haben. Sonst bleibt health.json bit-identisch -> kein Commit ->
    # kein Deploy. Verhindert Deploy bei jedem Garmin-Lauf ohne neue Werte.
    if os.path.exists(HEALTH_FILE):
        try:
            with open(HEALTH_FILE) as f:
                prev = json.load(f)
            if json.dumps(prev.get('days'), sort_keys=True) == json.dumps(days, sort_keys=True):
                out['updated_at'] = prev.get('updated_at', out['updated_at'])
                print('Keine Health-Aenderung -> updated_at unveraendert (kein Deploy)')
        except Exception as e:
            print(f'  (Health-Vergleich fehlgeschlagen: {e})')

    os.makedirs('data', exist_ok=True)
    with open(HEALTH_FILE, 'w') as f:
        json.dump(out, f, indent=2)
    print(f'Garmin: {fetched} Tage aktualisiert, {len(days)} gesamt')

    # Token-Export entfaellt: Der Server (ukb457) pflegt das Secret GARMIN_TOKENS.
    # Dieser Workflow schreibt es NICHT mehr zurueck.

    # Letzte 5 Tage zur Kontrolle
    for d in days[:5]:
        print(f"  {d['date']}: HRV={d.get('hrv','-')} RestHR={d.get('resting_hr','-')} "
              f"Schlaf={d.get('sleep_h','-')}h Stress={d.get('stress_avg','-')}")

if __name__ == '__main__':
    main()
