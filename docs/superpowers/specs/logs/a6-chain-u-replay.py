#!/usr/bin/env python3
"""사슬 자기일관성 U 검증: U = atan((중간 fix의 chord 수직 편차 최대 + 여유)/chord 길이).

회전 중엔 사슬이 굽어 U가 커져 자동으로 unknown이 되는지, 직진에선 U가 작아
decisive 표가 유지되는지, 도보(정상 추종)에서 mismatch 오표가 없는지를 잰다.
"""
import gzip, math, re, statistics

LOG = str(__import__("pathlib").Path(__file__).parent / "guide-diag-2026-08-09.log.gz")
R = 6371000.0

def hav(a, b):
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp, dl = math.radians(b[0]-a[0]), math.radians(b[1]-a[1])
    h = math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2*R*math.asin(math.sqrt(h))

def brg(a, b):
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dl = math.radians(b[1]-a[1])
    y = math.sin(dl)*math.cos(p2)
    x = math.cos(p1)*math.sin(p2) - math.sin(p1)*math.cos(p2)*math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360) % 360

def angdiff(a, b):
    return abs(((a - b + 540) % 360) - 180)

pat = re.compile(r"t=([\d.]+) lat=([\d.-]+) lng=([\d.-]+) acc=([\d.-]+) course=([\d.-]+) courseAcc=([\d.-]+) speed=([\d.-]+)")
fixes = []
with gzip.open(LOG, "rt") as f:
    for line in f:
        m = pat.search(line)
        if m:
            fixes.append((float(m.group(1)), float(m.group(2)), float(m.group(3)),
                          float(m.group(4)), float(m.group(5)), float(m.group(6)), float(m.group(7))))
sessions = [[fixes[0]]]
for x in fixes[1:]:
    if x[0] < sessions[-1][-1][0] or x[0] > sessions[-1][-1][0] + 120:
        sessions.append([])
    sessions[-1].append(x)
walk = sessions[0]

B, MAX_AGE, U_FLOOR, MARGIN_M = 10.0, 30.0, 8.0, 1.5

def observe(sess, i):
    """fix i의 유도 방위 관측: (bearing, U) 또는 None."""
    t, lat, lng = sess[i][0], sess[i][1], sess[i][2]
    for j in range(i-1, -1, -1):
        age = t - sess[j][0]
        if age > MAX_AGE: return None
        d = hav((sess[j][1], sess[j][2]), (lat, lng))
        if d >= B:
            b = brg((sess[j][1], sess[j][2]), (lat, lng))
            # 중간 fix의 chord 수직 편차 최대
            maxdev = 0.0
            for k in range(j+1, i):
                # chord 시점에서 중간점까지의 각·거리로 수직 성분
                dk = hav((sess[j][1], sess[j][2]), (sess[k][1], sess[k][2]))
                if dk == 0: continue
                bk = brg((sess[j][1], sess[j][2]), (sess[k][1], sess[k][2]))
                dev = abs(dk * math.sin(math.radians(bk - b)))
                maxdev = max(maxdev, dev)
            U = max(U_FLOOR, math.degrees(math.atan((maxdev + MARGIN_M) / d)))
            return (b, U, d, maxdev)
    return None

# 양측 평활 기준(±10m)
def ref_at(sess, i):
    back = fwd = None
    for j in range(i-1, -1, -1):
        if hav((sess[j][1], sess[j][2]), (sess[i][1], sess[i][2])) >= 10: back = j; break
    for j in range(i+1, len(sess)):
        if hav((sess[j][1], sess[j][2]), (sess[i][1], sess[i][2])) >= 10: fwd = j; break
    if back is None or fwd is None: return None
    return brg((sess[back][1], sess[back][2]), (sess[fwd][1], sess[fwd][2]))

