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


def clean(v):
    """문자열 trim, 빈값/'-'은 None으로."""
    if v is None:
        return None
    s = str(v).strip()
    return s if s and s != "-" else None


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
        stations.append(rec)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    # ensure_ascii=False로 한글 그대로 — gzip 후 크기 동일, diff 가독성 ↑.
    OUT.write_text(
        json.dumps(stations, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"생성: {OUT.relative_to(ROOT)} — {len(stations)}개 역")


if __name__ == "__main__":
    main()
