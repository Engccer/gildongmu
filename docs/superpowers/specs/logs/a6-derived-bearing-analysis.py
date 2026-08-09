#!/usr/bin/env python3
"""A6 1안(위치 이력 유도 방위) 오차 전파 실측.

입력: guide-diag-2026-08-09.log.gz (도보 281 fix + 자동차 2,131 fix)
측정:
  [M1] 상대 변위 잡음 — 등속 국소 적합 잔차 (절대 acc와 대조)
  [M2] 유도 방위 절대 오차 — 자동차 고속 구간 기기 course를 기준으로 대조
  [M3] 도보 유도 방위 지터 — 양측(비인과) 기저선 대비 인과 유도 방위 편차
  [M4] 커버리지·지연 — 기저선 B 확보율, 관측 age, 정지 후 재확보 시간
  [M5] 3-state 표결 시뮬 — 도보(정상 추종)에서 mismatch 오표 비율
"""
import gzip, math, re, statistics, sys

LOG = str(__import__("pathlib").Path(__file__).parent / "guide-diag-2026-08-09.log.gz")
R = 6371000.0

def haversine(lat1, lng1, lat2, lng2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2-lat1), math.radians(lng2-lng1)
    a = math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2*R*math.asin(math.sqrt(a))

def bearing(lat1, lng1, lat2, lng2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lng2-lng1)
    y = math.sin(dl)*math.cos(p2)
    x = math.cos(p1)*math.sin(p2) - math.sin(p1)*math.cos(p2)*math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360) % 360

def angdiff(a, b):
    return abs(((a - b + 540) % 360) - 180)

pat = re.compile(
    r"t=([\d.]+) lat=([\d.-]+) lng=([\d.-]+) acc=([\d.-]+) course=([\d.-]+) "
    r"courseAcc=([\d.-]+) speed=([\d.-]+) speedAcc=([\d.-]+) motion=(\S+)")

fixes = []
with gzip.open(LOG, "rt") as f:
    for line in f:
        m = pat.search(line)
        if m:
            fixes.append(dict(
                t=float(m.group(1)), lat=float(m.group(2)), lng=float(m.group(3)),
                acc=float(m.group(4)), course=float(m.group(5)),
                courseAcc=float(m.group(6)), speed=float(m.group(7)),
                motion=m.group(9)))

# 세션 분리 (t 역행 또는 120s 초과 공백)
sessions = [[fixes[0]]]
for f in fixes[1:]:
    if f["t"] < sessions[-1][-1]["t"] or f["t"] > sessions[-1][-1]["t"] + 120:
        sessions.append([])
    sessions[-1].append(f)

def pct(v, p):
    v = sorted(v)
    if not v: return float("nan")
    k = (len(v)-1) * p
    lo, hi = math.floor(k), math.ceil(k)
    return v[lo] if lo == hi else v[lo] + (v[hi]-v[lo])*(k-lo)

print(f"세션 수: {len(sessions)}")
for i, s in enumerate(sessions):
    spd = [f["speed"] for f in s if f["speed"] >= 0]
    print(f"  세션{i}: {len(s)} fix, {s[-1]['t']-s[0]['t']:.0f}s, "
          f"speed 중위 {statistics.median(spd):.2f}m/s, "
          f"acc 중위 {statistics.median(f['acc'] for f in s):.1f}m")

walk = sessions[0]
cars = [s for s in sessions[1:]]

# ── M1: 상대 변위 잡음 — 등속 국소 적합(±5s) 잔차 ──────────────────
def cv_residuals(sess, half=5.0):
    """각 fix에 대해 ±half초 이웃으로 lat/lng ~ t 선형 적합, 잔차 거리(m)."""
    res = []
    ts = [f["t"] for f in sess]
    lat0 = sess[0]["lat"]
    mlat = 111320.0
    mlng = 111320.0 * math.cos(math.radians(lat0))
    for i, f in enumerate(sess):
        nb = [g for g in sess if abs(g["t"]-f["t"]) <= half]
        if len(nb) < 5: continue
        n = len(nb)
        st = sum(g["t"] for g in nb); stt = sum(g["t"]**2 for g in nb)
        det = n*stt - st*st
        if det == 0: continue
        rx = ry = 0.0
        for coord, scale in (("lat", mlat), ("lng", mlng)):
            sv = sum(g[coord] for g in nb); stv = sum(g["t"]*g[coord] for g in nb)
            b = (n*stv - st*sv) / det
            a = (sv - b*st) / n
            pred = a + b*f["t"]
            d = (f[coord] - pred) * scale
            if coord == "lat": ry = d
            else: rx = d
        res.append(math.hypot(rx, ry))
    return res

