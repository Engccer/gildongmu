#!/usr/bin/env python3
"""전국 도시철도역사정보 표준데이터(XLSX) → 정적 JSON seed 변환기.

A3 받침대: 1,099개 도시철도역의 한/영/한자 역명 + WGS84 좌표 + 노선·환승·주소.
출처: 국가철도공단 레일포털(data.kric.go.kr) "전체_도시철도역사정보" XLSX.
공공데이터포털 표준데이터 15013205의 실제 제공 파일(연간 갱신, 차기 2026-12).

이 데이터는 OpenAPI가 아니라 연 1회 갱신 XLSX라 정적 seed가 정답이다.
갱신 시: 레일포털에서 최신 XLSX를 내려받아 INPUT 경로만 바꿔 재실행.

의존: openpyxl (pip3 install openpyxl). 일회성 갱신 도구라 프로젝트 런타임 의존 아님.
사용: python3 scripts/build-subway-stations.py <xlsx경로>

생성물: src/lib/data/subway-stations.json (역 레코드 배열 + 메타)
"""
import json
import re
import sys
from pathlib import Path

import openpyxl

# XLSX 컬럼 순서(2026-02-28 기준 헤더와 일치):
# 역번호, 역사명, 노선번호, 노선명, 영문역사명, 한자역사명, 환승역구분,
# 환승노선번호, 환승노선명, 역위도, 역경도, 운영기관명, 역사도로명주소,
# 역사전화번호, 데이터기준일자
COL = {
    "stationId": 0,
    "name": 1,
    "lineName": 3,
    "nameEn": 4,
    "nameHanja": 5,
    "transferType": 6,
    "transferLines": 8,
    "lat": 9,
    "lng": 10,
    "operator": 11,
    "roadAddress": 12,
}

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "src" / "lib" / "data" / "subway-stations.json"

# 원본 데이터 결함 보정 — (역명, 노선명) → (lat, lng).
# 2026-08-02 실측: 경의중앙선 양원역(서울 중랑구 망우동) 레코드에 **동명이역인
# 영동선 양원역(경북 봉화군 소천면)의 좌표**가 들어 있다. 주소 컬럼은 서울인데
# 좌표만 250km 떨어진 산간이라, 중랑구 사용자에게는 그 역이 영영 검색되지 않고
# 봉화 산간에서는 있지도 않은 수도권 전철역이 잡힌다.
# 보정 좌표 출처: 카카오 로컬 "양원역 경의중앙선"(서울 중랑구 망우동 269-5).
#
# 2026-08-10 실측: 4호선 이촌(국립중앙박물관) 레코드에 **한 정거장 옆 신용산역의
# 좌표**(신용산 레코드와 13m 차)가 들어 있다. 주소 컬럼은 올바른 이촌역 주소
# ("서빙고로 지하83")인데 좌표만 907m 밖이라, 신용산역 앞에서 이촌역이 8m 최근접
# 1순위로 잡히고 실거리 1km의 역이 370m로 안내됐다(CLI 실사용 재현 3건).
# 보정 좌표 출처: 카카오 로컬 "이촌역 4호선"(서울 용산구 서빙고로 지하 83).
COORD_FIXES = {
    ("양원역", "경의중앙선"): (37.606606, 127.107946),
    ("이촌(국립중앙박물관)", "4호선"): (37.522373, 126.974520),
}

# 좌표 혼입 가드 — **노선 내 연속성**으로 본다.
# 도시철도 노선은 역들이 이어져 있어 같은 노선의 최근접 역까지 거리가 짧다
# (2026-08-02 실측 최대 11.1km, 대경선 경산역). 동명이역 좌표가 섞이면 그 역만
# 노선에서 수백 km 떨어지므로 이 한 축으로 잡힌다.
#
# 주소 컬럼으로 판정하지 않는 이유: 원본의 주소 형식이 지역마다 달라 커버리지가
# 뚫린다 — 대구 94개 역은 주소가 "동구 안심로…"처럼 시도 접두 없이 시작해 매칭이
# 0%였고, 경기도 268건은 광역시가 아니라 아예 대상 밖이었다. 노선 연속성은 주소
# 형식과 무관해 1,098건 전부를 검사한다.
#
# 임계값 30km: 정상 최대 11.1km의 약 3배이고, 양원역 실오류는 141.4km였다
# (변이 주입으로 검출 확인). 오탐 0 · 미탐 0.
MAX_LINE_GAP_KM = 30

