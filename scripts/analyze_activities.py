#!/usr/bin/env python3
"""analyze_activities.py — Kennzahlen und Serie pro Fahrt.

DATENMODELL (v15)
-----------------
Quelle der Wahrheit ist immer data/streams/{id}.json (rohe Sekundendaten).
Daraus entstehen genau zwei Artefakte, ohne Ueberschneidung:

  data/activities.json      Index. Pro Fahrt alle Kennzahlen, die Listen und
                            Aggregate brauchen. Plus zwei Histogramme (Zeit je
                            Watt- bzw. HF-Eimer), aus denen das Frontend Zonen
                            LIVE rechnet - deshalb sind Zonengrenzen dort frei
                            verstellbar, ohne dass hier neu gerechnet wird.

  data/analysis/{id}.json   Eine einzige Serie in fester Aufloesung
                            (SERIES_STEP). Chart, Scatter und EF-Verlauf
                            leitet das Frontend daraus ab.

REGEL: Jede Groesse hat genau einen Ort. Nichts wird zweimal gerechnet,
nichts steht in beiden Dateien.
"""
import os, json
from datetime import datetime, timezone

# ── Parameter ────────────────────────────────────────────────────────────────
DATA_FILE    = 'data/activities.json'
STREAMS_DIR  = 'data/streams'
ANALYSIS_DIR = 'data/analysis'

ANALYSIS_VERSION = 16

FTP   = 250      # muss mit js/config.js uebereinstimmen
HRMAX = 172

SERIES_STEP = 5          # Sekunden je Punkt in analysis/{id}.json

HIST_P_STEP  = 10        # Watt je Histogramm-Eimer
HIST_P_MAX   = 1000      # darueber: Ueberlauf in den letzten Eimer
HIST_HR_MIN  = 40        # bpm, Untergrenze des HF-Histogramms
HIST_HR_STEP = 2
HIST_HR_MAX  = 200

NP_WINDOW    = 30        # Sekunden, Coggan-Standard
PC_DURATIONS = [5, 10, 30, 60, 120, 300, 600, 1200, 1800, 3600]

# Eine Luecke ist tolerierbar, wenn sie klein gegen das Messfenster ist.
# Fuer einen 5-s-Sprint zaehlt jede Sekunde; bei einem 60-Min-Block sind 2 Min
# Ampel-Halt Rauschen. Daher: Toleranz = max(GAP_MIN, GAP_FRAC * Fensterlaenge).
GAP_MIN  = 30            # s, darunter immer Sensor-Aussetzer
GAP_FRAC = 0.05          # 5 % der Fensterlaenge
MAX_GAP_SEC = GAP_MIN    # fuer die Serie/Pausenerkennung
FROZEN_HR_MIN_LEN = 180  # s: exakt konstante HF laenger als das = toter Sensor
FROZEN_HR_MIN_BPM = 50   # darunter "kein Signal", nicht "eingefroren"
TRIM_PCT          = 0.08 # Anteil vorn/hinten, der beim Decoupling wegfaellt

# Powermeter-Korrektur: 4iiii las am 30.05.2026 rund 20% zu niedrig
# (verifiziert gegen fremden Stages-PM und ueber die EF-Methode).
CALIBRATION = {18719827047: 1.247, 18717251723: 1.247}


# ── Helfer ───────────────────────────────────────────────────────────────────
def _clean_watts(watts):
    """None/negativ -> 0. Nullen BLEIBEN: sie sind echtes Coasting.
    Filtert man sie raus, werden Leistungsphasen ueber Pausen hinweg
    zusammengeklebt und alle Bestwerte systematisch ueberschaetzt."""
    return [w if isinstance(w, (int, float)) and w > 0 else 0 for w in (watts or [])]


def _rolling_means(series, window):
    """Gleitende Mittel, O(n) statt O(n*window)."""
    n = len(series)
    if n < window:
        return []
    s = sum(series[:window])
    out = [s / window]
    for i in range(window, n):
        s += series[i] - series[i - window]
        out.append(s / window)
    return out


def normalized_power(watts):
    r = _rolling_means(_clean_watts(watts), NP_WINDOW)
    if not r:
        return None
    return round((sum(x ** 4 for x in r) / len(r)) ** 0.25)


