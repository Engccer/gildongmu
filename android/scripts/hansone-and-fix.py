#!/usr/bin/env python3
"""한소네 7 점검(and-fix: A77 영어 화면 병기 줄 한 번 출력 · 「음성 검색」 동적 바로가기).

공용 대본 `hansone-smoke.py`(키 주입·줄 찾기·권한 창 닫기)와 `hansone-and-rows.py`(로터 「작업」 단위)의 도우미를 불러 쓴다.

    H7_SCRIPTS=<h7.py가 있는 폴더> python3 android/scripts/hansone-and-fix.py [--apk <app-debug.apk>] [--only english|shortcuts|transit] [검색어]

판정(점자·화면 출력 기록 LCD):
- english: 앱 언어만 영어로 바꿔(앱별 언어. 한소네 OS 설정은 건드리지 않는다) 낭독 이름이 따로 있는 병기 줄이 한 번만 출력되는가(A77).
  검색 결과 장소 줄(작업 메뉴가 남는가 함께), 내 주변 지하철 첫 역 제목(작업 메뉴), 둘러보기 위치 문장·한눈에 보기 첫 문장.
  같은 낱말 덩어리가 줄 안에 두 번 나오면 두 번 출력으로 본다. 끝나면 앱 언어를 원래 값으로 되돌린다.
- transit(6번 E43 M5 ⑦⑧ + 5번 A80·A81, 책상에서 닿는 길 「이미 탔어요」로 승차 중까지): 경유역 상세 왕복 뒤 펼침이 남는가,
  승차 중 검색 탭 장소 상세의 제목 다음 줄(A81 이름 없는 「버튼」), 다른 탭에서 띠바로 펼친 뒤 8초 안 착지, 앱을 나갔다 돌아온 뒤 커서 줄
  (「시트 닫기」면 결함), 화면을 끄고 켠 직후와 몇 초 뒤의 시트 줄(A80 이름 없는 「버튼」이 켠 직후 한 순간인가). 끝나면 안내를 끝낸다.
- shortcuts: `dumpsys shortcut`(읽기 전용)에서 길동무의 정적·동적 바로가기 id를 읽는다. 기대: 기기 안 음성 인식기가 있으면(검색 탭에
  「받아쓰기 시작」 버튼이 선다) 정적 nearby + 동적 voiceSearchDynamic, 없으면 nearby만.
다른 세션이 같은 기기를 쓰므로 기기 락 하나 안에서 처음부터 끝까지 돈다. 종료 코드: 0 통과, 1 실패, 2 시작 조건 미충족.
"""
import importlib.util
import os
import re
import subprocess
import sys
import time

here = os.path.dirname(os.path.abspath(__file__))


def load(name: str, file: str):
    spec = importlib.util.spec_from_file_location(name, os.path.join(here, file))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


smoke = load("hansone_smoke", "hansone-smoke.py")  # 기기 지정·h7 불러오기까지 한다(main은 돌지 않는다)
rows = load("hansone_and_rows", "hansone-and-rows.py")
t5 = load("hansone_and_m5_transit_5", "hansone-and-m5-transit-5.py")  # 대중교통 진입 단계(검색 → 시작 → 「이미 탔어요」)
for mod in (rows, t5):
    mod.smoke.results = smoke.results  # 각 대본이 따로 불러온 공용 모듈의 기록을 한 목록으로 모은다
h7 = smoke.h7
record = smoke.record
press = smoke.press
current = smoke.current
find = smoke.find
enter = smoke.enter
PACKAGE = smoke.PACKAGE
EN_SEARCH_LABEL = rows.EN_SEARCH_LABEL


