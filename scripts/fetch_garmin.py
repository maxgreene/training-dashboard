"""
Holt taegliche Gesundheitsdaten von Garmin Connect (HRV, Ruhe-HR, Schlaf,
Body Battery, Stress) und schreibt sie nach data/health.json.
Nutzt gespeicherte Tokens aus dem GitHub Secret GARMIN_TOKENS (base64).
"""
import os
import time
import random, json, base64, sys
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
        # 429-BACKOFF (statt starrem 6h-Cooldown):
        # Der OAuth2-Token lebt nur ~1h. Ein 6h-Cooldown liess ihn zwischendurch
        # ablaufen und verhinderte die Selbstheilung. Der 429 kommt von Garmins
        # Ratenbegrenzung auf der GitHub-IP-Range, nicht vom Konto - er ist
        # zeitfenster-abhaengig. Daher: kurz warten, mit Jitter, und erst bei
        # wiederholtem Scheitern laenger. Marker speichert "timestamp;fehlversuche".
        BASE_MIN   = 40      # erste Wartezeit nach 429
        MAX_MIN    = 240     # Deckel (4h)
        JITTER     = 0.25    # +-25% Zufall, damit Versuche nicht im Raster landen
        cd_file = os.path.join('data', '.garmin_cooldown')

        def read_marker():
            try:
                raw = open(cd_file).read().strip()
                parts = raw.split(';')
                ts = float(parts[0])
                n  = int(parts[1]) if len(parts) > 1 else 1
                return ts, n
            except Exception:
                return None, 0

        def write_marker(n):
            os.makedirs('data', exist_ok=True)
            with open(cd_file, 'w') as fh:
                fh.write(f'{time.time()};{n}')

        def clear_marker():
            if os.path.exists(cd_file):
                try: os.remove(cd_file)
                except Exception: pass

        # Wartezeit aus Fehlversuchen: 40, 80, 160, 240, 240 ... Minuten
        last_ts, fails = read_marker()
        skip_refresh = False
        if last_ts:
            wait_min = min(BASE_MIN * (2 ** max(0, fails - 1)), MAX_MIN)
            wait_min *= (1 + random.uniform(-JITTER, JITTER))
            age_min = (time.time() - last_ts) / 60
            if age_min < wait_min:
                skip_refresh = True
                print(f'429-Backoff aktiv ({age_min:.0f}min/{wait_min:.0f}min, {fails} Fehlversuche) - Refresh uebersprungen')

        # Refresh NUR wenn der Token wirklich (fast) abgelaufen ist.
        tok = getattr(garth.client, 'oauth2_token', None)
        need_refresh = tok is None or tok.expired

        # Restlaufzeit des OAuth2-Tokens protokollieren. Ohne diese Zeile raten wir,
        # wie lange er haelt - und damit auch, wann der exchange-Endpunkt ueberhaupt
        # gebraucht wird. Der 429 haengt genau daran.
        try:
            exp = getattr(tok, 'expires_at', None) if tok else None
            if exp:
                rest_min = (float(exp) - time.time()) / 60
                exp_iso = datetime.fromtimestamp(float(exp), timezone.utc).strftime('%Y-%m-%d %H:%M UTC')
                if rest_min > 0:
                    print(f'OAuth2-Token laeuft ab: {exp_iso} (noch {rest_min:.0f} min, {rest_min/60:.1f} h)')
                else:
                    print(f'OAuth2-Token ABGELAUFEN seit {abs(rest_min):.0f} min ({exp_iso})')
            # OAuth1 (Master, haelt ~1 Jahr) ebenfalls im Blick behalten
            o1 = getattr(garth.client, 'oauth1_token', None)
            o1exp = getattr(o1, 'mfa_expiration_timestamp', None) if o1 else None
            print(f'OAuth1-Token vorhanden: {o1 is not None}' + (f' (mfa_exp={o1exp})' if o1exp else ''))
        except Exception as _e:
            print(f'  (Token-Restlaufzeit nicht lesbar: {_e})')

        if not need_refresh:
            print('OAuth2-Token noch gueltig - kein Refresh noetig')

        refresh_ok = False
        if need_refresh and not skip_refresh:
            try:
                garth.client.username   # triggert intern den Auto-Refresh
                print('Token-Refresh OK')
                refresh_ok = True
                clear_marker()
            except Exception as re:
                msg = str(re)
                print(f'Token-Refresh-Versuch: {msg}')
                if '429' in msg:
                    n = fails + 1
                    write_marker(n)
                    nxt = min(BASE_MIN * (2 ** max(0, n - 1)), MAX_MIN)
                    print(f'429 erkannt -> Backoff gesetzt (~{nxt}min, Fehlversuch {n})')
                else:
                    # Anderer Fehler (z.B. 401): Marker nicht setzen, aber melden.
                    print('Kein 429 - Backoff NICHT gesetzt (Token evtl. ungueltig, Neu-Login noetig)')
    except Exception as e:
        print(f'Token-Resume fehlgeschlagen: {e}')
        return

    # Token-Gueltigkeit pruefen: nur wenn der OAuth2-Token jetzt gueltig ist,
    # duerfen wir ihn spaeter ins Secret zurueckschreiben. Sonst wuerden wir das
    # Secret mit einem toten Token ueberschreiben (Teufelskreis).
    token_valid = False
    try:
        tok = getattr(garth.client, 'oauth2_token', None)
        if tok is not None and not tok.expired:
            token_valid = True
    except Exception:
        pass
    if 'refresh_ok' in dir() and refresh_ok:
        token_valid = True

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

    # Erneuerte Tokens NUR zurueck-exportieren wenn der Token gueltig ist.
    # Bei 429/totem Token NICHT exportieren -> Secret behaelt den letzten guten
    # Stand (schuetzt v.a. den langlebigen OAuth1-Token). Verhindert Teufelskreis.
    # garth.refresh_oauth2() setzt bei HTTP-Fehler oauth1_token=None. Ohne den
    # langlebigen OAuth1 waere ein exportierter Blob wertlos -> Export sperren.
    if getattr(garth.client, 'oauth1_token', None) is None:
        token_valid = False
        print('OAuth1-Token fehlt im Speicher -> Secret NICHT ueberschrieben')
    if not token_valid:
        print('Token nicht gueltig (429/abgelaufen) -> Secret NICHT ueberschrieben, alter Stand bleibt')
    try:
        if not token_valid:
            raise RuntimeError('skip-export')
        tdir = os.path.expanduser('~/.garth')
        garth.client.dump(tdir)
        tokens = {}
        for fname in os.listdir(tdir):
            fp = os.path.join(tdir, fname)
            if os.path.isfile(fp):
                with open(fp) as fh:
                    tokens[fname] = fh.read()
        blob = base64.b64encode(json.dumps(tokens).encode()).decode()
        # In GITHUB_OUTPUT schreiben, damit der Workflow das Secret updaten kann
        gh_out = os.environ.get('GITHUB_OUTPUT')
        if gh_out:
            with open(gh_out, 'a') as fh:
                fh.write(f'garmin_tokens={blob}\n')
            print('Erneuerte Tokens exportiert (fuer Secret-Update)')
    except Exception as e:
        print(f'Token-Export uebersprungen: {e}')

    # Letzte 5 Tage zur Kontrolle
    for d in days[:5]:
        print(f"  {d['date']}: HRV={d.get('hrv','-')} RestHR={d.get('resting_hr','-')} "
              f"Schlaf={d.get('sleep_h','-')}h Stress={d.get('stress_avg','-')}")

if __name__ == '__main__':
    main()