def segments(ts, max_gap=MAX_GAP_SEC):
    """Zusammenhaengende Aufzeichnungs-Abschnitte als (start, end)-Indizes.

    Wahoo-Streams sind NICHT lueckenlos: bei Pausen fehlen Sekunden im
    time-Array (eine Fahrt hatte 36 Luecken, die groesste 43 Minuten).
    Ein Schiebefenster ueber das rohe Array wuerde Punkte als benachbart
    behandeln, zwischen denen der Fahrer Kaffee getrunken hat.
    """
    if not ts:
        return []
    segs = []
    start = 0
    for i in range(1, len(ts)):
        if ts[i] - ts[i - 1] > max_gap:
            segs.append((start, i))
            start = i
    segs.append((start, len(ts)))
    return segs


def power_curve(watts, ts):
    """Mean-Maximal-Power je Zeitfenster, lueckenbewusst.

    Ein Fenster darf keine nennenswerte Pause ueberspannen, sonst entstehen
    Bestwerte, die nie am Stueck gefahren wurden (eine 8-h-Fahrt hatte 2,4 h
    Pause; der 20-Min-Bestwert war dadurch 34 W zu hoch). Die Toleranz waechst
    mit dem Fenster, sonst faellt jeder lange Wert einer Stadtfahrt weg.
    """
    series = _clean_watts(watts)
    out = {}
    for dur in PC_DURATIONS:
        tol = max(GAP_MIN, GAP_FRAC * dur)
        best = None
        for a, b in segments(ts, tol):
            seg = series[a:b]
            if len(seg) < dur:
                continue
            s = sum(seg[:dur])
            m = s
            for i in range(dur, len(seg)):
                s += seg[i] - seg[i - dur]
                if s > m:
                    m = s
            v = m / dur
            if best is None or v > best:
                best = v
        if best is not None:
            out[str(dur)] = round(best)
    return out


