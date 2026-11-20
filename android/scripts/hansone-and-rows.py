#!/usr/bin/env python3
"""한소네 7 점검(and-rows: A75 결과 줄 한 번 출력 · B21 줄 작업 메뉴 · 영어 화면 병기 줄 관측).

공용 대본 `hansone-smoke.py`의 도우미(키 주입·줄 찾기)를 불러 쓰고, 작업 메뉴는 한소네 모바일 스크린 리더의 로터
「작업」 단위로 연다(안내서 16장: 백스페이스-스페이스-엔터-2-3/5-6점 단위 변경, 1/4점 항목 이동, 1-4점 실행).

    H7_SCRIPTS=<h7.py가 있는 폴더> python3 android/scripts/hansone-and-rows.py [--apk <app-debug.apk>] [--only search|subway|around|english] [검색어]

판정(점자·화면 출력 기록 LCD):
- 검색 결과 줄의 이름이 한 번만 출력된다(A75).
- 장소 줄 작업 메뉴가 전화 걸기 → 여기까지 길찾기 → 주소 복사하기 → ○○에 관해 물어보기 순서다(B21 ①).
  「주소 복사하기」를 실행하면 「주소 복사됨」이 나온다. 「물어보기」는 그 장소 채팅을 열고, 뒤로 오면 그 줄로 착지한다.
  전화 걸기·여기까지 길찾기는 실행하지 않는다(실제 전화 금지).
- 내 주변 → 지하철 도착 첫 역 제목의 작업 메뉴가 전화 → 여기까지 길찾기 → 상세 보기다(B21 ④, 역 좌표가 오는 경우).
- 내 주변 → 둘러보기에 「내 현재 위치에 관해 물어보기」가 있고, 한눈에 보기 문장의 작업 메뉴를 기록한다(B21 ⑥⑦, INFO).
- 앱 언어만 영어로 바꿔(앱별 언어, 한소네 설정은 건드리지 않는다) 병기 결과 줄의 출력을 원문 그대로 기록한 뒤 되돌린다.
다른 세션이 같은 기기를 쓰므로 설치부터 끝까지 한 번에 돈다(게이트 락 하나 안에서 실행할 것).
종료 코드: 0 통과, 1 실패, 2 시작 조건 미충족.
"""
import importlib.util
import os
import subprocess
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
PACKAGE = smoke.PACKAGE

ROTOR_NEXT = "7 8 space 5 6"
ITEM_NEXT = "7 8 space 4"
ITEM_RUN = "7 8 space 1 4"
EN_SEARCH_LABEL = "Search places"  # values-en `search_label`
ROW_ACTIONS = ["전화 걸기", "여기까지 길찾기", "주소 복사하기"]


def rotor_to_actions() -> bool:
    """로터를 「작업」 단위로 맞춘다. 단위는 문자·단어·줄·단락·제목·컨트롤·링크·작업 여덟이고 줄에 동작이 없으면 「작업」이 빠진다."""
    for _ in range(10):
        if current(press(ROTOR_NEXT, label="로터")) == "작업":
            return True
    return False


def list_actions(limit: int = 8) -> list[str]:
    """작업 항목을 「활성화」(누르기)가 나오거나 한 바퀴 돌 때까지 모은다. 항목 커서는 실행 뒤 처음으로 돌아간다."""
    items: list[str] = []
    for _ in range(limit):
        item = current(press(ITEM_NEXT, label="작업 항목"))
        if not item or item in items:
            break
        items.append(item)
        if item == "활성화":
            break
    return items


def run_action(name: str, wait: float = 3.0) -> list[str]:
    """이름이 든 작업 항목까지 옮겨 실행하고 그 뒤 출력 줄을 돌려준다."""
    for _ in range(8):
        if name in current(press(ITEM_NEXT, label="작업 항목")):
            return press(ITEM_RUN, wait=wait, label=f"실행 {name}")
    return []


def search(query: str) -> list[str]:
    find("검색 탭", first="prev")
    enter(3)
    if not find("장소 검색"):
        return []
    enter(2.5)
    press("8 space", wait=1.5, label="한글 입력")
    h7.type_text(query, "ko")
    return enter(6)