# 환승 쌍 거리 가드 — 노선 연속성의 사각(인접역 좌표 혼입)을 막는 둘째 축.
# 2026-08-10 실사고: 4호선 이촌역 레코드에 **한 정거장 옆 신용산역의 좌표**가
# 들어 있었다(오차 907m). 잘못된 좌표조차 같은 노선의 인접역 위라 노선 연속성은
# 정의상 정상으로 보인다 — 그래서 같은 이름으로 서로 환승역이라 선언된 레코드
# 쌍은 한 역 복합이므로 가까워야 한다는 축을 더한다.
# 임계값 600m 근거(전 seed 실측): 정당 환승 복합 최대 435m(서울역 1호선↔경의중앙선),
# 이촌 실오류 907m. 비환승 동명(신촌 2호선 vs 경의중앙선 701m — 실제 별개 역)은
# 両레코드 isTransfer=False라 검사 대상 밖이다.
# 상한 30km: 타 도시 동명이역이 양쪽 다 환승역인 경우(교대 — 서울 2·3호선과
# 부산 1호선·동해선, 315km)는 혼입이 아니므로 제외한다. 인접역 혼입의 오차는
# 정의상 수 km 이내이고, 30km 초과 이탈은 노선 연속성 축(MAX_LINE_GAP_KM)의
# 관할이라 두 가드가 30km 경계에서 상보적이다.
MAX_TRANSFER_GAP_M = 600


def clean(v):
    """문자열 trim, 빈값/'-'은 None으로."""
    if v is None:
        return None
    s = str(v).strip()
    return s if s and s != "-" else None


def haversine_km(lat1, lng1, lat2, lng2):
    from math import asin, cos, radians, sin, sqrt

    p1, p2 = radians(lat1), radians(lat2)
    dp, dl = radians(lat2 - lat1), radians(lng2 - lng1)
    h = sin(dp / 2) ** 2 + cos(p1) * cos(p2) * sin(dl / 2) ** 2
    return 2 * 6371 * asin(sqrt(h))


def line_outliers(stations):
    """같은 노선의 최근접 역까지 MAX_LINE_GAP_KM을 넘는 역들(사유 문자열 목록)."""
    by_line = {}
    for rec in stations:
        by_line.setdefault(rec["lineName"], []).append(rec)
    out = []
    for line, group in by_line.items():
        if len(group) < 2:
            continue  # 단독 역 노선은 비교 대상이 없다(현재 0개)
        for rec in group:
            gap = min(
                haversine_km(rec["lat"], rec["lng"], o["lat"], o["lng"])
                for o in group
                if o is not rec
            )
            if gap > MAX_LINE_GAP_KM:
                out.append(
                    f"{rec['name']}({line}) 좌표=({rec['lat']}, {rec['lng']}) 같은 노선 최근접 {gap:.0f}km"
                )
    return out


def base_name(name):
    """동명 판정용 코어 — 괄호 부가명과 '역' 접미를 벗긴다."""
    core = re.sub(r"\(.*?\)", "", name).strip()
    return core[:-1] if core.endswith("역") else core