def hist_power(watts):
    """Sekunden je Watt-Eimer. Absolute Watt, NICHT %FTP - nur so bleiben
    Zonengrenzen im Frontend verschiebbar, auch wenn sich FTP aendert."""
    nb = HIST_P_MAX // HIST_P_STEP + 1          # letzter Eimer = Ueberlauf
    h = [0] * nb
    for w in _clean_watts(watts):
        h[min(int(w) // HIST_P_STEP, nb - 1)] += 1
    return h


def hist_hr(hr_list):
    """Sekunden je HF-Eimer ab HIST_HR_MIN."""
    nb = (HIST_HR_MAX - HIST_HR_MIN) // HIST_HR_STEP + 1
    h = [0] * nb
    for x in (hr_list or []):
        if not x or x < HIST_HR_MIN:
            continue
        h[min((int(x) - HIST_HR_MIN) // HIST_HR_STEP, nb - 1)] += 1
    return h


def strip_frozen_hr(hr):
    """Eingefrorene HF-Phasen auf None setzen.

    Ein abgerutschter oder leerer HF-Gurt wiederholt seinen letzten Wert. Eine
    ueber Minuten EXAKT konstante, plausible HF ist physiologisch unmoeglich
    und verfaelscht EF, Decoupling und HF-Zonen. Nur plausible Werte werden
    geprueft: HF unter FROZEN_HR_MIN_BPM ist "kein Signal", nicht "eingefroren".
    Leistung bleibt unberuehrt.
    """
    if not hr:
        return hr, 0
    out = list(hr)
    n = len(out)
    i = stripped = 0
    while i < n:
        if out[i] is None or out[i] < FROZEN_HR_MIN_BPM:
            i += 1
            continue
        j = i
        while j < n and out[j] == out[i]:
            j += 1
        if j - i >= FROZEN_HR_MIN_LEN:
            for k in range(i, j):
                out[k] = None
            stripped += j - i
        i = j
    return out, stripped


def resample(values, step, n_out):
    """Mittelwert je Zeitfenster. Luecken bleiben None."""
    out = []
    for k in range(n_out):
        chunk = [v for v in values[k * step:(k + 1) * step]
                 if isinstance(v, (int, float))]
        out.append(round(sum(chunk) / len(chunk)) if chunk else None)
    return out


def decoupling(watts, hr, segs):
    """EF und Pa:HR-Entkopplung, beide nach TrainingPeaks-Standard auf NP.

    EF    = NP / mittlere HF ueber die ganze Fahrt.
    Pa:HR = (EF erste Haelfte - EF zweite Haelfte) / EF erste Haelfte.
            Positiv = HF ist relativ zur Leistung gestiegen (cardiac drift).

    Vorn und hinten faellt TRIM_PCT weg: Anfahren und Ausrollen verzerren,
    weil die HF der Leistung traege folgt.
    """
    n = min(len(watts), len(hr))
    if n < 300:
        return None, None
    lo, hi = int(n * TRIM_PCT), int(n * (1 - TRIM_PCT))
    idx = [i for i in range(lo, hi) if hr[i] and hr[i] >= FROZEN_HR_MIN_BPM]
    if len(idx) < 240:
        return None, None

    def ef_of(ii):
        if len(ii) < NP_WINDOW * 2:
            return None
        r = _rolling_means([watts[i] for i in ii], NP_WINDOW)
        if not r:
            return None
        np_ = (sum(x ** 4 for x in r) / len(r)) ** 0.25
        h = sum(hr[i] for i in ii) / len(ii)
        return (np_ / h) if h else None

    mid = len(idx) // 2
    ef_all, ef1, ef2 = ef_of(idx), ef_of(idx[:mid]), ef_of(idx[mid:])
    if not ef_all:
        return None, None
    drift = round((ef1 - ef2) / ef1 * 100, 2) if (ef1 and ef2) else None
    return round(ef_all, 4), drift


def tss_of(np_val, duration_sec):
    """TSS aus NP und Dauer, gerechnet mit UNSEREM FTP.

    Wahoo liefert ein eigenes TSS, aber gerechnet mit dem FTP aus der Wahoo-App
    - der weicht ab und fehlt oft ganz (dann stand hier 0). Deshalb selbst.
    """
    # duration_sec MUSS die Bewegungszeit sein, nicht die Gesamtspanne.
    if not np_val or not duration_sec:
        return None
    return round(duration_sec * (np_val ** 2) / (FTP ** 2 * 3600) * 100, 1)


# ── Analyse einer Fahrt ──────────────────────────────────────────────────────
def analyze(aid, streams):
    ts = streams.get('time') or []
    if not ts:
        return None, None

    pw  = streams.get('watts') or []
    hr  = streams.get('heartrate') or []
    cad = streams.get('cadence') or []

    if aid in CALIBRATION and pw:
        c = CALIBRATION[aid]
        pw = [round(w * c) if w else w for w in pw]
        print(f'    [calib] watts x{c}')

    frozen = 0
    if hr:
        hr, frozen = strip_frozen_hr(hr)
        if frozen:
            print(f'    HF-Ausfall bereinigt: {frozen}s')

    segs = segments(ts)
    # moving_sec = tatsaechlich aufgezeichnete Sekunden. duration_sec aus dem
    # Wahoo-Summary ist die Gesamtspanne INKLUSIVE Pausen und taugt weder fuer
    # TSS noch fuer die Anzeige.
    moving_sec = len(ts)
    elapsed = int(ts[-1] - ts[0]) + 1 if len(ts) >= 2 else moving_sec
    m = {'has_power': bool(pw), 'has_hr': bool(hr),
         'moving_sec': moving_sec, 'elapsed_sec': elapsed}
    if len(segs) > 1:
        m['pause_sec'] = elapsed - moving_sec
    if frozen:
        m['frozen_hr_sec'] = frozen

    if pw:
        cw = _clean_watts(pw)
        m['np']          = normalized_power(pw)
        m['power_curve'] = power_curve(pw, ts)
        m['hist_p']      = hist_power(pw)
        m['avg_power']   = round(sum(cw) / len(cw), 1)      # mit Nullen
        nz = [w for w in cw if w > 0]
        m['avg_power_moving'] = round(sum(nz) / len(nz), 1) if nz else None
        m['max_power']   = max(cw) if cw else None
        m['tss']         = tss_of(m['np'], moving_sec)

    if hr:
        hv = [x for x in hr if x and x >= FROZEN_HR_MIN_BPM]
        m['hist_hr'] = hist_hr(hr)
        m['avg_hr']  = round(sum(hv) / len(hv), 1) if hv else None
        m['max_hr']  = max(hv) if hv else None

    if cad:
        cv = [c for c in cad if c and c > 20]
        m['avg_cadence'] = round(sum(cv) / len(cv), 1) if cv else None
        m['max_cadence'] = max(cv) if cv else None

    if pw and hr:
        m['ef'], m['decoupling_pct'] = decoupling(_clean_watts(pw), hr, segs)

    # Serie laeuft auf AUFZEICHNUNGSZEIT (Pausen existieren darin nicht).
    # Index i entspricht Sekunde i*SERIES_STEP der aufgezeichneten Fahrt.
    n_out = max(1, moving_sec // SERIES_STEP)
    # Pausen als [Serien-Index, Sekunden]. Damit kann das Frontend die echte
    # Zeitachse rekonstruieren und Pausen als Luecken zeigen, statt sie
    # wegzuraffen.
    gaps = []
    for a, b in segments(ts, MAX_GAP_SEC)[:-1]:
        gaps.append([b // SERIES_STEP, int(ts[b] - ts[b - 1])])
    series = {
        'id': aid, 'v': ANALYSIS_VERSION, 'step': SERIES_STEP, 'n': n_out,
        'gaps': gaps or None,
        'w':   resample(pw,  SERIES_STEP, n_out) if pw else None,
        'hr':  resample(hr,  SERIES_STEP, n_out) if hr else None,
        'cad': resample(cad, SERIES_STEP, n_out) if cad else None,
    }
    return m, series


# ── Hauptlauf ────────────────────────────────────────────────────────────────
# Felder, die analyze besitzt (werden beim Reprocess ersetzt).
OWNED = ['np', 'power_curve', 'hist_p', 'hist_hr', 'avg_power', 'avg_power_moving',
         'max_power', 'avg_hr', 'max_hr', 'avg_cadence', 'max_cadence', 'tss',
         'ef', 'decoupling_pct', 'has_power', 'has_hr', 'frozen_hr_sec',
         'moving_sec', 'elapsed_sec', 'pause_sec']
# Felder aus alten Versionen, die es nicht mehr gibt.
OBSOLETE = ['power_zones', 'hr_zones', 'ef_gesamt', 'streams', 'chart',
            'ef_series', 'scatter', 'climbs', 'gps_ok', 'has_latlng']


def main():
    if not os.path.exists(DATA_FILE):
        print('No activities.json')
        return
    with open(DATA_FILE) as f:
        data = json.load(f)
    acts = data.get('activities', [])
    os.makedirs(ANALYSIS_DIR, exist_ok=True)

    done = 0
    for act in acts:
        aid = act['id']
        sf = os.path.join(STREAMS_DIR, str(aid) + '.json')
        af = os.path.join(ANALYSIS_DIR, str(aid) + '.json')
        if not os.path.exists(sf):
            continue

        for k in OBSOLETE:
            act.pop(k, None)

        if os.path.exists(af):
            try:
                with open(af) as f:
                    if json.load(f).get('v') == ANALYSIS_VERSION and act.get('np') is not None:
                        continue
            except Exception:
                pass

        print(f"  {act.get('date','')} {(act.get('name') or '')[:22]}")
        with open(sf) as f:
            streams = json.load(f).get('streams', {})
        m, series = analyze(aid, streams)
        if not m:
            continue

        for k in OWNED:
            act.pop(k, None)
        act.update({k: v for k, v in m.items() if v is not None})

        with open(af, 'w') as f:
            json.dump(series, f, separators=(',', ':'))
        print(f"    NP={m.get('np')} TSS={m.get('tss')} EF={m.get('ef')} "
              f"Serie={series['n']}pts")
        done += 1

    data['analysis_version'] = ANALYSIS_VERSION
    data['updated_at'] = datetime.now(timezone.utc).isoformat()
    with open(DATA_FILE, 'w') as f:
        json.dump(data, f, indent=2)
    print(f'Done: {done} analysiert')


if __name__ == '__main__':
    main()
