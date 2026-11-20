#!/usr/bin/env python3
"""한소네 7 점검(and-m5-transit-5: E43 M5 대중교통 실시간 안내 — 시작 버튼·새 소식 시트·시트 착지·띠바·승하차·화면 끔).

공용 대본 `hansone-smoke.py`의 도우미(키 주입·줄 찾기·마무리)를 그대로 불러 쓴다.

    H7_SCRIPTS=<h7.py가 있는 폴더> python3 android/scripts/hansone-and-m5-transit-5.py [검색어]
    H7_SCRIPTS=... python3 android/scripts/hansone-and-m5-transit-5.py --cleanup   # 안내만 끝내고 앱을 닫는다

판정은 점자·화면 출력 기록(LCD)과 `dumpsys`(창 초점·알림·화면 상태)만 쓴다. uiautomator·layout 덤프는 쓰지 않는다.
각 단계의 LCD 원문은 `   > ` 접두로 출력한다(주 세션이 로그로 판정). 실제 승차 없이 닿는 범위까지만 본다.
실행 순서: 새 소식 → 검색·길찾기 → 시작 버튼 → 시트 착지·줄 순서 → 띠바 → 차량 후보 20초 → 승차(이미 탔어요)
→ 경유역·상세 → 화면 밖 왕복 → 화면 끔 15초 → 하차(다음 구간)와 알림 → 안내 종료.
종료 코드: 0 통과, 1 실패, 2 시작 조건 미충족. 전체 10분 안에 끝나게 시간 예산(BUDGET)을 둔다.
"""
import importlib.util
import os
import re
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
norm = smoke.norm

SERIAL = os.environ.get("ANDROID_SERIAL", "000000000150")
# 이미 확인한 단계를 건너뛰어 예산을 뒤 단계에 쓴다: H7_SKIP=notice,sheet (notice = 새 소식 창 확인, sheet = 대중교통 시트 줄·띠바).
SKIP = set(filter(None, os.environ.get("H7_SKIP", "").split(",")))
BUDGET = 450.0  # 초. 마무리(안내 종료·홈)까지 10분 안에 끝낸다.
T0 = time.time()
SCAN_LIMIT = 60

# 코드에서 확인한 라벨(strings.xml 값). 키의 점은 밑줄로 바뀐다.
L_NOTICE_TITLE = "길동무가 업데이트되었습니다!"  # android_releaseNotice_title
L_NOTICE_CLOSE = "닫기 버튼"  # android_releaseNotice_confirm(정규화된 점자 출력 「BT 닫기 버튼」). 머티리얼 기본 「시트 닫기」는 확인을 저장하지 않아 고르지 않는다
L_RECOMMENDED = "추천 경로"  # route_transit_recommended
L_START_FMT = "{name} 안내 시작"  # beacon_guideStartTransitAlt
L_WALK_TITLE = "도보 안내,"  # beacon_walkHeading + 목적지
L_TRANSIT_TITLE = "대중교통 안내,"  # beacon_transitHeading + 목적지
L_BRIDGE = "승차 대기로 바로 넘어갑니다"  # android_beacon_prewalkUnavailableWith / transitGuide_prewalkUnavailable
L_STOP = "안내 종료"  # beacon_stop
L_MINIMIZE = "안내 시트 접기"  # guide_minimize
L_RESTORE = "안내 시트 펼치기"  # guide_band_return
L_BOARD_ALREADY = "이미 탔어요"  # transitGuide_boardAlready / boardApprox
L_ADVANCE = "다음 구간"  # transitGuide_advance (하차 뒤 누르는 버튼; 「내렸어요」 버튼은 없다)
L_VIA = "경유"  # transitGuide_viaStopsTrain 「경유역 N개」 / viaStopsBus 「경유 정류장 N개」
L_PROGRESS = "진행 상황"  # guide_progressButton
SEARCH_TAB = "검색 탭"
PLACE_FIELD = "장소 검색"
DIRECTIONS = "여기까지 길찾기"
WAIT_HINTS = ("탑승", "기다리는", "도착")  # 대기 국면 상태 문장 낱말(transitGuide_boardingContext* · guide_band_transitWaiting)
RIDE_HINTS = ("탑승 중", "정거장", "하차")  # 승차 국면(transitGuide_context* · guide_band_transitRiding)