def transfer_pair_outliers(stations):
    """동명이고 한쪽 이상 환승인 레코드 쌍이 MAX_TRANSFER_GAP_M을 넘는 경우.

    両환승이 아니라 "한쪽 이상"인 이유: 원본의 환승역구분 플래그가 비대칭인
    실환승 쌍이 17건 있다(보문·석촌·신림 등 — 한쪽 노선 레코드만 환승역 표기).
    両환승 조건은 그 17건을 검사 밖에 두고, 완화해도 오탐은 0건(실측 —
    비환승 동명 신촌은 両False라 여전히 제외된다).
    """
    by_name = {}
    for rec in stations:
        by_name.setdefault(base_name(rec["name"]), []).append(rec)
    out = []
    for name, group in by_name.items():
        for i, a in enumerate(group):
            for b in group[i + 1:]:
                if not (a["isTransfer"] or b["isTransfer"]):
                    continue
                gap_m = haversine_km(a["lat"], a["lng"], b["lat"], b["lng"]) * 1000
                if MAX_TRANSFER_GAP_M < gap_m <= MAX_LINE_GAP_KM * 1000:
                    out.append(
                        f"{name} 환승 쌍 {a['lineName']}({a['lat']}, {a['lng']}) ↔ "
                        f"{b['lineName']}({b['lat']}, {b['lng']}) 거리 {gap_m:.0f}m"
                    )
    return out


def main():
    if len(sys.argv) < 2:
        print("사용: python3 scripts/build-subway-stations.py <xlsx경로>", file=sys.stderr)
        sys.exit(2)
    src = Path(sys.argv[1]).expanduser()
    if not src.exists():
        print(f"파일 없음: {src}", file=sys.stderr)
        sys.exit(1)

    wb = openpyxl.load_workbook(src, read_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    header = rows[0]
    # 헤더 정합성 가드 — 컬럼 순서가 바뀌면 즉시 중단(잘못된 좌표 매핑 방지).
    expect = ["역번호", "역사명", "노선번호", "노선명", "영문역사명", "한자역사명",
              "환승역구분", "환승노선번호", "환승노선명", "역위도", "역경도",
              "운영기관명", "역사도로명주소", "역사전화번호", "데이터기준일자"]
    actual = [clean(h) for h in header]
    if actual != expect:
        print("헤더 불일치 — 컬럼 매핑 재확인 필요", file=sys.stderr)
        print("  기대:", expect, file=sys.stderr)
        print("  실제:", actual, file=sys.stderr)
        sys.exit(1)

    stations = []
    for r in rows[1:]:
        lat, lng = r[COL["lat"]], r[COL["lng"]]
        # 좌표는 필수 — 받침대의 핵심(근접 검색). 숫자 아니면 스킵.
        if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
            continue
        rec = {
            "stationId": clean(r[COL["stationId"]]),  # int/str 혼합 → 문자열 통일
            "name": clean(r[COL["name"]]),
            "nameEn": clean(r[COL["nameEn"]]),
            "lineName": clean(r[COL["lineName"]]),
            "lat": round(float(lat), 6),
            "lng": round(float(lng), 6),
            "operator": clean(r[COL["operator"]]),
            "roadAddress": clean(r[COL["roadAddress"]]),
            "isTransfer": clean(r[COL["transferType"]]) == "환승역",
        }
        hanja = clean(r[COL["nameHanja"]])
        if hanja:
            rec["nameHanja"] = hanja
        transfer = clean(r[COL["transferLines"]])
        if transfer:
            rec["transferLines"] = transfer
        fix = COORD_FIXES.get((rec["name"], rec["lineName"]))
        if fix:
            rec["lat"], rec["lng"] = fix
        stations.append(rec)

    # 보정 후에도 남은 이상치는 **중단**한다. 잘못된 좌표는 조용히 통과하면
    # "그 역이 검색되지 않는다"는 형태로만 드러나 원인을 찾기 어렵다(양원역 실사고).
    # 새 이상치를 만나면 실좌표를 확인해 COORD_FIXES에 추가하고 재실행할 것.
    outliers = line_outliers(stations) + transfer_pair_outliers(stations)
    if outliers:
        print(f"의심 좌표 {len(outliers)}건 — COORD_FIXES 보강 필요", file=sys.stderr)
        for m in outliers:
            print("  ", m, file=sys.stderr)
        sys.exit(1)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    # ensure_ascii=False로 한글 그대로 — gzip 후 크기 동일, diff 가독성 ↑.
    OUT.write_text(
        json.dumps(stations, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"생성: {OUT.relative_to(ROOT)} — {len(stations)}개 역")


if __name__ == "__main__":
    main()