for TH in (45, 60):
    votes = {"mismatch": 0, "match": 0, "unknown": 0}
    us = []
    none_cnt = 0
    for i in range(len(walk)):
        o = observe(walk, i)
        r = ref_at(walk, i)
        if o is None or r is None:
            none_cnt += 1; continue
        b, U, d, maxdev = o
        us.append(U)
        delta = angdiff(b, r)
        if delta - U > TH: votes["mismatch"] += 1
        elif delta + U < TH: votes["match"] += 1
        else: votes["unknown"] += 1
    tot = sum(votes.values())
    print(f"임계 {TH}°: 관측 없음 {none_cnt}, match {votes['match']/tot*100:.1f}%, "
          f"unknown표 {votes['unknown']/tot*100:.1f}%, mismatch 오표 {votes['mismatch']/tot*100:.1f}% "
          f"(n={tot}), U 중위 {statistics.median(us):.1f}° p90 {sorted(us)[int(len(us)*0.9)]:.1f}°")

# 합성 이탈: 도보 잡음을 그대로 쓰되 t0 이후 궤적을 각도 θ만큼 회전(갈림 시뮬)
# → 검출 지연(첫 mismatch 표와 창 확정)을 추정한다.
print("\n[합성 이탈] t0=120s에서 궤적을 θ 회전, 기준 방위는 회전 전 기준 유지")
def rotate_after(sess, t0, theta):
    """t0 이후 fix를 t0 시점 위치 중심으로 theta도 회전 → 갈림 궤적 합성."""
    out = []
    pivot = None
    th = math.radians(theta)
    for x in sess:
        if x[0] < t0 or pivot is None and x[0] >= t0:
            if x[0] >= t0 and pivot is None:
                pivot = (x[1], x[2])
            out.append(list(x)); continue
        dy = (x[1] - pivot[0]) * 111320.0
        dx = (x[2] - pivot[1]) * 111320.0 * math.cos(math.radians(pivot[0]))
        ry = dy*math.cos(th) - dx*math.sin(th)
        rx = dy*math.sin(th) + dx*math.cos(th)
        y = list(x)
        y[1] = pivot[0] + ry/111320.0
        y[2] = pivot[1] + rx/(111320.0*math.cos(math.radians(pivot[0])))
        out.append(y)
    return out

WINDOW_S, MIN_SPAN, MIN_VOTES, CONFIRM = 20.0, 16.0, 8, 0.7
for theta in (45, 60, 90):
    for TH in (45, 60):
        rot = rotate_after(walk, walk[0][0]+120, theta)
        # 기준(경로 접선)은 원 궤적의 양측 평활 — 이탈 후에도 경로는 원래 방향
        samples = []
        confirm_t = None
        first_mismatch = None
        for i in range(len(rot)):
            t = rot[i][0]
            o = observe(rot, i)
            r = ref_at(walk, i)  # 원 궤적 기준 = 경로 방향
            if o is None or r is None: continue
            b, U, d, maxdev = o
            delta = angdiff(b, r)
            if delta - U > TH: v = "mismatch"
            elif delta + U < TH: v = "match"
            else: v = "unknown"
            if v == "mismatch" and t >= walk[0][0]+120 and first_mismatch is None:
                first_mismatch = t - (walk[0][0]+120)
            samples = [s for s in samples if s[0] > t - WINDOW_S] + [(t, v)]
            dec = [s for s in samples if s[1] != "unknown"]
            if (len(dec) >= MIN_VOTES and len(dec)/len(samples) >= 0.8
                    and dec[-1][0]-dec[0][0] >= MIN_SPAN
                    and sum(1 for s in dec if s[1] == "mismatch")/len(dec) >= CONFIRM
                    and t >= walk[0][0]+120 and confirm_t is None):
                confirm_t = t - (walk[0][0]+120)
        print(f"  θ={theta}° 임계{TH}°: 첫 mismatch {first_mismatch and f'{first_mismatch:.0f}s'}, "
              f"창 확정 {confirm_t and f'{confirm_t:.0f}s'}")