def late() -> bool:
    return time.time() - T0 > BUDGET


def doubled(line: str) -> bool:
    """앞 조각(첫 쉼표까지)이 같은 줄에 두 번 이상 나오면 중복 출력이다. 4자 이상만 본다."""
    head = line.split(",")[0].replace("BT", "").strip()
    return len(head) >= 4 and line.count(head) > 1


def say(lines: list[str], tail: int = 12) -> None:
    for o in lines[-tail:]:
        print(f"   > {o}", flush=True)


def lcd_since(since: str) -> list[str]:
    return [norm(o) for o in h7.lcd(since)]


def seek(pred, first: str = "next", limit: int = 14) -> str | None:
    """`find`와 같은 방식으로, 줄이 조건 함수를 만족할 때까지 커서를 옮긴다."""
    keys = {"next": "space 4", "prev": "space 1"}
    other = "prev" if first == "next" else "next"
    for direction, count in ((first, limit), (other, limit * 2)):
        seen = ""
        for _ in range(count):
            if late():
                return None
            line = current(press(keys[direction], label=f"{direction}→조건"))
            if line and pred(line):
                time.sleep(1.2)
                return line
            if line and line == seen:
                break
            seen = line or seen
    return None


def guard(step: str) -> bool:
    """각 단계 전: 길동무가 앞인가. 앱 메뉴(팝업)가 초점을 쥐고 있어도 앱이 맨 앞이면 통과."""
    if late():
        record("INFO", f"{step}: 시간 예산 소진, 건너뜀")
        return False
    if smoke.in_app() or smoke.app_on_top():
        return True
    record("FAIL", f"{step}: 길동무가 앞이 아님", smoke.focus())
    return False


def sh(*args: str, timeout: int = 30) -> str:
    return subprocess.run(["adb", "-s", SERIAL, "shell", *args], capture_output=True, text=True, timeout=timeout, errors="replace").stdout


def guide_notification_lines() -> list[str]:
    """길동무 알림 줄 수만 본다(알림 본문은 개인 정보가 실릴 수 있어 pkg·id 줄만 남긴다)."""
    out = sh("dumpsys", "notification")
    return [norm(l) for l in out.splitlines() if "pkg=space.dodoplanet.gildongmu" in l]


def screen_awake() -> bool:
    return "mWakefulness=Awake" in sh("dumpsys", "power")


def land_after(started: str, wait: float) -> list[str]:
    time.sleep(wait)
    out = lcd_since(started)
    say(out)
    return out


def sheet_lines(limit: int = 30) -> list[str]:
    lines: list[str] = []
    for _ in range(limit):
        if late():
            break
        line = current(press("space 4", label="시트 줄"))
        if lines and line == lines[-1]:
            break
        if line:
            lines.append(line)
        if L_STOP in line:
            break
    return lines


# ── 1. 앱 실행과 새 소식 창 ────────────────────────────────────────────
def step_notice() -> bool:
    started = h7.now()
    h7.launch(f"{smoke.PACKAGE}/.MainActivity", wait=6)
    if not smoke.in_app():
        record("FAIL", "앱 실행", smoke.focus())
        return False
    if "notice" in SKIP:
        record("INFO", "새 소식 창 단계 건너뜀(H7_SKIP)")
        return True
    out = lcd_since(started)
    say(out)
    landed = next((o for o in out if L_NOTICE_TITLE in o), None)
    # 앱이 이미 앞에 있었으면 실행이 제목을 다시 내지 않는다 — 줄을 거슬러 찾아 본다(착지 판정은 못 한다).
    seen = landed or find(L_NOTICE_TITLE, first="prev", limit=12)
    if not seen:
        record("INFO", "새 소식 창 없음(이미 확인함)")
        return True
    record("PASS" if landed else "INFO", "새 소식 창 제목 착지", (landed or "앱이 이미 떠 있어 착지는 판정하지 않음")[:60])
    order: list[str] = []
    close = None
    for _ in range(14):
        line = current(press("space 4", label="새 소식 줄"))
        if not line or (order and line == order[-1]):
            break
        order.append(line)
        print(f"   | {line}", flush=True)
        if L_NOTICE_CLOSE in line and "시트" not in line:
            close = line
            break
    heads = [o for o in order if "무엇이 달라졌나요" in o or "유의해야 할 것" in o]
    record("INFO", "새 소식 창 줄 순서(헤딩·본문)", f"줄 {len(order)}개, 헤딩 {len(heads)}개")
    if not close:
        close = find(L_NOTICE_CLOSE, limit=10)
    if not close:
        record("FAIL", "새 소식 창 「닫기」 도달")
        return False
    since = h7.now()
    enter(4)
    after = lcd_since(since)
    say(after, 6)
    record("INFO", "새 소식 창 닫은 뒤 커서 줄", (current(after) or "출력 없음")[:60])
    return True


