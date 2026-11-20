#!/usr/bin/env python3
"""한소네 7 점검(and-m5-car: E43 M5 자동차 실시간 안내).

공용 대본 `hansone-smoke.py`의 도우미(키 주입·줄 찾기·마무리)를 그대로 불러 쓰고, 길찾기 자동차 결과의 시작 단추와 안내 시트만 본다.

    H7_SCRIPTS=<h7.py가 있는 폴더> python3 android/scripts/hansone-and-m5-car.py [검색어]

판정(점자·화면 출력 기록 LCD):
- 자동차 결과 머리 바로 뒤에 「자동차 안내 시작」 단추가 있다(Tmap 경로일 때만 선다 — 카카오 폴백이면 없어서 INFO).
- 누르면 안내 시트 제목이 「자동차 안내, {목적지}」다(도보 제목이 새지 않는다).
- 실내라 위치를 못 잡으면 상세 안내(「현재 도로」 줄)가 서지 않는다 — 그 항목은 INFO(실주행 확인 몫).
- 시트의 줄이 두 번 실리지 않는다.
- 「안내 종료」에 닿고, 누르면 세션이 끝난다(자동차는 걸음 요약이 없다).
종료 코드: 0 통과, 1 실패, 2 시작 조건 미충족.
"""
import importlib.util
import os
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

SCAN_LIMIT = 70


def doubled(line: str) -> bool:
    """앞 조각(첫 쉼표까지)이 같은 줄에 두 번 이상 나오면 중복 출력이다. 짧은 조각은 우연히 겹치니 4자 이상만 본다."""
    head = line.split(",")[0].replace("BT", "").strip()
    return len(head) >= 4 and line.count(head) > 1


def sheet_lines(limit: int = 16) -> list[str]:
    lines: list[str] = []
    for _ in range(limit):
        line = current(press("space 4", label="시트 줄"))
        if lines and line == lines[-1]:
            break
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
    start = find("자동차 안내 시작", limit=SCAN_LIMIT)
    if not start:
        car = find("택시", first="prev", limit=SCAN_LIMIT)
        return record("INFO" if car else "WARN", "「자동차 안내 시작」 없음", "Tmap이 아닌 경로(카카오 폴백)면 단추가 서지 않는다" if car else "자동차 결과를 찾지 못함")
    record("FAIL" if doubled(start) else "PASS", "「자동차 안내 시작」 단추", start[:40])

    started = h7.now()
    enter(10)
    smoke.dismiss_system_dialogs()
    if not smoke.in_app():
        return record("FAIL", "안내 시작 뒤 앱 복귀", smoke.focus())
    time.sleep(8)
    out = [smoke.norm(o) for o in h7.lcd(started)]
    for o in out[-12:]:
        print(f"   > {o}", flush=True)
    spoken_start = next((o for o in out if "자동차 안내 시작" in o and "까지" in o), None)
    record("PASS" if spoken_start else "INFO", "시작 문장(「…까지 자동차 안내 시작」)", (spoken_start or "위치를 못 잡아 간략·실패로 끝났을 수 있다")[:70])
    lines = sheet_lines()
    for line in lines:
        print(f"   | {line}", flush=True)
    title = find("자동차 안내,", first="prev", limit=20) or next((l for l in lines if "자동차 안내," in l), None)
    walk_title = next((l for l in lines if "도보 안내," in l), None)
    if walk_title:
        record("FAIL", "안내 시트 제목에 도보 제목이 샘", walk_title[:60])
    elif title:
        record("PASS", "안내 시트 제목 「자동차 안내, …」", title[:60])
    else:
        record("INFO", "안내 시트 제목을 훑지 못함(시작 실패 행으로 끝났을 수 있다)")
    road = next((l for l in lines if l.startswith("현재 도로")), None)
    record("PASS" if road else "INFO", "「현재 도로」 줄(E56)", (road or "실내라 상세 안내가 서지 않음 — 실주행 확인 몫")[:60])
    twice = [l for l in lines if doubled(l)]
    record("FAIL" if twice else "PASS", "시트 줄 한 번 출력", (twice[0][:60] if twice else ""))
    stop = find("안내 종료", limit=16)
    if not stop:
        return record("FAIL", "「안내 종료」 도달")
    record("PASS", "「안내 종료」 도달", stop[:30])
    enter(4)
    after = find("자동차 안내 시작", first="prev", limit=SCAN_LIMIT)
    record("PASS" if after else "WARN", "종료 뒤 길찾기 화면 복귀(걸음 요약 화면 없음)", (after or "")[:40])


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
