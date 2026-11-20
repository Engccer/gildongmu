#!/usr/bin/env python3
"""한소네 7 점검(and-route: B24 버스 노선 집합 · B17 자동차 정체 줄 · B25 안내 시트 정보 띠 · A75 거리 풀어쓰기 제거).

공용 대본 `hansone-smoke.py`의 도우미(키 주입·줄 찾기·마무리)를 그대로 불러 쓰고, 길찾기 결과 줄을 훑는 점검만 더한다.

    H7_SCRIPTS=<h7.py가 있는 폴더> python3 android/scripts/hansone-and-route.py [검색어]

판정(점자·화면 출력 기록 LCD):
- 결과 줄에 「미터」 풀어쓰기가 없다(A75 — 낭독용 이름을 얹으면 한소네가 이름과 글자를 이어 두 번 싣는다).
- 같은 줄에 앞 조각이 두 번 실리지 않는다(A75).
- 자동차 결과에 정체 줄(「막히는 구간」)이 있다(B17). 정체 정보가 없는 시각·경로면 줄이 없을 수 있어 INFO로 남긴다.
- 버스 노선 집합(「370, 371번 버스」 꼴)은 그런 경로가 나올 때만 보이므로 INFO로 남긴다(B24).
- 안내 시트의 「남은 거리」 줄과 「안내 종료」가 한 번씩 출력된다(B25 — 띠는 시각 배치만 바꾼다).
종료 코드: 0 통과, 1 실패, 2 시작 조건 미충족.
"""
import importlib.util
import os
import re
import sys
import time

here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("hansone_smoke", os.path.join(here, "hansone-smoke.py"))
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)  # 기기 지정·h7 불러오기까지 한다(main은 돌지 않는다)
h7 = smoke.h7
record = smoke.record
press = smoke.press
current = smoke.current
find = smoke.find
enter = smoke.enter

# 결과 줄을 훑는 상한(줄 수). 대중교통 추천 경로·도보 첫 줄·자동차 안내가 펼쳐져 있어 40~60줄이다.
SCAN_LIMIT = 70


def doubled(line: str) -> bool:
    """앞 조각(첫 쉼표까지)이 같은 줄에 두 번 이상 나오면 A75 꼴이다. 짧은 조각은 우연히 겹치니 4자 이상만 본다."""
    head = line.split(",")[0].replace("BT", "").strip()
    return len(head) >= 4 and line.count(head) > 1


def scan_results() -> list[str]:
    lines: list[str] = []
    repeats = 0
    for _ in range(SCAN_LIMIT):
        line = current(press("space 4", label="결과 줄"))
        if lines and line == lines[-1]:
            repeats += 1
            if repeats >= 2:
                break  # 끝에 닿았다
            continue
        repeats = 0
        if lines and line == lines[0]:
            break  # 탭 막대를 지나 화면 머리로 한 바퀴 돌아왔다
        if line:
            lines.append(line)
        if "안내 종료" in line:
            break
    return lines


def run(query: str) -> None:
    h7.launch(f"{smoke.PACKAGE}/.MainActivity", wait=5)
    if not smoke.in_app():
        return record("FAIL", "앱 실행", smoke.focus())
    if not find("검색 탭", first="prev"):
        return record("FAIL", "검색 탭 찾기")
    enter(3)
    if not find("장소 검색"):
        return record("FAIL", "검색 편집창 찾기")
    enter(2.5)
    press("8 space", wait=1.5, label="한글 입력")
    h7.type_text(query, "ko")
    out = enter(6)
    if not any("검색 결과" in o for o in out):
        return record("FAIL", "검색 결과 통지", " / ".join(out)[-120:])
    row = current(out)
    if "검색 결과" in row or not row:
        press("space 4", label="첫 결과")
    enter(4)
    if not find("여기까지 길찾기"):
        return record("FAIL", "장소 상세의 「여기까지 길찾기」")
    enter(10)
    time.sleep(4)  # 세 수단 조회가 끝나기를 기다린다
    lines = scan_results()
    record("INFO", "훑은 결과 줄 수", str(len(lines)))
    for line in lines:
        print(f"   | {line}", flush=True)

    spelled = [l for l in lines if "미터" in l]
    record("FAIL" if spelled else "PASS", "결과 줄에 「미터」 풀어쓰기 없음(A75)", (spelled[0][:70] if spelled else ""))
    twice = [l for l in lines if doubled(l)]
    record("FAIL" if twice else "PASS", "결과 줄 한 번 출력(A75)", (twice[0][:70] if twice else ""))
    jam = next((l for l in lines if "막히는 구간" in l), None)
    car = any("택시" in l for l in lines)
    if jam:
        record("PASS", "자동차 정체 줄(B17)", jam[:70])
    elif car:
        record("INFO", "자동차 결과는 있으나 정체 줄 없음(정체 정보 없음일 수 있다, B17)")
    else:
        record("WARN", "자동차 결과 줄을 훑지 못함(B17)")
    lanes = next((l for l in lines if re.search(r"\d+[A-Za-z0-9-]*, \d+[A-Za-z0-9-]*번 버스", l)), None)
    record("PASS" if lanes else "INFO", "버스 노선 집합 줄(B24)", lanes[:70] if lanes else "이번 경로에 노선이 둘 이상인 버스 구간이 없다")

    if not find("안내 시작", first="prev", limit=SCAN_LIMIT):
        return record("WARN", "「안내 시작」을 찾지 못해 안내 시트 점검을 건너뜀")
    started = h7.now()
    enter(10)
    smoke.dismiss_system_dialogs()
    if not smoke.in_app():
        return record("FAIL", "안내 시작 뒤 앱 복귀", smoke.focus())
    time.sleep(6)
    out = [smoke.norm(o) for o in h7.lcd(started)]
    landed = next((o for o in reversed(out) if "남은 거리" in o), None) or find("남은 거리", first="prev", limit=8)
    if not landed:
        record("INFO", "「남은 거리」 줄 없음(위치를 못 잡았거나 간략 안내)")
    else:
        record("FAIL" if doubled(landed) or "미터" in landed else "PASS", "안내 시트 「남은 거리」 한 번 출력(B25·A75)", landed[:60])
    stop = find("안내 종료", limit=16)
    record("PASS" if stop else "FAIL", "「안내 종료」 도달(B25 두 배 높이 단추)", (stop or "")[:40])


def main() -> int:
    window = smoke.focus()
    if window == "?":
        print("adb로 한소네를 찾지 못했습니다.")
        return 2
    if smoke.TERMINAL_MODE in window:
        print("한소네가 터미널 모드입니다. 화면 읽기 프로그램 연결을 끊은 뒤 다시 실행하세요.")
        return 2
    try:
        if sys.argv[1:] != ["--cleanup"]:
            run(sys.argv[1] if len(sys.argv) > 1 else "길동 치킨")
    finally:
        smoke.cleanup()
    print("\n결과")
    for status, name, detail in smoke.results:
        print(f"  {status}  {name}  {detail}")
    return 1 if any(s == "FAIL" for s, _, _ in smoke.results) else 0


if __name__ == "__main__":
    sys.exit(main())