# ── 2. 검색 → 길찾기 ─────────────────────────────────────────────────
def step_search(query: str) -> bool:
    if not guard("검색"):
        return False
    if not find(SEARCH_TAB, first="prev"):
        record("FAIL", "검색 탭 찾기")
        return False
    enter(3)
    if not find(PLACE_FIELD):
        record("FAIL", "검색 편집창 찾기")
        return False
    enter(2.5)
    press("8 space", wait=1.5, label="한글 입력")
    h7.type_text(query, "ko")
    out = enter(6)
    say(out, 4)
    if not any("검색 결과" in o for o in out):
        record("FAIL", "검색 결과 통지", " / ".join(out)[-120:])
        return False
    row = current(out)
    if "검색 결과" in row or not row:
        row = current(press("space 4", label="첫 결과"))
    record("PASS", "검색 결과 첫 줄", row[:60])
    enter(4)
    if not find(DIRECTIONS):
        record("FAIL", "장소 상세의 「여기까지 길찾기」")
        return False
    enter(10)
    time.sleep(5)  # 세 수단 조회가 끝나기를 기다린다
    return True


# ── 3. 시작 버튼 ─────────────────────────────────────────────────────
def step_start_button() -> str | None:
    if not guard("시작 버튼"):
        return None
    start = find(L_START_FMT.format(name=L_RECOMMENDED), limit=SCAN_LIMIT)
    if not start:
        # 이름이 다른 경로의 버튼이라도 있으면 그것으로 계속한다.
        start = seek(lambda l: l.endswith("안내 시작") or ("안내 시작" in l and "자동차" not in l and "도보" not in l), limit=SCAN_LIMIT)
    if not start:
        head = find("대중교통", first="prev", limit=SCAN_LIMIT)
        record("INFO" if head else "WARN", "대중교통 「안내 시작」 단추 없음", "대중교통 결과는 있으나 단추 없음(안내 가능 경로 아님)" if head else "대중교통 결과 머리(route.public)를 찾지 못함")
        return None
    record("FAIL" if doubled(start) else "PASS", "「안내 시작」 단추 한 번 출력", start[:50])
    prev = current(press("space 1", label="펼침 줄"))
    time.sleep(0.5)
    if L_RECOMMENDED in prev and "안내 시작" not in prev:
        record("PASS", "단추가 펼침 줄 바로 다음 항목", prev[:40])
    else:
        record("FAIL", "단추가 펼침 줄 바로 다음 항목", f"앞 줄: {prev[:40]}")
    press("space 4", label="단추로 복귀")
    return start