for name, sess in [("도보", walk)] + [(f"자동차{i+1}", s) for i, s in enumerate(cars)]:
    r = cv_residuals(sess)
    print(f"[M1] {name} 등속 잔차(상대 잡음): 중위 {statistics.median(r):.2f}m, "
          f"p90 {pct(r,0.9):.2f}m, p99 {pct(r,0.99):.2f}m  (보고 acc 중위 "
          f"{statistics.median(f['acc'] for f in sess):.1f}m)")

# ── 유도 방위: 인과(뒤로 기저선 B 확보) ──────────────────────────────
def derived_bearings(sess, B, max_age=30.0):
    """fix i마다 가장 가까운 과거 fix j (거리>=B, age<=max_age)에서 bearing.
    반환: index -> (bearing, age, dist)"""
    out = {}
    for i, f in enumerate(sess):
        for j in range(i-1, -1, -1):
            g = sess[j]
            age = f["t"] - g["t"]
            if age > max_age: break
            d = haversine(g["lat"], g["lng"], f["lat"], f["lng"])
            if d >= B:
                out[i] = (bearing(g["lat"], g["lng"], f["lat"], f["lng"]), age, d)
                break
    return out

# ── M2: 자동차 고속 구간 — 기기 course(신뢰 가능)와 대조 ──────────────
print("\n[M2] 유도 방위 절대 오차 — 자동차 기기 course 기준 (speed>=5, courseAcc<=20)")
for B in (5, 10, 15, 20):
    errs = []
    turn_errs = []   # 회전 중(기기 course 변화율 큰 구간)
    for s in cars:
        db = derived_bearings(s, B)
        for i, (b, age, d) in db.items():
            f = s[i]
            if f["speed"] < 5 or f["courseAcc"] < 0 or f["courseAcc"] > 20: continue
            e = angdiff(b, f["course"])
            # 회전 판정: 직전 5초 기기 course 변화 > 20°
            prev = [g for g in s if 0 < f["t"]-g["t"] <= 5 and g["course"] >= 0]
            turning = prev and angdiff(prev[0]["course"], f["course"]) > 20
            (turn_errs if turning else errs).append(e)
    if errs:
        print(f"  B={B:2d}m 직진 n={len(errs):4d}: 중위 {statistics.median(errs):5.1f}° "
              f"p90 {pct(errs,0.9):5.1f}° p99 {pct(errs,0.99):5.1f}°   "
              f"회전 n={len(turn_errs):3d}: 중위 {statistics.median(turn_errs) if turn_errs else float('nan'):5.1f}° "
              f"p90 {pct(turn_errs,0.9) if turn_errs else float('nan'):5.1f}°")

# ── M3: 도보 지터 — 양측(비인과 ±B) 기준 대비 인과 유도 방위 ──────────
print("\n[M3] 도보 유도 방위 vs 양측 평활 기준 (기준: 뒤 B ~ 앞 B 변위 방위)")
def twosided_ref(sess, B):
    out = {}
    for i, f in enumerate(sess):
        back = fwd = None
        for j in range(i-1, -1, -1):
            if haversine(sess[j]["lat"], sess[j]["lng"], f["lat"], f["lng"]) >= B:
                back = sess[j]; break
        for j in range(i+1, len(sess)):
            if haversine(sess[j]["lat"], sess[j]["lng"], f["lat"], f["lng"]) >= B:
                fwd = sess[j]; break
        if back and fwd:
            out[i] = bearing(back["lat"], back["lng"], fwd["lat"], fwd["lng"])
    return out