def first_result(out: list[str]) -> str:
    row = current(out)
    if "검색 결과" in row or not row or "result" in row.lower():
        row = current(press("space 4", label="첫 결과"))
    return row


def check_search(query: str) -> None:
    out = search(query)
    if not any("검색 결과" in o for o in out):
        return record("FAIL", "검색 결과 통지", " / ".join(out)[-120:])
    row = first_result(out)
    name = row.split(",")[0].replace("BT", "").split("음식점")[0].strip()
    if name and row.count(name) > 1:
        record("FAIL", "결과 줄에 이름이 두 번 출력(A75)", row[:80])
    else:
        record("PASS", "결과 줄 한 번 출력(A75)", row[:60])

    if not rotor_to_actions():
        return record("FAIL", "로터 「작업」 단위 없음(B21 ①, E45 ⓐ)")
    items = list_actions()
    head = items[:3]
    ask = next((i for i in items if i.endswith("에 관해 물어보기")), None)
    # 전화번호가 없는 장소는 「전화 걸기」가 빠진다 — 있는 것만 순서를 본다.
    expected = [a for a in ROW_ACTIONS if a in items]
    if "여기까지 길찾기" in items and head[: len(expected)] == expected and ask:
        record("PASS", "장소 줄 작업 메뉴 순서(B21 ①)", " → ".join(items))
    else:
        record("FAIL", "장소 줄 작업 메뉴 순서(B21 ①)", " → ".join(items))

    copied = run_action("주소 복사하기")
    record("PASS" if any("주소 복사됨" in o for o in copied) else "FAIL", "주소 복사 통지", " / ".join(copied)[:60])

    asked = run_action(ask or "물어보기", wait=5)
    opened = " / ".join(asked)
    record("PASS" if name and name.split()[0] in opened else "WARN", "물어보기가 그 장소 채팅을 연다", opened[:60])
    press("f4", wait=5, label="뒤로")
    back = current(press("space 4", label="착지 다음"))
    landed = current(press("space 1", label="착지 줄"))
    record("PASS" if name and name in landed else "WARN", "물어보기에서 돌아와 그 줄로 착지", f"{landed[:50]} (다음 줄 {back[:30]})")

    # 비교: 같은 줄을 ENTER로 상세에 들어갔다 돌아온 착지(종전부터 있던 경로). 둘이 같으면 물어보기만의 결함이 아니다.
    if find(name, limit=20):
        enter(5)
        press("f4", wait=5, label="상세에서 뒤로")
        press("space 4", label="착지 다음")
        landed = current(press("space 1", label="착지 줄"))
        record("PASS" if name in landed else "WARN", "상세에서 돌아와 그 줄로 착지(비교)", landed[:50])


def open_hub(label: str) -> list[str]:
    """내 주변 허브에서 그 줄을 연다. 탭을 다시 골라도 스택이 남아 있으면 허브가 아니므로 뒤로 한 번 더 간다. 연 화면의 첫 출력을 돌려준다."""
    if not find("내 주변 탭", first="prev", limit=20):
        return []
    enter(3)
    if not find(label, limit=12):
        press("f4", wait=4, label="뒤로(허브로)")
        if not find(label, limit=20):
            return []
    return enter(10)


def check_subway() -> None:
    out = open_hub("지하철 도착")
    if not out:
        return record("FAIL", "내 주변 → 지하철 도착 열기")
    try:
        title = current(out)  # 첫 로드 착지는 첫 역 제목이다
        if "호선" not in title:
            return record("INFO", "지하철 역 제목 착지 없음(주변 역 없음·조회 실패)", title[:50])
        if not rotor_to_actions():
            return record("FAIL", "역 제목에 작업 메뉴 없음(B21 ④, coords=1)", title[:50])
        items = list_actions()
        ok = len(items) >= 3 and "전화" in items[0] and items[1] == "여기까지 길찾기" and "상세 보기" in items[2]
        record("PASS" if ok else "FAIL", "역 제목 작업 메뉴(B21 ④)", f"{title[:20]} : {' → '.join(items)}")
    finally:
        press("f4", wait=4, label="뒤로")