# ── 4. 누르고 시트 착지 ──────────────────────────────────────────────
def step_open_sheet() -> str:
    """시트를 연 뒤 어떤 시트가 섰는지 「walk」「transit」「none」으로 돌려준다."""
    if not guard("안내 시작"):
        return "none"
    started = h7.now()
    enter(10)
    for _ in range(3):  # 권한 창(위치·알림)이 차례로 뜰 수 있다. 상한 3번.
        if smoke.in_app():
            break
        smoke.dismiss_system_dialogs()
        time.sleep(3)
    if not smoke.in_app() and not smoke.app_on_top():
        record("FAIL", "안내 시작 뒤 앱 복귀", smoke.focus())
        return "none"
    out = land_after(started, 8)
    bridge = next((o for o in out if L_BRIDGE in o), None)
    if bridge:
        record("INFO", "승차 전 도보 시작 실패의 다리 문장", bridge[:70])
    landing = current(out)
    record("INFO", "시트 선 뒤 첫 커서 줄", (landing or "출력 없음")[:70])
    walk_title = find(L_WALK_TITLE, first="prev", limit=12)
    if walk_title:
        record("PASS", "승차 전 도보 시트 제목 「도보 안내, …」", walk_title[:60])
        row = current(press("space 4", label="도보 첫 정보 행"))
        record("INFO", "도보 시트 제목 다음 줄", row[:60])
        arrived = seek(lambda l: " 도착 버튼" in l and "남은" not in l and "추정" not in l, limit=SCAN_LIMIT)  # 정규화 출력 「BT {역} 도착 버튼 …」
        if not arrived:
            record("INFO", "승차 전 도보 컨트롤(「{역} 도착」) 못 찾음", "위치 신호가 없으면 서지 않을 수 있다")
            return "walk"
        record("PASS", "승차 전 도보 컨트롤 도달", arrived[:40])
        since = h7.now()
        enter(6)
        for _ in range(2):
            if not smoke.in_app():
                smoke.dismiss_system_dialogs()
        say(land_after(since, 6), 6)
        return "transit"
    return "transit"


def check_transit_sheet() -> None:
    if not guard("대중교통 시트"):
        return
    title = find(L_TRANSIT_TITLE, first="prev", limit=16)
    if not title:
        record("FAIL", "대중교통 시트 제목 「대중교통 안내, …」", "도보 제목만 있거나 시트가 서지 않음")
        return
    record("PASS", "대중교통 시트 제목", title[:60])
    lines = [title] + sheet_lines()
    for l in lines:
        print(f"   | {l}", flush=True)
    status = next((l for l in lines[1:4] if any(h in l for h in WAIT_HINTS + RIDE_HINTS)), None)
    record("PASS" if status else "WARN", "제목 다음 상태 문장 행(E38 착지)", (status or "제목 뒤 3줄에 상태 낱말 없음")[:60])
    record("PASS" if lines and L_STOP in lines[-1] else "WARN", "순서 끝에 「안내 종료」", lines[-1][:30] if lines else "")
    twice = [l for l in lines if doubled(l)]
    record("FAIL" if twice else "PASS", "시트 줄 한 번 출력", twice[0][:60] if twice else "")


# ── 5. 띠바 ─────────────────────────────────────────────────────────
def check_band() -> None:
    if not guard("띠바"):
        return
    mini = find(L_MINIMIZE, first="prev", limit=SCAN_LIMIT)
    if not mini:
        record("WARN", "「안내 시트 접기」 못 찾음")
        return
    enter(4)
    if not smoke.app_on_top():
        record("FAIL", "시트 접은 뒤 앱 앞", smoke.focus())
        return
    band = find(L_RESTORE, limit=20) or find(L_RESTORE, first="prev", limit=20)
    if not band:
        record("FAIL", "띠바 줄(「안내 시트 펼치기」) 없음")
        return
    record("PASS", "띠바 줄 도달", band[:60])
    started = h7.now()
    enter(5)
    out = land_after(started, 4)
    landing = current(out)
    ok = any(h in landing for h in WAIT_HINTS + RIDE_HINTS) and "안내 시트" not in landing
    record("PASS" if ok else "WARN", "띠바를 다시 열면 상태 문장 행에 앉음", (landing or "출력 없음")[:60])


# ── 9b. 차량 후보 20초 ───────────────────────────────────────────────
def check_candidates_stay() -> None:
    if not guard("차량 후보"):
        return
    cand = seek(lambda l: "탑승" not in l and ("행" in l or "분" in l or "도착" in l) and "안내" not in l and "남은" not in l, limit=SCAN_LIMIT)
    if not cand:
        record("INFO", "차량 후보 줄에 닿지 못함", "실내라 후보가 없거나 줄 판별 실패(실사용 판정 몫)")
        return
    record("INFO", "차량 후보로 간주한 줄", cand[:50])
    since = h7.now()
    time.sleep(20)
    out = lcd_since(since)
    say(out, 8)
    moved = [o for o in out if o and o != cand]
    record("PASS" if not moved else "WARN", "20초 머무는 동안 커서 줄 변화 없음", f"새 출력 {len(moved)}줄: {moved[0][:40] if moved else ''}")


