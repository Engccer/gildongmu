"""상세 모드 closer 톤 간격을 데드밴드별로 재는 리플레이.

사용법: python3 closer-interval-replay.py <로그.gz> [데드밴드…]

`guide-diag` 로그의 fix 열에 `toneLayerStep`(Kit `GuideToneLayer.swift` ↔ 웹
`guide-tone-layer.ts`)을 다시 태워, 그 데드밴드였다면 "가까워지는 중" 톤이 언제
났을지를 복원한다. 상수 판정의 근거로 쓰므로 **재현하는 것과 못 하는 것을 여기 적어
둔다** — 재현 범위를 모르면 그 위에 세운 값 선택도 검증할 수 없다.

재현한다:
  - 4단계 추세 축(데드밴드·앵커 재설정·closer 최소 간격 2초)과 시간 감쇠.
  - 이탈·불확실 구간의 축 정지와 복귀 시 `needsRebase` **즉시 1회** 톤.
    ⚠ 이것을 빼면 톤이 실제보다 뜸하게 측정된다(간격 최대값이 특히 부풀려진다).
  - 우선 톤이 여는 3초 정숙 구간. walk에서 `imminent`가 `ahead`,
    `offRoute`가 `warning`을 동반한다는 대응으로 이벤트 열에서 복원한다.

재현하지 못한다(로그에 없는 것):
  - `motion`은 기록돼 있으나 `speedUnknown`이 다수라 정지 tick 경합은 근사다.
  - 리듀서가 실제로 낸 톤 자체(로그에 tone 열이 없다). 위 대응은 CLAUDE.md
    "임박 큐" 계약에 근거한 추정이고, car 프로파일은 40m에서 `ahead`가 나므로
    이 대응이 다르다 — 이 스크립트는 **도보 세션 판정용**이다.

따라서 산출 수치는 **근사**다. 데드밴드 간 비교(어느 쪽이 더 잦은가)는 같은 근사를
공유하므로 유효하지만, 절대 초 수를 계약값으로 승격하지 말 것.
"""

import gzip, re, sys, statistics

GRACE, SPAN, FLOOR, CLOSER_MIN, QUIET = 21.0, 21.0, 5.0, 2.0, 3.0
FOLLOWING = ("following", "bundle")
# walk에서 우선 톤을 동반하는 이벤트 → (톤, 축 재기준화 필요 여부).
PRIORITY_EVENTS = {"imminent": False, "offRoute": True}

FIX = re.compile(
    r"fix t=(?P<t>[\d.]+) .*?motion=(?P<motion>\w+) age=[\d.]+ phase=(?P<phase>\w+) "
    r"d=(?P<d>[\d.]+) event=(?P<event>\S+)"
)
TS = re.compile(r"\[(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)Z\]")


def decayed(hold, base):
    if hold <= GRACE:
        return base
    return max(FLOOR, base - (base - FLOOR) * min(1.0, (hold - GRACE) / SPAN))


def replay(rows, base):
    """closer 톤 시각 목록과 farther 횟수를 돌려준다."""
    anchor = anchor_at = last_closer = quiet_until = None
    trend = None  # 직전 추세("closer"/"farther") — 재기준 즉시 1회가 이것을 승계한다
    rebase = False
    tones, farther = [], 0
    for t, motion, phase, d, event in rows:
        x = -d  # 로그의 d는 경로상 진행 거리라 추세 축(잔여)은 부호가 반대다

        # 1단계 준용 — 추세 축이 성립하지 않는 국면은 앵커를 버리고 재기준을 예약한다.
        if phase not in FOLLOWING:
            anchor, rebase = None, True
            continue
        # 2단계 — 우선 톤은 정숙 구간을 열고, 이탈 톤은 낡은 투영이라 재기준까지 건다.
        if event in PRIORITY_EVENTS:
            quiet_until = t + QUIET
            rebase = rebase or PRIORITY_EVENTS[event]
            continue
        # 3단계 — 이벤트가 톤 자리를 소유한다.
        if event != "-":
            continue
        # 4단계 — 추세 축.
        if quiet_until is not None and t < quiet_until:
            continue
        if rebase or anchor is None:
            rebase = False
            anchor, anchor_at = x, t
            if motion != "stopped" and trend == "closer":
                last_closer = t  # 재기준 즉시 1회는 최소 간격을 거치지 않는다
                tones.append(t)
            continue
        if motion == "stopped":
            continue
        band = decayed(t - anchor_at, base)
        if x <= anchor - band:
            anchor, anchor_at, trend = x, t, "closer"
            if last_closer is None or t - last_closer >= CLOSER_MIN:
                last_closer = t
                tones.append(t)
        elif x >= anchor + band:
            anchor, anchor_at, trend = x, t, "farther"
            farther += 1
    return tones, farther


def sessions(path):
    out, cur, last_t = [], [], None
    for line in gzip.open(path, "rt", encoding="utf-8", errors="replace"):
        m = FIX.search(line)
        if not m:
            continue
        t = float(m["t"])
        if last_t is not None and (t < last_t or t - last_t > 300):
            out.append(cur)
            cur = []
        last_t = t
        ts = TS.search(line)
        cur.append(
            (t, m["motion"], m["phase"], float(m["d"]), m["event"], ts.group(1) if ts else "?")
        )
    out.append(cur)
    return [s for s in out if len(s) >= 100]


def peak_speed(rows):
    """fix 간 순간 속도의 90퍼센타일. 수단 판별은 평균으로 하면 안 된다 —
    신호 대기가 섞인 보행과 정체 주행이 같은 평균에 놓인다."""
    v = sorted(
        (b[3] - a[3]) / (b[0] - a[0])
        for a, b in zip(rows, rows[1:])
        if 0 < b[0] - a[0] <= 10 and b[3] >= a[3]
    )
    return v[int(len(v) * 0.9)] if v else 0.0


def main(path, bases):
    for s in sessions(path):
        peak = peak_speed(s)
        if peak > 4.0:  # 도보 상한(≈14km/h)을 넘으면 차량 세션이다
            continue
        span = s[-1][0] - s[0][0]
        walked = max(r[3] for r in s) - min(r[3] for r in s)
        if walked < 100:
            continue
        print(
            f"\n[{s[0][5]}Z ~ {s[-1][5]}Z] fix={len(s)} {span:.0f}s "
            f"진행 {walked:.0f}m 평균 {walked/span:.2f}m/s 최고(90p) {peak:.2f}m/s"
        )
        for base in bases:
            tones, farther = replay([r[:5] for r in s], base)
            if len(tones) < 2:
                print(f"  deadBand {base:>4.1f}m : closer {len(tones)}회 (간격 산출 불가)")
                continue
            gaps = [b - a for a, b in zip(tones, tones[1:])]
            print(
                f"  deadBand {base:>4.1f}m : closer {len(tones):>3}회 farther {farther} | "
                f"중위 {statistics.median(gaps):5.1f}s 평균 {statistics.mean(gaps):5.1f}s "
                f"최대 {max(gaps):5.1f}s | <10s {sum(g < 10 for g in gaps)} "
                f"10~15s {sum(10 <= g < 15 for g in gaps)} "
                f"15~25s {sum(15 <= g < 25 for g in gaps)} ≥25s {sum(g >= 25 for g in gaps)}"
            )


if __name__ == "__main__":
    main(sys.argv[1], [float(x) for x in sys.argv[2:]] or [10.0])
