#!/usr/bin/env python3
"""서울교통공사 음성유도기 CSV(OA-22526) → 정적 seed JSON.

다운로드부터 수행(재현 가능). cp949, 컬럼: 연번,호선,외부역번호,역명,설치위치.
역명 괄호 병기("서울역 (1)")를 제거하고 정규화 키(소문자·역 접미 제거)를 사전 계산한다.
갱신: 수동 재실행(연 1회 관례). 산출물 asOf는 원본 파일명 기준일.

normalize()는 src/lib/station-match.ts의 normalizeStationName과 동일 규칙이어야
한다(키 사전 계산이 런타임 매칭과 일치해야 함). 수정 시 양쪽을 함께 고친다.
"""
import csv, io, json, re, urllib.request, urllib.parse

URL = "https://datafile.seoul.go.kr/bigfile/iot/inf/nio_download.do?&useCache=false"
BODY = urllib.parse.urlencode({"infId": "OA-22526", "seq": "1", "infSeq": "2"}).encode()
AS_OF = "2025-08"  # 원본 파일명 …_20250812.csv, 갱신 시 함께 수정
# ⚠ messages/*.json의 subway.voiceGuideSource(5로케일)에 이 기준일이 하드코딩되어
# 있다(VOICE_GUIDES_AS_OF는 서버 전용이라 클라이언트 컴포넌트에서 import 불가).
# AS_OF를 갱신하면 5로케일 문구도 함께 수동 갱신할 것.


def normalize(name: str) -> str:
    n = re.sub(r"\s*\([^)]*\)", "", name).strip()
    n = re.sub(r"(?:\s+(?:\S*(?:선|철도)|GTX-\S*))+$", "", n, flags=re.I).strip()
    n = re.sub(r"\s*station$", "", n, flags=re.I)
    n = re.sub(r"역$", "", n).strip()
    return n.lower()


def main():
    req = urllib.request.Request(URL, data=BODY, method="POST")
    raw = urllib.request.urlopen(req).read().decode("cp949")
    rows = list(csv.reader(io.StringIO(raw)))[1:]
    entries = []
    for r in rows:
        if len(r) < 5 or not r[3].strip() or not r[4].strip():
            continue
        entries.append({"key": normalize(r[3]), "line": r[1].strip(), "location": r[4].strip()})
    out = {"asOf": AS_OF, "entries": entries}
    with open("src/lib/data/voice-guides.json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"entries: {len(entries)}, stations: {len(set(e['key'] for e in entries))}")


if __name__ == "__main__":
    main()