# ── 6a. 승차 ────────────────────────────────────────────────────────
def step_board() -> bool:
    if not guard("승차"):
        return False
    btn = find(L_BOARD_ALREADY, limit=SCAN_LIMIT)
    if not btn:
        record("INFO", "「이미 탔어요」 못 찾음", "대기 국면이 아니거나 후보 선택 흐름(실승차 판정 몫)")
        return False
    started = h7.now()
    enter(5)
    # 급행 질문이 뜨면 일반 열차로 넘긴다.
    pre = lcd_since(started)
    if any("급행인가요" in o for o in pre):
        if find("일반 열차", limit=8):
            enter(5)
    out = land_after(started, 4)
    ride = next((o for o in out if any(h in o for h in RIDE_HINTS)), None)
    record("PASS" if ride else "WARN", "승차 국면 진입(탑승 중·남은 정거장)", (ride or "출력에 승차 낱말 없음")[:60])
    return bool(ride)


# ── 9a. 경유역 목록·상세 ─────────────────────────────────────────────
def check_via_list() -> None:
    if not guard("경유역 목록"):
        return
    via = find(L_VIA, limit=SCAN_LIMIT)
    if not via:
        record("INFO", "경유역 줄 못 찾음", "이 경로에 경유 목록 없음")
        return
    record("INFO", "경유 줄", via[:40])
    enter(3)
    first = current(press("space 4", label="첫 경유역"))
    for _ in range(3):
        if "전화" not in first:  # 전화 걸기 단추는 누르지 않는다
            break
        first = current(press("space 4", label="전화 건너뜀"))
    record("INFO", "펼친 뒤 다음 줄(경유역 행)", first[:50])
    before_focus = smoke.focus()
    enter(4)
    if smoke.focus() != before_focus or not smoke.in_app():
        press("f4", wait=3, label="ESC 상세에서 복귀")
        back = current(press("space 4", label="복귀 줄 확인"))
        record("PASS" if first[:6] in back or back == first else "WARN", "상세에서 뒤로 오면 그 줄에 앉음", f"앉은 줄: {back[:40]}")
    else:
        record("INFO", "경유역 행 활성화가 다른 창을 열지 않음", "상세 화면이 없는 구조일 수 있음")
    nxt = current(press("space 4", label="펼침 유지 확인"))
    record("INFO", "펼침 유지(다음 줄이 경유역 행인지 판정 몫)", nxt[:50])


# ── 9c. 화면 밖으로 나갔다 돌아오기 ──────────────────────────────────
def check_leave_and_return() -> None:
    if not guard("화면 밖 왕복"):
        return
    sh("am", "start", "-a", "android.intent.action.MAIN", "-c", "android.intent.category.HOME")
    time.sleep(3)
    started = h7.now()
    h7.launch(f"{smoke.PACKAGE}/.MainActivity", wait=6)
    if not smoke.in_app():
        record("FAIL", "다른 앱에 갔다 돌아옴", smoke.focus())
        return
    out = land_after(started, 3)
    landing = current(out)
    record("INFO", "돌아온 뒤 착지 줄(시트가 서고 상태 문장 행이 기대값)", (landing or "출력 없음")[:60])