def doubled(line: str) -> str | None:
    """줄 안에 4낱말 이상 덩어리가 두 번 나오면 그 덩어리(한소네가 낭독 이름과 보이는 글자를 이어 붙인 모양). 역할 꼬리(「버튼」 등)는 뺀다."""
    words = re.sub(r"[(),]", " ", line).split()
    for size in range(min(8, len(words) // 2), 3, -1):
        for i in range(len(words) - size + 1):
            chunk = words[i : i + size]
            for j in range(i + size, len(words) - size + 1):
                if words[j : j + size] == chunk:
                    return " ".join(chunk)
    return None


def judge_once(label: str, line: str) -> None:
    if not line:
        return record("WARN", f"{label}: 줄을 못 읽음")
    dup = doubled(line)
    record("FAIL" if dup else "PASS", f"{label} 한 번 출력(A77)", (f"되풀이: {dup} / " if dup else "") + line[:90])


def guard() -> bool:
    """키를 넣기 전 앞 창이 길동무인가(다른 세션의 앱에 글자가 들어가지 않게). 권한 창이면 닫는다."""
    for attempt in range(3):
        if smoke.in_app() or smoke.app_on_top():
            return True
        window = smoke.focus()
        if smoke.TERMINAL_MODE in window:
            record("FAIL", "한소네가 터미널 모드로 바뀜 — 중단", window)
            return False
        if "permissioncontroller" in window:
            smoke.dismiss_system_dialogs()  # 권한 창은 「허용 안함」으로 넘긴다(대신 허용하지 않는다)
        elif attempt == 0:
            time.sleep(120)  # 다른 세션의 앱일 수 있다(기기 락 규칙 2판: 2분 뒤 다시 본다). 키는 넣지 않는다.
        else:
            h7.launch(f"{PACKAGE}/.MainActivity", wait=5)
        time.sleep(2)
    record("FAIL", "앞 창이 길동무가 아님", smoke.focus())
    return False


def sweep(label: str, steps: int) -> None:
    """다음 줄로 steps번 가며 괄호 병기가 있는 줄을 모두 판정한다(주변 상황 줄·위치 표시줄처럼 자리를 모르는 줄)."""
    seen = 0
    for _ in range(steps):
        line = current(press("space 4", wait=1.2, label=f"{label} 다음 줄"))
        if line and len(line.split()) >= 8:  # 고친 줄은 괄호 한글 없이 낭독 이름만 나오므로 괄호로 고르지 않는다 — 긴 줄은 모두 판정
            dup = doubled(line)
            if dup:
                record("FAIL", f"{label} 한 번 출력(A77)", f"되풀이: {dup} / {line[:90]}")
            seen += 1
    record("PASS" if seen else "INFO", f"{label}: 긴 줄 {seen}개 판정", "되풀이 줄은 위 FAIL로 따로 적음" if seen else "긴 줄을 만나지 못함")


def en_search(query: str) -> None:
    find("Search Tab", first="prev", limit=20)
    enter(3)
    sweep("영어 검색 탭 위쪽(위치 표시줄)", 4)
    if not find(EN_SEARCH_LABEL, first="prev", limit=8):
        return record("WARN", "영어 화면 검색창 못 찾음")
    enter(2.5)
    press("8 space", wait=1.5, label="한글 입력")
    h7.type_text(query, "ko")
    out = enter(6)
    row = current(out)
    if not row or "result" in row.lower():
        row = current(press("space 4", label="첫 결과"))
    judge_once("영어 검색 결과 장소 줄", row)
    if "(" not in row:
        record("INFO", "첫 결과에 병기가 없다(영문 원천이 있거나 로마자 없음) — 낭독 이름 없는 줄", row[:60])
    if rows.rotor_to_actions():
        items = rows.list_actions()
        record("PASS" if any("Directions to here" in i for i in items) else "FAIL", "영어 장소 줄 작업 메뉴가 남는다", " → ".join(items))
    else:
        record("FAIL", "영어 장소 줄 작업 메뉴 없음(지우기가 메뉴까지 지웠다)", row[:50])


def en_hub(label: str) -> list[str]:
    if not find("Nearby Tab", first="prev", limit=20):
        return []
    enter(3)
    if not find(label, limit=12):
        press("f4", wait=4, label="뒤로(허브로)")
        if not find(label, limit=20):
            return []
    return enter(10)


def en_subway() -> None:
    out = en_hub("Subway arrivals")
    if not out:
        return record("WARN", "영어 내 주변 → 지하철 열기 못 함")
    try:
        title = current(out)
        if "Line" not in title and "line" not in title:
            return record("INFO", "지하철 역 제목 착지 없음", title[:60])
        judge_once("영어 지하철 역 제목", title)
        if rows.rotor_to_actions():
            record("PASS", "영어 역 제목 작업 메뉴가 남는다", " → ".join(rows.list_actions()))
        else:
            record("FAIL", "영어 역 제목 작업 메뉴 없음", title[:50])
    finally:
        press("f4", wait=4, label="뒤로")


def en_around() -> None:
    out = en_hub("Look around")
    if not out:
        return record("WARN", "영어 둘러보기 열기 못 함")
    time.sleep(6)
    try:
        top = find("Near", first="prev", limit=6) or current(out)
        judge_once("영어 둘러보기 위치 문장", top)
        if find("At a glance", limit=6):
            judge_once("영어 한눈에 보기 첫 문장", current(press("space 4", label="한눈에 보기 첫 문장")))
        sweep("영어 둘러보기 아래쪽(주변 상황 줄)", 25)
    finally:
        press("f4", wait=4, label="뒤로")


def check_english(query: str) -> None:
    h7.sh("cmd", "locale", "set-app-locales", PACKAGE, "--locales", "en-US")
    try:
        h7.sh("am", "force-stop", PACKAGE)
        h7.launch(f"{PACKAGE}/.MainActivity", wait=6)
        for step in (lambda: en_search(query), en_subway, en_around):
            if not guard():
                return
            try:
                step()
            except Exception as e:  # 한 단계의 실패가 나머지를 막지 않게
                record("FAIL", "영어 점검 중 예외", repr(e)[:80])
    finally:
        h7.sh("cmd", "locale", "set-app-locales", PACKAGE, "--locales", "")
        h7.sh("am", "force-stop", PACKAGE)


NAMELESS = re.compile(r"^BT( 버튼)?( 활성화하려면.*)?$")  # 정규화된 점자 출력에서 이름 없는 버튼(「BT 활성화하려면 ENTER 키를 누르세요」)


def nameless(line: str) -> bool:
    return bool(NAMELESS.match(line.strip()))


def transit_via_roundtrip() -> None:
    """⑦ 경유역 줄을 누르면 역 상세가 열리고, 돌아오면 그 줄에 앉고 목록이 펼친 채인가. 상세에서는 A81처럼 제목 다음 줄도 본다."""
    if not t5.guard("경유역 왕복"):
        return
    via = find(t5.L_VIA, limit=t5.SCAN_LIMIT)
    if not via:
        return record("INFO", "경유역 줄 못 찾음", "이 경로에 경유 목록 없음")
    enter(3)
    row = ""
    for _ in range(4):
        row = current(press("space 4", label="첫 경유역 행"))
        if row and "전화" not in row:
            break
    record("INFO", "펼친 뒤 첫 경유역 행", row[:50])
    started = h7.now()
    enter(5)
    title = current(t5.land_after(started, 3))
    record("INFO", "경유역을 누른 뒤 착지 줄(역 상세 제목이 기대값)", (title or "출력 없음")[:50])
    after_title = current(press("space 4", label="상세 제목 다음 줄"))
    record("FAIL" if nameless(after_title) else "PASS", "경유역 상세 제목 다음 줄에 이름이 있음(A81)", after_title[:50])
    started = h7.now()
    press("f4", wait=4, label="ESC 상세에서 복귀")
    back = current(t5.land_after(started, 3))
    nxt = current(press("space 4", label="펼침 유지 확인"))
    same = bool(row) and row[:8] in back
    record("PASS" if same else "FAIL", "상세에서 돌아오면 누른 경유역 행에 앉음(⑦)", f"앉은 줄: {back[:40]}")
    record("PASS" if nxt and nxt != back and "경유" not in nxt[:4] and t5.L_STOP not in nxt else "WARN", "돌아온 뒤 목록이 펼친 채(다음 줄이 다른 경유역 행)", nxt[:40])


def transit_search_detail() -> None:
    """A81 승차 중 검색 탭 → 장소 상세에서 제목 다음 줄. 그 뒤 검색 탭에서 띠바로 시트를 펼쳐 8초 안 착지(⑧)."""
    if not t5.guard("검색 탭 장소 상세"):
        return
    if not find(t5.L_MINIMIZE, first="prev", limit=30):
        return record("WARN", "「안내 시트 접기」 못 찾음")
    enter(3)
    if not find(t5.SEARCH_TAB, limit=30):
        return record("WARN", "검색 탭 못 찾음")
    enter(3)
    first = ""
    for _ in range(12):
        line = current(press("space 4", label="최근·결과 줄"))
        if line and ("버튼" in line or "," in line) and t5.L_RESTORE not in line and "받아쓰기" not in line and "새로고침" not in line:
            first = line
            break
    if first:
        started = h7.now()
        enter(5)
        title = current(t5.land_after(started, 3))
        nxt = current(press("space 4", label="상세 제목 다음 줄"))
        record("FAIL" if nameless(nxt) else "PASS", "안내 중 장소 상세 제목 다음 줄에 이름이 있음(A81)", f"제목 {title[:24]} / 다음 {nxt[:40]}")
        press("f4", wait=4, label="ESC 검색 탭으로")
    else:
        record("INFO", "검색 탭에 연 장소 줄 없음(최근 장소·결과 없음)")
    band = find(t5.L_RESTORE, limit=30) or find(t5.L_RESTORE, first="prev", limit=30)
    if not band:
        return record("FAIL", "다른 탭에서 띠바 줄 못 찾음")
    started = h7.now()
    enter(4)
    out = t5.land_after(started, 8)
    landing = next((o for o in reversed(out) if o), "")
    record("PASS" if "탑승 중" in landing else "FAIL", "다른 탭에서 띠바로 펼치면 8초 안 상태 문장 행에 앉음(⑧)", " / ".join(o[:20] for o in out if o)[:120])


def transit_leave_return() -> None:
    """⑧ 앱을 나갔다 돌아온 뒤 커서 줄. 「시트 닫기」(머티리얼 스크림)에 앉으면 결함."""
    if not t5.guard("앱 나갔다 돌아오기"):
        return
    t5.sh("am", "start", "-a", "android.intent.action.MAIN", "-c", "android.intent.category.HOME")
    time.sleep(3)
    started = h7.now()
    h7.launch(f"{PACKAGE}/.MainActivity", wait=4)
    if not smoke.in_app():
        return record("FAIL", "다른 앱에 갔다 돌아옴", smoke.focus())
    out = t5.land_after(started, 6)
    landing = next((o for o in reversed(out) if o), "")
    record("FAIL" if "시트 닫기" in landing else ("PASS" if "탑승 중" in landing else "WARN"), "돌아온 뒤 커서가 상태 문장 행(「시트 닫기」 아님)", " / ".join(o[:20] for o in out if o)[:120])


def transit_screen_on() -> None:
    """A80 화면을 끄고 켠 직후와 몇 초 뒤의 시트 줄에서 이름 없는 버튼. 켠 직후 한 순간이면 직후 줄에만 나온다."""
    if not t5.guard("화면 끄고 켜기"):
        return
    t5.sh("input", "keyevent", "26")
    time.sleep(4)
    t5.sh("input", "keyevent", "26")
    time.sleep(1)
    if not smoke.in_app():
        t5.sh("input", "keyevent", "82")
        time.sleep(1)
    if not smoke.in_app():
        return record("INFO", "화면 켠 뒤 앱이 앞이 아님(잠금 화면)", smoke.focus())
    early = [current(press("space 4", wait=0.6, label="켠 직후 줄")) for _ in range(6)]
    time.sleep(5)
    find(t5.L_TRANSIT_TITLE, first="prev", limit=24)
    later = t5.sheet_lines(30)
    e = [l for l in early if nameless(l)]
    l2 = [l for l in later if nameless(l)]
    record("FAIL" if l2 else "PASS", "화면 켜고 5초 뒤 시트 줄에 이름 없는 버튼 없음(A80)", f"켠 직후 {len(e)}개 / 5초 뒤 {len(l2)}개, 직후 줄: {' | '.join(x[:14] for x in early)}"[:160])


def check_transit(query: str) -> None:
    t5.T0 = time.time()  # 대중교통 단계의 10분 예산은 이 모드 시작부터 센다
    if not t5.step_notice() or not t5.step_search(query) or not t5.step_start_button():
        return
    if t5.step_open_sheet() != "transit":
        return record("INFO", "대중교통 시트가 서지 않음 — 단계 건너뜀")
    if not t5.step_aboard("mid"):
        return
    for step in (transit_via_roundtrip, transit_search_detail, transit_leave_return, transit_screen_on):
        try:
            step()
        except Exception as e:
            record("FAIL", "대중교통 점검 중 예외", repr(e)[:80])


def check_shortcuts() -> None:
    dump = h7.sh("dumpsys", "shortcut")
    block = dump[dump.find(f"Package: {PACKAGE}") :] if f"Package: {PACKAGE}" in dump else ""
    block = block[: block.find("Package: ", 10)] if "Package: " in block[10:] else block
    ids = re.findall(r"id=(\w+)", block)
    dynamic = "voiceSearchDynamic" in ids
    record("INFO", "바로가기 id(dumpsys shortcut)", ", ".join(dict.fromkeys(ids)) or "없음")
    # 인식기 유무는 검색 탭의 「받아쓰기 시작」 버튼으로 본다(같은 술어 `Dictation.isAvailable`이 세운다).
    h7.sh("am", "force-stop", PACKAGE)
    h7.launch(f"{PACKAGE}/.MainActivity", wait=5)
    if not guard():
        return
    find("검색 탭", first="prev", limit=20)
    enter(3)
    mic = find("받아쓰기 시작", limit=6) is not None
    ok = ("nearby" in ids) and (dynamic == mic)
    record("PASS" if ok else "FAIL", "「음성 검색」 바로가기는 받아쓰기 되는 기기에만", f"받아쓰기 버튼 {'있음' if mic else '없음'}, voiceSearchDynamic {'있음' if dynamic else '없음'}")


def main() -> int:
    args = sys.argv[1:]
    apk = None
    if args[:1] == ["--apk"]:
        apk, args = args[1], args[2:]
    only = None
    if args[:1] == ["--only"]:
        only, args = args[1], args[2:]
    query = args[0] if args else "치킨"
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
        checks = {"shortcuts": check_shortcuts, "english": lambda: check_english(query)}
        if only == "transit":
            checks = {"transit": lambda: check_transit(args[0] if args else "국립중앙박물관")}
        for name, check in checks.items():
            if only and name != only:
                continue
            try:
                check()
            except Exception as e:
                record("FAIL", "점검 중 예외", repr(e)[:80])
    finally:
        after = h7.sh("cmd", "locale", "get-app-locales", PACKAGE).strip()
        record("PASS" if after == before else "FAIL", "앱 언어 원상 복구", after)
        if only == "transit":
            smoke.cleanup()  # 안내 종료 → 앱 닫기
        h7.sh("am", "force-stop", PACKAGE)
        h7.sh("input", "keyevent", "KEYCODE_HOME")

    print("\n결과")
    for status, name, detail in smoke.results:
        print(f"  {status}  {name}  {detail}")
    return 1 if any(s == "FAIL" for s, _, _ in smoke.results) else 0


if __name__ == "__main__":
    sys.exit(main())