def check_around() -> None:
    if not open_hub("둘러보기"):
        return record("FAIL", "내 주변 → 둘러보기 열기")
    time.sleep(6)
    try:
        around_body()
    finally:
        press("f4", wait=4, label="뒤로")


def around_body() -> None:
    if find("한눈에 보기", limit=6):
        line = current(press("space 4", label="한눈에 보기 첫 문장"))
        if rotor_to_actions():
            record("INFO", "한눈에 보기 첫 문장 작업 메뉴(B21 ⑥)", f"{line[:40]} : {' → '.join(list_actions())}")
        else:
            record("INFO", "한눈에 보기 첫 문장에 작업 없음(문장이 부른 장소가 없으면 정상)", line[:50])
    ask = find("현재 위치에 관해 물어보기", limit=40)
    record("PASS" if ask else "FAIL", "「내 현재 위치에 관해 물어보기」 버튼(B21 ⑦)", (ask or "")[:50])


def observe_english(query: str) -> None:
    """앱 언어만 영어로 — 병기 결과 줄(시각 `Roman (한글)`, 낭독 이름 `Roman`)의 출력을 원문 그대로 남긴다."""
    h7.sh("cmd", "locale", "set-app-locales", PACKAGE, "--locales", "en-US")
    try:
        h7.sh("am", "force-stop", PACKAGE)  # 저장된 화면 스택 대신 첫 화면에서
        h7.launch(f"{PACKAGE}/.MainActivity", wait=6)
        find("Search Tab", first="prev", limit=20)  # 역할 낱말도 앱 언어(「Tab」)로 붙는다
        enter(3)
        if not find(EN_SEARCH_LABEL, first="prev", limit=8):  # 탭을 고르면 「Search」 버튼에 앉는다 — 검색창은 그 앞
            return record("WARN", "영어 화면 검색창 못 찾음")
        enter(2.5)
        press("8 space", wait=1.5, label="한글 입력")
        h7.type_text(query, "ko")
        out = enter(6)
        row = current(out)
        if not row or "result" in row.lower():
            row = current(press("space 4", label="첫 결과"))
        record("INFO", "영어 화면 병기 결과 줄 출력(원문)", row)
    finally:
        h7.sh("cmd", "locale", "set-app-locales", PACKAGE, "--locales", "")
        h7.sh("am", "force-stop", PACKAGE)


def main() -> int:
    args = sys.argv[1:]
    apk = None
    if args[:1] == ["--apk"]:
        apk, args = args[1], args[2:]
    only = None
    if args[:1] == ["--only"]:
        only, args = args[1], args[2:]
    query = args[0] if args else "길동 치킨"
    window = smoke.focus()
    if window == "?":
        print("adb로 한소네를 찾지 못했습니다.")
        return 2
    if smoke.TERMINAL_MODE in window:
        print("한소네가 터미널 모드입니다. 화면 읽기 프로그램 연결을 끊은 뒤 다시 실행하세요.")
        return 2
    if apk:
        subprocess.run(["adb", "install", "-r", apk], check=True, timeout=300)
    before = h7.sh("cmd", "locale", "get-app-locales", PACKAGE).strip()
    try:
        h7.sh("am", "force-stop", PACKAGE)
        h7.launch(f"{PACKAGE}/.MainActivity", wait=5)
        if not smoke.in_app():
            record("FAIL", "앱 실행", smoke.focus())
        else:
            checks = {"search": lambda: check_search(query), "subway": check_subway, "around": check_around, "english": lambda: observe_english(query)}
            for name, check in checks.items():
                if only and name != only:
                    continue
                try:
                    check()
                except Exception as e:  # 한 점검의 실패가 나머지를 막지 않게
                    record("FAIL", "점검 중 예외", repr(e)[:80])
    finally:
        after = h7.sh("cmd", "locale", "get-app-locales", PACKAGE).strip()
        record("PASS" if after == before else "FAIL", "앱 언어 원상 복구", after)
        press("space z", wait=3, label="앱 닫기")

    print("\n결과")
    for status, name, detail in smoke.results:
        print(f"  {status}  {name}  {detail}")
    return 1 if any(s == "FAIL" for s, _, _ in smoke.results) else 0


if __name__ == "__main__":
    sys.exit(main())