# ── 7. 화면 끔 ──────────────────────────────────────────────────────
def check_screen_off(boarded: bool) -> None:
    """`boarded`: 승차 대기·승차 중인가. 대중교통 상주 알림(keep-alive)은 그 두 국면에만 켜진다 — 차량 고르기 전에는 알림이 없는 것이 정상이다."""
    if not guard("화면 끔"):
        return
    sh("input", "keyevent", "26")
    time.sleep(2)
    off = not screen_awake()
    record("PASS" if off else "WARN", "전원 키로 화면 꺼짐", "")
    time.sleep(15)
    mid = guide_notification_lines()
    record("INFO", "화면 꺼진 채 15초 뒤 길동무 알림 줄 수", str(len(mid)))
    sh("input", "keyevent", "26")
    time.sleep(3)
    if "Keyguard" in smoke.focus() or "StatusBar" in smoke.focus() or not screen_awake():
        sh("input", "keyevent", "82")  # 잠금 해제 시도(MENU). 한소네 잠금 방식은 선례 없음: 불확실
        time.sleep(2)
    if not smoke.in_app():
        record("INFO", "화면 켠 뒤 앱이 앞이 아님(잠금 화면 해제 못 함)", smoke.focus())
        sh("am", "start", "-a", "android.intent.action.MAIN", "-c", "android.intent.category.LAUNCHER", "-n", f"{smoke.PACKAGE}/.MainActivity")
        time.sleep(4)
        if not smoke.in_app():
            return
    after = guide_notification_lines()
    if boarded:
        record("PASS" if after else "FAIL", "화면 켠 뒤 안내 알림이 남음(승차 국면)", f"알림 줄 {len(after)}개")
    else:
        record("INFO", "화면 켠 뒤 알림 줄 수(차량 고르기 전, 상주 알림 없음이 정상)", str(len(after)))
    title = find(L_TRANSIT_TITLE, first="prev", limit=16)
    record("PASS" if title else "FAIL", "화면 켠 뒤 시트가 남음", (title or "시트 제목 못 찾음")[:50])


# ── 6b. 하차와 알림 ─────────────────────────────────────────────────
def check_alight() -> None:
    if not guard("하차"):
        return
    adv = find(L_ADVANCE, limit=SCAN_LIMIT)
    if not adv:
        record("INFO", "「다음 구간」 못 찾음", "하차 선언 단추는 하차 근접 때만 선다: 실승차 판정 몫")
        return
    record("INFO", "하차 선언에 쓰는 단추", adv[:50])
    if "도보" in adv:
        record("INFO", "남은 도보 안내 시작 단추라 누르지 않음", adv[:50])
        return
    started = h7.now()
    enter(6)
    out = land_after(started, 4)
    arrived = any("도착" in o or "내리" in o for o in out)
    time.sleep(4)
    notes = guide_notification_lines()
    if arrived:
        record("PASS" if not notes else "FAIL", "하차(arrived) 직후 안내 알림이 남지 않음", f"알림 줄 {len(notes)}개")
    else:
        record("INFO", "하차 직후 알림 판정 못 함(다음 구간이 이어짐, 실승차 판정 몫)", f"알림 줄 {len(notes)}개")


# ── 8. 안내 종료 ────────────────────────────────────────────────────
def check_stop() -> None:
    if not guard("안내 종료"):
        return
    stop = find(L_STOP, limit=SCAN_LIMIT)
    if not stop:
        record("FAIL", "「안내 종료」 도달")
        return
    record("PASS", "「안내 종료」 도달", stop[:30])
    enter(5)
    after = find("안내 시작", first="prev", limit=SCAN_LIMIT)
    record("PASS" if after else "WARN", "종료 뒤 길찾기 화면의 시작 버튼이 다시 보임", (after or "못 찾음")[:50])


def run(query: str) -> None:
    if not step_notice():
        return
    if not step_search(query):
        return
    if not step_start_button():
        return
    kind = step_open_sheet()
    if kind == "none":
        return
    if kind == "walk":
        record("INFO", "승차 전 도보 시트에 머묾", "대중교통 시트 단계(5~7·9)를 건너뛰고 종료 단계로 감")
        check_stop()
        return
    if "sheet" not in SKIP:
        check_transit_sheet()
        check_band()
    check_candidates_stay()
    if step_board():
        check_via_list()
        check_leave_and_return()
        check_screen_off(boarded=True)
        check_alight()
    else:
        check_screen_off(boarded=False)
    check_stop()


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
            run(sys.argv[1] if len(sys.argv) > 1 else "국립중앙박물관")  # 역은 상세 배치가 길어 「여기까지 길찾기」가 아래에 있다 — 먼 비역 장소
    finally:
        smoke.cleanup()
    print("\n결과")
    for status, name, detail in smoke.results:
        print(f"  {status}  {name}  {detail}")
    return 1 if any(s == "FAIL" for s, _, _ in smoke.results) else 0


if __name__ == "__main__":
    sys.exit(main())