for B in (5, 10, 15, 20):
    db = derived_bearings(walk, B)
    ref = twosided_ref(walk, 10)
    devs = [angdiff(db[i][0], ref[i]) for i in db if i in ref]
    over60 = sum(1 for d in devs if d > 60) / len(devs) * 100 if devs else float("nan")
    over45 = sum(1 for d in devs if d > 45) / len(devs) * 100 if devs else float("nan")
    print(f"  B={B:2d}m n={len(devs):3d}: 중위 {statistics.median(devs):5.1f}° "
          f"p90 {pct(devs,0.9):5.1f}° p99 {pct(devs,0.99):5.1f}°  >45°: {over45:4.1f}%  >60°: {over60:4.1f}%")

# 대조: 도보 기기 course의 같은 지표
ref = twosided_ref(walk, 10)
dev_course = [angdiff(f["course"], ref[i]) for i, f in enumerate(walk)
              if i in ref and f["course"] >= 0]
print(f"  [대조] 기기 course n={len(dev_course)}: 중위 {statistics.median(dev_course):.1f}° "
      f"p90 {pct(dev_course,0.9):.1f}°  >60°: {sum(1 for d in dev_course if d>60)/len(dev_course)*100:.1f}%")

# ── M4: 커버리지·지연 ────────────────────────────────────────────────
print("\n[M4] 도보 커버리지·지연 (max_age=30s)")
for B in (5, 10, 15, 20):
    db = derived_bearings(walk, B)
    cov = len(db) / len(walk) * 100
    ages = [v[1] for v in db.values()]
    print(f"  B={B:2d}m: 커버리지 {cov:5.1f}%  age 중위 {statistics.median(ages):4.1f}s "
          f"p90 {pct(ages,0.9):4.1f}s")
db10 = derived_bearings(walk, 10)
print(f"  [대조] 기기 course valid(courseAcc<=12° 축 통과): "
      f"{sum(1 for f in walk if 0 <= f['courseAcc'] <= 12)}/{len(walk)} fix")
print(f"  [대조] 기기 course courseAcc<=45°: "
      f"{sum(1 for f in walk if 0 <= f['courseAcc'] <= 45)}/{len(walk)} fix")

# ── M5: 3-state 표결 시뮬 — 도보는 정상 추종이므로 mismatch = 오표 ────
print("\n[M5] 도보 표결 시뮬 (기준 접선 = 양측 평활 ±10m, 임계 60°, 불확실성 U 고정)")
for B in (10, 15):
    db = derived_bearings(walk, B)
    ref = twosided_ref(walk, 10)
    for U in (15, 25, 35):
        votes = {"mismatch": 0, "match": 0, "unknown": 0}
        for i, (b, age, d) in db.items():
            if i not in ref: continue
            delta = angdiff(b, ref[i])
            if delta - U > 60: votes["mismatch"] += 1
            elif delta + U < 60: votes["match"] += 1
            else: votes["unknown"] += 1
        tot = sum(votes.values())
        if tot:
            print(f"  B={B}m U={U:2d}°: match {votes['match']/tot*100:5.1f}%  "
                  f"unknown {votes['unknown']/tot*100:5.1f}%  "
                  f"mismatch(오표) {votes['mismatch']/tot*100:5.1f}%  (n={tot})")

# ── 부록: 도보 세션 정지 구간과 재확보 ──────────────────────────────
stops = 0; regain = []
in_stop = False; stop_end_t = None
db10 = derived_bearings(walk, 10)
idx_with = sorted(db10.keys())
for i, f in enumerate(walk):
    slow = f["speed"] >= 0 and f["speed"] < 0.3
    if slow and not in_stop:
        in_stop = True; stops += 1
    elif not slow and in_stop:
        in_stop = False
        nxt = [j for j in idx_with if j >= i]
        if nxt: regain.append(walk[nxt[0]]["t"] - f["t"])
print(f"\n[부록] 도보 정지(<0.3m/s) 구간 {stops}회, 재출발→유도방위 재확보 중위 "
      f"{statistics.median(regain) if regain else float('nan'):.1f}s")
